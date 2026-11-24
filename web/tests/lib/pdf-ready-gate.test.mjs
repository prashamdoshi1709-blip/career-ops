// 2026-11-11 regression (AFG #24): the tracker's PDF tick (✅) alone must never make
// a job "Ready to Apply". Both documents must exist and the newest quality
// record, from the current generator, must say "ready".
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readPipelineDetails, qualityReady } from "../../src/lib/pipeline-details.mjs";

function setup({ cover = true, verdict = "ready", generator = "G1" } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-gate-"));
  const dir = path.join(root, "output", "applications", "Acme - Analyst");
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(root, "data", "cv-original"), { recursive: true });
  fs.writeFileSync(path.join(root, "data", "cv-original", "version.json"), JSON.stringify({ generator: "G1" }));
  fs.writeFileSync(path.join(dir, "cv.pdf"), "x");
  let idx = `# header\n007\toutput/applications/Acme - Analyst/cv.pdf\t\ta4\t2026-11-11\tcv\n`;
  if (cover) {
    fs.writeFileSync(path.join(dir, "cover.pdf"), "x");
    idx += `007\toutput/applications/Acme - Analyst/cover.pdf\t\ta4\t2026-11-11\tcover\n`;
  }
  fs.writeFileSync(path.join(root, "data", "pdf-index.tsv"), idx);
  if (verdict) fs.writeFileSync(path.join(dir, "Quality check Acme.json"), JSON.stringify({ generator, verdict }));
  return { root, cvAbs: path.join(dir, "cv.pdf") };
}
const app = { n: "7", company: "Acme", report: "[007](../reports/007-acme.md)", notes: "", status: "Evaluated", score: "4.2/5", pdf: "✅" };

test("both documents + current ready verdict → Ready to Apply", () => {
  const { root } = setup();
  const d = readPipelineDetails(root, [app])["7"];
  assert.equal(d.docsReady, true);
  assert.equal(d.stage, "Ready to Apply");
});

test("tracker ✅ but a failed quality check → not ready", () => {
  const { root } = setup({ verdict: "not-ready" });
  const d = readPipelineDetails(root, [app])["7"];
  assert.equal(d.docsReady, false);
  assert.equal(d.stage, "Under Review");
});

test("tracker ✅ but no cover letter → not ready", () => {
  const { root } = setup({ cover: false });
  assert.equal(readPipelineDetails(root, [app])["7"].docsReady, false);
});

test("a ready verdict from an older generator does not count", () => {
  const { root, cvAbs } = setup({ generator: "G0" });
  assert.equal(qualityReady(root, cvAbs), false);
  assert.equal(readPipelineDetails(root, [app])["7"].docsReady, false);
});

test("no quality record → not ready", () => {
  const { root } = setup({ verdict: null });
  assert.equal(readPipelineDetails(root, [app])["7"].docsReady, false);
});

test("confidential employer needs no cover letter", () => {
  const { root } = setup({ cover: false });
  assert.equal(readPipelineDetails(root, [{ ...app, company: "?" }])["7"].docsReady, true);
});
