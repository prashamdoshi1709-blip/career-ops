import { test } from "node:test";
import assert from "node:assert/strict";
import { irrelevantReason } from "../../src/lib/role-relevance.mjs";

const out = [
  "Business Development Graduate Program", "Business Management Graduate Program", "Head of Corporate Development",
  "Business Development Manager", "Business Development Analyst", "Sales Executive", "Account Manager – Corporate Clients",
  "Key Account Manager", "Marketing Analyst", "Partnerships Manager", "Lead Generation Specialist", "Customer Acquisition Analyst",
  "Growth Manager", "Head of Financial Planning & Analysis", "Chief Financial Officer", "Graduate Program - Business Management",
];
const keep = [
  "Corporate Development Analyst", "M&A - Corporate Development Analyst", "Business Development Manager – M&A Advisory",
  "Investment Banking Analyst – Origination", "Deal Origination Associate", "Business Development Associate - Private Equity",
  "Commercial Finance Analyst", "Finance Business Partner - FP&A", "Sales Finance Analyst", "Senior Finance Analyst (Business Cases)",
  "Credit Analyst - Business Lending", "Senior Finance Analyst / Media and Technology Business / Sydney", "Business Valuations Consultant",
  "2027 Graduate Program - (Restructuring & Recovery Team)", "Graduate Financial Analyst - Corporate Finance (M&A)",
  "Investment Banking Analyst", "Equity Research Associate", "FP&A Manager", "Business Analyst - Corporate Finance", "Development Analyst",
];

test("roles whose main function is sales, BD, marketing or senior leadership are excluded", () => {
  for (const t of out) assert.ok(irrelevantReason(t), `should exclude: ${t}`);
});
test("deal, finance-analysis and corporate development roles are kept", () => {
  for (const t of keep) assert.equal(irrelevantReason(t), null, `should keep: ${t}`);
});

test("academic research posts are excluded, investment research is not", () => {
  assert.ok(irrelevantReason("Research Associate", "Curtin University"));
  assert.ok(irrelevantReason("Research Associate, First Nations Injury Prevention (Identified)", "University of New South Wales"));
  assert.equal(irrelevantReason("Equity Research Associate - Industrials", "RBC Capital Markets"), null);
  assert.equal(irrelevantReason("Research Associate", "Morgans"), null);
});

test("consulting: entry roles kept, senior consulting excluded, FP&A partner titles kept", () => {
  for (const t of ["Business Analyst", "Associate", "Associate Consultant", "Strategy Analyst", "Consultant - Strategy & Transactions", "Graduate Consultant", "Commercial Due Diligence Analyst", "Transformation Consultant", "Finance Business Partner - FP&A"])
    assert.equal(irrelevantReason(t), null, `should keep: ${t}`);
  for (const t of ["Engagement Manager", "Senior Manager, Strategy", "Principal", "Partner, Deal Advisory", "Associate Partner", "Director, Strategy & Operations", "Head of Strategy", "Chief Strategy Officer", "Strategy Manager", "Transformation Manager", "Consulting Manager"])
    assert.ok(irrelevantReason(t), `should exclude: ${t}`);
});

test("specialist and IT 'consultant' titles are not management consulting; level-choice titles stay", () => {
  for (const [t, c] of [["Injury Management Consultant", ""], ["Software Asset Management Consultant (SAM Consultant)", ""], ["Senior Project Management Consultant MEOSPO", ""], ["Associate Consultant", "Infosys limited"], ["Administration / Reception (Associate Consultant) / We", ""], ["Business Analyst - SharePoint Transformation", ""], ["SAP Consultant", ""]])
    assert.ok(irrelevantReason(t, c), `should exclude: ${t}`);
  for (const t of ["EY Parthenon - Senior Consultant or Manager - Deal Management Financial Services", "Strategy& - Deals / Strategy Consultant / Senior Associate/Manager", "Management Consultant", "Deals / Management Consultant", "Graduate Consultant"])
    assert.equal(irrelevantReason(t), null, `should keep: ${t}`);
});
