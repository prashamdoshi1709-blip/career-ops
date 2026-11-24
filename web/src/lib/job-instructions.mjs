// Local customisation (2026-11-15): "Additional Instructions (Optional)" for one job.
//
// One JSON file in the user layer, data/job-instructions.json. Each entry belongs
// to ONE job and records every identity that job can be reached by: its page key
// (t{tracker#} or p{postingId}) and the posting ids of its URLs. So the same
// instructions are found when a scan find (p...) is marked Applied and becomes
// tracker row t{n}, and never for any other job. Kept apart from the career
// profile; never read by evaluation or screening, so ratings cannot change.
// Reading and saving are file operations only: no Claude call, no generation.

import fs from "node:fs";
import path from "node:path";
import { postingIdFor, legacyPostingIdFor } from "./posting-id.mjs";

export const TARGETS = ["both", "cv", "cover"];
export const TARGET_LABEL = { both: "Both CV and Cover Letter", cv: "CV only", cover: "Cover Letter only" };
const MAX = 4000;

// Offline tests point this at a temporary file so they never touch saved instructions.
export const storePath = (root) => process.env.CAREER_OPS_JOB_INSTRUCTIONS_FILE || path.join(root, "data", "job-instructions.json");
const validKey = (k) => /^(t\d+|p[a-f0-9]{8,40})$/.test(String(k ?? ""));

export function readStore(root) {
  try {
    const d = JSON.parse(fs.readFileSync(storePath(root), "utf8"));
    return d && typeof d === "object" && d.jobs && typeof d.jobs === "object" ? d : { version: 1, jobs: {} };
  } catch {
    return { version: 1, jobs: {} };
  }
}

function writeStore(root, store) {
  const p = storePath(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2) + "\n");
  fs.renameSync(tmp, p); // atomic replace
}

export const cleanText = (s) => String(s ?? "").replace(/\r\n?/g, "\n").replace(/\u0000/g, "").trim().slice(0, MAX);
/** @returns {"both"|"cv"|"cover"} */
export const cleanTarget = (t) => (TARGETS.includes(t) ? t : "both");

/**
 * Every id a job is known by: its page key plus the posting ids of its URLs.
 * @param {string} key
 * @param {string[]} [urls]
 * @returns {string[]}
 */
export function identitiesOf(key, urls = []) {
  const ids = new Set(validKey(key) ? [key] : []);
  for (const u of urls) {
    if (!/^https?:\/\//.test(String(u ?? ""))) continue;
    ids.add(`p${postingIdFor(u)}`);
    ids.add(`p${legacyPostingIdFor(u)}`);
  }
  return [...ids];
}

/** @type {{text: string, target: "both"|"cv"|"cover", updatedAt: string|null, key: string|null}} */
const EMPTY = { text: "", target: "both", updatedAt: null, key: null };

/**
 * The instructions saved for whichever job any of `ids` names (newest wins), or empty ones.
 * @param {string} root
 * @param {string[]} [ids]
 * @returns {{text: string, target: "both"|"cv"|"cover", updatedAt: string|null, key: string|null}}
 */
export function findInstructions(root, ids = []) {
  const want = new Set(ids.filter(Boolean));
  if (!want.size) return { ...EMPTY };
  const hits = Object.entries(readStore(root).jobs)
    .filter(([k, e]) => want.has(k) || (Array.isArray(e?.ids) && e.ids.some((i) => want.has(i))))
    .sort((a, b) => String(b[1].updatedAt ?? "").localeCompare(String(a[1].updatedAt ?? "")));
  if (!hits.length) return { ...EMPTY };
  const [k, e] = hits[0];
  return { text: cleanText(e.text), target: cleanTarget(e.target), updatedAt: e.updatedAt ?? null, key: k };
}

/**
 * Save (or clear, when the text is empty) one job's instructions under its page
 * key. Entries for the same job saved under an earlier identity (before it was
 * marked Applied, say) are replaced, so one job never has two sets.
 * @param {string} root
 * @param {string} key
 * @param {{text?: string, target?: string}} raw
 * @param {{urls?: string[], label?: string, now?: string}} [opts]
 */
export function saveInstructions(root, key, raw, { urls = [], label = "", now = new Date().toISOString() } = {}) {
  if (!validKey(key)) throw new Error("job id required");
  const ids = identitiesOf(key, urls);
  const store = readStore(root);
  for (const [k, e] of Object.entries(store.jobs)) {
    if (k === key || (Array.isArray(e?.ids) && e.ids.some((i) => ids.includes(i)))) delete store.jobs[k];
  }
  const text = cleanText(raw?.text);
  if (text) store.jobs[key] = { text, target: cleanTarget(raw?.target), ids, label: String(label).slice(0, 160), updatedAt: now };
  writeStore(root, store);
  return findInstructions(root, ids);
}
