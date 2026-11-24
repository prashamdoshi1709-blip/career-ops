// 2026-11-11 regression: BCG "Generalist Junior Consultant and Consultants"
// (Sydney & Melbourne, Job ID 57565; Canberra) were read from BCG's board but
// dropped by the title filter, while a "Lead AI Tech Architect" must stay out.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as yaml from "js-yaml";
import { fileURLToPath } from "node:url";
import { buildTitleFilterWithOverrides, buildTitleFilterOverrides } from "../../../scan.mjs";
import { scanGroup, scanBreakdown, breakdownMessage } from "../../src/lib/scan-breakdown.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const portals = yaml.load(fs.readFileSync(path.join(repo, "portals.yml"), "utf8"));
const filter = buildTitleFilterWithOverrides(portals.title_filter, buildTitleFilterOverrides(portals.title_filter_overrides));

test("the missed BCG consulting roles now pass the title filter", () => {
  assert.equal(filter("Generalist Junior Consultant and Consultants, Sydney & Melbourne", "Boston Consulting Group"), true);
  assert.equal(filter("Generalist Junior Consultant and Consultants, Canberra", "Boston Consulting Group"), true);
});

test("specialist technology roles stay out, whatever the employer", () => {
  for (const t of ["BCG Platinion | Lead AI Tech Architect", "Senior Consultant, SAP", "Software Engineer", "Data Scientist, Pricing", "Cyber Security Consultant"]) {
    assert.equal(filter(t, "Boston Consulting Group"), false, t);
  }
});

test("plain 'Consultant' passes only at listed strategy and advisory firms", () => {
  assert.equal(filter("Consultant", "Bain & Company"), true);
  assert.equal(filter("Consultant", "Commonwealth Bank"), false);
  assert.equal(filter("Recruitment Consultant", "Bain & Company"), false);
});

test("target titles from the brief pass everywhere", () => {
  for (const t of ["Junior Consultant", "Associate Consultant", "Business Consultant", "Strategy Analyst", "Corporate Strategy Analyst", "Business Transformation Analyst", "Commercial Analyst", "Investment Banking Analyst", "M&A Analyst", "Corporate Finance Analyst", "Transaction Advisory Analyst", "Valuations Analyst", "Financial Modelling Analyst", "Equity Research Associate", "Investment Analyst", "Corporate Development Analyst", "Deal Advisory Analyst", "Graduate Consultant", "Graduate Analyst"]) {
    assert.equal(filter(t, "SEEK"), true, t);
  }
});

test("every Australian capital passes the location allow-list", () => {
  const allow = portals.location_filter.allow.map((s) => s.toLowerCase());
  for (const c of ["sydney", "melbourne", "brisbane", "perth", "adelaide", "canberra", "hobart", "darwin"]) assert.ok(allow.includes(c), c);
});

test("new roles are grouped and counted without inventing anything", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breakdown-"));
  fs.mkdirSync(path.join(root, "data"));
  const head = "url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation";
  fs.writeFileSync(path.join(root, "data", "scan-history.tsv"), `${head}\nhttps://old\t2026-11-10\tworkday-api\tOld\tX\tadded\tSydney\n`);
  const mark = fs.readFileSync(path.join(root, "data", "scan-history.tsv"), "utf8").split("\n").length;
  fs.appendFileSync(path.join(root, "data", "scan-history.tsv"), [
    "https://a\t2026-11-11\tphenom-api\tGeneralist Junior Consultant and Consultants, Canberra\tBCG\tadded\tCanberra",
    "https://b\t2026-11-11\tjobstreet-api\tM&A Analyst\tBoutique\tadded\tSydney",
    "https://c\t2026-11-11\tworkday-api\tSoftware Engineer\tBank\tskipped_title\tSydney",
  ].join("\n") + "\n");
  fs.writeFileSync(path.join(root, "data", "scan-runs.tsv"), "timestamp\tstatus\tdupes\tnew_added\terrors\n2026-11-11\tcompleted\t40\t2\t1\n");
  const b = scanBreakdown(root, mark);
  assert.deepEqual(b, { newRoles: 2, verified: 1, duplicates: 40, inaccessible: 1, groups: { "Management Consulting": 1, "Investment Banking & M&A": 1 } });
  assert.match(breakdownMessage(b), /2 new roles \(1 verified on employer sites\), 40 already known, 1 board unreachable/);
  assert.equal(scanGroup("Equity Research Associate"), "Equity Research");
});
