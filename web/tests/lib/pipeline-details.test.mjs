import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { deadlineFromNotes, parseReportFacts, readPipelineDetails, workflowStage } from "../../src/lib/pipeline-details.mjs";

test("report header facts are read, with Machine Summary and JD fallbacks", () => {
  const a = parseReportFacts("**Location:** Sydney NSW\n**Posted:** about 2026-11-02 (LinkedIn)\n**Deadline:** not stated\n**Suitability:** 8.8/10\n");
  assert.deepEqual(a, { location: "Sydney NSW", posted: "~2026-11-02", deadline: "", suitability: 8.8 });
  const b = parseReportFacts("**Score:** 4.2/5\n```yaml\nposting_location: \"Sydney CBD\"\n```\n## Job Description (archived verbatim)\nPosted: 2026-10-26 (SEEK)\n");
  assert.equal(b.location, "Sydney CBD");
  assert.equal(b.posted, "2026-10-26");
});

test("deadlines in notes are recognised", () => {
  assert.equal(deadlineFromNotes("Sydney. closes 2026-11-13."), "2026-11-13");
  assert.equal(deadlineFromNotes("Closing Date: 13/11/2026"), "13/11/2026");
  assert.equal(deadlineFromNotes("no date here"), "");
});

test("workflow stage never reports Applied unless the tracker says so", () => {
  assert.equal(workflowStage({ status: "Evaluated", cv: true, cover: true }), "Ready to Apply");
  assert.equal(workflowStage({ status: "Evaluated", cv: true, cover: false }), "Under Review");
  assert.equal(workflowStage({ status: "Applied", cv: false, cover: false }), "Applied");
  assert.equal(workflowStage({ status: "Discarded" }), "Closed");
  assert.equal(workflowStage({ status: "Assessment" }), "Interview");
});

test("documents are read from data/pdf-index.tsv only when the file exists", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-details-"));
  try {
    fs.mkdirSync(path.join(root, "data"));
    fs.mkdirSync(path.join(root, "reports"));
    fs.mkdirSync(path.join(root, "output"));
    fs.writeFileSync(path.join(root, "output", "cv.pdf"), "x");
    fs.writeFileSync(path.join(root, "reports", "009-x.md"), "**Location:** Sydney NSW\n");
    fs.writeFileSync(path.join(root, "data", "pdf-index.tsv"), "# header\n009\toutput/cv.pdf\t\ta4\t2026-11-09\tcv\n009\toutput/missing.pdf\t\ta4\t2026-11-09\tcover\n");
    const d = readPipelineDetails(root, [{ n: "9", report: "[009](../reports/009-x.md)", notes: "", status: "Evaluated", score: "4.0/5", pdf: "❌" }]);
    assert.equal(d["9"].cv, true);
    assert.equal(d["9"].cover, false);
    assert.equal(d["9"].location, "Sydney NSW");
    assert.equal(d["9"].suitability, 8);
    assert.equal(d["9"].stage, "Under Review");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
