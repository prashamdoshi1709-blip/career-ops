// A count written as a compound modifier ("~14-company peer set", "3–4 company
// models") supports the same count in plain words (2026-11-22 regression).
// Fictional source only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { auditClaims } from "../verify-cv-facts.mjs";

const SOURCE = "- Built 3–4 company models from filings.\n- Maintained a ~14-company listed peer set.\n- Rated hotels on a 5-star scale.";

test("a compound count in the source supports the plain count", () => {
  assert.deepEqual(auditClaims("I maintained comparables across 14 companies.", SOURCE).invented, []);
  assert.deepEqual(auditClaims("I built models for 3–4 companies.", SOURCE).invented, []);
  assert.deepEqual(auditClaims("I maintained a ~14-company peer set.", SOURCE).invented, []);
});

test("a different count is still invented, in either form", () => {
  assert.deepEqual(auditClaims("I maintained comparables across 20 companies.", SOURCE).invented, ["20 companies"]);
  assert.deepEqual(auditClaims("I built 6 company models.", SOURCE).invented, ["6 companies"]);
});

test("a compound modifier that is not a count noun adds nothing", () => {
  assert.deepEqual(auditClaims("I rated 5 stars.", SOURCE).invented.length, auditClaims("I rated 5 stars.", "").invented.length);
});
