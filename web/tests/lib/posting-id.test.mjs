// 2026-11-15 regression: posting IDs dropped the whole query string, so every
// Morgan Stanley posting (?pid=), Bain (?jobid=) and Nous/StepStone (?gh_jid=)
// shared one ID. CFO Advisory roles were also hidden as "senior leadership".
import { test } from "node:test";
import assert from "node:assert/strict";
import { postingIdFor, legacyPostingIdFor, jobIdQuery } from "../../src/lib/posting-id.mjs";
import { postingIdFor as fromDocStatus } from "../../src/lib/doc-status.mjs";
import { postingIdFor as fromScreening } from "../../src/lib/screening.mjs";
import { irrelevantReason } from "../../src/lib/role-relevance.mjs";

test("different jobs whose number is in the query get different IDs", () => {
  const pairs = [
    ["https://morganstanley.eightfold.ai/careers?pid=549800002276&domain=morganstanley.com", "https://morganstanley.eightfold.ai/careers?pid=549800542949&domain=morganstanley.com"],
    ["https://www.bain.com/careers/find-a-role/position/?jobid=10397", "https://www.bain.com/careers/find-a-role/position/?jobid=10409"],
    ["https://nousgroup.com/careers/available-roles/?gh_jid=8859649002", "https://nousgroup.com/careers/available-roles/?gh_jid=8904985002"],
  ];
  for (const [a, b] of pairs) assert.notEqual(postingIdFor(a), postingIdFor(b), a);
});

test("URLs without a job-number parameter keep their old ID", () => {
  for (const u of ["https://au.seek.com/job/95848812", "https://jobs.deloitte.com.au/job/Perth-Consultant-WA/1370138666/", "https://rbc.wd3.myworkdayjobs.com/rbcglobal1/job/SYDNEY/Equity-Research-Associate_R-0000189547", "https://au.seek.com/job/95848812?utm_source=x&ref=y"]) {
    assert.equal(postingIdFor(u), legacyPostingIdFor(u), u);
  }
});

test("tracking parameters and parameter order do not change the ID", () => {
  assert.equal(postingIdFor("https://x.com/careers?pid=5&domain=x.com&utm_source=li"), postingIdFor("https://X.com/careers/?domain=x.com&pid=5"));
  assert.equal(jobIdQuery("https://x.com/p?utm=1&JobId=ABC"), "jobid=abc");
});

test("every module uses the same ID function", () => {
  const u = "https://www.bain.com/careers/find-a-role/position/?jobid=10397";
  assert.equal(fromDocStatus(u), postingIdFor(u));
  assert.equal(fromScreening(u), postingIdFor(u));
});

test("CFO Advisory roles are shown; real CFO and senior roles stay hidden", () => {
  for (const t of ["Experienced Analyst / CFO Advisory / Perth", "Senior Consultant - CFO Advisory", "Senior Associate | CFO Advisory | Adelaide"]) assert.equal(irrelevantReason(t), null, t);
  for (const t of ["CFO", "Group CFO", "Chief Financial Officer", "Director, CFO Advisory", "Senior Manager | CFO Advisory"]) assert.ok(irrelevantReason(t), t);
});
