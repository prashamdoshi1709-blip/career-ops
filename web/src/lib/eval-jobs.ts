// Local customisation (2026-11-11): which scan finds can be evaluated in bulk,
// and the worker launcher. File reads only.
import path from "node:path";
import { spawn } from "node:child_process";
import { evalQueue, isAlive, summary } from "@/lib/doc-queue-store.mjs";
import { loadDocJobs } from "@/lib/doc-jobs";
import { priorityOf } from "@/lib/doc-status.mjs";
import { readScreening, jdFor } from "@/lib/screening.mjs";
import { readSettings } from "@/lib/job-cleanup.mjs";

const STUDENT_ONLY = /\b(intern(ship)?|vacation (program|programme|scheme)|summer (intern|program)|off-cycle|work experience program)\b/i;

export function evalPreview() {
  const { root, jobs, statuses, keyOf } = loadDocJobs();
  const q = evalQueue.readQueue(root);
  const screening = readScreening(root) as Record<string, unknown>;
  const gate = readSettings(root).screeningGate as number;
  const seen = new Set<string>();
  const eligible: Array<{ key: string; kind: string; url: string; company: string; title: string; location: string; score: number | null; priority: number; hasJd: boolean }> = [];
  const excluded: Record<string, number> = {};
  const ex = (r: string) => (excluded[r] = (excluded[r] ?? 0) + 1);
  for (const j of jobs) {
    if (j.kind !== "inbox") continue;
    const key = keyOf(j);
    const item = q.items[key] as { state: string } | undefined;
    if (item && ["queued", "generating", "ready", "removed", "failed"].includes(item.state)) { ex("Already queued or evaluated"); continue; }
    if (STUDENT_ONLY.test(String(j.title))) { ex("Student internship or vacation programme"); continue; }
    // Career-Ops does not read these sites automatically (its LinkedIn rule stops the evaluation), so batch runs would only fail and use tokens.
    if (/linkedin\.com|indeed\.|glassdoor\./i.test(String(j.url))) { ex("LinkedIn, Indeed or Glassdoor posting: paste its description with Add Job Manually instead"); continue; }
    const dupKey = `${String(j.company).toLowerCase()}|${String(j.title).toLowerCase()}`;
    if (seen.has(dupKey)) { ex("Duplicate listing of the same role"); continue; }
    seen.add(dupKey);
    // Only jobs that passed the low-cost screen, and that have a job description
    // Career-Ops may use, go on to a detailed evaluation (2026-11-11).
    const sc = screening[key] as { score: number; basis: string } | undefined;
    if (!sc) { ex("Not screened yet: run the low-cost screen first"); continue; }
    if (sc.score < gate) { ex(`Screened below ${gate} (kept, not deleted)`); continue; }
    const desc = jdFor(root, { kind: "inbox", url: j.url, company: j.company, title: j.title });
    if (!desc.jd) { ex("No job description: paste it on the job's Review page (SEEK and LinkedIn pages are not read automatically)"); continue; }
    void statuses;
    eligible.push({ key, kind: "inbox", url: j.url, company: j.company, title: j.title, location: String(j.location ?? ""), score: sc.score, priority: priorityOf({ ...j, score: sc.score }), hasJd: true });
  }
  eligible.sort((a, b) => b.priority - a.priority);
  const runs = Object.values(q.items as Record<string, { usage?: { inputTokens: number; costUsd: number | null } }>).filter((i) => i.usage && i.usage.inputTokens > 0);
  const per = runs.length ? { tokens: Math.round(runs.reduce((s, i) => s + i.usage!.inputTokens, 0) / runs.length), cost: runs.some((i) => i.usage!.costUsd != null) ? runs.reduce((s, i) => s + (i.usage!.costUsd ?? 0), 0) / runs.length : null, runs: runs.length } : null;
  return { eligible, excluded, perJob: per, estimateTokens: per ? per.tokens * eligible.length : null, estimateCostUsd: per?.cost != null ? Math.round(per.cost * eligible.length * 100) / 100 : null };
}

export function ensureEvalWorker(root: string, origin: string) {
  const q = evalQueue.readQueue(root);
  if (q.settings.paused) return false;
  const waiting = Object.values(q.items as Record<string, { state: string }>).some((i) => i.state === "queued" || i.state === "generating");
  if (!waiting || isAlive(q.worker?.pid)) return false;
  const codeRoot = path.resolve(process.cwd(), "..");
  const child = spawn(process.execPath, [path.join(codeRoot, "web", "scripts", "eval-worker.mjs")], { cwd: codeRoot, env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DASHBOARD_ORIGIN: origin }, detached: true, stdio: "ignore" });
  child.unref();
  return true;
}

export const evalSummary = (root: string) => summary(evalQueue.readQueue(root));
