import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { docStatuses, previewBatch, priorityOf, jobKey } from "../../src/lib/doc-status.mjs";
import { enqueue, readQueue, cancelPending, recoverStale, mutateQueue, setPaused, summary } from "../../src/lib/doc-queue-store.mjs";

function root() {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), "dq-"));
  for (const d of ["data/cv-original", "output/applications/Acme - Analyst"]) fs.mkdirSync(path.join(r, d), { recursive: true });
  fs.writeFileSync(path.join(r, "data/cv-original/version.json"), JSON.stringify({ generator: "v2" }));
  return r;
}
const job = (o) => ({ kind: "tracked", n: "5", docN: "5", company: "Acme", title: "Analyst", status: "Evaluated", availability: "Open", score: 8, category: "Investment Banking & M&A", sources: [{ label: "SEEK" }], url: "https://au.seek.com/job/1", ...o });
function withDocs(r, verdict, generator = "v2") {
  const dir = path.join(r, "output/applications/Acme - Analyst");
  fs.writeFileSync(path.join(dir, "cv.pdf"), "x"); fs.writeFileSync(path.join(dir, "cover.pdf"), "x");
  fs.writeFileSync(path.join(dir, "Quality check Acme.json"), JSON.stringify({ generator, verdict, generatedAt: "2026-11-11T00:00:00Z" }));
  fs.writeFileSync(path.join(r, "data/pdf-index.tsv"), `# h\n005\toutput/applications/Acme - Analyst/cv.pdf\tx\ta4\t2026-11-11\tcv\n005\toutput/applications/Acme - Analyst/cover.pdf\tx\ta4\t2026-11-11\tcover\n`);
}

test("eligibility: applied, skipped, closed and JD-less scan finds are excluded with a reason", () => {
  const r = root();
  const jobs = [job({ n: "1", docN: "1", status: "Applied" }), job({ n: "2", docN: "2", status: "SKIP" }), job({ n: "3", docN: "3", availability: "Closed" }), job({ n: "4", docN: "4" }),
    { kind: "inbox", n: null, company: "Beta", title: "Analyst", status: "", availability: "Open", score: 7, category: "Other", sources: [{ label: "SEEK" }], url: "https://au.seek.com/job/9" },
    { kind: "inbox", n: null, company: "Gamma", title: "Analyst", status: "", availability: "Open", score: 7, category: "Other", sources: [{ label: "Employer (Workday)" }], url: "https://x.wd3.myworkdayjobs.com/a/job/1" }];
  const s = docStatuses(r, jobs);
  assert.match(s.t1.reason, /^Already Applied/);
  assert.equal(s.t2.state, "not-generated");
  assert.match(s.t3.reason, /closed/);
  assert.equal(s.t4.eligible, true);
  assert.match(s[jobKey(jobs[4])].reason, /No job description available/);
  assert.equal(s[jobKey(jobs[5])].eligible, true, "employer job-board finds can be fetched");
  const pv = previewBatch(r, jobs, s);
  assert.deepEqual(pv.eligible.map((e) => e.company).sort(), ["Acme", "Gamma"]);
  assert.ok(Object.keys(pv.excluded).length >= 3);
});

test("ready only when a current quality record says ready; otherwise needs review", () => {
  const r = root(); withDocs(r, "ready");
  assert.equal(docStatuses(r, [job()]).t5.state, "ready");
  const r2 = root(); withDocs(r2, "check");
  assert.equal(docStatuses(r2, [job()]).t5.state, "needs-review");
  const r3 = root(); withDocs(r3, "ready", "v1");
  assert.equal(docStatuses(r3, [job()]).t5.state, "needs-review", "older generator");
});

test("documents become outdated when the instructions or the JD change afterwards", () => {
  const r = root(); withDocs(r, "ready");
  const later = new Date(Date.now() + 60_000).toISOString();
  fs.writeFileSync(path.join(r, "data/application-instructions.json"), JSON.stringify({ version: 1, jobs: { 5: { general: "x", updatedAt: later } } }));
  assert.equal(docStatuses(r, [job()]).t5.state, "outdated");
  const r2 = root(); withDocs(r2, "ready");
  assert.equal(docStatuses(r2, [job({ jdUpdatedAt: later })]).t5.state, "outdated");
});

test("priority: suitability first, then a near deadline, then role family", () => {
  const today = new Date("2026-11-11");
  assert.ok(priorityOf(job({ score: 9 }), today) > priorityOf(job({ score: 7 }), today));
  assert.ok(priorityOf(job({ deadline: "2026-11-15" }), today) > priorityOf(job(), today));
  assert.ok(priorityOf(job({ category: "Valuations & Financial Modelling" }), today) > priorityOf(job({ category: "Other" }), today));
});

test("queue: no duplicates, cancel pending, recover after a crash, pause", () => {
  const r = root();
  const items = [{ key: "t5", kind: "tracked", n: "5", company: "Acme", title: "A", cover: true, priority: 80 }, { key: "t6", kind: "tracked", n: "6", company: "B", title: "B", cover: true, priority: 70 }];
  assert.equal(enqueue(r, items).added, 2);
  assert.equal(enqueue(r, items).added, 0, "already queued");
  mutateQueue(r, (q) => { q.items.t5.state = "generating"; q.worker = { pid: 999999 }; return q; });
  let recovered = 0;
  mutateQueue(r, (q) => { recovered = recoverStale(q); return q; });
  assert.equal(recovered, 1);
  assert.equal(readQueue(r).items.t5.state, "queued");
  assert.equal(cancelPending(r), 2);
  assert.equal(summary(readQueue(r)).queued, 0);
  setPaused(r, true, "test");
  assert.equal(readQueue(r).settings.paused, true);
  assert.equal(enqueue(r, items).added, 2, "cancelled items can be queued again");
});
