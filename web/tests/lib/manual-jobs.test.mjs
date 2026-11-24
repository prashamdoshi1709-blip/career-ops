import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  validateInput, buildManualReport, parseManualReport, isManualReport, docsOutdated, findDuplicates, urlKey, jdHash,
} from "../../src/lib/manual-jobs.mjs";
import { buildOpportunities } from "../../src/lib/opportunities.mjs";

const JD = "We are seeking an Analyst to join our Sydney corporate finance team. You will build financial models, prepare valuation analysis and support M&A transactions for mid-market clients.";
const base = { company: "Acme Advisory", role: "Corporate Finance Analyst", location: "Sydney NSW", url: "", jd: JD, deadline: "", source: "LinkedIn" };

test("only company, title and JD are required", () => {
  assert.ok(validateInput({ company: "A", role: "B", jd: JD }).value);
  assert.match(validateInput({ role: "B", jd: JD }).error, /Company/);
  assert.match(validateInput({ company: "A", jd: JD }).error, /title/);
  assert.match(validateInput({ company: "A", role: "B", jd: "short" }).error, /job description/);
  assert.match(validateInput({ ...base, url: "not a url" }).error, /URL/);
  assert.equal(validateInput({ ...base, source: "Somewhere" }).value.source, "Other");
  assert.equal(validateInput({ ...base, company: "A | B\nC" }).value.company, "A B C");
});

test("report round-trips and keeps the JD last for the generator", () => {
  const md = buildManualReport(base, { num: "022", today: "2026-11-10" });
  assert.ok(isManualReport(md));
  assert.match(md, /^\*\*URL:\*\* —$/m);
  assert.match(md, /^\*\*Legitimacy:\*\*/m);
  const jdText = (md.split(/^## Job Description[^\n]*\n/m)[1] ?? "").trim();
  assert.equal(jdText, JD);
  const p = parseManualReport(md);
  assert.equal(p.company, "Acme Advisory");
  assert.equal(p.role, "Corporate Finance Analyst");
  assert.equal(p.source, "LinkedIn");
  assert.equal(p.jd, JD);
  assert.equal(parseManualReport("# Evaluation\n**Score:** 4/5"), null);
});

test("documents are flagged outdated only when the JD changed after they were made", () => {
  const md = buildManualReport(base, { today: "2026-11-10", jdUpdatedAt: "2026-11-10T05:00:00.000Z" });
  assert.equal(docsOutdated(md, Date.parse("2026-11-10T04:00:00Z")), true);
  assert.equal(docsOutdated(md, Date.parse("2026-11-10T06:00:00Z")), false);
  assert.equal(docsOutdated(buildManualReport(base, { today: "2026-11-10" }), Date.parse("2026-11-10T04:00:00Z")), false);
  assert.equal(docsOutdated(md, null), false);
});

test("URL keys ignore tracking parameters, fragments and trailing slashes", () => {
  assert.equal(urlKey("https://www.seek.com.au/job/123/?utm_source=x#apply"), urlKey("https://seek.com.au/job/123"));
  assert.notEqual(urlKey("https://seek.com.au/job/123"), urlKey("https://seek.com.au/job/124"));
  assert.notEqual(jdHash("a"), jdHash("b"));
});

test("duplicates are found in the tracker and in the scan inbox", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mj-"));
  fs.mkdirSync(path.join(root, "data"));
  fs.mkdirSync(path.join(root, "reports"));
  fs.writeFileSync(path.join(root, "data", "pipeline.md"), "# Pipeline\n\n## Pending\n- [ ] https://au.seek.com/job/1 | Beta Capital | M&A Analyst | Sydney NSW\n");
  const apps = [{ n: "5", company: "Acme Advisory Pty Ltd", role: "Corporate Finance Analyst", status: "Evaluated", report: "", notes: "", url: "[x](https://acme.com/jobs/9)" }];
  const byName = findDuplicates(root, apps, base);
  assert.equal(byName.length, 1);
  assert.equal(byName[0].kind, "tracked");
  const byUrl = findDuplicates(root, apps, { ...base, company: "Someone Else", role: "Other", url: "https://acme.com/jobs/9?utm_source=li" });
  assert.equal(byUrl[0]?.why, "same posting URL");
  const inbox = findDuplicates(root, apps, { ...base, company: "Beta Capital", role: "M&A Analyst" });
  assert.equal(inbox[0]?.kind, "inbox");
  assert.equal(findDuplicates(root, apps, { ...base, role: "Tax Accountant" }).length, 0);
  assert.equal(findDuplicates(root, apps, base, { excludeN: "5" }).length, 0);
  // Different city: not the same vacancy.
  assert.equal(findDuplicates(root, apps, { ...base, company: "Beta Capital", role: "M&A Analyst", location: "Perth WA" }).length, 0);
});

test("a manual job appears in All Job Opportunities with a preliminary rating and its source", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mj-"));
  fs.mkdirSync(path.join(root, "data"));
  fs.mkdirSync(path.join(root, "reports"));
  fs.writeFileSync(path.join(root, "reports", "022-acme.md"), buildManualReport(base, { today: "2026-11-10" }));
  const apps = [{ n: "22", date: "2026-11-10", company: "Acme Advisory", role: "Corporate Finance Analyst", score: "N/A", status: "Evaluated", pdf: "❌", report: "[022](../reports/022-acme.md)", notes: "Added manually (LinkedIn)." }];
  const { jobs } = buildOpportunities(root, apps, { today: "2026-11-10" });
  const j = jobs.find((x) => x.n === "22");
  assert.ok(j);
  assert.equal(j.manual, true);
  assert.equal(j.ratingType, "Preliminary");
  assert.ok(j.score > 0 && j.score <= 10);
  assert.equal(j.sources[0].label, "Added manually (LinkedIn)");
  assert.equal(j.location, "Sydney NSW");
});

test("a preliminary rating from a pasted JD never reaches the Exceptional band", async () => {
  const { preliminaryRating } = await import("../../src/lib/opportunities.mjs");
  const jd = "M&A analyst: financial model, valuation, DCF, comparable companies, due diligence, research, capital raising, investment committee papers, market analysis, forecast, recommendation.";
  const r = preliminaryRating({ title: "M&A Analyst", location: "Sydney NSW", jd, company: "Acme" });
  assert.ok(r.score <= 8.5, `got ${r.score}`);
  assert.equal(r.type, "Preliminary");
});
