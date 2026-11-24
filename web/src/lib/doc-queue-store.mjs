// Local customisation (2026-11-11): persistent document-generation queue.
//
// One JSON file in the user layer, data/doc-queue.json, shared by the dashboard
// (which adds, pauses, cancels and reads) and data/cv-original/queue-worker.mjs
// (which processes items one or two at a time). Every change is a locked,
// atomic read-modify-write, so the two never overwrite each other.
//
// Item states: queued → generating → ready | needs-review | failed | skipped | cancelled
// No Claude call happens here; only the worker calls the shared generator.

import fs from "node:fs";
import path from "node:path";

export const QUEUE_VERSION = 1;
// Each queue is one JSON file; the document queue is "doc-queue", the
// evaluation queue (2026-11-11) is "eval-queue". Same rules for both.
const pathFor = (name) => (root) => path.join(root, "data", `${name}.json`);
const lockFor = (name) => (root) => path.join(root, "data", `.${name}.lock`);
export const queuePath = pathFor("doc-queue");

export const DEFAULT_SETTINGS = {
  paused: false,
  concurrency: 1,          // Claude calls at once (1 or 2)
  autoQueueNew: false,     // queue newly eligible jobs automatically (off until opted in)
  autoQueueDailyLimit: 10,
  backoffUntil: null,      // set when Claude reports a usage or rate limit
  pauseReason: "",
};

export function emptyQueue() {
  return { version: QUEUE_VERSION, settings: { ...DEFAULT_SETTINGS }, worker: null, items: {}, approvals: [] };
}

export const isAlive = (pid) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };

function sleepMs(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

/** A queue backed by data/<name>.json. */
export function createQueueStore(name) {
  const qPath = pathFor(name), lPath = lockFor(name);
  function readQueue(root) {
    try {
      const q = JSON.parse(fs.readFileSync(qPath(root), "utf8"));
      return { ...emptyQueue(), ...q, settings: { ...DEFAULT_SETTINGS, ...(q.settings ?? {}) }, items: q.items ?? {} };
    } catch {
      return emptyQueue();
    }
  }


  /** Run fn(queue) under the queue lock and save what it returns (or the mutated queue). */
  function mutateQueue(root, fn) {
    const lock = lPath(root);
    const deadline = Date.now() + 10_000;
    for (;;) {
      try { fs.mkdirSync(lock); break; } catch {
        // A lock older than 60 s belongs to a process that died mid-write.
        try { if (Date.now() - fs.statSync(lock).mtimeMs > 60_000) { fs.rmSync(lock, { recursive: true, force: true }); continue; } } catch { /* gone */ }
        if (Date.now() > deadline) throw new Error("document queue is busy; try again");
        sleepMs(50);
      }
    }
    try {
      const q = readQueue(root);
      const res = fn(q) ?? q;
      const p = qPath(root);
      const tmp = `${p}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(res, null, 2) + "\n");
      fs.renameSync(tmp, p);
      return res;
    } finally {
      fs.rmSync(lock, { recursive: true, force: true });
    }
  }


  /** Add jobs (deduplicated by key). Items already queued, generating or done are left alone unless `requeue`. */
  /**
   * @param {string} root
   * @param {any[]} jobs
   * @param {{now?: string, requeue?: boolean, approvalNote?: object|null}} [opts]
   */
  function enqueue(root, jobs, { now = new Date().toISOString(), requeue = false, approvalNote = null } = {}) {
    let added = 0;
    const q = mutateQueue(root, (q) => {
      for (const j of jobs) {
        const cur = q.items[j.key];
        const active = cur && ["queued", "generating"].includes(cur.state);
        if (active) continue;
        if (cur && !requeue && ["ready", "needs-review"].includes(cur.state)) continue;
        q.items[j.key] = { ...j, state: "queued", attempts: 0, lastError: "", reason: "", queuedAt: now, startedAt: null, finishedAt: null, usage: cur?.usage ?? null, history: [...(cur?.history ?? []), ...(cur ? [{ state: cur.state, at: cur.finishedAt ?? cur.queuedAt }] : [])].slice(-10) };
        added++;
      }
      if (approvalNote) q.approvals = [...(q.approvals ?? []), { at: now, ...approvalNote, added }].slice(-50);
      q.settings.paused = false;
      return q;
    });
    return { added, queue: q };
  }

  function setPaused(root, paused, reason = "") {
    return mutateQueue(root, (q) => { q.settings.paused = paused; q.settings.pauseReason = paused ? reason : ""; if (!paused) q.settings.backoffUntil = null; return q; });
  }

  /** Cancel every queued (not yet started) item. Generating items finish normally. */
  function cancelPending(root, now = new Date().toISOString()) {
    let n = 0;
    mutateQueue(root, (q) => { for (const it of Object.values(q.items)) if (it.state === "queued") { it.state = "cancelled"; it.finishedAt = now; n++; } return q; });
    return n;
  }


  return { path: qPath, readQueue, mutateQueue, enqueue, setPaused, cancelPending };
}

const docs = createQueueStore("doc-queue");
export const readQueue = docs.readQueue;
export const mutateQueue = docs.mutateQueue;
export const enqueue = docs.enqueue;
export const setPaused = docs.setPaused;
export const cancelPending = docs.cancelPending;
export const evalQueue = createQueueStore("eval-queue");

/** Items left "generating" by a worker that is no longer running go back to the queue. */
export function recoverStale(q) {
  if (isAlive(q.worker?.pid)) return 0;
  let n = 0;
  for (const it of Object.values(q.items)) if (it.state === "generating") { it.state = "queued"; it.startedAt = null; n++; }
  return n;
}

export function summary(q) {
  const items = Object.values(q.items);
  const by = (s) => items.filter((i) => i.state === s).length;
  const done = items.filter((i) => i.usage);
  const tokens = done.reduce((s, i) => s + (i.usage.inputTokens ?? 0) + (i.usage.outputTokens ?? 0), 0);
  const cost = done.reduce((s, i) => s + (i.usage.costUsd ?? 0), 0);
  return {
    queued: by("queued"), generating: by("generating"), ready: by("ready"), needsReview: by("needs-review"),
    failed: by("failed"), skipped: by("skipped"), cancelled: by("cancelled"), total: items.length,
    workerRunning: isAlive(q.worker?.pid), paused: q.settings.paused, pauseReason: q.settings.pauseReason,
    backoffUntil: q.settings.backoffUntil, usedTokens: tokens, usedCostUsd: Math.round(cost * 100) / 100, measuredRuns: done.length,
  };
}
