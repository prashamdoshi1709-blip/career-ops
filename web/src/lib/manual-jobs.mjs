// Local customisation (2026-11-10): jobs added by hand from the dashboard
// ("+ Add Job Manually" on All Job Opportunities).
//
// A manual job becomes an ordinary tracker row with a short report that archives
// the pasted job description, so everything else already works on it: the job
// page, status changes (set-status.mjs), follow-ups, the pipeline table and the
// shared CV + cover letter generator (data/cv-original/generate.mjs, which reads
// the JD from the report's "## Job Description" section).
//
// Writes go through the canonical writers only:
//   - report number: reserve-report-num.mjs
//   - new row, or a changed company / role / URL: a tracker-addition TSV merged
//     by merge-tracker.mjs (matched on the row's report link)
//   - removal: tracker.mjs delete --num N
// No Claude call anywhere in this module.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { normCompany, normTitle, readInbox } from "./opportunities.mjs";

export const SOURCES = ["LinkedIn", "SEEK", "Company website", "Other"];
const MANUAL_RE = /^\*\*Source:\*\*\s*Manual\b/m;

// ---------- small helpers ----------

export const slugify = (s) =>
  String(s ?? "").toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, " ").replace(/[_\s]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "job";

/** One-line cell text: no pipes, tabs or line breaks (they would break the tracker table). */
const cell = (s) => String(s ?? "").replace(/[|\t\r\n]+/g, " ").replace(/\s+/g, " ").trim();

const linkHref = (c) => (String(c ?? "").match(/\]\((https?:[^)\s]+)\)/) ?? [])[1] ?? (String(c ?? "").match(/https?:\/\/\S+/) ?? [])[0] ?? "";

/** Comparable form of a posting URL: no tracking params, fragment, trailing slash or www. */
export function urlKey(u) {
  try {
    const x = new URL(String(u).trim());
    for (const k of [...x.searchParams.keys()]) if (/^(utm_|ref|refid|trk|tracking|source|src|origin)/i.test(k)) x.searchParams.delete(k);
    x.hash = "";
    return (x.host.replace(/^www\./, "").toLowerCase() + x.pathname.replace(/\/+$/, "") + (x.search || "")).toLowerCase();
  } catch {
    return "";
  }
}

export const isHttpUrl = (u) => /^https?:\/\/[^\s]+\.[^\s]+/i.test(String(u ?? "").trim());
export const jdHash = (jd) => crypto.createHash("sha256").update(String(jd ?? "").trim()).digest("hex").slice(0, 16);

// ---------- validation ----------

/** Clean the form input; returns { value } or { error }. Company, title and JD are required. */
export function validateInput(raw = {}) {
  const v = {
    company: cell(raw.company).slice(0, 120),
    role: cell(raw.role).slice(0, 160),
    location: cell(raw.location).slice(0, 120),
    url: cell(raw.url).slice(0, 600),
    deadline: cell(raw.deadline).slice(0, 40),
    source: SOURCES.includes(raw.source) ? raw.source : "Other",
    jd: String(raw.jd ?? "").replace(/\r\n?/g, "\n").replace(/\u0000/g, "").trim().slice(0, 60000),
  };
  if (!v.company) return { error: "Company name is required." };
  if (!v.role) return { error: "Job title is required." };
  if (v.jd.length < 80) return { error: "Paste the full job description (at least a few sentences)." };
  if (v.url && !isHttpUrl(v.url)) return { error: "The posting URL must start with http:// or https://." };
  if (v.deadline && !/^\d{4}-\d{2}-\d{2}$/.test(v.deadline)) return { error: "Use the date picker for the deadline (YYYY-MM-DD)." };
  return { value: v };
}

// ---------- the report ----------

/** Markdown report for a manual job. The JD section stays last: generate.mjs reads everything after its heading. */
export function buildManualReport(v, { num, today, jdUpdatedAt = null, verification = "" }) {
  const lines = [
    `# Manually added: ${v.company} — ${v.role}`,
    "",
    `**Date:** ${today}`,
    `**Source:** Manual (${v.source})`,
    `**Location:** ${v.location || "—"}`,
    `**Deadline:** ${v.deadline || "Not stated"}`,
    `**Score:** N/A (not evaluated; ask for an AI evaluation from the job page if you want one)`,
    `**URL:** ${v.url || "—"}`,
    `**Legitimacy:** not assessed (added by hand)`,
    `**Verification:** ${verification || (v.url ? "posting not checked; job description pasted by you" : "no posting URL; job description pasted by you")}`,
    `**JD hash:** ${jdHash(v.jd)}`,
  ];
  if (jdUpdatedAt) lines.push(`**JD updated:** ${jdUpdatedAt}`);
  lines.push(
    "",
    "This job was added by hand from the dashboard. It has not been scored; the job page can generate a tailored CV and cover letter from the job description below.",
    "",
    `## Job Description (archived verbatim)`,
    "",
    v.jd,
    "",
  );
  void num;
  return lines.join("\n");
}

const field = (md, label) => {
  const m = String(md).match(new RegExp(`^\\*\\*${label}:\\*\\*[ \\t]*(.*)$`, "m"));
  const s = m ? m[1].trim() : "";
  return s === "—" || /^not stated$/i.test(s) ? "" : s;
};

export const isManualReport = (md) => MANUAL_RE.test(String(md ?? ""));

/** Fields of a manual report, for the Edit Job form. */
export function parseManualReport(md) {
  if (!isManualReport(md)) return null;
  const title = (String(md).match(/^# Manually added: (.+?) — (.+)$/m) ?? []);
  return {
    company: title[1] ?? "",
    role: title[2] ?? "",
    location: field(md, "Location"),
    url: field(md, "URL"),
    deadline: field(md, "Deadline"),
    source: (field(md, "Source").match(/\((.+)\)/) ?? [])[1] ?? "Other",
    jd: (String(md).split(/^## Job Description[^\n]*\n/m)[1] ?? "").trim(),
    addedOn: field(md, "Date"),
    jdUpdatedAt: field(md, "JD updated"),
    verification: field(md, "Verification"),
  };
}

/**
 * Documents made before the JD last changed may be outdated.
 * @param {string} reportMd
 * @param {number|null} docsMtimeMs newest tailored CV / cover PDF time, or null
 */
export function docsOutdated(reportMd, docsMtimeMs) {
  const at = field(reportMd, "JD updated");
  if (!at || !docsMtimeMs) return false;
  const t = Date.parse(at);
  return Number.isFinite(t) && t > docsMtimeMs;
}

// ---------- duplicates ----------

const titleClose = (a, b) => {
  const x = normTitle(a), y = normTitle(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const shorter = x.length < y.length ? x : y, longer = x.length < y.length ? y : x;
  return shorter.length >= 8 && longer.includes(shorter);
};
const cityOf = (s) => (String(s ?? "").match(/\b(Sydney|Melbourne|Brisbane|Perth|Adelaide|Canberra|Hobart|Darwin|Parramatta|Newcastle|Gold Coast)\b/i)?.[1] ?? "").toLowerCase();

/**
 * Existing jobs that look like the same vacancy: tracker rows and inbox (scan) finds.
 * @param {string} root
 * @param {any[]} applications
 * @param {any} v
 * @param {{excludeN?: string|null}} [opts]
 * @returns {{kind:"tracked"|"inbox", n?:string, company:string, role:string, location:string, url:string, status?:string, manual?:boolean, why:string}[]}
 */
export function findDuplicates(root, applications, v, { excludeN = null } = {}) {
  const out = [];
  const ck = normCompany(v.company), uk = v.url ? urlKey(v.url) : "";
  const sameCity = (loc) => { const a = cityOf(v.location), b = cityOf(loc); return !a || !b || a === b; };
  for (const a of applications) {
    if (excludeN && String(a.n) === String(excludeN)) continue;
    const url = linkHref(a.url) || linkHref(a.notes);
    const byUrl = uk && url && urlKey(url) === uk;
    const byName = normCompany(a.company) === ck && titleClose(a.role, v.role) && sameCity(a.notes);
    if (!byUrl && !byName) continue;
    const reportFile = (String(a.report ?? "").match(/\(([^)]+\.md)\)/) ?? [])[1];
    let manual = false;
    if (reportFile) { try { manual = isManualReport(fs.readFileSync(path.join(root, "reports", path.basename(reportFile)), "utf8")); } catch { /* missing report */ } }
    out.push({ kind: "tracked", n: String(a.n), company: a.company, role: a.role, location: "", url, status: a.status, manual, why: byUrl ? "same posting URL" : "same company and job title" });
  }
  for (const j of readInbox(root)) {
    const byUrl = uk && urlKey(j.url) === uk;
    const byName = normCompany(j.company) === ck && titleClose(j.title, v.role) && sameCity(j.location);
    if (byUrl || byName) out.push({ kind: "inbox", company: j.company, role: j.title, location: j.location, url: j.url, why: byUrl ? "same posting URL" : "same company and job title" });
  }
  return out;
}

// ---------- canonical writers ----------

function run(codeRoot, root, args, timeout = 60_000) {
  const r = spawnSync(process.execPath, args, { cwd: codeRoot, env: { ...process.env, CAREER_OPS_ROOT: root }, encoding: "utf8", timeout });
  return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? (r.error ? String(r.error.message) : "") };
}

const TSV_HEAD = ["num", "date", "company", "role", "status", "score", "pdf", "report", "notes", "url"];
function writeTsv(root, row) {
  const dir = path.join(root, "batch", "tracker-additions");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${row.num}-${slugify(row.company)}.tsv`);
  fs.writeFileSync(file, TSV_HEAD.join("\t") + "\n" + TSV_HEAD.map((k) => cell(row[k])).join("\t") + "\n");
  return file;
}

const trackerFile = (root) => path.join(root, "data", "applications.md");
function trackerRowByReport(root, reportBase) {
  const t = fs.readFileSync(trackerFile(root), "utf8").split("\n");
  const line = t.find((l) => /^\|\s*\d+\s*\|/.test(l) && l.includes(`reports/${reportBase})`));
  return line ? line.split("|")[1].trim() : null;
}

/**
 * Create the report and tracker row for a manual job.
 * @returns {{ok:true, n:string, reportNum:string, report:string} | {ok:false, error:string}}
 */
export function createManualJob(codeRoot, root, v, { today, verification = "" }) {
  const res = run(codeRoot, root, [path.join(codeRoot, "reserve-report-num.mjs")]);
  const num = (res.out.match(/\b(\d{3,})\b/) ?? [])[1];
  if (res.code !== 0 || !num) return { ok: false, error: `could not reserve a report number: ${(res.err || res.out).trim().slice(0, 200)}` };
  const base = `${num}-${slugify(`${v.company} ${v.role}`)}-${today}.md`;
  const reportPath = path.join(root, "reports", base);
  try {
    fs.writeFileSync(reportPath, buildManualReport(v, { num, today, verification }), { flag: "wx" });
    writeTsv(root, {
      num: Number(num), date: today, company: v.company, role: v.role, status: "Evaluated", score: "N/A", pdf: "❌",
      report: `[${num}](reports/${base})`,
      notes: [`Added manually (${v.source})`, v.location, v.deadline ? `Deadline: ${v.deadline}` : ""].filter(Boolean).join(". ") + ".",
      url: v.url,
    });
    const m = run(codeRoot, root, [path.join(codeRoot, "merge-tracker.mjs")]);
    if (m.code !== 0) return { ok: false, error: `tracker merge failed: ${(m.err || m.out).trim().split("\n").slice(-3).join(" ").slice(0, 300)}` };
    const n = trackerRowByReport(root, base);
    if (!n) return { ok: false, error: "the tracker merge did not add the row (see merge-tracker output)" };
    return { ok: true, n, reportNum: num, report: base };
  } finally {
    run(codeRoot, root, [path.join(codeRoot, "reserve-report-num.mjs"), "--release", num]);
  }
}

function rowCells(root, n) {
  const lines = fs.readFileSync(trackerFile(root), "utf8").split("\n");
  const head = lines.find((l) => /^\|\s*#\s*\|/.test(l)).split("|").map((s) => s.trim().toLowerCase());
  const line = lines.find((l) => new RegExp(`^\\|\\s*${Number(n)}\\s*\\|`).test(l));
  if (!line) return null;
  const c = line.split("|").map((s) => s.trim());
  const get = (k) => (head.indexOf(k) >= 0 ? c[head.indexOf(k)] : "");
  return { n: get("#"), date: get("date"), company: get("company"), role: get("role"), score: get("score"), status: get("status"), pdf: get("pdf"), report: get("report"), notes: get("notes"), url: linkHref(get("url")) };
}

// Company, Role and URL cells of ONE existing row, rewritten under the shared
// tracker lock (openTrackerTransaction in tracker-utils.mjs, the lock every
// tracker writer holds) with an atomic replace. Status, score, notes and the
// report link are never touched. Runs as a child process so the web bundle does
// not pull in the core modules.
const EDIT_SCRIPT = `
import { openTrackerTransaction } from "./tracker-utils.mjs";
import { resolveTrackerPathForWrite } from "./path-resolver.mjs";
const { root, n, company, role, url } = JSON.parse(process.argv.at(-1)); // the one JSON argument after -e
const tx = await openTrackerTransaction(resolveTrackerPathForWrite(root));
try {
  const lines = tx.read().split("\\n");
  const hi = lines.findIndex((l) => /^\\|\\s*#\\s*\\|/.test(l));
  const head = lines[hi].split("|").map((s) => s.trim().toLowerCase());
  const i = lines.findIndex((l, k) => k > hi && new RegExp("^\\\\|\\\\s*" + n + "\\\\s*\\\\|").test(l));
  if (i < 0) throw new Error("row not found");
  const c = lines[i].split("|");
  if (c.length !== head.length) throw new Error("row has an unexpected number of cells; left unchanged");
  const set = (k, v) => { const j = head.indexOf(k); if (j > 0) c[j] = " " + v + " "; };
  set("company", company); set("role", role);
  if (url !== null && head.includes("url")) set("url", url ? "[" + new URL(url).host.replace(/^www\\./, "") + "](" + url + ")" : "");
  lines[i] = c.join("|");
  tx.replace(lines.join("\\n"));
} finally { tx.close(); }
console.log("ok");
`;
function editTrackerCells(codeRoot, root, n, v) {
  const r = run(codeRoot, root, ["--input-type=module", "-e", EDIT_SCRIPT, JSON.stringify({ root, n: Number(n), company: cell(v.company), role: cell(v.role), url: v.url === null ? null : cell(v.url) })]);
  return r.code === 0 && /ok/.test(r.out) ? { ok: true } : { ok: false, error: (r.err || r.out).trim().split("\n").slice(-1)[0].slice(0, 200) };
}

/** Report file (absolute) linked from tracker row n, or null. */
export function reportPathForRow(root, n) {
  const r = rowCells(root, n);
  const f = r && (r.report.match(/\(([^)]+\.md)\)/) ?? [])[1];
  return f ? path.join(root, "reports", path.basename(f)) : null;
}

/**
 * Edit a manual job. The JD and details live in its report; company, role and URL
 * changes reach the tracker through the merge. Status and notes are never changed,
 * and no document is regenerated or touched.
 * @returns {{ok:true, jdChanged:boolean} | {ok:false, error:string, status?:number}}
 */
export function updateManualJob(codeRoot, root, n, v, { now = new Date().toISOString(), verification = "" } = {}) {
  const row = rowCells(root, n);
  if (!row) return { ok: false, error: `no tracker row #${n}`, status: 404 };
  const rp = reportPathForRow(root, n);
  const md = rp && fs.existsSync(rp) ? fs.readFileSync(rp, "utf8") : "";
  if (!isManualReport(md)) return { ok: false, error: "Only jobs added manually can be edited here; evaluated jobs keep their original report.", status: 400 };
  const old = parseManualReport(md);
  const jdChanged = jdHash(old.jd) !== jdHash(v.jd);
  const keepVerification = !jdChanged && old.url === v.url ? old.verification : "";
  const next = buildManualReport(v, {
    today: old.addedOn,
    jdUpdatedAt: jdChanged ? now : old.jdUpdatedAt || null,
    verification: verification || keepVerification,
  });
  fs.writeFileSync(rp, next);
  if (row.company !== v.company || row.role !== v.role || (row.url || "") !== (v.url || "")) {
    const e = editTrackerCells(codeRoot, root, row.n, { company: v.company, role: v.role, url: (row.url || "") !== (v.url || "") ? v.url : null });
    if (!e.ok) return { ok: false, error: `report saved, but the tracker row was not updated: ${e.error}` };
  }
  return { ok: true, jdChanged };
}

/**
 * Remove a manual job that was never acted on: its tracker row (tracker.mjs delete),
 * its report and its cached JD analysis. Refused once it has documents or a status
 * other than Evaluated, so a real application record can never be removed here.
 */
export function removeManualJob(codeRoot, root, n) {
  const row = rowCells(root, n);
  if (!row) return { ok: false, error: `no tracker row #${n}`, status: 404 };
  const rp = reportPathForRow(root, n);
  const md = rp && fs.existsSync(rp) ? fs.readFileSync(rp, "utf8") : "";
  if (!isManualReport(md)) return { ok: false, error: "Only jobs added manually can be removed here.", status: 400 };
  if (row.status !== "Evaluated") return { ok: false, error: `This job is marked ${row.status}; its record is kept.`, status: 400 };
  const num = String(Number((row.report.match(/\[(\d+)\]/) ?? [])[1]));
  const idx = (() => { try { return fs.readFileSync(path.join(root, "data", "pdf-index.tsv"), "utf8"); } catch { return ""; } })();
  if (idx.split("\n").some((l) => l.split("\t")[0] && String(Number(l.split("\t")[0])) === num)) {
    return { ok: false, error: "This job has generated documents; it is kept so they stay linked.", status: 400 };
  }
  const d = run(codeRoot, root, [path.join(codeRoot, "tracker.mjs"), "delete", "--num", String(Number(n))]);
  if (d.code !== 0) return { ok: false, error: (d.err || d.out).trim().split("\n")[0] || "delete failed" };
  fs.rmSync(rp, { force: true });
  const cache = path.join(root, "data", "cv-original", "cache");
  for (const f of fs.existsSync(cache) ? fs.readdirSync(cache) : []) if (f.startsWith(`jd-${(row.report.match(/\[(\d+)\]/) ?? [])[1]}-`)) fs.rmSync(path.join(cache, f), { force: true });
  return { ok: true, backupNote: (d.err.match(/before the delete: (\S+)/) ?? [])[1] ?? null };
}

// ---------- optional posting check (no Claude) ----------

const RESTRICTED = /linkedin\.com|indeed\.|glassdoor\./i;

/**
 * Try to read the JD from the posting's public ATS API (fetch-jd.mjs) and check
 * whether the posting is live (check-liveness.mjs, API only, records nothing).
 * Sites that need a login are not fetched: the pasted JD is used instead.
 */
export function checkPosting(codeRoot, root, url) {
  if (!isHttpUrl(url)) return { ok: false, error: "Enter a posting URL first." };
  if (RESTRICTED.test(url)) {
    return { ok: true, jd: "", liveness: "not checked", message: "This site needs a login, so Career-Ops does not read it. Paste the job description from the posting; if the employer lists the same role on its own careers page, that link is better." };
  }
  const f = run(codeRoot, root, [path.join(codeRoot, "fetch-jd.mjs"), url], 30_000);
  const jd = f.code === 0 ? f.out.trim() : "";
  const l = run(codeRoot, root, [path.join(codeRoot, "check-liveness.mjs"), "--no-record", "--no-fallback", url], 45_000);
  const verdict = (l.out.match(/(active|expired|uncertain)\s+\((\w+)\)/) ?? []);
  const liveness = verdict[1] ? `${verdict[1]} (${verdict[2] === "api" ? "employer job-board API" : verdict[2]})` : "could not be confirmed";
  const message = jd
    ? "Job description read from the employer's job board. Check it, then save."
    : "This job board could not be read automatically. Your pasted job description will be used.";
  return { ok: true, jd, liveness, message };
}

/**
 * A scan find you have applied to (marked Applied in All Job Opportunities):
 * add it to the tracker through the merge, with the "no score" sentinel and no
 * report, exactly as tracker mode adds a role by hand. Never called automatically.
 */
export function addTrackedFromScan(codeRoot, root, { company, title, location, url, status = "Applied", today }) {
  const res = run(codeRoot, root, [path.join(codeRoot, "reserve-report-num.mjs")]);
  const num = (res.out.match(/\b(\d{3,})\b/) ?? [])[1];
  if (res.code !== 0 || !num) return { ok: false, error: "could not reserve a number" };
  try {
    writeTsv(root, { num: Number(num), date: today, company: cell(company), role: cell(title), status, score: "N/A", pdf: "❌", report: "—", notes: [`${status} ${today} (marked in All Job Opportunities)`, cell(location)].filter(Boolean).join(". ") + ".", url });
    const m = run(codeRoot, root, [path.join(codeRoot, "merge-tracker.mjs")]);
    if (m.code !== 0) return { ok: false, error: `tracker merge failed: ${(m.err || m.out).trim().split("\n").slice(-2).join(" ").slice(0, 200)}` };
    const t = fs.readFileSync(path.join(root, "data", "applications.md"), "utf8").split("\n").find((l) => /^\|\s*\d+\s*\|/.test(l) && l.includes(url));
    return { ok: true, n: t ? t.split("|")[1].trim() : null };
  } finally {
    run(codeRoot, root, [path.join(codeRoot, "reserve-report-num.mjs"), "--release", num]);
  }
}
