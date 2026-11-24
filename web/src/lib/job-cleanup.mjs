// Local customisation (2026-11-11): permanent removal of jobs rated below the
// minimum suitability (default 6.5/10, set in Config).
//
// planCleanup() is read-only and lists exactly what would be removed and why.
// applyCleanup() removes those jobs from the operating data:
//   - tracker rows: tracker.mjs delete --num N (the canonical delete), then the
//     row's report, merged tracker-addition TSV, status-log lines, cached JD
//     analysis, per-job instructions and queue entry;
//   - scan finds: the line in data/pipeline.md, any saved posting and queue entry;
//   - every deleted URL keeps ONE minimal scan-history row (url, date, status
//     "suppressed_low_score", nothing else) so the scanner never re-adds it.
// Protected, never removed whatever the score: Applied / Responded / Assessment /
// Interview / Offer / Hired, anything with a follow-up, anything with documents.
// No Claude call.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { buildOpportunities } from "./opportunities.mjs";
import { parseApplications } from "./tracker-table.mjs";
import { trackedPostingDocs } from "./doc-status.mjs";

export const SETTINGS_FILE = (root) => path.join(root, "data", "dashboard-settings.json");
// screeningGate: the screen's score from which a job may go on to a detailed
// evaluation. Screens run lower than detailed evaluations (calibrated on
// 2026-11-11: 7 jobs rated 6.6 to 8.4 in detail screened 4.0 to 7.6), so the
// gate is below the deletion minimum. Screening itself never deletes.
export const DEFAULT_SETTINGS = { minSuitability: 6.5, applyToPreliminary: false, autoCleanup: true, screeningGate: 5.5 };
export function readSettings(root) {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE(root), "utf8")) }; } catch { return { ...DEFAULT_SETTINGS }; }
}
export function writeSettings(root, patch) {
  const next = { ...readSettings(root), ...patch };
  const t = Number(next.minSuitability);
  if (!Number.isFinite(t) || t < 0 || t > 10) throw new Error("the minimum must be between 0 and 10");
  next.minSuitability = Math.round(t * 10) / 10;
  const g = Number(next.screeningGate);
  next.screeningGate = Number.isFinite(g) && g >= 0 && g <= 10 ? Math.round(g * 10) / 10 : DEFAULT_SETTINGS.screeningGate;
  const f = SETTINGS_FILE(root);
  fs.writeFileSync(`${f}.tmp`, JSON.stringify(next, null, 2) + "\n");
  fs.renameSync(`${f}.tmp`, f);
  return next;
}

const PROTECTED = /^(applied|responded|assessment|interview|offer|hired)$/i;
const SUPPRESSED = "suppressed_low_score";
const read = (f) => { try { return fs.readFileSync(f, "utf8"); } catch { return ""; } };
const linkHref = (c) => (String(c ?? "").match(/\]\((https?:[^)\s]+)\)/) ?? [])[1] ?? (String(c ?? "").match(/https?:\/\/\S+/) ?? [])[0] ?? "";
// One shared definition (2026-11-15): see posting-id.mjs.
import { postingIdFor } from "./posting-id.mjs";

export function loadJobs(root, codeRoot) {
  const md = read(path.join(root, "data", "applications.md"));
  const apps = md ? parseApplications(md, root, codeRoot) : [];
  return { apps, ...buildOpportunities(root, apps) };
}

/** Read-only: which jobs fall below the minimum, which are protected, and why. */
export function planCleanup(root, codeRoot, settings = readSettings(root)) {
  const { jobs, apps } = loadJobs(root, codeRoot);
  const followups = read(path.join(root, "data", "follow-ups.md"));
  const index = read(path.join(root, "data", "pdf-index.tsv"));
  const postingDocs = (() => { try { return JSON.parse(read(path.join(root, "data", "posting-docs.json")) || "{}"); } catch { return {}; } })();
  const min = settings.minSuitability;
  const remove = [], protectedJobs = [], pending = [], conflicts = [], keep = [];
  for (const j of jobs) {
    const hasFollowup = j.kind === "tracked" && new RegExp(`^\\|\\s*${j.n}\\s*\\|`, "m").test(followups);
    // A tracked row made from a scan find keeps its documents under the posting (2026-11-11).
    const hasDocs = j.kind === "tracked" ? index.split("\n").some((l) => l.split("\t")[0] && String(Number(l.split("\t")[0])) === String(Number(j.docN))) || Boolean(trackedPostingDocs(postingDocs, j)) : Boolean(postingDocs[postingIdFor(j.url)]);
    const base = { key: j.kind === "tracked" ? `t${j.n}` : `p${postingIdFor(j.url)}`, kind: j.kind, n: j.n, company: j.company, title: j.title, url: j.url, score: j.score, ratingType: j.ratingType, status: j.status };
    if (j.kind === "tracked" && (PROTECTED.test(j.status) || hasFollowup)) { protectedJobs.push({ ...base, why: PROTECTED.test(j.status) ? j.status : "has a follow-up" }); continue; }
    if (j.score == null) { pending.push(base); continue; }
    // A tracked row whose Notes state a different suitability than its report is ambiguous: flag, never delete.
    if (j.kind === "tracked") {
      const m = String(j.notes ?? "").match(/Suitability\s*([\d.]+)\s*\/\s*10/i);
      if (m && Math.abs(Number(m[1]) - j.score) > 0.15) { conflicts.push({ ...base, noted: Number(m[1]) }); continue; }
    }
    if (j.score >= min) { keep.push(base); continue; }
    // Only a detailed evaluation (or, if you opt in, a preliminary rating) can remove a job.
    // A screening score never does: it is a cheap first look, not an assessment.
    if (j.ratingType === "Screened") { pending.push({ ...base, why: "screened only; a detailed evaluation decides" }); continue; }
    if (j.ratingType === "Preliminary" && !settings.applyToPreliminary) { pending.push({ ...base, why: "preliminary rating only" }); continue; }
    if (hasDocs) { protectedJobs.push({ ...base, why: "has generated documents" }); continue; }
    remove.push({ ...base, why: `${j.ratingType} rating ${j.score}/10 is below ${min}` });
  }
  return { at: new Date().toISOString(), minSuitability: min, applyToPreliminary: settings.applyToPreliminary, total: jobs.length, trackerRows: apps.length, remove, protected: protectedJobs, keep, pending, conflicts };
}

function rewrite(file, fn) {
  const before = read(file);
  if (!before) return 0;
  const lines = before.split("\n");
  const kept = lines.filter((l, i) => !fn(l, i));
  if (kept.length === lines.length) return 0;
  fs.writeFileSync(`${file}.tmp`, kept.join("\n"));
  fs.renameSync(`${file}.tmp`, file);
  return lines.length - kept.length;
}

/** Permanently remove the planned jobs. Returns counts per store. */
export function applyCleanup(root, codeRoot, plan, today = new Date().toISOString().slice(0, 10)) {
  const done = { tracker: 0, reports: 0, inbox: 0, processed: 0, scanHistoryRemoved: 0, suppressed: 0, statusLog: 0, cache: 0, tsv: 0, instructions: 0, queue: 0, postings: 0, errors: [] };
  if (!plan.remove.length) return done;
  const apps = loadJobs(root, codeRoot).apps;
  const urls = new Set();
  // Tracked rows, highest number first, through the canonical delete.
  for (const r of plan.remove.filter((x) => x.kind === "tracked").sort((a, b) => Number(b.n) - Number(a.n))) {
    const app = apps.find((a) => String(a.n) === String(r.n));
    if (!app) continue;
    if (PROTECTED.test(app.status)) { done.errors.push(`#${r.n} became ${app.status}; kept`); continue; }
    const reportFile = (String(app.report ?? "").match(/\(([^)]+\.md)\)/) ?? [])[1];
    const reportNum = (String(app.report ?? "").match(/\[(\d+)\]/) ?? [])[1];
    const d = spawnSync(process.execPath, [path.join(codeRoot, "tracker.mjs"), "delete", "--num", String(r.n)], { cwd: codeRoot, env: { ...process.env, CAREER_OPS_ROOT: root }, encoding: "utf8" });
    if (d.status !== 0) { done.errors.push(`#${r.n}: ${(d.stderr || d.stdout).trim().split("\n")[0]}`); continue; }
    done.tracker++;
    // tracker.mjs delete keeps "applications.md.bak" (the tracker with the deleted
    // row in it). Removed jobs are not archived inside the app, so it goes too.
    const bak = (d.stderr.match(/before the delete: (\S+)/) ?? [])[1];
    if (bak && bak.endsWith("applications.md.bak") && fs.existsSync(bak)) fs.rmSync(bak);
    for (const u of [linkHref(app.url), r.url]) if (u) urls.add(u);
    if (reportFile) {
      const rp = path.join(root, "reports", path.basename(reportFile));
      const reportUrl = (read(rp).match(/^\*\*URL:\*\*\s*(https?:\S+)/m) ?? [])[1];
      if (reportUrl) urls.add(reportUrl);
      if (fs.existsSync(rp)) { fs.rmSync(rp); done.reports++; }
    }
    if (reportNum) {
      const cache = path.join(root, "data", "cv-original", "cache");
      for (const f of fs.existsSync(cache) ? fs.readdirSync(cache) : []) if (f.startsWith(`jd-${reportNum}-`)) { fs.rmSync(path.join(cache, f)); done.cache++; }
      const merged = path.join(root, "batch", "tracker-additions", "merged");
      for (const f of fs.existsSync(merged) ? fs.readdirSync(merged) : []) if (new RegExp(`^0*${Number(reportNum)}-`).test(f)) { fs.rmSync(path.join(merged, f)); done.tsv++; }
    }
    done.statusLog += rewrite(path.join(root, "data", "status-log.tsv"), (l) => l.split("\t")[0] === String(r.n));
    // pipeline.md Processed lines that point at this report.
    if (reportNum) done.processed += rewrite(path.join(root, "data", "pipeline.md"), (l) => /^\s*-\s*\[x\]/.test(l) && new RegExp(`#0*${Number(reportNum)}\\b`).test(l));
    // Per-job instructions keyed by report number.
    const ip = path.join(root, "data", "application-instructions.json");
    try { const s = JSON.parse(read(ip)); if (reportNum && s.jobs?.[String(Number(reportNum))]) { delete s.jobs[String(Number(reportNum))]; fs.writeFileSync(ip, JSON.stringify(s, null, 2) + "\n"); done.instructions++; } } catch { /* none */ }
  }
  // Scan finds in the inbox.
  const inboxUrls = new Set(plan.remove.filter((x) => x.kind === "inbox").map((x) => x.url));
  done.inbox += rewrite(path.join(root, "data", "pipeline.md"), (l) => /^\s*-\s*\[ \]/.test(l) && [...inboxUrls].some((u) => l.includes(u)));
  for (const u of inboxUrls) {
    urls.add(u);
    const pj = path.join(root, "data", "posting-jobs", `${postingIdFor(u)}.json`);
    if (fs.existsSync(pj)) { fs.rmSync(pj); done.postings++; }
  }
  // Queue entries.
  const qp = path.join(root, "data", "doc-queue.json");
  try { const q = JSON.parse(read(qp)); for (const r of plan.remove) if (q.items?.[r.key] && !["generating"].includes(q.items[r.key].state)) { delete q.items[r.key]; done.queue++; } fs.writeFileSync(qp, JSON.stringify(q, null, 2) + "\n"); } catch { /* no queue */ }
  // Scan history: drop the content rows, keep one minimal suppression row per URL.
  const sh = path.join(root, "data", "scan-history.tsv");
  const text = read(sh);
  if (text) {
    const lines = text.split("\n");
    const header = lines[0];
    const cols = header.split("\t").length;
    let dropped = 0;
    const body = lines.slice(1).filter((l) => l.trim() && !(urls.has(l.split("\t")[0]) && ++dropped));
    for (const u of urls) { const row = new Array(cols).fill(""); row[0] = u; row[1] = today; row[5] = SUPPRESSED; body.push(row.join("\t")); done.suppressed++; }
    const kept = [header, ...body, ""];
    done.scanHistoryRemoved = dropped;
    fs.writeFileSync(`${sh}.tmp`, kept.join("\n"));
    fs.renameSync(`${sh}.tmp`, sh);
  }
  return done;
}

/** URLs suppressed after a low score (so a removed job is not shown again). */
export function suppressedUrls(root) {
  const set = new Set();
  for (const l of read(path.join(root, "data", "scan-history.tsv")).split("\n")) { const c = l.split("\t"); if (c[5] === SUPPRESSED && c[0]) set.add(c[0]); }
  return set;
}

/** Automatic removal of NEW below-minimum jobs (Config → remove automatically), at most every 5 minutes. */
export function autoCleanup(root, codeRoot, { now = Date.now() } = {}) {
  const settings = readSettings(root);
  if (!settings.autoCleanup) return null;
  const stateFile = path.join(root, "data", ".cleanup-state.json");
  let st = {};
  try { st = JSON.parse(fs.readFileSync(stateFile, "utf8")); } catch { st = {}; }
  if (st.lastRun && now - Date.parse(st.lastRun) < 5 * 60 * 1000) return null;
  const plan = planCleanup(root, codeRoot, settings);
  const res = plan.remove.length ? applyCleanup(root, codeRoot, plan) : null;
  const removed = plan.remove.length && res ? plan.remove.length - res.errors.length : 0;
  fs.writeFileSync(stateFile, JSON.stringify({ lastRun: new Date(now).toISOString(), lastRemoved: removed, totalRemoved: (st.totalRemoved ?? 0) + removed }, null, 2));
  return { removed };
}
