// Local customisation (2026-11-15): one definition of a scan find's posting ID.
//
// A posting ID is the first 12 hex characters of sha1(normalised URL). The URL
// used to be normalised by dropping everything after "?", which merged
// different jobs whose job number lives in the query string: all 1,363 Morgan
// Stanley postings (?pid=), Bain (?jobid=), Nous Group and StepStone
// (?gh_jid=) shared one ID each, so one role opened another's page and
// documents. The job-number parameters below are now kept; every other URL
// (over 99% of them) hashes exactly as before, so their IDs do not change.

import crypto from "node:crypto";

/** Query parameters that identify the job itself (compared case-insensitively). */
export const JOB_ID_PARAMS = new Set(["jobid", "job_id", "gh_jid", "pid", "jk", "vjk", "currentjobid", "reqid", "req_id", "requisitionid", "postingid", "positionid", "jid"]);

const base = (url) => String(url ?? "").trim().replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();
const sha = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 12);

/** The job-number part of a URL's query, normalised ("pid=549800002276"), or "". */
export function jobIdQuery(url) {
  const q = String(url ?? "").trim().replace(/#.*$/, "").split("?")[1];
  if (!q) return "";
  const kept = [];
  for (const part of q.split("&")) {
    const [k, v = ""] = part.split("=");
    const key = decodeURIComponentSafe(k).toLowerCase();
    if (JOB_ID_PARAMS.has(key) && v) kept.push(`${key}=${decodeURIComponentSafe(v).trim().toLowerCase()}`);
  }
  return kept.sort().join("&");
}

function decodeURIComponentSafe(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

/** Posting ID of a URL (keeps the job number when it is in the query string). */
export const postingIdFor = (url) => {
  const id = jobIdQuery(url);
  return sha(id ? `${base(url)}?${id}` : base(url));
};

/** The ID this URL had before 2026-11-15 (query dropped). Used only to keep old links working. */
export const legacyPostingIdFor = (url) => sha(base(url));
