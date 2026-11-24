// Local customisation (2026-11-11): shared loader for the document queue and the
// pages that show document status. File reads only.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { careerOpsRoot, readApplications } from "@/lib/career-ops";
import { buildOpportunities } from "@/lib/opportunities.mjs";
import { docStatuses, previewBatch, jobKey } from "@/lib/doc-status.mjs";
import { readQueue, mutateQueue, recoverStale, isAlive, enqueue } from "@/lib/doc-queue-store.mjs";

export type DocState = { key: string; state: string; reason: string; cv: string | null; cover: string | null; needCover: boolean; generatedAt: string | null; verdict: string | null; eligible: boolean; exclude: string; priority: number };

export function loadDocJobs() {
  const root = careerOpsRoot();
  const { jobs } = buildOpportunities(root, readApplications());
  const statuses = docStatuses(root, jobs) as Record<string, DocState>;
  return { root, jobs: jobs as Array<Record<string, unknown> & { kind: string; n: string | null; url: string; company: string; title: string }>, statuses, keyOf: (j: unknown) => jobKey(j) as string };
}

/** Start the background worker when approved work is waiting and none is running. */
export function ensureWorker(root: string) {
  const q = readQueue(root);
  if (q.settings.paused) return false;
  const waiting = Object.values(q.items as Record<string, { state: string }>).some((i) => i.state === "queued" || i.state === "generating");
  if (!waiting || isAlive(q.worker?.pid)) return false;
  mutateQueue(root, (qq: unknown) => { recoverStale(qq); return qq; });
  const codeRoot = path.resolve(process.cwd(), "..");
  const child = spawn(process.execPath, [path.join(codeRoot, "data", "cv-original", "queue-worker.mjs")], { cwd: codeRoot, env: { ...process.env, CAREER_OPS_ROOT: root }, detached: true, stdio: "ignore" });
  child.unref();
  return true;
}

/** Opt-in: queue newly eligible jobs automatically, at most autoQueueDailyLimit a day. */
export function autoQueue(root: string) {
  const q = readQueue(root);
  if (!q.settings.autoQueueNew || q.settings.paused) return 0;
  const today = new Date().toISOString().slice(0, 10);
  const doneToday = (q.approvals ?? []).filter((a: { at: string; auto?: boolean; added?: number }) => a.auto && a.at.startsWith(today)).reduce((s: number, a: { added?: number }) => s + (a.added ?? 0), 0);
  const room = Math.max(0, (q.settings.autoQueueDailyLimit ?? 10) - doneToday);
  if (!room) return 0;
  const { jobs, statuses } = loadDocJobs();
  const pv = previewBatch(root, jobs, statuses);
  const fresh = pv.eligible.filter((e: { key: string }) => !q.items[e.key]).slice(0, room);
  if (!fresh.length) return 0;
  return enqueue(root, fresh, { approvalNote: { auto: true, note: "automatic queueing of new jobs (opted in)" } }).added;
}

export const fileExists = (root: string, rel: string | null) => !!rel && fs.existsSync(path.join(root, "output", "applications", rel));
