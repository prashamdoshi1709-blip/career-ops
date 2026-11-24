// Local customisation (2026-11-11): what a scan run found, in plain numbers.
//
// After a scheduled or manual scan, the run message shows how many roles were
// new, how many were already known (duplicates), how many boards could not be
// reached, and how many new roles came straight from an employer's own job
// system (verified at the source) rather than a job board. New roles are also
// grouped by category so the user can see where the search is finding work.
//
// Read-only: it reads data/scan-history.tsv and data/scan-runs.tsv only.

import fs from "node:fs";
import path from "node:path";

export const SCAN_GROUPS = [
  ["Equity Research", /equity research|research analyst|research associate|equities/i],
  ["Investment Banking & M&A", /investment bank|\bm&a\b|mergers|acquisition|capital markets|\becm\b|\bdcm\b|leveraged finance|corporate advisory|deal advisory|\bdeals?\b|transaction (services|advisory)|strategy & transactions|restructuring/i],
  ["Corporate Finance & Valuations", /corporate finance|valuation|fp&a|financial planning|commercial finance|treasury|financial analyst|finance analyst/i],
  ["Financial Modelling", /financial model/i],
  ["Management Consulting", /consult|generalist/i],
  ["Corporate Strategy", /strategy|strategic|corporate development|commercial analyst|growth/i],
  ["Business Transformation", /transformation|performance improvement|operations/i],
  ["Investment & Asset Management", /investment|portfolio|asset management|private equity|private credit|infrastructure|credit analyst|fund/i],
];

/** One category for a title (first match wins, in the order above). */
export function scanGroup(title) {
  const t = String(title ?? "");
  for (const [name, re] of SCAN_GROUPS) if (re.test(t)) return name;
  return "Other";
}

// Job boards and aggregators: a listing there still has to be confirmed at the employer.
const BOARD_SOURCE = /seek|jobstreet|linkedin|indeed|glassdoor|jora|adzuna|telegram|websearch|manual/i;

/** Number of lines in scan-history.tsv now (call before a run). */
export function historyMark(root) {
  try { return fs.readFileSync(path.join(root, "data", "scan-history.tsv"), "utf8").split("\n").length; } catch { return 0; }
}

/**
 * Summarise one run: rows appended to scan-history since `mark`, plus the last
 * scan-runs.tsv row for duplicates and unreachable boards.
 */
export function scanBreakdown(root, mark) {
  const lines = (() => { try { return fs.readFileSync(path.join(root, "data", "scan-history.tsv"), "utf8").split("\n"); } catch { return []; } })();
  const head = (lines[0] ?? "").split("\t");
  const col = (row, name) => row[head.indexOf(name)] ?? "";
  const added = lines.slice(Math.max(1, (mark || 1) - 1)).filter(Boolean).map((l) => l.split("\t")).filter((r) => col(r, "status") === "added");
  const groups = {};
  let verified = 0;
  for (const r of added) {
    const g = scanGroup(col(r, "title"));
    groups[g] = (groups[g] ?? 0) + 1;
    if (!BOARD_SOURCE.test(col(r, "portal"))) verified += 1;
  }
  let duplicates = 0;
  let inaccessible = 0;
  try {
    const runs = fs.readFileSync(path.join(root, "data", "scan-runs.tsv"), "utf8").trim().split("\n");
    const h = runs[0].split("\t");
    const last = runs[runs.length - 1].split("\t");
    duplicates = Number(last[h.indexOf("dupes")]) || 0;
    inaccessible = Number(last[h.indexOf("errors")]) || 0;
  } catch { /* no run log */ }
  return { newRoles: added.length, verified, duplicates, inaccessible, groups };
}

/** The run message shown in Scheduled Scans. */
export function breakdownMessage(b) {
  const groups = Object.entries(b.groups).sort((x, y) => y[1] - x[1]).map(([g, n]) => `${g} ${n}`).join(", ");
  return `Scan finished: ${b.newRoles} new role${b.newRoles === 1 ? "" : "s"} (${b.verified} verified on employer sites), ${b.duplicates} already known, ${b.inaccessible} board${b.inaccessible === 1 ? "" : "s"} unreachable.${groups ? ` New by group: ${groups}.` : ""} No evaluations or documents were started.`;
}
