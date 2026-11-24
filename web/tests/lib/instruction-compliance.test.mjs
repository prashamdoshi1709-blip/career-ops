// 2026-11-15: Additional Instructions are checked against the generated text, not
// the model's own report. Local only; no Claude call.
import { test } from "node:test";
import assert from "node:assert/strict";
import { requestedGreeting, cleanSalutation, analysePoint, checkCompliance, complianceGroup, applyFixes, splitPoints } from "../../src/lib/instruction-compliance.mjs";

const letter = (salutation = "Dear Hiring Manager,", body = ["I am an Equity Research Analyst at Example Capital in Sydney.", "At Sample Advisory I supported diligence on a live sell-side mandate.", "On my own initiative, I founded Example Media Studio.", "I would welcome the chance to discuss the role."]) => ({ salutation, recipient: "Hiring Manager", address: ["Example Recruitment", "Sydney NSW"], re: "Finance Analyst", body });

test("greeting requests are read in the ways people write them", () => {
  assert.equal(requestedGreeting("write dear Jonah instead of Dear Hiring Manager,").greeting, "Dear Jonah,");
  assert.equal(requestedGreeting("Write dear Adam , instead of dear hiring manager").greeting, "Dear Adam,");
  assert.equal(requestedGreeting("Address the letter to Ms Sarah Lee.").greeting, "Dear Ms Sarah Lee,");
  assert.equal(requestedGreeting("Change the salutation to Dear Recruitment Team").greeting, "Dear Recruitment Team,");
  assert.equal(requestedGreeting("Use Hi Tom as the greeting").greeting, "Hi Tom,");
  assert.equal(requestedGreeting("Make the opening paragraph shorter."), null);
  assert.equal(requestedGreeting("Keep Dear Hiring Manager"), null);
});

test("a salutation from the model is kept only when it is a plain greeting", () => {
  assert.equal(cleanSalutation("Dear Jonah"), "Dear Jonah,");
  assert.equal(cleanSalutation("Dear [Name],"), "Dear Hiring Manager,");
  assert.equal(cleanSalutation(""), "Dear Hiring Manager,");
  assert.equal(cleanSalutation("To whom it may concern"), "Dear Hiring Manager,");
});

test("each point is classified as testable or a judgement", () => {
  assert.equal(analysePoint("Keep the cover letter under 250 words.", "cover").kind, "word_limit");
  assert.equal(analysePoint("Make the opening paragraph shorter.", "cover").kind, "shorter_opening");
  assert.equal(analysePoint('Remove the sentence "I would welcome the chance to discuss the role."', "cover").kind, "remove_text");
  assert.equal(analysePoint("Emphasise Example Media Studio.", "cover").kind, "feature_entity");
  assert.equal(analysePoint("Highlight my Sample Advisory experience more prominently.", "both").kind, "feature_entity");
  assert.equal(analysePoint("Make the cover letter more personal and less formal.", "cover").kind, "subjective");
  assert.equal(analysePoint("Remove the second bullet under Example Capital.", "cv").kind, "subjective");
  assert.deepEqual(splitPoints("Write Dear Jonah instead of Dear Hiring Manager. Keep it under 300 words; less formal"), ["Write Dear Jonah instead of Dear Hiring Manager.", "Keep it under 300 words", "less formal"]);
});

test("a requested greeting is verified in the final letter, and fails when missing", () => {
  const extra = { text: "write dear Jonah instead of Dear Hiring Manager,", target: "cover" };
  const bad = complianceGroup(checkCompliance({ extra, cover: letter() }));
  assert.equal(bad.status, "issue");
  assert.match(bad.list[0], /Instruction not followed.*Requested greeting was not applied/);
  assert.equal(bad.fixable, true);
  const good = complianceGroup(checkCompliance({ extra, cover: letter("Dear Jonah,") }));
  assert.equal(good.status, "ok");
  assert.match(good.list[0], /Verified.*Dear Jonah,.*Dear Hiring Manager removed/);
});

test("the greeting and a quoted sentence are corrected on this computer; nothing else changes", () => {
  const extra = { text: 'write dear Jonah instead of Dear Hiring Manager.\nRemove the sentence "I would welcome the chance to discuss the role."', target: "cover" };
  const items = checkCompliance({ extra, cover: letter() });
  const { spec, applied } = applyFixes(letter(), items);
  assert.equal(applied.length, 2);
  assert.equal(spec.salutation, "Dear Jonah,");
  assert.equal(spec.recipient, ""); // the name is only in the greeting
  assert.equal(spec.body.length, 3);
  assert.equal(complianceGroup(checkCompliance({ extra, cover: spec })).status, "ok");
});

test("a letter instruction set to CV only is flagged; rejected and permanent rules are explained", () => {
  const wrong = checkCompliance({ extra: { text: "Write Dear Jonah instead of Dear Hiring Manager", target: "cv" }, cover: letter(), cv: { profile: "x", highlights: [], skills: [], jobs: [] } });
  assert.equal(wrong[0].status, "wrong_target");
  assert.equal(complianceGroup(wrong).status, "review");
  const tar = checkCompliance({ extra: { text: "Do not mention Example Media Studio.", target: "cover" }, cover: letter() });
  assert.equal(tar[0].status, "rejected");
  const mba = checkCompliance({ extra: { text: "Say I am an MBA candidate.", target: "both" }, cover: letter() });
  assert.equal(mba[0].status, "rejected");
});

test("shorter and word-limit requests are measured against the text", () => {
  const prev = letter("Dear Hiring Manager,", ["One two three four five six seven eight nine ten eleven twelve.", "More."]);
  const now = letter("Dear Hiring Manager,", ["One two three four five.", "More."]);
  assert.equal(checkCompliance({ extra: { text: "Make the opening paragraph shorter.", target: "cover" }, cover: now, prevCover: prev })[0].status, "verified");
  assert.equal(checkCompliance({ extra: { text: "Make the opening paragraph shorter.", target: "cover" }, cover: prev, prevCover: prev })[0].status, "not_followed");
  assert.equal(checkCompliance({ extra: { text: "Keep the cover letter under 10 words.", target: "cover" }, cover: prev })[0].status, "not_followed");
  assert.equal(checkCompliance({ extra: { text: "Make it more natural.", target: "cover" }, cover: now })[0].status, "unverifiable");
});
