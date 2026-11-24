// Local customisation (2026-11-15): every saved version of one job's CV and
// cover letter, newest first, with what made it: version number, date, the
// Additional Instructions used and which document they applied to, and the
// quality-check result. Read from the PDFs and "Quality check *.json" records in
// the job's folder and its "Drafts after submission" folder. File reads only.

import fs from "node:fs";
import path from "node:path";
import { checkCompliance, complianceGroup } from "./instruction-compliance.mjs";
import { readCandidate } from "./candidate-profile.mjs";
// Generated files are named "<documentPrefix> Resume ..." / "<documentPrefix> Cover Letter ..."
// (prefix from data/candidate-profile.json; any prefix when it is not set).
const escRe = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PREFIX = readCandidate().documentPrefix ? `${escRe(readCandidate().documentPrefix)} ` : "(?:.* )?";
const DOC_RE = new RegExp(`^${PREFIX}(Resume|Cover Letter)`);
const CV_RE = new RegExp(`${PREFIX}Resume`), COVER_RE = new RegExp(`${PREFIX}Cover Letter`);

export const DRAFTS = "Drafts after submission";

const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };

/**
 * @param {string} root data root
 * @param {string[]} linked absolute paths of the documents currently linked to the job
 */
export function docVersions(root, linked = []) {
  const appsDir = path.join(root, "output", "applications");
  const current = new Set(linked.filter(Boolean).map((p) => path.resolve(p)));
  const bases = [...new Set([...current].map((p) => path.dirname(p)).map((d) => (path.basename(d) === DRAFTS ? path.dirname(d) : d)))];
  const dirs = bases.flatMap((d) => [d, path.join(d, DRAFTS)]).filter((d) => d.startsWith(appsDir) && fs.existsSync(d));
  const records = dirs.flatMap((d) => fs.readdirSync(d).filter((f) => /^Quality check .*\.json$/.test(f)).map((f) => ({ dir: d, rec: readJson(path.join(d, f)) })))
    .filter((r) => r.rec)
    .sort((a, b) => String(a.rec.generatedAt ?? "").localeCompare(String(b.rec.generatedAt ?? "")))
    .map((r, i) => ({ ...r, number: r.rec.version ?? i + 1 }));
  const madeBy = (dir, name, kind) => records.find((r) => r.dir === dir && r.rec[kind] === name && !(r.rec.revision && r.rec.revision[kind === "cv" ? "cvChanged" : "coverChanged"] === false));
  const out = [];
  for (const d of dirs) {
    for (const f of fs.readdirSync(d)) {
      if (!f.endsWith(".pdf") || !DOC_RE.test(f)) continue;
      const abs = path.join(d, f);
      const kind = f.includes("Cover Letter") ? "cover" : "cv";
      const r = madeBy(d, f, kind)?.rec ?? null;
      const n = madeBy(d, f, kind)?.number ?? null;
      const failed = (r?.quality ?? []).filter((q) => q.status === "issue").length;
      const review = (r?.quality ?? []).filter((q) => q.status === "review").length;
      out.push({
        file: path.relative(appsDir, abs).split(path.sep).join("/"),
        name: f,
        kind,
        at: r?.generatedAt ? Date.parse(r.generatedAt) : fs.statSync(abs).mtimeMs,
        current: current.has(path.resolve(abs)),
        draft: path.basename(d) === DRAFTS,
        version: n,
        verdict: r?.verdict ?? null,
        check: r ? (failed ? `${failed} failed` : review ? `${review} to review` : "passed") : "no record",
        instructions: r?.additionalInstructions ? { text: r.additionalInstructions.text, target: r.additionalInstructions.target } : null,
        revisedOnly: r?.revision ? r.revision.documents : null,
      });
    }
  }
  return out.sort((a, b) => b.at - a.at);
}

// ---------- Additional Instructions vs the current documents (2026-11-15) ----------

const specFor = (pdf) => (pdf ? readJson(pdf.replace(/ \(layout fix [^)]+\)\.pdf$/, ".pdf").replace(/\.pdf$/, ".json")) : null);

/** The newest quality record in the folder of the job's linked documents (not drafts). */
export function latestRecord(linked = []) {
  const dirs = [...new Set(linked.filter(Boolean).map((p) => path.dirname(path.resolve(p))).filter((d) => path.basename(d) !== DRAFTS))];
  const recs = dirs.flatMap((d) => { try { return fs.readdirSync(d).filter((f) => /^Quality check .*\.json$/.test(f)).map((f) => readJson(path.join(d, f))); } catch { return []; } }).filter(Boolean);
  return recs.sort((a, b) => String(b.generatedAt ?? "").localeCompare(String(a.generatedAt ?? "")))[0] ?? null;
}

/**
 * The job's saved Additional Instructions checked now against the documents that
 * are linked, when the latest quality record did not already check exactly these
 * instructions (it predates the check, or the instructions changed since). File
 * reads only; no Claude call. Null when there is nothing to show.
 */
export function complianceView(linked = [], instructions, record = latestRecord(linked)) {
  const text = String(instructions?.text ?? "").trim();
  if (!text) return null;
  const ai = record?.additionalInstructions;
  if (ai && ai.text === text && ai.target === instructions.target && (record.quality ?? []).some((q) => q.group === "Additional Instructions Compliance")) return null;
  const cvPdf = linked.find((p) => CV_RE.test(p ?? ""));
  const coverPdf = linked.find((p) => COVER_RE.test(p ?? ""));
  const g = complianceGroup(checkCompliance({ extra: instructions, cv: specFor(cvPdf), cover: specFor(coverPdf) }));
  if (!g) return null;
  return { ...g, detail: `Your saved instructions checked now against the current documents (no AI call). ${g.detail}`, live: true };
}
