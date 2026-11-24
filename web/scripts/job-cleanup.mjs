#!/usr/bin/env node
// Local customisation (2026-11-11): remove jobs rated below the minimum
// suitability (Config → Minimum suitability). Dry run by default.
//   node web/scripts/job-cleanup.mjs            report only (writes nothing)
//   node web/scripts/job-cleanup.mjs --apply    permanently remove the listed jobs
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const CODE = path.resolve(here, "..", "..");
const ROOT = process.env.CAREER_OPS_ROOT ? path.resolve(CODE, process.env.CAREER_OPS_ROOT) : CODE;
const C = await import(pathToFileURL(path.join(here, "..", "src", "lib", "job-cleanup.mjs")).href);
const plan = C.planCleanup(ROOT, CODE);
const brief = (xs) => xs.map((x) => `${x.kind === "tracked" ? `#${x.n}` : "scan"} ${x.score ?? "—"} ${x.ratingType ?? ""} | ${x.company} | ${x.title}${x.why ? ` | ${x.why}` : ""}`);
const report = { root: ROOT, minSuitability: plan.minSuitability, total: plan.total, remove: plan.remove.length, removeTracked: plan.remove.filter((x) => x.kind === "tracked").length, removeScan: plan.remove.filter((x) => x.kind === "inbox").length, protected: plan.protected.length, keep: plan.keep.length, pending: plan.pending.length, conflicts: plan.conflicts.length };
if (process.argv.includes("--list")) console.log(JSON.stringify({ ...report, removeList: brief(plan.remove), protectedList: brief(plan.protected), conflictList: brief(plan.conflicts) }, null, 2));
else console.log(JSON.stringify(report));
if (process.argv.includes("--apply")) console.log(JSON.stringify({ applied: C.applyCleanup(ROOT, CODE, plan) }));
