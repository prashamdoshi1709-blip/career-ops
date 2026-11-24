// Discovery coverage reader (2026-11-22): figures from the scanners' own files,
// never invented. Fictional fixtures.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { discoveryCoverage } from "../../src/lib/discovery-coverage.mjs";

test("coverage counts checked, remaining, retired and Australian employers per source", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cov-"));
  fs.mkdirSync(path.join(root, "data", "cache", "ats-companies"), { recursive: true });
  fs.writeFileSync(path.join(root, "data", "cache", "ats-companies", "lever.json"), JSON.stringify(["a", "b", "c", "d", "e"]));
  fs.writeFileSync(path.join(root, "data", "explore-coverage.json"), JSON.stringify({ version: 1, sources: { lever: { a: "2026-11-22T00:00:00Z", b: "2026-09-01T00:00:00Z" } }, au: { lever: { a: "2026-11-22T00:00:00Z" } }, lastRun: { lever: "2026-11-22T00:00:00Z" } }));
  fs.writeFileSync(path.join(root, "data", "dead-boards.tsv"), "ats\tboard\tmisses\tlast_checked\nlever\tlever:e\t3\t2026-11-20T00:00:00Z\nlever\tlever:d\t1\t2026-11-20T00:00:00Z\n");
  fs.writeFileSync(path.join(root, "data", "explore-runs.jsonl"), JSON.stringify({ at: "2026-11-22T00:00:00Z", mode: "sweep", funnel: { matched: 1 }, budgetStopped: true }) + "\n");
  const c = discoveryCoverage(root, Date.UTC(2026, 10, 22, 12));
  const lever = c.sources.find((s) => s.source === "lever");
  assert.deepEqual({ available: lever.available, retired: lever.retired, checked: lever.checked, checked30d: lever.checked30d, remaining: lever.remaining, au: lever.australianEmployers }, { available: 5, retired: 1, checked: 2, checked30d: 1, remaining: 2, au: 1 });
  assert.equal(lever.percent, 50);
  assert.equal(c.lastRun.budgetStopped, true);
  assert.equal(c.sources.find((s) => s.source === "workday").available, null, "a directory never downloaded is not recorded, not zero");
});
