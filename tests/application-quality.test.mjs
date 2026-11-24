// lib/application-quality: reusable CV and cover-letter checks (2026-11-19).
// Fictional candidate only; no real career data. No Claude call.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { positiveRewrite, positiveLetterBody, negativeStatements } from "../lib/application-quality/positive.mjs";
import { safeFixes, fixLetterBody } from "../lib/application-quality/safe-fixes.mjs";
import { repeatedCvSentences, letterClaimIssues } from "../lib/application-quality/letter-checks.mjs";
import { copiedPhraseRuns } from "../lib/application-quality/copied-phrases.mjs";
import { companyFindings } from "../lib/application-quality/company-check.mjs";
import { buildValidation } from "../lib/application-quality/validation.mjs";
import { classifyKeywords, keywordFindings, keywordPromptBlock } from "../lib/application-quality/keywords.mjs";
import { probeHtml } from "../lib/application-quality/layout-probe.mjs";

const CV = `# Alex Example
## Experience
### Northwind Bank — Sydney
**Credit Analyst**
- Analysed financial statements of 30+ mid-market borrowers and wrote credit memos.
- Supported due diligence on two acquisition finance deals, preparing cash flow analysis.
- Built 2 three-statement models in Excel.
## Skills
Excel, PowerPoint, financial statement analysis, cash flow analysis`;

test("positive: a gap clause is removed and the strength kept; a direct answer stays truthful", () => {
  assert.equal(positiveRewrite("Although I have not worked in audit, my credit memos taught me to read accounts closely.").text, "My credit memos taught me to read accounts closely.");
  assert.equal(positiveRewrite("I lack experience in private equity.").text, "");
  assert.equal(positiveRewrite("I analyse financial statements every week.").changes.length, 0);
  const q = positiveRewrite("No, I do not hold a CPA.", { directQuestion: true });
  assert.equal(q.text, "No, I do not hold a CPA."); assert.equal(q.changes.length, 0);
  assert.deepEqual(positiveLetterBody(["Fine sentence here today.", ["I have never used Python."]]).body, ["Fine sentence here today."]);
  assert.equal(negativeStatements("I may not fully meet the requirements. I write credit memos.").length, 1);
});

test("safe fixes: dashes, contractions, spelling; ranges, titles and names unchanged", () => {
  const r = safeFixes("I'm analyzing 3–4 models — for the Senior Analyst – Credit role at the Program Office.");
  assert.equal(r.text, "I am analysing 3–4 models, for the Senior Analyst – Credit role at the Program Office.");
  assert.equal(safeFixes("**2 models** built", { keepBold: true }).text, "**2 models** built");
  assert.deepEqual(fixLetterBody(["It's **done**."]).body, ["It is done."]);
});

test("letter checks: restating is flagged unless the link to the job is explained", () => {
  const cvEvidence = [{ id: "B2", text: "Supported due diligence on two acquisition finance deals, preparing cash flow analysis." }];
  const plain = repeatedCvSentences({ paras: ["At Northwind Bank, I supported due diligence on two acquisition finance deals, preparing the cash flow analysis."], cvEvidence, jdTerms: "Leveraged finance analyst: credit structuring, covenant analysis, lender presentations." });
  assert.equal(plain.length, 1); assert.equal(plain[0].linked, false); assert.equal(plain[0].id, "B2");
  const linked = repeatedCvSentences({ paras: ["At Northwind Bank, I supported due diligence on two acquisition finance deals, preparing the cash flow analysis, which is close to the covenant analysis and credit structuring this role involves."], cvEvidence, jdTerms: "Leveraged finance analyst: credit structuring, covenant analysis, lender presentations." });
  assert.equal(linked[0].linked, true);
});

test("letter checks: unsupported claims, with negation and employer sentences left alone", () => {
  const why = letterClaimIssues("I led the acquisition finance deal. I built dozens of LBO models. As a CFA, I used Bloomberg. I have 6 years of experience in credit. My checks reduced errors.", CV).map((c) => c.why);
  for (const re of [/leading or executing/, /model type/, /more models/, /qualification/, /tool/, /length of experience/, /outcome/]) assert.ok(why.some((w) => re.test(w)), `${re}: ${JSON.stringify(why)}`);
  assert.deepEqual(letterClaimIssues("I have not yet built an LBO model. Your team uses Bloomberg daily.", CV), []);
  assert.ok(letterClaimIssues("Leading M&A deal execution for clients.", CV, { cv: true }).length, "CV lines are checked in third person");
  assert.equal(letterClaimIssues("My checks reduced errors.", CV)[0].level, "review", "outcomes are review, not blocking");
});

test("copied phrases: one run per phrase; names and figures not counted as prose", () => {
  const runs = copiedPhraseRuns("I supported due diligence on two acquisition finance deals, preparing cash flow analysis for the team.", CV);
  assert.equal(runs.filter((r) => !r.terms).length, 1);
});

test("company check: wrong employer, missing reason and name-swapped copies are flagged", () => {
  const body = ["I am applying for the Credit Analyst position at Harbour Bank.", "Middle paragraph about credit memos and cash flow analysis for borrowers.", "Harbour Bank appeals to me because of its agribusiness lending in regional Queensland."];
  const ok = companyFindings({ coverSpec: { address: ["Harbour Bank", "Brisbane QLD"], re: "Credit Analyst", body }, company: "Harbour Bank", role: "Credit Analyst", location: "Brisbane, QLD", sources: ["Harbour Bank leads agribusiness lending across regional Queensland."] });
  assert.deepEqual(ok, []);
  const wrong = companyFindings({ coverSpec: { address: ["Other Bank", "Sydney NSW"], re: "Credit Analyst", body }, company: "Harbour Bank", role: "Credit Analyst", location: "Brisbane, QLD", sources: [] });
  assert.ok(wrong.some((f) => f.level === "issue")); assert.ok(wrong.some((f) => /job is in/.test(f.text))); assert.ok(wrong.some((f) => /not traced/.test(f.text)));
  const copy = companyFindings({ coverSpec: { address: ["Harbour Bank", "Brisbane QLD"], re: "Credit Analyst", body }, company: "Harbour Bank", role: "Credit Analyst", location: "Brisbane, QLD", sources: ["agribusiness lending regional Queensland"], otherLetters: [{ company: "River Bank", body: body.slice(1).join(" ") }] });
  assert.ok(copy.some((f) => /Reads very like your River Bank/.test(f.text)));
});

test("validation: an issue fails its area and makes the documents not ready", () => {
  const v = buildValidation([{ group: "Letter claims", status: "issue", detail: "x" }, { group: "Visual layout", status: "ok", detail: "y" }]);
  assert.equal(v.areas.factualAccuracy, "fail"); assert.equal(v.areas.visualFormatting, "pass"); assert.equal(v.status, "not-ready");
  assert.equal(buildValidation([{ group: "Visual layout", status: "ok" }]).areas.keywordCoverage, "not checked");
});

test("keywords: classified against cv.md; unsupported terms reported, never counted as present", () => {
  const jd = "Credit analyst: financial statement analysis, cash flow analysis, Bloomberg, CFA preferred, LBO modelling, Excel.";
  const k = classifyKeywords(jd, CV);
  const cls = Object.fromEntries(k.map((x) => [x.term, x.cls]));
  assert.equal(cls["financial statement analysis"], "direct");
  assert.equal(cls["Bloomberg"], "unsupported"); assert.equal(cls["LBO modelling"], "unsupported");
  assert.equal(k.find((x) => x.term === "CFA").importance, "preferred");
  assert.match(keywordPromptBlock(k), /NOT supported[^\n]*Bloomberg/);
  const f = keywordFindings(k, { cvText: CV, letterText: "I used Bloomberg to screen borrowers." });
  assert.equal(f.status, "issue"); assert.match(f.detail, /not an ATS score/);
  const ev = classifyKeywords("Due diligence on deals.", CV, { evidence: { "due diligence": { cv: /Supported due diligence/, cls: "careful", use: "supported due diligence" } } });
  assert.equal(ev[0].cls, "careful"); assert.equal(ev[0].use, "supported due diligence");
});

test("layout probe: detects overlapping and clipped text on a rendered page", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aq-probe-"));
  const html = path.join(dir, "p.html");
  fs.writeFileSync(html, '<!doctype html><html><body><div class="page" style="width:210mm;height:297mm;position:relative"><p style="position:absolute;top:10px;left:10px;width:300px">First line of text</p><p style="position:absolute;top:14px;left:20px;width:300px">Second line on top</p><p style="width:80px;white-space:nowrap;overflow:hidden">A sentence far too long for its box</p></div></body></html>');
  let lay;
  try { lay = await probeHtml(html); } catch (e) { if (/Executable doesn't exist|browserType.launch/.test(String(e))) return; throw e; }
  assert.ok(lay[0].overlaps.length > 0); assert.ok(lay[0].clipped.length > 0); assert.equal(lay[0].empty, false);
});

test("keywords: verified wording is not a claim; a fabricated skill is (2026-11-19 regression)", () => {
  const cvMd = `${CV}\n- Portfolio project: built the optimal allocation using mean-variance optimisation and the efficient frontier.`;
  const jd = "Financial analyst: budgeting and variance analysis, month end, Power BI.";
  // "mean-variance optimisation" is portfolio theory, not variance analysis.
  const ok = keywordFindings(classifyKeywords(jd, cvMd), { cvText: cvMd, cvMd });
  assert.deepEqual(ok.diagnostics.claimed, []);
  assert.match(ok.detail, /none claimed/);
  assert.ok(ok.diagnostics.keptOut.includes("budgeting and variance analysis"), "the unsupported job term is still reported");
  const bad = keywordFindings(classifyKeywords(jd, cvMd), { cvText: `${cvMd}\nPrepared monthly budgets and variance analysis.`, cvMd });
  assert.equal(bad.status, "issue");
  assert.equal(bad.diagnostics.claimed.length, 1, "one finding per sentence");
  assert.equal(bad.diagnostics.claimed[0].document, "CV");
  assert.match(bad.diagnostics.claimed[0].fix, /document correction/);
  assert.ok(bad.diagnostics.claimed[0].jdRequirement.includes("budgeting"));
});

test("company check: employer names match regardless of case and punctuation (2026-11-22 regression)", async () => {
  const { namesEmployer, employerKey } = await import("../lib/application-quality/company-check.mjs");
  assert.equal(employerKey("NORTHWIND ADVISORY (WA) PTY LTD"), "northwind");
  assert.ok(namesEmployer("Northwind Advisory (WA) Pty Ltd Perth WA", "NORTHWIND ADVISORY (WA) PTY LTD"));
  assert.ok(namesEmployer("Harbour Super, Melbourne VIC", "HARBOUR Super"));
  assert.ok(namesEmployer("Alex Example Resume Harbour Bank Credit Analyst.pdf", "Harbour Bank"));
  assert.ok(!namesEmployer("River Bank, Sydney NSW", "Harbour Bank"), "a different employer still fails");
  assert.ok(!namesEmployer("Northwindsor Logistics", "Northwind Advisory"), "whole words only");
});

test("keywords: a job title in the letter is not a claim of that skill (2026-11-22 regression)", () => {
  const k = [{ term: "budgeting and variance analysis", cls: "unsupported", jdLine: "budgeting" }];
  const title = keywordFindings(k, { cvText: CV, cvMd: CV, letterText: "I am applying for the Financial Analyst and Budget Officer position at Harbour Council.", roleTitle: "Financial Analyst and Budget Officer", company: "Harbour Council" });
  assert.deepEqual(title.diagnostics.claimed, []);
  assert.equal(title.diagnostics.contextual.length, 1);
  const noTitle = keywordFindings(k, { cvText: CV, cvMd: CV, letterText: "I am applying for the Financial Analyst and Budget Officer position at Harbour Council." });
  assert.deepEqual(noTitle.diagnostics.claimed, [], "the applying-for clause is recognised without the title");
  const claim = keywordFindings(k, { cvText: CV, cvMd: CV, letterText: "I prepared the annual budget for Harbour Council.", roleTitle: "Financial Analyst and Budget Officer" });
  assert.equal(claim.diagnostics.claimed.length, 1, "a real claim is still caught");
});

test("recheck records: a new file every time, nothing overwritten, changes listed (2026-11-22)", async () => {
  const RR = await import("../lib/application-quality/recheck-record.mjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aq-recheck-"));
  const gen = { generatedAt: "2026-11-01T00:00:00Z", verdict: "not-ready", quality: [{ group: "File validation", status: "issue", list: ["case mismatch"] }, { group: "Visual layout", status: "ok", list: [] }] };
  fs.writeFileSync(path.join(dir, "Quality check Harbour Bank Analyst.json"), JSON.stringify(gen));
  const prev = RR.previousRecord(dir);
  assert.match(prev.file, /Quality check/);
  const now = { quality: [{ group: "File validation", status: "ok", list: [] }, { group: "Visual layout", status: "ok", list: [] }] };
  const ch = RR.qualityChanges(prev.record, now);
  assert.deepEqual(ch, [{ group: "File validation", change: "status", from: "issue", to: "ok", added: [], resolved: ["case mismatch"] }]);
  const t = new Date("2026-11-22T01:02:03Z");
  const a = RR.saveRecheck(dir, "Harbour Bank Analyst", { checkedAt: t.toISOString(), quality: now.quality }, t);
  const b = RR.saveRecheck(dir, "Harbour Bank Analyst", { checkedAt: t.toISOString(), quality: now.quality }, t);
  assert.notEqual(a, b, "same second: a second file, not an overwrite");
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "Quality check Harbour Bank Analyst.json"), "utf8")).verdict, "not-ready", "the generation record is untouched");
  assert.match(RR.previousRecord(dir).file, /Quality rechecks/);
  assert.equal(RR.checkerFingerprint([a]).length, 12);
});
