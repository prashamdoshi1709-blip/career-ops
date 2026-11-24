// Local customisation (2026-11-09): per-application facts for the pipeline table
// and the job detail page that the tracker table itself does not carry:
// location, posting date, deadline, suitability /10, whether a tailored CV and
// cover letter exist, and a workflow stage.
//
// Read-only. Sources, in order of preference:
//   - the evaluation report header (**Location:**, **Posted:**, **Deadline:**,
//     **Suitability:**), then its Machine Summary (posting_location), then the
//     archived JD's "Posted:" line;
//   - the tracker row's Notes (a "closes …" / "deadline …" date, a city);
//   - data/pdf-index.tsv rows (kind cv / cover) whose file still exists.
// The workflow stage is DERIVED for display; the tracker's canonical status is
// never changed by this module.

import fs from "node:fs";
import path from "node:path";
// Used only at call time, so the import cycle with doc-status.mjs is harmless.
import { trackedPostingDocs } from "./doc-status.mjs";
import { latestQualityRecord } from "./latest-quality.mjs";

const CITY_RE = /\b(Sydney|Melbourne|Brisbane|Perth|Adelaide|Canberra|Hobart|Darwin|Gold Coast|Newcastle)\b/;

/** Report file basename from a tracker Report cell such as `[009](../reports/009-x.md)`. */
export function reportFileFromCell(cell) {
  const m = String(cell ?? "").match(/\(([^)]+\.md)\)/);
  return m ? path.basename(m[1]) : null;
}

/** Zero-padded-insensitive report number from a Report cell, or null. */
export function reportNumberFromCell(cell) {
  const m = String(cell ?? "").match(/\[(\d+)\]/);
  return m ? String(Number(m[1])) : null;
}

const headerField = (md, label) => {
  const m = md.match(new RegExp(`^\\*\\*${label}:\\*\\*[ \\t]*(.+)$`, "m"));
  const v = m ? m[1].trim() : "";
  return v && v !== "—" && v !== "-" ? v : "";
};

/** A display date: "2026-11-02", or "~2026-11-02" when the source says "about". */
function displayDate(raw) {
  if (!raw) return "";
  const iso = raw.match(/\d{4}-\d{2}-\d{2}/);
  if (!iso) return /not stated/i.test(raw) ? "" : raw;
  if (/^before\b/i.test(raw.trim())) return `before ${iso[0]}`;
  return /^about\b|^~/i.test(raw.trim()) ? `~${iso[0]}` : iso[0];
}

/** Facts readable from one evaluation report's markdown. */
export function parseReportFacts(md) {
  if (!md) return {};
  let location = headerField(md, "Location");
  if (!location) {
    const pl = md.match(/^posting_location:\s*"?([^"\n]+)"?\s*$/m);
    if (pl && pl[1] !== "null") location = pl[1].trim();
  }
  let posted = displayDate(headerField(md, "Posted"));
  if (!posted) {
    const jd = md.split(/^## Job Description/m)[1] ?? "";
    const p = jd.match(/^Posted:\s*(\d{4}-\d{2}-\d{2})/m);
    if (p) posted = p[1];
  }
  const deadlineRaw = headerField(md, "Deadline");
  const deadline = /not stated/i.test(deadlineRaw) ? "" : deadlineRaw;
  const suit = headerField(md, "Suitability").match(/([\d.]+)\s*\/\s*10/);
  return { location, posted, deadline, suitability: suit ? Number(suit[1]) : null };
}

/** A deadline written into the tracker Notes ("closes 2026-11-13", "Deadline: 13/11/2026"). */
export function deadlineFromNotes(notes) {
  const m = String(notes ?? "").match(/\b(?:closes|closing(?: date)?|deadline)\b[:\s]+(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{1,2} [A-Z][a-z]{2,8}(?: \d{4})?)/i);
  return m ? m[1] : "";
}

/** report number → { cv?: absPath, cover?: absPath } from data/pdf-index.tsv (existing files only). */
export function readPdfIndex(root) {
  const out = new Map();
  let text = "";
  try {
    text = fs.readFileSync(path.join(root, "data", "pdf-index.tsv"), "utf8");
  } catch {
    return out;
  }
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith("#")) continue;
    const [num, pdf, , , , kindRaw] = line.split("\t");
    if (!num || !pdf) continue;
    const kind = (kindRaw || "cv").trim() === "cover" ? "cover" : "cv";
    const abs = path.resolve(root, pdf);
    if (!abs.startsWith(path.resolve(root) + path.sep) || !fs.existsSync(abs)) continue;
    const key = String(Number(num));
    const slot = out.get(key) ?? {};
    slot[kind] = abs;
    out.set(key, slot);
  }
  return out;
}

const scoreOf = (s) => {
  const m = String(s ?? "").match(/([\d.]+)\s*\/\s*5/);
  return m ? Number(m[1]) : null;
};

/**
 * Workflow stage shown beside the canonical status:
 * New → Under Review → Ready to Apply → Applied → Interview → Offer / Rejected / Closed.
 * "Ready to Apply" needs a tailored CV and a cover letter on disk; nothing here
 * ever marks a role Applied: that comes only from the tracker status.
 */
export function workflowStage({ status, cv, cover }) {
  const s = String(status ?? "").trim().toLowerCase();
  if (s === "applied" || s === "responded") return "Applied";
  if (s === "interview" || s === "assessment") return "Interview";
  if (s === "offer" || s === "hired") return "Offer";
  if (s === "rejected") return "Rejected";
  if (s === "discarded" || s === "skip" || s === "closed") return "Closed";
  if (cv && cover) return "Ready to Apply";
  return "Under Review";
}

/** True when the newest quality record beside this CV is from the current generator and says "ready". */
export function qualityReady(root, cvAbs) {
  try {
    const dir = path.dirname(cvAbs);
    const current = JSON.parse(fs.readFileSync(path.join(root, "data", "cv-original", "version.json"), "utf8")).generator;
    const r = latestQualityRecord(dir);
    if (!r) return false;
    return r.generator === current && r.verdict === "ready";
  } catch {
    return false;
  }
}

/**
 * Details for every tracker row, keyed by the row number (`n`).
 * @param {string} root career-ops data root
 * @param {{n:string, report:string, notes:string, status:string, score:string, pdf:string, location?:string, company?:string, url?:string}[]} apps
 * @returns {Record<string, {reportNum: string|null, location: string, posted: string, deadline: string, suitability: number|null, cv: boolean, cover: boolean, docsReady: boolean, stage: string}>}
 */
export function readPipelineDetails(root, apps) {
  const index = readPdfIndex(root);
  let pd = null;
  const postingDocs = () => (pd ??= (() => { try { return JSON.parse(fs.readFileSync(path.join(root, "data", "posting-docs.json"), "utf8")); } catch { return {}; } })());
  const details = {};
  for (const a of apps) {
    let facts = {};
    const file = reportFileFromCell(a.report);
    if (file) {
      try {
        facts = parseReportFacts(fs.readFileSync(path.join(root, "reports", file), "utf8"));
      } catch {
        facts = {};
      }
    }
    const reportNum = reportNumberFromCell(a.report);
    let docs = (reportNum && index.get(reportNum)) || {};
    // 2026-11-11: a scan find marked Applied becomes a row with no report; its
    // documents stay filed under the posting (data/posting-docs.json).
    if (!docs.cv) {
      const p = trackedPostingDocs(postingDocs(), { url: a.url });
      if (p) {
        const abs = (rel) => { const f = rel ? path.join(root, rel) : null; return f && fs.existsSync(f) ? f : undefined; };
        docs = { cv: abs(p.cv), cover: abs(p.cover) };
      }
    }
    // 2026-11-11: a document counts only when its file is indexed; the tracker's
    // PDF column alone (✅) no longer marks a CV as present.
    const cv = Boolean(docs.cv);
    const cover = Boolean(docs.cover);
    // "Ready to Apply" also needs the latest quality check, from the current
    // generator, to have passed (same rule as Documents and All Job Opportunities).
    const confidential = String(a.company ?? "").trim() === "?";
    const docsReady = cv && (cover || confidential) && qualityReady(root, docs.cv);
    const location = (a.location && a.location !== "—" ? a.location : "") || facts.location || (String(a.notes ?? "").match(CITY_RE)?.[1] ?? "");
    details[a.n] = {
      reportNum,
      location,
      posted: facts.posted || "",
      deadline: facts.deadline || deadlineFromNotes(a.notes),
      suitability: facts.suitability ?? (scoreOf(a.score) != null ? Math.round(scoreOf(a.score) * 20) / 10 : null),
      cv,
      cover,
      docsReady,
      stage: workflowStage({ status: a.status, cv: docsReady, cover: docsReady }),
    };
  }
  return details;
}
