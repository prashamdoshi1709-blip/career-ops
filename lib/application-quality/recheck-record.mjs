// Saved quality rechecks (2026-11-22). A free recheck runs only local checks
// and now keeps a record: a NEW timestamped file every time, never overwriting
// the generation record or an earlier recheck, with a fingerprint of the
// checker code and what changed since the previous result.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const RECHECK_DIR = "Quality rechecks";

/** sha256 (first 12) over the checker source files that exist; order-stable. */
export function checkerFingerprint(files) {
  const h = crypto.createHash("sha256");
  for (const f of [...files].sort()) { try { h.update(path.basename(f)); h.update(fs.readFileSync(f)); } catch { /* absent file: skipped */ } }
  return h.digest("hex").slice(0, 12);
}

const key = (it) => String(it.group ?? "");
const items = (rec) => (Array.isArray(rec?.quality) ? rec.quality : []);

/** Per-check changes between two quality lists: status moves, new and resolved points. */
export function qualityChanges(prev, now) {
  const before = new Map(items(prev).map((it) => [key(it), it]));
  const after = new Map(items(now).map((it) => [key(it), it]));
  const out = [];
  for (const [g, it] of after) {
    const p = before.get(g);
    if (!p) { out.push({ group: g, change: "new check", from: null, to: it.status }); continue; }
    const pl = new Set((p.list ?? []).map(String)), nl = new Set((it.list ?? []).map(String));
    const added = [...nl].filter((x) => !pl.has(x)), resolved = [...pl].filter((x) => !nl.has(x));
    if (p.status !== it.status || added.length || resolved.length) out.push({ group: g, change: p.status !== it.status ? "status" : "details", from: p.status, to: it.status, added, resolved });
  }
  // A check the previous record had but this one did not run (generation-only
  // checks such as instruction compliance are not part of a free recheck).
  for (const [g, p] of before) if (!after.has(g)) out.push({ group: g, change: "not re-run (checked only when documents are generated)", from: p.status, to: null });
  return out;
}

/** The newest earlier record for comparison: a recheck if any, else the generation record. */
export function previousRecord(jobDir, generationPattern = /^Quality check .*\.json$/) {
  const list = [];
  // Two fixed folders, one level each (not a tree walk).
  for (const [dir, re] of [[jobDir, generationPattern], [path.join(jobDir, RECHECK_DIR), /\.json$/]]) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { /* none */ }
    for (const f of names) if (re.test(f)) list.push(path.join(dir, f));
  }
  const withTime = list.map((f) => { let t = 0; try { const r = JSON.parse(fs.readFileSync(f, "utf8")); t = Date.parse(r.checkedAt ?? r.generatedAt ?? "") || fs.statSync(f).mtimeMs; } catch { /* unreadable */ } return { f, t }; });
  const best = withTime.sort((a, b) => b.t - a.t)[0];
  if (!best) return null;
  try { return { file: best.f, record: JSON.parse(fs.readFileSync(best.f, "utf8")) }; } catch { return null; }
}

/** Write a new recheck record; returns its path. Never overwrites. */
export function saveRecheck(jobDir, base, record, now = new Date()) {
  const dir = path.join(jobDir, RECHECK_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = now.toISOString().replace(/[:]/g, "").replace(/\..+$/, "").replace("T", " ");
  let file = path.join(dir, `${base} ${stamp}.json`);
  for (let i = 2; fs.existsSync(file); i++) file = path.join(dir, `${base} ${stamp} (${i}).json`);
  fs.writeFileSync(file, JSON.stringify(record, null, 2), { flag: "wx" });
  return file;
}
