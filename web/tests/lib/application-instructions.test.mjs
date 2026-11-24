import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { saveInstructions, getInstructions, listOthers, recordRevision, cleanEntry, readStore } from "../../src/lib/application-instructions.mjs";

const tmp = () => { const r = fs.mkdtempSync(path.join(os.tmpdir(), "ai-")); fs.mkdirSync(path.join(r, "data")); return r; };

test("instructions save, reload and stay with their own job", () => {
  const r = tmp();
  saveInstructions(r, "022", { general: "Emphasise communication.", cv: "Reduce project A content.", cover: "More personal.", tone: "Natural", emphasis: "Management Consulting" }, { label: "A" });
  saveInstructions(r, "9", { general: "Focus on valuation." }, { label: "KPMG" });
  const a = getInstructions(r, "22");
  assert.equal(a.general, "Emphasise communication.");
  assert.equal(a.cv, "Reduce project A content.");
  assert.equal(a.cover, "More personal.");
  assert.equal(a.tone, "Natural");
  assert.equal(getInstructions(r, "009").general, "Focus on valuation.");
  assert.equal(getInstructions(r, "5").general, "", "a job without instructions gets none from another job");
  assert.deepEqual(listOthers(r, "22").map((o) => o.reportNum), ["9"]);
});

test("unknown tone or emphasis values are dropped; clearing removes the entry", () => {
  const r = tmp();
  assert.equal(cleanEntry({ tone: "Shouty", emphasis: "Sales" }).tone, "");
  saveInstructions(r, "3", { general: "x" });
  saveInstructions(r, "3", {});
  assert.equal(Object.keys(readStore(r).jobs).length, 0);
});

test("revision feedback is kept with the job and survives clearing the instructions", () => {
  const r = tmp();
  saveInstructions(r, "4", { cover: "Natural." });
  recordRevision(r, "4", { docs: "cover", feedback: "Too technical." });
  saveInstructions(r, "4", {});
  const e = getInstructions(r, "4");
  assert.equal(e.cover, "");
  assert.equal(e.revisions.length, 1);
  assert.equal(e.revisions[0].docs, "cover");
});
