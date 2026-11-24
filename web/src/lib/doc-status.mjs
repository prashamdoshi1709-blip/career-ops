// Local customisation (2026-11-11): one answer, everywhere, to "does this job
// have its own CV and cover letter, and can I use them?". Read by Today, All Job
// Opportunities and Documents, and by the queue's eligibility preview.
//
// Status values: not-generated | queued | generating | ready | needs-review |
// failed | skipped | outdated. "ready" requires BOTH a finished generation AND a
// quality record from the current generator whose verdict is "ready".
// File reads only: no Claude call.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { readPdfIndex } from "./pipeline-details.mjs";
import { readQueue } from "./doc-queue-store.mjs";
import { readStore as readInstructions } from "./application-instructions.mjs";

const APPLIED = /^(applied|responded|assessment|interview|offer|hired|rejected)$/i;
const SKIPPED = /^(skip|discarded)$/i;
// Job boards whose public API returns the full job description (liveness-api.mjs JD_TEXT_API_ATS).
// Programmes for current students only.
const STUDENT_ONLY = /\b(intern(ship)?|vacation (program|programme|scheme)|summer (intern|program)|off-cycle|work experience program)\b/i;
const JD_API_HOSTS = /myworkdayjobs\.com|smartrecruiters\.com|greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|zohorecruit/i;

// One shared definition (2026-11-15): see posting-id.mjs.
import { postingIdFor } from "./posting-id.mjs";
import { latestQualityRecord } from "./latest-quality.mjs";
export { postingIdFor };
export const jobKey = (j) => (j.kind === "tracked" ? `t${j.n}` : `p${postingIdFor(j.url)}`);

/** Documents saved under any posting URL a tracked row carries (its own URL or a merged source), or null. */
export function trackedPostingDocs(postingDocs, j) {
  const urls = [j.url, j.applyUrl, ...(j.sources ?? []).map((s) => s.url)].filter((u) => /^https?:\/\//.test(String(u ?? "")));
  for (const u of urls) { const d = postingDocs?.[postingIdFor(u)]; if (d?.cv) return d; }
  return null;
}

const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const generatorVersion = (root) => readJson(path.join(root, "data", "cv-original", "version.json"), {}).generator ?? "";

/** Newest quality record in a documents folder. */
// 2026-11-22: includes saved free rechecks (latest-quality.mjs).
function latestQuality(dir) {
  return latestQualityRecord(dir);
}

const relToApps = (root, abs) => { const base = path.join(root, "output", "applications") + path.sep; return abs && abs.startsWith(base) ? abs.slice(base.length) : null; };

/**
 * Documents and status for every job from buildOpportunities().
 * @returns {Record<string, {key:string, state:string, reason:string, cv:string|null, cover:string|null, needCover:boolean, generatedAt:string|null, verdict:string|null, eligible:boolean, exclude:string, priority:number, queue:object|null}>}
 */
export function docStatuses(root, jobs) {
  const index = readPdfIndex(root);
  const posting = readJson(path.join(root, "data", "posting-docs.json"), {});
  const queue = readQueue(root);
  const instr = readInstructions(root).jobs ?? {};
  const current = generatorVersion(root);
  const out = {};
  for (const j of jobs) {
    const key = jobKey(j);
    const q = queue.items[key] ?? null;
    const confidential = /^Confidential/.test(j.company);
    const needCover = !confidential;
    let cvAbs = null, coverAbs = null, reportNum = null;
    if (j.kind === "tracked") {
      reportNum = j.docN ? String(Number(j.docN)) : null;
      const d = (reportNum && index.get(reportNum)) || {};
      cvAbs = d.cv ?? null; coverAbs = d.cover ?? null;
      // 2026-11-11: a scan find marked Applied becomes a tracker row with no report,
      // so its documents are still filed under the posting. Without this they
      // read as "Not generated" (and could be queued again) once the job was Applied.
      if (!cvAbs) {
        const p = trackedPostingDocs(posting, j);
        if (p) {
          cvAbs = path.join(root, p.cv); coverAbs = p.cover ? path.join(root, p.cover) : null;
          if (!fs.existsSync(cvAbs)) cvAbs = null;
          if (coverAbs && !fs.existsSync(coverAbs)) coverAbs = null;
        }
      }
    } else {
      const d = posting[key.slice(1)] ?? {};
      cvAbs = d.cv ? path.join(root, d.cv) : null; coverAbs = d.cover ? path.join(root, d.cover) : null;
      if (cvAbs && !fs.existsSync(cvAbs)) cvAbs = null;
      if (coverAbs && !fs.existsSync(coverAbs)) coverAbs = null;
    }
    const cv = relToApps(root, cvAbs), cover = relToApps(root, coverAbs);
    const quality = cvAbs ? latestQuality(path.dirname(cvAbs)) : null;
    const docsAt = [cvAbs, coverAbs].filter(Boolean).map((f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } });
    const newest = docsAt.length ? Math.max(...docsAt) : null;

    // Why this job should not use Claude tokens.
    let exclude = "";
    if (APPLIED.test(j.status ?? "")) exclude = `Already ${j.status}: documents stay exactly as submitted`;
    else if (SKIPPED.test(j.status ?? "")) exclude = `Marked ${j.status}`;
    else if (j.availability === "Closed") exclude = "Posting closed or expired";
    else if (STUDENT_ONLY.test(j.title ?? "")) exclude = "Student internship or vacation programme (your MBA is completed, so you are unlikely to be eligible)";
    else if (j.kind === "inbox" && !JD_API_HOSTS.test(j.url) && !fs.existsSync(path.join(root, "data", "posting-jobs", `${key.slice(1)}.json`))) exclude = `No job description available: ${j.sources?.[0]?.label ?? "this site"} pages are not read automatically. Paste the description on the job's Review page and it becomes eligible.`;

    let state = "not-generated", reason = "";
    if (cv) {
      if (!quality) { state = "needs-review"; reason = "No quality check on record (made before the current generator)"; }
      else if (quality.generator !== current) { state = "needs-review"; reason = "Checked under earlier rules; run Check quality on the job page"; }
      else if (quality.verdict === "ready") state = "ready";
      else { state = "needs-review"; reason = quality.verdict === "not-ready" ? "A quality check failed; see the job page" : "Some checks require review; see the job page"; }
      if (needCover && !cover && state === "ready") { state = "needs-review"; reason = "CV ready; the cover letter was not created (see the quality panel)"; }
      // Outdated: instructions or a manually added job's description changed after the documents.
      const ins = reportNum ? instr[reportNum] : null;
      if (newest && ins?.updatedAt && Date.parse(ins.updatedAt) > newest + 1000) { state = "outdated"; reason = "Your instructions for this job were edited after these documents were made"; }
      if (newest && j.jdUpdatedAt && Date.parse(j.jdUpdatedAt) > newest) { state = "outdated"; reason = "The job description was edited after these documents were made"; }
    }
    if (q && ["queued", "generating"].includes(q.state)) { state = q.state; reason = q.state === "generating" ? "Being generated now" : "Waiting in the queue"; }
    else if (q && q.state === "failed" && !cv) { state = "failed"; reason = q.lastError || "Generation failed"; }
    else if (q && q.state === "skipped" && !cv) { state = "failed"; reason = q.reason; }
    // Excluded from generation is NOT a document problem: it stays "Not generated", with the reason.
    if (!cv && exclude && !["queued", "generating", "failed"].includes(state)) { state = "not-generated"; reason = exclude; }

    const eligible = !exclude && !cv && !["queued", "generating"].includes(state);
    out[key] = { key, state, reason, cv, cover, needCover, generatedAt: quality?.generatedAt ?? (newest ? new Date(newest).toISOString() : null), verdict: quality?.verdict ?? null, eligible, exclude, priority: priorityOf(j), queue: q ? { state: q.state, attempts: q.attempts, lastError: q.lastError } : null };
  }
  return out;
}

// Your order (2026-11-11): 1 IB and M&A, 2 corporate finance and transaction
// advisory, 3 financial modelling and valuations, 4 equity research, 5 corporate
// strategy, 6 management consulting, 7 other finance. The category decides first;
// within it, higher suitability and a closer deadline go first.
const CATEGORY_TIERS = [
  [/Investment Banking & M&A/, 7],
  [/Corporate Finance|Transaction Services|Commercial Due Diligence/, 6],
  [/Valuations|Financial Modelling/, 5],
  [/Equity Research/, 4],
  [/Corporate Strategy/, 3],
  [/Management Consulting|Strategy Consulting|Performance Improvement|Business Transformation/, 2],
  [/Corporate & Institutional Banking|Portfolio & Asset Management/, 3],
  [/Financial Analyst|Investment, PE/, 1],
];
export function priorityOf(j, today = new Date()) {
  let p = ((CATEGORY_TIERS.find(([re]) => re.test(j.category ?? "")) ?? [null, 0])[1]) * 100 + (j.score ?? 5) * 10;
  const d = Date.parse(j.deadline);
  if (Number.isFinite(d)) { const days = (d - today.getTime()) / 864e5; if (days >= 0 && days <= 7) p += 15; else if (days >= 0 && days <= 14) p += 8; }
  return Math.round(p * 10) / 10;
}

/** What "Generate missing documents" would do, with a usage estimate from measured runs. */
export function previewBatch(root, jobs, statuses) {
  // The same company and title listed twice (two locations or two boards) gets
  // one set of documents: the higher-priority listing is kept.
  const seen = new Map();
  const dup = new Set();
  const norm = (x) => String(x ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  for (const j of jobs.filter((x) => statuses[jobKey(x)]?.eligible).sort((a, b) => statuses[jobKey(b)].priority - statuses[jobKey(a)].priority)) {
    const k = `${norm(j.company)}|${norm(j.title)}`;
    if (seen.has(k)) dup.add(jobKey(j)); else seen.set(k, j);
  }
  const eligible = jobs.filter((j) => statuses[jobKey(j)]?.eligible && !dup.has(jobKey(j))).sort((a, b) => statuses[jobKey(b)].priority - statuses[jobKey(a)].priority);
  const excluded = jobs.filter((j) => !statuses[jobKey(j)]?.eligible && !statuses[jobKey(j)]?.cv && !["queued", "generating"].includes(statuses[jobKey(j)]?.state));
  const groups = {};
  if (dup.size) groups["Duplicate of another listing of the same role"] = dup.size;
  for (const j of excluded) { if (dup.has(jobKey(j))) continue; const r = statuses[jobKey(j)].reason || statuses[jobKey(j)].exclude || "Not eligible"; const g = r.replace(/:.*$/, ""); groups[g] = (groups[g] ?? 0) + 1; }
  const q = readQueue(root);
  const runs = Object.values(q.items).filter((i) => i.usage);
  const fromQuality = measuredUsage(root);
  const all = [...runs.map((i) => i.usage), ...fromQuality];
  const avg = all.length
    ? { tokens: Math.round(all.reduce((s, u) => s + (u.inputTokens ?? 0) + (u.outputTokens ?? 0), 0) / all.length), cost: all.some((u) => u.costUsd != null) ? all.reduce((s, u) => s + (u.costUsd ?? 0), 0) / all.filter((u) => u.costUsd != null).length : null, runs: all.length, measured: true }
    // Until real runs are recorded here: the 5-job test batch of 2026-11-11
    // (81k to 91k tokens, US$0.28 to US$0.79 per job as reported by Claude Code).
    : { tokens: 85000, cost: 0.54, runs: 5, measured: false, basis: "5-job test batch, 11 Nov 2026" };
  return {
    eligible: eligible.map((j) => ({ key: jobKey(j), kind: j.kind, n: j.n ?? null, url: j.url, company: j.company, title: j.title, location: j.location, cover: statuses[jobKey(j)].needCover, priority: statuses[jobKey(j)].priority, score: j.score })),
    cvs: eligible.length,
    covers: eligible.filter((j) => statuses[jobKey(j)].needCover).length,
    perJob: avg,
    estimateTokens: avg.tokens * eligible.length,
    estimateCostUsd: avg.cost == null ? null : Math.round(avg.cost * eligible.length * 100) / 100,
    excluded: groups,
  };
}

/** Token use recorded in quality records by generations since usage capture began. */
export function measuredUsage(root) {
  const base = path.join(root, "output", "applications");
  const out = [];
  for (const d of fs.existsSync(base) ? fs.readdirSync(base) : []) {
    const dir = path.join(base, d);
    try { for (const f of fs.readdirSync(dir).filter((x) => /^Quality check .*\.json$/.test(x))) { const r = readJson(path.join(dir, f), null); if (r?.usage && !r.revision) out.push(r.usage); } } catch { /* not a folder */ }
  }
  return out;
}
