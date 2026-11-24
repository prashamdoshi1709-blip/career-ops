// 2026-11-13: a count binds to the phrase it describes, never past a preposition.
// "3–5 questions for an IT services call" was reported as the invented claim
// "5 services"; real counts must still be extracted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { metricClaims } from "../verify-cv-facts.mjs";

const claims = (s) => [...metricClaims(s)];

test("a count does not jump over a preposition to a later noun", () => {
  assert.deepEqual(claims("Live mandate diligence: pre-call analysis and 3–5 questions for an IT services call"), []);
  assert.deepEqual(claims("Prepared 4 memos with the services team"), []);
});

test("genuine counts are still extracted", () => {
  assert.deepEqual(claims("Managed 45 staff across 3 sites"), ["45 staff", "3 sites"]);
  assert.deepEqual(claims("Built 12 services for 3 clients"), ["12 services", "3 clients"]);
  assert.deepEqual(claims("Supported 200 users per day"), ["200 users"]);
  assert.deepEqual(claims("15+ years of experience"), ["15 years"]);
  assert.deepEqual(claims("~5 live Cloud Run deployments"), ["5 deployments"]);
});

test('"of" still links a count to its noun', () => {
  assert.deepEqual(claims("Served 20 of the largest clients"), ["20 clients"]);
});
