// The candidate's personal details for the dashboard (2026-11-19).
//
// Names, personal draft checks and named items
// live in the git-ignored user layer, data/candidate-profile.json, so this
// tracked code holds no personal data. Without that file everything falls back
// to neutral defaults: the dashboard still works, with generic wording.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDataRoot } from "./core/data-root.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, "..", "..", "..");
/**
 * Data root, resolved exactly as the rest of Career-Ops does it (CAREER_OPS_ROOT,
 * CAREER_OPS_DATA_DIR, then the .career-ops-data marker, then the checkout).
 */
export const dataRoot = () => resolveDataRoot(REPO, (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return null; } }, process.env, path.resolve, path.join);
/**
 * Where the profile is read from, first match wins: CAREER_OPS_CANDIDATE_FILE,
 * the data root's data/, then the checkout's own data/ (so a scratch data root,
 * as the test suite uses, keeps the candidate's rules, as before 2026-11-19).
 */
export const candidateProfilePaths = (root = dataRoot()) => [process.env.CAREER_OPS_CANDIDATE_FILE, path.join(root, "data", "candidate-profile.json"), path.join(REPO, "data", "candidate-profile.json")].filter(Boolean);
export const candidateProfilePath = (root = dataRoot()) => candidateProfilePaths(root).find((p) => fs.existsSync(p)) ?? candidateProfilePaths(root)[0];

const DEFAULTS = {
  fullName: "the candidate",
  firstName: "the candidate",
  pronoun: { himself: "themselves" },
  documentPrefix: "",
  instructionEntities: [],
  instructionRejections: [],
  reportLeadWith: null,
};

/** The profile merged over the defaults; never throws. */
export function readCandidate(root = dataRoot()) {
  let p = {};
  for (const file of candidateProfilePaths(root)) {
    try { p = JSON.parse(fs.readFileSync(file, "utf8")); break; } catch { /* absent or unreadable: try the next, then defaults */ }
  }
  return { ...DEFAULTS, ...p, pronoun: { ...DEFAULTS.pronoun, ...(p.pronoun ?? {}) } };
}

/** A [source, flags] pair (JSON-safe) as a RegExp. */
export const toRegExp = (pair) => new RegExp(pair[0], pair[1] ?? "");

/**
 * Evaluate data-driven rules: each fires when every `all` pattern matches and
 * no `none` pattern does, on the subject+body ("all") or the body ("body").
 */
export function applyRules(rules, { all = "", body = "" }, group) {
  const out = [];
  for (const r of rules ?? []) {
    if (group && r.group !== group) continue;
    const t = r.on === "body" ? body : all;
    if (r.requireBody && !body) continue;
    if ((r.all ?? []).every((p) => toRegExp(p).test(t)) && !(r.none ?? []).some((p) => toRegExp(p).test(t))) out.push({ level: r.level, text: r.text });
  }
  return out;
}
