// Local customisation (2026-11-11): stable job addresses.
//
// A job page lives at /opportunities/{id}. A tracked application's id is its
// tracker number ("35"); a scan find's id is "p" + postingIdFor(its URL). When a
// scan find is marked Applied it becomes a NEW tracker row and the scan entry is
// merged into that row, so its "p…" id stopped matching anything and every link,
// refresh or Back to it showed 404 (first seen on /opportunities/pcd75bc6afd74,
// which became tracker row #35). The same happened when a find was skipped or
// left the list for any other reason.
//
// This module answers "which job does this id mean NOW?" for every id ever
// handed out, from records that never change when a status changes:
//   1. a live job whose key is the id                       → show it
//   2. a tracked row whose posting URL (or a merged source)
//      hashes to the id, or that matches the original
//      posting's company + title                             → redirect to the row
//   3. a posting known from the inbox, scan history, saved
//      job descriptions or the document queue, now hidden  → "no longer listed"
//   4. nothing anywhere                                     → genuinely unknown (404)
// Read-only: nothing here writes any file.

import fs from "node:fs";
import path from "node:path";
import { postingIdFor, jobKey } from "./doc-status.mjs";
import { normCompany, normTitle } from "./opportunities.mjs";
import { legacyPostingIdFor } from "./posting-id.mjs";

const readText = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } };
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };

/** Every posting id a job can be reached by: its own key plus each source URL it absorbed. */
export function postingIdsOf(job) {
  const urls = [job.url, job.applyUrl, ...(job.sources ?? []).map((s) => s.url)].filter((u) => /^https?:\/\//.test(String(u ?? "")));
  // Old IDs (query string dropped, before 2026-11-15) are included so links
  // handed out before the ID fix still reach the same job.
  return new Set(urls.flatMap((u) => [postingIdFor(u), legacyPostingIdFor(u)]));
}

/**
 * What is recorded about a posting id outside the live list, or null.
 * Sources: saved job descriptions, the document and evaluation queues, the
 * inbox (pending AND processed lines), and the scan history.
 */
export function postingRecord(root, id) {
  const hex = String(id).replace(/^p/, "");
  if (!/^[a-f0-9]{12}$/.test(hex)) return null;
  const saved = readJson(path.join(root, "data", "posting-jobs", `${hex}.json`), null);
  if (saved?.url) return { url: saved.url, company: saved.company ?? "", title: saved.title ?? "", location: saved.location ?? "", where: "saved job description" };
  for (const q of ["doc-queue.json", "eval-queue.json"]) {
    const it = readJson(path.join(root, "data", q), {}).items?.[`p${hex}`];
    if (it?.url) return { url: it.url, company: it.company ?? "", title: it.title ?? "", location: it.location ?? "", where: q };
  }
  let section = "";
  for (const line of readText(path.join(root, "data", "pipeline.md")).split("\n")) {
    if (line.startsWith("## ")) section = line.trim();
    const m = line.match(/^\s*-\s*\[(.)\]\s*(.+)$/);
    if (!m) continue;
    const cells = m[2].split("|").map((s) => s.trim());
    const url = cells.find((c) => /^https?:\/\//.test(c));
    if (!url || (postingIdFor(url) !== hex && legacyPostingIdFor(url) !== hex)) continue;
    const rest = cells.slice(cells.indexOf(url) + 1).filter((c) => !/^(posted|note|trust|rank):/i.test(c));
    return { url, company: rest[0] ?? "", title: rest[1] ?? "", location: rest[2] ?? "", where: m[1] === " " && section === "## Pending" ? "inbox" : "inbox (processed)" };
  }
  const hist = readText(path.join(root, "data", "scan-history.tsv")).split("\n");
  const head = (hist[0] ?? "").split("\t");
  const col = (row, name) => row[head.indexOf(name)] ?? "";
  for (const l of hist.slice(1)) {
    const row = l.split("\t");
    if (row[0] && /^https?:\/\//.test(row[0]) && (postingIdFor(row[0]) === hex || legacyPostingIdFor(row[0]) === hex)) {
      return { url: row[0], company: col(row, "company"), title: col(row, "title"), location: col(row, "location"), where: `scan history (${col(row, "status") || "seen"})` };
    }
  }
  return null;
}

/**
 * Resolve a job-page id against the current job list.
 * @param {string} root career-ops data root
 * @param {string} id the [id] route segment
 * @param {object[]} jobs buildOpportunities(...).jobs
 * @returns {{type:"job", job:object} | {type:"redirect", to:string, job:object} | {type:"gone", record:object} | {type:"unknown"}}
 */
export function resolveJobId(root, id, jobs) {
  const raw = decodeURIComponent(String(id ?? "")).trim();
  // "t35" is the internal key of tracker row 35; its page is /opportunities/35.
  const t = raw.match(/^t(\d+)$/);
  if (t) return { type: "redirect", to: `/opportunities/${t[1]}`, job: jobs.find((j) => j.kind === "tracked" && String(j.n) === t[1]) ?? null };
  if (!/^p[a-f0-9]{12}$/.test(raw)) return { type: "unknown" };
  const hex = raw.slice(1);

  const live = jobs.find((j) => jobKey(j) === raw);
  if (live) return { type: "job", job: live };

  const tracked = jobs.filter((j) => j.kind === "tracked" && j.n);
  const byUrl = tracked.find((j) => postingIdsOf(j).has(hex));
  if (byUrl) return { type: "redirect", to: `/opportunities/${byUrl.n}`, job: byUrl };

  // Merged into another live entry (a duplicate on another site).
  const absorbed = jobs.find((j) => j.kind !== "tracked" && postingIdsOf(j).has(hex));
  if (absorbed) return { type: "redirect", to: `/opportunities/${jobKey(absorbed)}`, job: absorbed };

  const record = postingRecord(root, raw);
  if (record) {
    const rec = jobs.filter((j) => j.kind === "tracked" && j.n).find((j) => postingIdFor(j.url ?? "") === postingIdFor(record.url)
      || (record.company && record.title && normCompany(j.company) === normCompany(record.company) && normTitle(j.title) === normTitle(record.title)));
    if (rec) return { type: "redirect", to: `/opportunities/${rec.n}`, job: rec };
    return { type: "gone", record: { ...record, id: raw } };
  }
  return { type: "unknown" };
}
