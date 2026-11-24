// The newest quality result for a documents folder (2026-11-22). A free
// recheck saves its own record under "Quality rechecks/"; when it is newer
// than the generation record, its checks, verdict and rules version replace
// the generation record's for display and status, and everything else (usage,
// instructions, revision, analysis) still comes from the generation record.
// Read only.
import fs from "node:fs";
import path from "node:path";

const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
const newest = (dir, re) => {
  try {
    return fs.readdirSync(dir).filter((f) => re.test(f)).map((f) => ({ f: path.join(dir, f), t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t)[0] ?? null;
  } catch { return null; }
};

export function latestQualityRecord(dir) {
  const g = newest(dir, /^Quality check .*\.json$/);
  const r = newest(path.join(dir, "Quality rechecks"), /\.json$/);
  const gen = g ? readJson(g.f) : null;
  const rec = r ? readJson(r.f) : null;
  if (!rec) return gen;
  const genAt = Date.parse(gen?.generatedAt ?? "") || g?.t || 0;
  const recAt = Date.parse(rec.checkedAt ?? "") || r.t;
  if (gen && genAt > recAt) return gen;
  return { ...(gen ?? {}), quality: rec.quality, validation: rec.validation, verdict: rec.verdict, generator: rec.generator, recheck: { checkedAt: rec.checkedAt, checkerVersion: rec.checkerVersion, previous: rec.previous ?? null, changes: rec.changes ?? [], file: path.relative(dir, r.f) } };
}
