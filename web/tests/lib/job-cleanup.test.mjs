import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { planCleanup, applyCleanup, writeSettings, readSettings, suppressedUrls } from "../../src/lib/job-cleanup.mjs";

const CODE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const row = (n, company, score, status, notes = "") => `| ${n} | 2026-11-09 | ${company} | — | Analyst | ${score} | ${status} | ❌ | [${String(n).padStart(3, "0")}](../reports/${String(n).padStart(3, "0")}-x${n}-2026-11-09.md) | ${notes} | [seek](https://au.seek.com/job/${n}) |`;
function sandbox() {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), "jc-"));
  for (const d of ["data", "reports", "batch/tracker-additions/merged", "data/cv-original"]) fs.mkdirSync(path.join(r, d), { recursive: true });
  // The generator version file lives in the git-ignored user layer; a clean
  // checkout has none, so a minimal one stands in (the code falls back the same way).
  const ver = path.join(CODE, "data/cv-original/version.json");
  if (fs.existsSync(ver)) fs.copyFileSync(ver, path.join(r, "data/cv-original/version.json"));
  else fs.writeFileSync(path.join(r, "data/cv-original/version.json"), JSON.stringify({ generator: "test" }));
  const rows = [row(1, "Exact", "3.25/5", "Evaluated"), row(2, "Below", "3.2/5", "Evaluated"), row(3, "Above", "3.3/5", "Evaluated"), row(4, "Protected", "2/5", "Applied"), row(5, "Unscored", "N/A", "Evaluated"), row(6, "Conflict", "3/5", "Evaluated", "Suitability 7.4/10")];
  fs.writeFileSync(path.join(r, "data/applications.md"), `# Applications Tracker\n\n| # | Date | Company | Via | Role | Score | Status | PDF | Report | Notes | URL |\n|---|---|---|---|---|---|---|---|---|---|---|\n${rows.join("\n")}\n`);
  for (let n = 1; n <= 6; n++) fs.writeFileSync(path.join(r, "reports", `${String(n).padStart(3, "0")}-x${n}-2026-11-09.md`), `# R\n\n**Date:** 2026-11-09\n**URL:** https://au.seek.com/job/${n}\n\n## Job Description (archived verbatim)\n\nAnalyst role.\n`);
  fs.writeFileSync(path.join(r, "data/scan-history.tsv"), "url\tfirst_seen\tportal\ttitle\tcompany\tstatus\n" + [1, 2, 3].map((n) => `https://au.seek.com/job/${n}\t2026-11-04\tseek\tAnalyst\tX${n}\tadded`).join("\n") + "\n");
  fs.writeFileSync(path.join(r, "data/pipeline.md"), "# Pipeline\n\n## Pending\n\n## Processed\n");
  return r;
}

test("6.5 is kept, 6.4 is removed, protected and unscored are kept, conflicts are flagged", () => {
  const r = sandbox();
  const p = planCleanup(r, CODE);
  const names = (xs) => xs.map((x) => x.company).sort();
  assert.deepEqual(names(p.remove), ["Below"]);
  assert.ok(names(p.keep).includes("Exact"), "exactly 6.5 stays");
  assert.ok(names(p.keep).includes("Above"));
  assert.deepEqual(names(p.protected), ["Protected"]);
  assert.deepEqual(names(p.pending), ["Unscored"]);
  assert.deepEqual(names(p.conflicts), ["Conflict"]);
});

test("applying removes the row, its report and history content, and leaves one suppression row", () => {
  const r = sandbox();
  const res = applyCleanup(r, CODE, planCleanup(r, CODE), "2026-11-11");
  assert.equal(res.tracker, 1);
  assert.equal(res.errors.length, 0);
  const t = fs.readFileSync(path.join(r, "data/applications.md"), "utf8");
  assert.ok(!/\| Below \|/.test(t) && /\| Exact \|/.test(t) && /\| Protected \|/.test(t));
  assert.ok(!fs.existsSync(path.join(r, "reports/002-x2-2026-11-09.md")));
  assert.ok(suppressedUrls(r).has("https://au.seek.com/job/2"));
  const hist = fs.readFileSync(path.join(r, "data/scan-history.tsv"), "utf8");
  assert.ok(!hist.includes("\tX2\t"), "no content kept for the removed job");
  assert.ok(!fs.existsSync(path.join(r, "data/applications.md.bak")), "no in-app copy of the old tracker");
  assert.equal(planCleanup(r, CODE).remove.length, 0, "idempotent");
});

test("the minimum is adjustable and validated", () => {
  const r = sandbox();
  assert.equal(readSettings(r).minSuitability, 6.5);
  writeSettings(r, { minSuitability: 7 });
  assert.ok(planCleanup(r, CODE).remove.map((x) => x.company).includes("Exact"));
  assert.throws(() => writeSettings(r, { minSuitability: 11 }));
});
