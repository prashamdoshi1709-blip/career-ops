// 2026-11-13: "using ... reports, assessing revenue, EBITDA ..." was read as a
// tool named "assessing revenue". A lowercase -ing clause is what was done,
// not a tool; real tool names are still checked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeClaim, factClaims } from "../verify-cv-facts.mjs";

const source = normalizeClaim("Analysed companies using results, quarterly cash flow reports and investor presentations (revenue, EBITDA, margins, cash burn). Tools: Excel, FactSet, PowerPoint.");
const tools = (s) => factClaims(s, source).filter((c) => c.kind === "tool").map((c) => c.value);

test("an -ing clause after 'using' is not a tool claim", () => {
  const found = tools("Analysed companies using results, quarterly cash flow reports and investor presentations, assessing revenue, EBITDA and margins.");
  assert.ok(!found.some((t) => /assessing/.test(t)), JSON.stringify(found));
});

test("an unlisted tool after 'using' is still claimed", () => {
  assert.ok(tools("Built models using Bloomberg and FactSet.").includes("bloomberg"));
  assert.ok(tools("Analysed data using kubernetes clusters, tracking results.").some((t) => /kubernetes/.test(t)));
});

// 2026-11-17 (a past application): the outputs named after an -ing clause were
// read as tools ("peer comparisons", "written research").
test("items after an -ing clause that ends the list are not tool claims", () => {
  const src = normalizeClaim("Built models using company filings. Analysed companies using investor presentations. Held management calls.");
  const found = factClaims("Breaks down businesses using filings, investor materials and management calls, turning qualitative and quantitative evidence into clear forecasts, peer comparisons and written research.", src).filter((c) => c.kind === "tool").map((c) => c.value);
  assert.deepEqual(found.filter((t) => /peer comparisons|written research|forecasts/.test(t)), [], JSON.stringify(found));
});

test("a tool named before the -ing clause is still checked", () => {
  const src = normalizeClaim("Built models using FactSet.");
  const found = factClaims("Built models using Bloomberg and FactSet, turning filings into forecasts and Tableau dashboards.", src).filter((c) => c.kind === "tool").map((c) => c.value);
  assert.ok(found.includes("bloomberg"), JSON.stringify(found));
});

test("a capitalised product named after the -ing clause is still checked", () => {
  const src = normalizeClaim("Built models using FactSet.");
  const found = factClaims("Built models using FactSet, turning filings into forecasts and Tableau dashboards.", src).filter((c) => c.kind === "tool").map((c) => c.value);
  assert.ok(found.some((t) => /tableau/.test(t)), JSON.stringify(found));
});
