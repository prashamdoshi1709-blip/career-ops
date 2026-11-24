// Mock of the dashboard's evaluate endpoint for worker tests. Writes a real
// report and a tracker row through merge-tracker in the sandbox.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
const SB = process.argv[2], CODE = process.argv[4];
const plan = JSON.parse(fs.readFileSync(process.argv[3], "utf8")); // url -> [{error}|{score}]
const calls = {};
http.createServer((req, res) => {
  let body = ""; req.on("data", (d) => (body += d)); req.on("end", () => {
    const { input } = JSON.parse(body);
    // The worker sends "<url>\n\n<<provided-job-description>>\n<text>"; the URL identifies the job.
    const url = String(input).split("\n\n<<provided-job-description>>\n")[0];
    if (!String(input).includes("<<provided-job-description>>")) { res.writeHead(400); res.end("expected a provided job description"); return; }
    const step = (plan[url] ?? [{ score: 4 }])[Math.min((calls[url] = (calls[url] ?? 0) + 1) - 1, (plan[url] ?? [1]).length - 1)];
    res.writeHead(200, { "Content-Type": "application/x-ndjson" });
    res.write(JSON.stringify({ type: "status", label: "reading posting" }) + "\n");
    if (step.error) { res.write(JSON.stringify({ type: "error", msg: step.error }) + "\n"); res.end(); return; }
    const r = spawnSync(process.execPath, [path.join(CODE, "reserve-report-num.mjs")], { cwd: CODE, env: { ...process.env, CAREER_OPS_ROOT: SB }, encoding: "utf8" });
    const num = r.stdout.match(/\d{3,}/)[0];
    const base = `${num}-mock-${num}-2026-11-11.md`;
    fs.writeFileSync(path.join(SB, "reports", base), `# Mock evaluation\n\n**Date:** 2026-11-11\n**Archetype:** Investment Banking / M&A\n**Score:** ${step.score}/5\n**URL:** ${url}\n**Legitimacy:** High Confidence\n\n## Job Description (archived verbatim)\n\nAnalyst role in corporate finance and M&A, building financial models and valuations.\n`);
    fs.mkdirSync(path.join(SB, "batch/tracker-additions"), { recursive: true });
    fs.writeFileSync(path.join(SB, "batch/tracker-additions", `${num}-mock.tsv`), `num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\turl\n${Number(num)}\t2026-11-11\tMock Co ${num}\tAnalyst\tEvaluated\t${step.score}/5\t❌\t[${num}](reports/${base})\tmock\t${url}\n`);
    spawnSync(process.execPath, [path.join(CODE, "merge-tracker.mjs")], { cwd: CODE, env: { ...process.env, CAREER_OPS_ROOT: SB }, encoding: "utf8" });
    spawnSync(process.execPath, [path.join(CODE, "reserve-report-num.mjs"), "--release", num], { cwd: CODE, env: { ...process.env, CAREER_OPS_ROOT: SB } });
    res.end(JSON.stringify({ type: "done", tokens: 150000, costUsd: 1.2, reportN: Number(num) }) + "\n");
  });
}).listen(Number(process.argv[5] || 3019), "127.0.0.1", () => console.log("mock on 3019"));
