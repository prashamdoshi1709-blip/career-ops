#!/usr/bin/env node
// Local customisation (2026-11-11): batch evaluation worker.
//
// Started by the dashboard (detached) when the evaluation queue has approved
// work; exits when nothing is left. Each job goes through the dashboard's own
// evaluate endpoint (/api/run, kind "evaluate"), the same path as the Evaluate
// button: the posting is read, a report with the job description archived is
// written, and the job joins the tracker with a detailed rating. Then the
// minimum-suitability rule (Config) is applied to it. One job at a time by
// default; temporary failures retried up to 3 times; a usage or rate limit
// pauses the queue for 20 minutes. Never applies to, contacts or submits anything.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const CODE = path.resolve(here, "..", "..");
const ROOT = process.env.CAREER_OPS_ROOT ? path.resolve(CODE, process.env.CAREER_OPS_ROOT) : CODE;
const ORIGIN = process.env.CAREER_OPS_DASHBOARD_ORIGIN || "http://127.0.0.1:3000";
const CLI = process.env.CAREER_OPS_EVAL_CLI || process.env.CAREER_OPS_CLI || "claude";
const lib = (f) => import(pathToFileURL(path.join(here, "..", "src", "lib", f)).href);
const { evalQueue: Q, isAlive } = await lib("doc-queue-store.mjs");
const C = await lib("job-cleanup.mjs");
const SCR = await lib("screening.mjs");
const log = (m) => fs.appendFileSync(path.join(ROOT, "data", "eval-queue.log"), `${new Date().toISOString()} ${m}\n`);
// Includes Claude plan limits, e.g. "You've hit your 5-hour limit · resets 1:50pm".
const RATE = /rate.?limit|usage limit|limit reached|hit your [\w -]*limit|5-hour limit|weekly limit|429|overloaded|too many requests|credit balance/i;
const MAX_ATTEMPTS = 3, BACKOFF_MS = Number(process.env.CAREER_OPS_EVAL_BACKOFF_MS) || 20 * 60 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let mine = false;
Q.mutateQueue(ROOT, (q) => {
  if (isAlive(q.worker?.pid) && q.worker.pid !== process.pid) return q;
  for (const it of Object.values(q.items)) if (it.state === "generating") { it.state = "queued"; it.startedAt = null; }
  q.worker = { pid: process.pid, startedAt: new Date().toISOString(), heartbeat: new Date().toISOString() };
  mine = true;
  return q;
});
if (!mine) process.exit(0);
log(`worker ${process.pid} started (${ORIGIN}, ${CLI})`);

/** One evaluation through the dashboard's evaluate endpoint; resolves with the stream's outcome. */
async function evaluate(url) {
  const res = await fetch(`${ORIGIN}/api/run`, { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: JSON.stringify({ kind: "evaluate", input: url, cliId: CLI }) });
  if (!res.ok || !res.body) return { ok: false, error: (await res.text().catch(() => "")).slice(0, 300) || `HTTP ${res.status}` };
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", done = null; const errors = [];
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      try { const ev = JSON.parse(line); if (ev.type === "error") errors.push(String(ev.msg ?? "")); if (ev.type === "done") done = ev; } catch { /* partial line */ }
    }
  }
  if (done && !errors.length) return { ok: true, tokens: done.tokens ?? 0, costUsd: done.costUsd ?? null, reportN: done.reportN ?? null };
  return { ok: false, error: errors.join(" ").slice(0, 300) || "The evaluation ended without a result", tokens: done?.tokens ?? 0, costUsd: done?.costUsd ?? null };
}

/** Score the new tracker row got, by its posting URL (detailed, from the report). */
function scoreFor(url, reportN) {
  const { jobs } = C.loadJobs(ROOT, CODE);
  // The evaluation may switch to the employer's own URL, so the report number it returned is the reliable link.
  const byReport = reportN != null ? jobs.find((x) => x.kind === "tracked" && String(Number(x.docN)) === String(Number(reportN))) : null;
  const j = byReport ?? jobs.find((x) => x.kind === "tracked" && x.url === url);
  return j ? { n: j.n, url: j.url, score: j.score, ratingType: j.ratingType } : null;
}

/** The scan find's inbox line: marked processed once evaluated (it now lives in the tracker). */
function markInboxProcessed(url) {
  const f = path.join(ROOT, "data", "pipeline.md");
  try {
    const t = fs.readFileSync(f, "utf8");
    const next = t.split("\n").map((l) => (/^\s*-\s*\[ \]/.test(l) && l.includes(url) ? l.replace("[ ]", "[x]") : l)).join("\n");
    if (next !== t) { fs.writeFileSync(`${f}.tmp`, next); fs.renameSync(`${f}.tmp`, f); }
  } catch { /* no inbox */ }
}

async function processItem(key) {
  const it = Q.readQueue(ROOT).items[key];
  log(`start ${key} ${it.company} · ${it.title}`);
  // Pass the saved job description so the evaluation never fetches the posting page.
  const desc = SCR.jdFor(ROOT, { kind: "inbox", url: it.url, company: it.company, title: it.title });
  if (!desc.jd) { Q.mutateQueue(ROOT, (q) => { Object.assign(q.items[key], { state: "failed", attempts: MAX_ATTEMPTS, lastError: "No job description saved; paste it on the job's Review page", finishedAt: new Date().toISOString() }); return q; }); return; }
  const r = await evaluate(`${it.url}\n\n<<provided-job-description>>\n${desc.jd}`);
  const usage = { inputTokens: r.tokens ?? 0, outputTokens: 0, costUsd: r.costUsd ?? null };
  if (r.ok) {
    const s = scoreFor(it.url, r.reportN);
    let state = "ready", reason = s?.score != null ? `Rated ${s.score}/10 (${s.ratingType})` : "Evaluated";
    // The minimum-suitability rule, now that a detailed rating exists.
    const settings = C.readSettings(ROOT);
    if (settings.autoCleanup) {
      const plan = C.planCleanup(ROOT, CODE, settings);
      const target = plan.remove.filter((x) => (s?.n && x.kind === "tracked" && String(x.n) === String(s.n)) || x.url === it.url);
      if (target.length) {
        // Remove the new tracker row AND the scan find's inbox line, so the job cannot reappear.
        C.applyCleanup(ROOT, CODE, { ...plan, remove: [...target, { kind: "inbox", key: it.key, url: it.url }] });
        state = "removed"; reason = `Rated ${s?.score}/10, below ${settings.minSuitability}: removed permanently`;
      }
    }
    if (state !== "removed") markInboxProcessed(it.url);
    Q.mutateQueue(ROOT, (q) => { Object.assign(q.items[key], { state, reason, n: s?.n ?? null, score: s?.score ?? null, usage, finishedAt: new Date().toISOString() }); return q; });
    log(`done ${key}: ${reason}`);
    return;
  }
  if (RATE.test(r.error)) {
    Q.mutateQueue(ROOT, (q) => { q.items[key].state = "queued"; q.items[key].startedAt = null; q.settings.backoffUntil = new Date(Date.now() + BACKOFF_MS).toISOString(); q.settings.pauseReason = "Claude usage or rate limit reached; the queue resumes automatically"; return q; });
    log(`rate limit on ${key}: backing off`);
    return;
  }
  // Retry ONLY a genuinely temporary connection problem that happened before an
  // evaluation could run. Anything else (a finished run that failed to save, no
  // report, an unreadable posting) is final: retrying repeats a full ~1.1M-token
  // run for the same outcome (2026-11-11: 10 runs were wasted this way).
  const transient = /ECONNRESET|ECONNREFUSED|connection (reset|refused)|fetch failed|socket hang up|network|HTTP 5\d\d|timed? ?out/i.test(r.error) && !(r.tokens > 0);
  const permanent = !transient;
  Q.mutateQueue(ROOT, (q) => {
    const i = q.items[key];
    i.attempts = permanent ? MAX_ATTEMPTS : (i.attempts ?? 0) + 1; i.lastError = r.error; i.usage = usage;
    if (i.attempts >= MAX_ATTEMPTS) { i.state = "failed"; i.finishedAt = new Date().toISOString(); } else { i.state = "queued"; i.startedAt = null; }
    return q;
  });
  log(`error on ${key}: ${r.error.slice(0, 160)}`);
}

const running = new Set();
try {
  for (;;) {
    let picks = [], stop = false, wait = 0;
    Q.mutateQueue(ROOT, (q) => {
      q.worker = { ...(q.worker ?? {}), pid: process.pid, heartbeat: new Date().toISOString() };
      if (q.settings.paused) { stop = running.size === 0; return q; }
      const until = q.settings.backoffUntil ? Date.parse(q.settings.backoffUntil) : 0;
      if (until > Date.now()) { wait = Math.min(until - Date.now(), 60_000); return q; }
      if (until) { q.settings.backoffUntil = null; q.settings.pauseReason = ""; }
      const slots = Math.max(1, Math.min(2, q.settings.concurrency ?? 1)) - running.size;
      const queued = Object.values(q.items).filter((i) => i.state === "queued").sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
      if (!queued.length && running.size === 0) { stop = true; return q; }
      picks = queued.slice(0, Math.max(0, slots)).map((i) => i.key);
      for (const k of picks) { q.items[k].state = "generating"; q.items[k].startedAt = new Date().toISOString(); }
      return q;
    });
    if (stop) break;
    for (const k of picks) { running.add(k); processItem(k).catch((e) => log(`crash on ${k}: ${e.message}`)).finally(() => running.delete(k)); }
    await sleep(wait || (picks.length ? 3000 : 5000));
  }
} finally {
  Q.mutateQueue(ROOT, (q) => { if (q.worker?.pid === process.pid) q.worker = null; return q; });
  log(`worker ${process.pid} stopped`);
}
