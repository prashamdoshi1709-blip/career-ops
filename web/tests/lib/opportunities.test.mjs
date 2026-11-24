import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, normCompany, preliminaryRating, sameVacancy, sourceOf } from "../../src/lib/opportunities.mjs";

const e = (o) => ({ url: "", reqId: "", companyKey: normCompany(o.company), titleKey: o.title.toLowerCase(), location: o.location, ...o });

test("genuine duplicates merge; similar titles at different firms or req IDs do not", () => {
  assert.ok(sameVacancy(e({ company: "J.P Morgan", title: "ecm analyst", location: "Sydney NSW" }), e({ company: "JPMorgan Chase", title: "ecm analyst", location: "Sydney, NSW, Australia" })));
  assert.ok(!sameVacancy(e({ company: "KPMG", title: "valuations analyst", location: "Sydney" }), e({ company: "Deloitte", title: "valuations analyst", location: "Sydney" })));
  assert.ok(!sameVacancy(e({ company: "RSM", title: "senior analyst", location: "Sydney", reqId: "JR1" }), e({ company: "RSM", title: "senior analyst", location: "Sydney", reqId: "JR2" })));
  assert.ok(!sameVacancy(e({ company: "RSM", title: "senior analyst", location: "Perth" }), e({ company: "RSM", title: "senior analyst", location: "Sydney" })));
});

test("title-only preliminary ratings are capped at 8.0 and marked low confidence", () => {
  const r = preliminaryRating({ title: "Investment Banking Analyst", location: "Sydney NSW" });
  assert.equal(r.type, "Preliminary");
  assert.equal(r.confidence, "Low");
  assert.ok(r.score <= 8);
});

test("analytical finance outranks routine accounting and personal advice", () => {
  const fa = preliminaryRating({ title: "Corporate Development Analyst", location: "Sydney NSW" }).score;
  const planner = preliminaryRating({ title: "Graduate Financial Planner", location: "Sydney NSW" }).score;
  const reporting = preliminaryRating({ title: "Financial Reporting Analyst", location: "Sydney NSW" }).score;
  assert.ok(fa > reporting && reporting > planner);
  assert.equal(classify("FP&A Analyst").category, "Financial Analyst & FP&A");
  assert.equal(classify("Valuation Analyst", "", "JLL").category, "Other");
});

test("no location means Rating Pending, not an invented score", () => {
  const r = preliminaryRating({ title: "M&A Analyst", location: "" });
  assert.equal(r.score, null);
  assert.equal(r.type, "Pending");
});

test("sources are labelled from the link", () => {
  assert.equal(sourceOf("https://au.seek.com/job/1"), "SEEK");
  assert.equal(sourceOf("https://hl.wd1.myworkdayjobs.com/campus/job/x"), "Employer (Workday)");
});

import { careerAppeal } from "../../src/lib/opportunities.mjs";

test("consulting categories, honest scores and separate career appeal", () => {
  assert.equal(classify("Business Analyst", "", "McKinsey & Company").category, "Strategy Consulting");
  assert.equal(classify("Associate", "", "Boston Consulting Group").category, "Strategy Consulting");
  assert.equal(classify("Commercial Due Diligence Analyst", "", "EY").category, "Commercial Due Diligence");
  assert.equal(classify("Corporate Strategy Analyst", "", "Qantas").category, "Corporate Strategy");
  assert.equal(classify("Senior Consultant - M&A Valuations", "", "Deloitte").category, "Valuations & Financial Modelling");
  assert.equal(classify("Investment Banking Analyst", "", "Moelis").category, "Investment Banking & M&A");
  const mbb = preliminaryRating({ title: "Associate Consultant", location: "Sydney NSW", company: "Bain & Company" }).score;
  const cdd = preliminaryRating({ title: "Commercial Due Diligence Analyst", location: "Sydney NSW", company: "EY" }).score;
  const ib = preliminaryRating({ title: "Investment Banking Analyst", location: "Sydney NSW", company: "Moelis" }).score;
  assert.ok(cdd > mbb, `CDD (${cdd}) should out-fit generalist MBB (${mbb})`);
  assert.ok(ib >= cdd, "IB stays the top priority");
  assert.match(careerAppeal("Bain & Company"), /High career appeal/);
  assert.equal(careerAppeal("Moelis"), null);
});

test("2026-11-22: corporate banking and portfolio roles get their own categories and priority tiers", async () => {
  const { classify, priorityTier } = await import("../../src/lib/opportunities.mjs");
  assert.equal(classify("Associate Relationship Manager - Corporate Banking").category, "Corporate & Institutional Banking");
  assert.equal(classify("Analyst, Corporate Lending").category, "Corporate & Institutional Banking");
  assert.equal(classify("Home Lending Analyst").category, "Investment, PE & Credit", "retail lending unchanged");
  assert.equal(classify("Investment Analyst, Asset Allocation").category, "Portfolio & Asset Management");
  assert.equal(classify("FP&A Analyst").category, "Financial Analyst & FP&A", "FP&A is not caught by the financial planner rule");
  assert.equal(classify("Financial Planner").category, "Other");
  assert.equal(priorityTier("Investment Banking & M&A"), 1);
  assert.equal(priorityTier("Valuations & Financial Modelling"), 1);
  assert.equal(priorityTier("Corporate & Institutional Banking"), 2);
  assert.equal(priorityTier("Financial Analyst & FP&A"), 3);
  assert.equal(priorityTier("anything unknown"), 3);
});
