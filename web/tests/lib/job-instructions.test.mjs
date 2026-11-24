// 2026-11-15: Additional Instructions (Optional) are saved per job, found again
// under any id the same job is reached by (p... before Applied, t{n} after), and
// never applied to another job. File operations only.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { saveInstructions, findInstructions, identitiesOf, readStore } from "../../src/lib/job-instructions.mjs";
import { postingIdFor } from "../../src/lib/posting-id.mjs";

const fresh = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "job-instr-"));
  fs.mkdirSync(path.join(root, "data"));
  return root;
};
const EP = "https://au.seek.com/job/10000001"; // example posting A
const OTHER = "https://au.seek.com/job/10000002"; // example posting B

test("instructions save, reload and stay with their own job", () => {
  const root = fresh();
  saveInstructions(root, "t69", { text: "Focus more on transaction analysis and due diligence.", target: "cv" }, { urls: [EP] });
  const got = findInstructions(root, identitiesOf("t69", [EP]));
  assert.equal(got.text, "Focus more on transaction analysis and due diligence.");
  assert.equal(got.target, "cv");
  assert.ok(got.updatedAt);
  assert.equal(findInstructions(root, identitiesOf("t43", [OTHER])).text, "", "another job never sees them");
  assert.equal(findInstructions(root, identitiesOf("t70", [])).text, "");
});

test("instructions typed before Applied are found after the job becomes a tracker row", () => {
  const root = fresh();
  const pid = `p${postingIdFor(EP)}`;
  saveInstructions(root, pid, { text: "Keep the cover letter shorter.", target: "cover" }, { urls: [EP] });
  const after = findInstructions(root, identitiesOf("t69", [EP]));
  assert.equal(after.text, "Keep the cover letter shorter.");
  assert.equal(after.target, "cover");
  // Editing on the tracked page replaces the earlier entry: one set per job.
  saveInstructions(root, "t69", { text: "Keep the cover letter shorter and more personal.", target: "both" }, { urls: [EP] });
  assert.deepEqual(Object.keys(readStore(root).jobs), ["t69"]);
  assert.equal(findInstructions(root, [pid]).text, "Keep the cover letter shorter and more personal.");
});

test("clearing removes them; unknown targets fall back to both", () => {
  const root = fresh();
  saveInstructions(root, "t69", { text: "x", target: "everything" }, { urls: [EP] });
  assert.equal(findInstructions(root, ["t69"]).target, "both");
  saveInstructions(root, "t69", { text: "   " }, { urls: [EP] });
  assert.equal(findInstructions(root, ["t69"]).text, "");
  assert.deepEqual(readStore(root).jobs, {});
});

test("ids are validated and text is capped", () => {
  const root = fresh();
  assert.throws(() => saveInstructions(root, "../x", { text: "a" }));
  const long = "a".repeat(5000);
  assert.equal(saveInstructions(root, "t69", { text: long }).text.length, 4000);
});
