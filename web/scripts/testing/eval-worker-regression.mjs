#!/usr/bin/env node
// Regression for the batch-evaluation worker (2026-11-11). No Claude call:
// copies the data into a temporary sandbox, serves a mock of the evaluate
// endpoint that writes real reports and tracker rows through merge-tracker,
// and checks: a job rated below the minimum is removed everywhere (tracker row,
// inbox line, suppressed); kept jobs get a detailed rating and appear once;
// a usage limit backs off and resumes; temporary errors are retried.
//   node web/scripts/testing/eval-worker-regression.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(here, "..", ".."), CODE = path.resolve(WEB, "..");
const SB = fs.mkdtempSync(path.join(os.tmpdir(), "evalq-"));
spawnSync("rsync", ["-a", "--exclude", "node_modules", "--exclude", ".git", "--exclude", "web", "--exclude", "data/backups", "--exclude", "output", `${CODE}/`, `${SB}/`]);
for (const f of ["eval-queue.json", "eval-queue.log", ".cleanup-state.json"]) fs.rmSync(path.join(SB, "data", f), { force: true });
process.env.CAREER_OPS_ROOT = SB;
const lib = (f) => import(pathToFileURL(path.join(WEB, "src", "lib", f)).href);
const { loadJobs, planCleanup } = await lib("job-cleanup.mjs");
const { evalQueue } = await lib("doc-queue-store.mjs");
const { jobKey } = await lib("doc-status.mjs");
const pick = loadJobs(SB, CODE).jobs.filter((j) => j.kind === "inbox").slice(0, 6);
if (pick.length < 6) { console.log("SKIP: fewer than 6 scan finds to test with"); process.exit(0); }
// The worker evaluates only jobs with a saved description (it never fetches the posting).
const { savePostingJd } = await lib("screening.mjs");
for (const j of pick) savePostingJd(SB, j, `${j.title} at ${j.company}. `.repeat(20), "test fixture");
const plan = { [pick[0].url]: [{ score: 4 }], [pick[1].url]: [{ score: 2.5 }], [pick[2].url]: [{ error: "Claude usage limit reached" }, { score: 3.5 }], [pick[3].url]: [{ error: "connection reset" }, { error: "connection reset" }, { score: 3.6 }],
  // A run that finished but failed to save, and a plan limit: neither may be retried as a new run.
  [pick[4].url]: [{ error: "The posting URL has a tab or newline, so the tracker row cannot be built." }, { score: 4 }],
  [pick[5].url]: [{ error: "You've hit your 5-hour limit · resets 1:50pm (Australia/Sydney)" }, { score: 3.5 }] };
const planFile = path.join(SB, "mock-plan.json");
fs.writeFileSync(planFile, JSON.stringify(plan));
evalQueue.enqueue(SB, pick.map((j, i) => ({ key: jobKey(j), kind: "inbox", url: j.url, company: j.company, title: j.title, priority: 100 - i })));
const port = 3000 + Math.floor(Math.random() * 900) + 50;
const mock = spawn(process.execPath, [path.join(here, "mock-evaluate-endpoint.mjs"), SB, planFile, CODE, String(port)], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
spawnSync(process.execPath, [path.join(WEB, "scripts", "eval-worker.mjs")], { env: { ...process.env, CAREER_OPS_ROOT: SB, CAREER_OPS_DASHBOARD_ORIGIN: `http://127.0.0.1:${port}`, CAREER_OPS_EVAL_BACKOFF_MS: "2000" }, timeout: 120000 });
mock.kill();
const items = JSON.parse(fs.readFileSync(path.join(SB, "data", "eval-queue.json"), "utf8")).items;
const st = (j) => items[jobKey(j)];
const jobs = loadJobs(SB, CODE).jobs;
const entries = (u) => jobs.filter((j) => j.url === u || (j.sources ?? []).some((s) => s.url === u));
let fail = 0;
const check = (n, c, d = "") => { console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? ` (${d})` : ""}`); if (!c) fail++; };
check("kept job rated 8.0 with a detailed rating", st(pick[0]).state === "ready" && entries(pick[0].url)[0]?.ratingType === "Detailed");
check("job rated 5.0 removed everywhere", st(pick[1]).state === "removed" && entries(pick[1].url).length === 0);
check("removed URL suppressed in scan history", fs.readFileSync(path.join(SB, "data", "scan-history.tsv"), "utf8").includes(`${pick[1].url}\t`) && /suppressed_low_score/.test(fs.readFileSync(path.join(SB, "data", "scan-history.tsv"), "utf8")));
check("usage limit: backed off, then evaluated", st(pick[2]).state === "ready");
check("temporary errors retried, then evaluated", st(pick[3]).state === "ready" && st(pick[3]).attempts === 2);
check("each kept job appears once", [pick[0], pick[2], pick[3]].every((j) => entries(j.url).length === 1));
check("nothing left below the minimum", planCleanup(SB, CODE).remove.length === 0);
check("usage recorded", Object.values(items).some((i) => i.usage?.inputTokens > 0));
check("a finished run that failed to save is not retried", st(pick[4]).state === "failed" && st(pick[4]).attempts === 3);
check("a Claude plan limit pauses and resumes, not a failure", st(pick[5]).state === "ready");
check("only the URL reaches the tracker (no description text)", !fs.readFileSync(path.join(SB, "data", "applications.md"), "utf8").includes("<<provided-job-description>>"));
fs.rmSync(SB, { recursive: true, force: true });
console.log(fail ? `${fail} FAILED` : "All passed");
process.exit(fail ? 1 : 0);
