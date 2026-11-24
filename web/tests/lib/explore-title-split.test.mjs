// Explore: comma-separated titles are alternatives (2026-11-24), and the
// default posting window matches the scheduled sweeps (30 days).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseExplorePatch, DEFAULT_FILTERS } from "../../src/lib/explore.ts";

test("a comma-separated title string becomes several titles; locations keep commas", () => {
  const f = parseExplorePatch({ positive: "Investment Banking Analyst, M&A Associate; Private Credit Analyst", negative: "Intern, Graduate", allow: "Sydney, NSW" }, DEFAULT_FILTERS);
  assert.deepEqual(f.positive, ["Investment Banking Analyst", "M&A Associate", "Private Credit Analyst"]);
  assert.deepEqual(f.negative, ["Intern", "Graduate"]);
  assert.deepEqual(f.allow, ["Sydney, NSW"]);
});

test("an array of titles is unchanged", () => {
  assert.deepEqual(parseExplorePatch({ positive: ["Valuations Analyst", "Corporate Development"] }, DEFAULT_FILTERS).positive, ["Valuations Analyst", "Corporate Development"]);
});

test("the default posting window is 30 days", () => {
  assert.equal(DEFAULT_FILTERS.sinceDays, 30);
});
