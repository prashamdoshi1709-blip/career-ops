// The dashboard shows a saved free recheck when it is newer than the
// generation record, and keeps the generation record's other fields (2026-11-22).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { latestQualityRecord } from "../../src/lib/latest-quality.mjs";

test("newer recheck wins for checks and verdict; usage stays from generation", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-"));
  fs.writeFileSync(path.join(dir, "Quality check X.json"), JSON.stringify({ generatedAt: "2026-11-01T00:00:00Z", verdict: "not-ready", generator: "old", usage: { tokens: 1 }, quality: [{ group: "A", status: "issue" }] }));
  assert.equal(latestQualityRecord(dir).verdict, "not-ready");
  fs.mkdirSync(path.join(dir, "Quality rechecks"));
  fs.writeFileSync(path.join(dir, "Quality rechecks", "X 2026-11-22 010203.json"), JSON.stringify({ checkedAt: "2026-11-22T01:02:03Z", verdict: "check", generator: "new", checkerVersion: "abc", quality: [{ group: "A", status: "ok" }], changes: [{ group: "A", change: "status", from: "issue", to: "ok" }] }));
  const r = latestQualityRecord(dir);
  assert.equal(r.verdict, "check"); assert.equal(r.generator, "new"); assert.deepEqual(r.usage, { tokens: 1 });
  assert.equal(r.recheck.changes.length, 1);
});

test("a generation newer than the last recheck wins", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lq-"));
  fs.mkdirSync(path.join(dir, "Quality rechecks"));
  fs.writeFileSync(path.join(dir, "Quality rechecks", "X 2026-11-01.json"), JSON.stringify({ checkedAt: "2026-11-01T00:00:00Z", verdict: "check", quality: [] }));
  fs.writeFileSync(path.join(dir, "Quality check X.json"), JSON.stringify({ generatedAt: "2026-11-22T00:00:00Z", verdict: "ready", quality: [] }));
  assert.equal(latestQualityRecord(dir).verdict, "ready");
  assert.equal(latestQualityRecord(path.join(dir, "missing")), null);
});
