// Local customisation (2026-11-10): "My Instructions for This Application".
//
// One JSON file in the user layer, data/application-instructions.json, keyed by
// report number (a job's stable id). Each job keeps its own instructions; nothing
// is copied to another job unless the candidate presses "Copy from". Read by
// data/cv-original/generate.mjs at generation and revision time. Saving never
// calls Claude.

import fs from "node:fs";
import path from "node:path";

export const TONES = ["", "Natural", "Professional", "Concise", "Confident"];
export const EMPHASES = ["", "Investment Banking", "Management Consulting", "Strategy Consulting", "Corporate Finance", "Valuations", "Equity Research", "Financial Analysis", "Client Communication and Stakeholder Engagement"];
const MAX = 4000;

export const storePath = (root) => path.join(root, "data", "application-instructions.json");
export const keyOf = (reportNum) => (/^\d+$/.test(String(reportNum ?? "")) ? String(Number(reportNum)) : null);

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
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2) + "\n");
  fs.renameSync(tmp, p); // atomic replace
}

const text = (s) => String(s ?? "").replace(/\r\n?/g, "\n").replace(/\u0000/g, "").trim().slice(0, MAX);

/** Clean an instructions entry from the form. */
export function cleanEntry(raw = {}) {
  return {
    general: text(raw.general),
    cv: text(raw.cv),
    cover: text(raw.cover),
    tone: TONES.includes(raw.tone) ? raw.tone : "",
    emphasis: EMPHASES.includes(raw.emphasis) ? raw.emphasis : "",
  };
}

export const isEmpty = (e) => !e || !(e.general || e.cv || e.cover || e.tone || e.emphasis);

/** Saved instructions for one job (empty fields when none). */
export function getInstructions(root, reportNum) {
  const k = keyOf(reportNum);
  const e = k ? readStore(root).jobs[k] : null;
  return { ...cleanEntry(e ?? {}), updatedAt: e?.updatedAt ?? null, label: e?.label ?? "", revisions: Array.isArray(e?.revisions) ? e.revisions : [] };
}

/** Save (or clear, when every field is empty) one job's instructions. Revision history is kept. */
export function saveInstructions(root, reportNum, raw, { label = "", now = new Date().toISOString() } = {}) {
  const k = keyOf(reportNum);
  if (!k) throw new Error("report number required");
  const store = readStore(root);
  const prev = store.jobs[k] ?? {};
  const entry = cleanEntry(raw);
  if (isEmpty(entry) && !(prev.revisions ?? []).length) delete store.jobs[k];
  else store.jobs[k] = { ...entry, label: String(label).slice(0, 160) || prev.label || "", updatedAt: now, revisions: prev.revisions ?? [] };
  writeStore(root, store);
  return getInstructions(root, k);
}

/** Record a revision request (the feedback text and which documents). */
export function recordRevision(root, reportNum, { docs, feedback, now = new Date().toISOString() }) {
  const k = keyOf(reportNum);
  if (!k) return;
  const store = readStore(root);
  const prev = store.jobs[k] ?? { ...cleanEntry({}), label: "", updatedAt: now };
  prev.revisions = [...(prev.revisions ?? []), { at: now, docs, feedback: text(feedback) }].slice(-20);
  store.jobs[k] = prev;
  writeStore(root, store);
}

/** Other jobs with saved instructions, for "Copy from another job". */
export function listOthers(root, exceptReportNum) {
  const k = keyOf(exceptReportNum);
  return Object.entries(readStore(root).jobs)
    .filter(([key, e]) => key !== k && !isEmpty(cleanEntry(e)))
    .map(([key, e]) => ({ reportNum: key, label: e.label || `Report ${key}`, ...cleanEntry(e) }));
}
