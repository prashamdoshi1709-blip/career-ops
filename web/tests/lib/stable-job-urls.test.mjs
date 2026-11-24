// 2026-11-11 regression: /opportunities/pcd75bc6afd74 showed 404 after that scan
// find was marked Applied. Marking it Applied creates a tracker row (#35) and the
// scan entry is merged into it, so the "p…" id matched nothing. Every job id ever
// handed out must keep resolving, and the row must keep the documents generated
// for the posting.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildOpportunities } from "../../src/lib/opportunities.mjs";
import { resolveJobId, postingRecord } from "../../src/lib/job-identity.mjs";
import { docStatuses, jobKey, postingIdFor } from "../../src/lib/doc-status.mjs";

const URL_A = "https://rbc.wd3.myworkdayjobs.com/rbcglobal1/job/SYDNEY/Equity-Research-Associate_R-0000189547";
const URL_B = "https://au.seek.com/job/90000002";
const URL_C = "https://au.seek.com/job/90000003";
const pid = (u) => `p${postingIdFor(u)}`;

function fixture({ applied = false, skipped = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stable-url-"));
  fs.mkdirSync(path.join(root, "data", "posting-jobs"), { recursive: true });
  fs.mkdirSync(path.join(root, "data", "cv-original"), { recursive: true });
  fs.writeFileSync(path.join(root, "data", "cv-original", "version.json"), JSON.stringify({ generator: "G1" }));
  const lineA = `- [${applied ? "x" : " "}] ${URL_A} | RBC Capital Markets | Equity Research Associate, Metals & Mining | Sydney NSW`;
  const lineC = `- [${skipped ? "x" : " "}] ${URL_C} | Gamma Partners | Transaction Services Analyst | Sydney NSW`;
  fs.writeFileSync(path.join(root, "data", "pipeline.md"), `# Pipeline\n\n## Pending\n${lineA}\n- [ ] ${URL_B} | Beta Capital | M&A Analyst | Sydney NSW\n${lineC}\n`);
  // Documents generated while it was still a scan find (filed under the posting).
  const dir = path.join(root, "output", "applications", "RBC");
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ["cv.pdf", "cover.pdf"]) fs.writeFileSync(path.join(dir, f), "x");
  fs.writeFileSync(path.join(dir, "Quality check RBC.json"), JSON.stringify({ generator: "G1", verdict: "ready" }));
  fs.writeFileSync(path.join(root, "data", "posting-docs.json"), JSON.stringify({ [postingIdFor(URL_A)]: { cv: "output/applications/RBC/cv.pdf", cover: "output/applications/RBC/cover.pdf", generator: "G1", verdict: "ready" } }));
  fs.writeFileSync(path.join(root, "data", "posting-jobs", `${postingIdFor(URL_A)}.json`), JSON.stringify({ url: URL_A, company: "RBC Capital Markets", title: "Equity Research Associate, Metals & Mining", location: "Sydney NSW" }));
  const apps = applied
    ? [{ n: "35", date: "2026-11-11", company: "RBC Capital Markets", role: "Equity Research Associate, Metals & Mining", score: "N/A", status: "Applied", pdf: "❌", report: "—", notes: "Applied 2026-11-11 (marked in All Job Opportunities).", url: `[workday](${URL_A})` }]
    : [];
  return { root, jobs: buildOpportunities(root, apps, { today: "2026-11-11" }).jobs };
}

test("before: the scan find opens at its own p-id", () => {
  const { root, jobs } = fixture();
  const r = resolveJobId(root, pid(URL_A), jobs);
  assert.equal(r.type, "job");
  assert.equal(r.job.kind, "inbox");
});

test("after marking Applied: the old p-id redirects to the tracker row (was a 404)", () => {
  const { root, jobs } = fixture({ applied: true });
  assert.equal(jobs.some((j) => jobKey(j) === pid(URL_A)), false, "the scan entry is merged into the row, as before");
  const r = resolveJobId(root, pid(URL_A), jobs);
  assert.equal(r.type, "redirect");
  assert.equal(r.to, "/opportunities/35");
});

test("other jobs are unaffected when one job is marked Applied", () => {
  const { root, jobs } = fixture({ applied: true });
  const r = resolveJobId(root, pid(URL_B), jobs);
  assert.equal(r.type, "job");
  assert.equal(r.job.company, "Beta Capital");
});

test("the Applied row keeps the CV and cover letter generated for the posting", () => {
  const { root, jobs } = fixture({ applied: true });
  const row = jobs.find((j) => j.kind === "tracked" && j.n === "35");
  const d = docStatuses(root, [row])["t35"];
  assert.ok(d.cv, "CV still linked");
  assert.ok(d.cover, "cover letter still linked");
  assert.notEqual(d.state, "not-generated");
});

test("a row matched only by company + title (URL differs) still resolves", () => {
  const { root } = fixture({ applied: true });
  const apps = [{ n: "35", date: "2026-11-11", company: "RBC Capital Markets", role: "Equity Research Associate, Metals & Mining", score: "N/A", status: "Applied", pdf: "❌", report: "—", notes: "", url: "[x](https://jobs.rbc.com/other-link)" }];
  const jobs = buildOpportunities(root, apps, { today: "2026-11-11" }).jobs;
  assert.equal(resolveJobId(root, pid(URL_A), jobs).to, "/opportunities/35");
});

test("a skipped scan find shows 'no longer listed', not a 404", () => {
  const { root, jobs } = fixture({ skipped: true });
  const r = resolveJobId(root, pid(URL_C), jobs);
  assert.equal(r.type, "gone");
  assert.equal(r.record.company, "Gamma Partners");
  assert.equal(postingRecord(root, pid(URL_C)).where, "inbox (processed)");
});

test("internal key t35 opens tracker row 35; unknown ids stay 404", () => {
  const { root, jobs } = fixture({ applied: true });
  assert.equal(resolveJobId(root, "t35", jobs).to, "/opportunities/35");
  assert.equal(resolveJobId(root, "p000000000000", jobs).type, "unknown");
  assert.equal(resolveJobId(root, "../etc", jobs).type, "unknown");
});

test("resolving never writes a file", () => {
  const { root, jobs } = fixture({ applied: true });
  const snap = () => fs.readdirSync(path.join(root, "data")).map((f) => { const p = path.join(root, "data", f); return fs.statSync(p).isFile() ? `${f}:${fs.readFileSync(p, "utf8")}` : f; }).join("\n");
  const before = snap();
  for (const id of [pid(URL_A), pid(URL_B), pid(URL_C), "t35"]) resolveJobId(root, id, jobs);
  assert.equal(snap(), before);
});

test("the job page's details panel also finds the posting's documents for that row", async () => {
  const { readPipelineDetails } = await import("../../src/lib/pipeline-details.mjs");
  const { root } = fixture({ applied: true });
  const d = readPipelineDetails(root, [{ n: "35", company: "RBC Capital Markets", report: "—", notes: "", status: "Applied", score: "N/A", pdf: "❌", url: URL_A }])["35"];
  assert.equal(d.cv, true);
  assert.equal(d.cover, true);
  assert.equal(d.docsReady, true);
});
