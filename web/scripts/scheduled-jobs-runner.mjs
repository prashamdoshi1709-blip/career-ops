#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";
import {
  isSafeScheduledId,
  withResourceLock,
  withScheduledStore,
} from "../src/lib/scheduled-jobs-store.mjs";
import { nextScheduledRun } from "../src/lib/scheduled-cadence.mjs";
import { isMainModule } from "../../lib/is-main-module.mjs";
import { scheduledRunnerResourcePath, scheduledStorePath } from "../src/lib/scheduled-runner-path.mjs";
import { getCareerOpsRoot } from "../../path-resolver.mjs";
import { getProfilePath } from "../src/lib/core/profile-path.mjs";
import { scanFailureMessage } from "../src/lib/scheduled-scan-error.mjs";
import { historyMark, scanBreakdown, breakdownMessage } from "../src/lib/scan-breakdown.mjs";

const CODE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const MAX_RUNS = 100;
export const MAX_ATTEMPTS = 3;
export const SCAN_TIMEOUT_MS = 25 * 60 * 1_000;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
export const QUEUE_CLAIM_STALE_MS = 30 * 1_000;

const nowIso = () => new Date().toISOString();

export const nextFutureRun = nextScheduledRun;

export function enqueueDueJobs(store, nowMs = Date.now()) {
  let queued = 0;
  for (const job of store.jobs) {
    if (job.status !== "active") continue;
    const dueAt = job.nextRunAt || job.startAt;
    const dueMs = Date.parse(dueAt);
    if (!Number.isFinite(dueMs) || dueMs > nowMs) continue;

    if (!store.queue.some((item) => item.jobId === job.id)) {
      store.queue.push({ id: randomUUID(), jobId: job.id, queuedAt: new Date(nowMs).toISOString() });
      queued += 1;
    }

    const nextRunAt = nextScheduledRun(job.startAt, job.every, job.unit, nowMs, job.timezone || "UTC");
    if (nextRunAt) job.nextRunAt = nextRunAt;
    job.updatedAt = new Date(nowMs).toISOString();
  }
  return queued;
}

function claimIsStale(item, nowMs) {
  if (!item.claimToken || !item.claimedAt) return false;
  const claimedMs = Date.parse(item.claimedAt);
  return !Number.isFinite(claimedMs) || nowMs - claimedMs >= QUEUE_CLAIM_STALE_MS;
}

function claimQueueItem(store, item, job, nowMs) {
  if (item.claimToken && !claimIsStale(item, nowMs)) return null;
  if (item.claimToken) {
    const staleRun = item.runId && store.runs.find((run) => run.id === item.runId);
    if (staleRun) {
      staleRun.state = "queued";
      staleRun.message = "Requeued after an interrupted worker.";
    }
  }
  const claimToken = randomUUID();
  item.claimToken = claimToken;
  item.claimedAt = new Date(nowMs).toISOString();
  if (!item.runId || !isSafeScheduledId(item.runId)) item.runId = randomUUID();
  const run = store.runs.find((candidate) => candidate.id === item.runId);
  if (run) {
    run.state = "running";
    run.at = new Date(nowMs).toISOString();
    run.attempt = (run.attempt || 0) + 1;
  } else {
    store.runs.unshift({ id: item.runId, jobId: job.id, at: new Date(nowMs).toISOString(), state: "running", attempt: 1, engine: job.engine || "full" });
  }
  return { job: structuredClone(job), queueId: item.id, runId: item.runId, claimToken };
}

export function claimDueJob(store, nowMs = Date.now()) {
  for (const item of store.queue) {
    const job = store.jobs.find((candidate) => candidate.id === item.jobId && candidate.status === "active");
    if (!job) continue;
    const claim = claimQueueItem(store, item, job, nowMs);
    if (claim) return claim;
  }
  return null;
}

export function claimManualJob(store, jobId, nowMs = Date.now()) {
  const job = store.jobs.find((candidate) => candidate.id === jobId && candidate.status !== "deleted");
  if (!job) return null;
  let item = store.queue.find((candidate) => candidate.jobId === jobId);
  if (!item) {
    item = { id: randomUUID(), jobId, queuedAt: new Date(nowMs).toISOString() };
    store.queue.push(item);
  }
  return claimQueueItem(store, item, job, nowMs);
}

export const runnerResourcePath = scheduledRunnerResourcePath;

function numericFilter(value, fallback, minimum, maximum = Number.POSITIVE_INFINITY) {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(number)));
}

export function buildScanCommand(job) {
  const filters = job.filters || {};
  const sinceDays = numericFilter(filters.sinceDays, 7, 1);
  if (job.engine === "portals") {
    return {
      script: "scan.mjs",
      args: ["--since", String(sinceDays), "--quiet"],
    };
  }
  // 2026-11-23: specialist recruiter sites only, daily. Each recruiter entry
  // carries its own max_posting_age_days, so no --since; --verify checks every
  // new link before it reaches the inbox.
  if (job.engine === "recruiters") {
    return {
      script: "scan.mjs",
      args: ["--source-type", "specialist_recruiter", "--verify", "--quiet"],
    };
  }
  // 2026-11-22: progressive sweep. No company cap: each source gets a time
  // budget (default 300s, 60..900), stops cleanly, and the next run continues
  // from data/explore-coverage.json. Four sources stay inside SCAN_TIMEOUT_MS.
  if (job.engine === "sweep") {
    const budget = numericFilter(filters.budgetSeconds, 300, 60, 900);
    const sweepAts = Array.isArray(filters.ats) && filters.ats.length ? filters.ats.join(",") : "greenhouse,lever,ashby,workday";
    return {
      script: "scan-ats-full.mjs",
      args: ["--since", String(sinceDays), "--ats", sweepAts, "--rotate", "--budget-seconds", String(budget), "--json"],
    };
  }

  const ats = Array.isArray(filters.ats) && filters.ats.length
    ? filters.ats.join(",")
    : "greenhouse,lever,ashby,workday";
  const limit = numericFilter(filters.limitPerAts, 150, 50, 500);
  return {
    script: "scan-ats-full.mjs",
    args: ["--since", String(sinceDays), "--ats", ats, "--limit", String(limit), "--json"],
  };
}

/**
 * 2026-11-23: problems a successful run still had, from the run logs the
 * scanners wrote after `sinceIso`: boards that failed, answered 429, or were
 * held back by an open rate-limit circuit (rate-limit-state.mjs). A run exits
 * 0 when only some sources failed, so without this "success" hid them.
 * Returns a short sentence, or "" when there was nothing to report.
 */
export function sourceWarnings(root, engine, sinceIso) {
  const read = (name) => { try { return fs.readFileSync(path.join(root, "data", name), "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((r) => r && r.at >= sinceIso); } catch { return []; } };
  const parts = [];
  const add = (label, failed, limited, paused) => {
    const bits = [];
    if (failed) bits.push(`${failed} failed`);
    if (limited) bits.push(`${limited} rate-limited`);
    if (paused) bits.push(`${paused} paused by rate limits (not asked)`);
    if (bits.length) parts.push(`${label}: ${bits.join(", ")}`);
  };
  if (engine === "sweep" || engine === "full") {
    let slept = 0;
    for (const r of read("explore-runs.jsonl")) {
      for (const [src, f] of Object.entries(r.funnelBySource ?? {})) { add(src[0].toUpperCase() + src.slice(1), 0, f.rateLimited ?? 0, f.deferredRateLimit ?? 0); slept += f.sleptSeconds ?? 0; }
    }
    // The Mac sleeping mid-run (2026-11-23: 901s of a 935s Workday sweep)
    // uses up the time budget without scanning; say so rather than look slow.
    if (slept >= 60) parts.push(`Mac was asleep for ${Math.round(slept / 60)} min of this run, so it scanned less`);
  } else {
    const names = { seek: "SEEK", employers: "Employer sites", recruiters: "Recruiters" };
    for (const r of read("source-runs.jsonl")) for (const [g, x] of Object.entries(r.groups ?? {})) add(names[g] ?? g, x.failed ?? 0, x.rateLimited ?? 0, x.deferredRateLimit ?? 0);
  }
  const open = (() => { try { return Object.entries(JSON.parse(fs.readFileSync(path.join(root, "data", "rate-limit-state.json"), "utf8")).circuits ?? {}).filter(([, c]) => c.state === "open").map(([k]) => k.replace("workday:", "")); } catch { return []; } })();
  if (open.length && parts.some((p) => /rate/.test(p))) parts.push(`Workday paused: ${open.join(", ")}`);
  return parts.join("; ");
}

export function extractRolesFound(engine, stdout) {
  if (engine === "full" || engine === "sweep") {
    try {
      const result = JSON.parse(stdout);
      return Number.isFinite(Number(result.postingsKept)) ? Number(result.postingsKept) : 0;
    } catch {
      return 0;
    }
  }
  const match = stdout.match(/New offers added:\s*(\d+)/i);
  return match ? Number(match[1]) : 0;
}

function writeJobPortals(root, job) {
  if (!isSafeScheduledId(job.id)) throw new Error("Invalid scheduled job identifier.");
  const portalsPath = path.join(root, "portals.yml");
  const base = yaml.load(fs.readFileSync(portalsPath, "utf8"));
  if (!base || typeof base !== "object") throw new Error("portals.yml must contain a mapping");

  const filters = job.filters || {};
  const positive = Array.isArray(filters.positive)
    ? filters.positive.filter((value) => typeof value === "string" && value.trim())
    : [];
  const fallbackPositive = Array.isArray(base.title_filter?.positive)
    ? base.title_filter.positive.filter((value) => typeof value === "string" && value.trim())
    : [];
  if (!positive.length && !fallbackPositive.length) {
    throw new Error("Scheduled scans require title keywords in the job or portals.yml title_filter.positive.");
  }
  // Local customisation (2026-11-09): a saved scan may NARROW portals.yml, never
  // silently widen it. Previously an empty list on the job replaced the user's
  // portals.yml list, so a scan saved with blank fields ran with no location
  // filter and no excluded titles (157 overseas roles on 2026-11-04).
  //   - allow / always_allow: the job's list wins only when it is non-empty;
  //     an empty list inherits portals.yml.
  //   - negative titles, block, block_hard: union of portals.yml and the job
  //     (more exclusions are always safe).
  //   - strict / remote_title_fallback and every other key: kept from portals.yml.
  const listOf = (value) => (Array.isArray(value) ? value.filter((v) => typeof v === "string" && v.trim()) : []);
  const union = (a, b) => [...new Set([...listOf(a), ...listOf(b)])];
  const narrowOrInherit = (jobList, baseList) => (listOf(jobList).length ? listOf(jobList) : listOf(baseList));
  const baseLocation = base.location_filter || {};
  base.title_filter = {
    ...(base.title_filter || {}),
    positive: positive.length ? positive : fallbackPositive,
    negative: union(base.title_filter?.negative, filters.negative),
  };
  if (base.title_filter_full) base.title_filter_full = { ...base.title_filter_full, ...base.title_filter };
  base.location_filter = {
    ...baseLocation,
    allow: narrowOrInherit(filters.allow, baseLocation.allow),
    always_allow: narrowOrInherit(filters.alwaysAllow, baseLocation.always_allow),
    block: union(baseLocation.block, filters.block),
    block_hard: union(baseLocation.block_hard, filters.blockHard),
  };

  const tempDir = path.join(root, "data", "tmp");
  fs.mkdirSync(tempDir, { recursive: true });
  const tempPath = path.join(tempDir, `scheduled-${job.id}-${randomUUID()}.yml`);
  fs.writeFileSync(tempPath, yaml.dump(base, { lineWidth: 120, noRefs: true }), "utf8");
  return tempPath;
}

/*
 * Keep the temporary portal overlay scoped to each retry. A thrown setup or
 * spawn error is retryable just like a non-zero scanner exit, while cleanup
 * still runs before the next attempt. A scanner that ran into the timeout is
 * not retried: the same sweep would hit the same limit, three times over.
 */

export function executeJob(root, job, options = {}) {
  const spawnFn = options.spawnFn || spawnSync;
  const startedAt = Date.now();
  let lastError = "Scan failed";
  let finalAttempt = MAX_ATTEMPTS;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let tempPortals = null;
    try {
      tempPortals = writeJobPortals(root, job);
      const command = buildScanCommand(job);
      // 2026-11-11: remember where scan-history ends, to report what this run added.
      const mark = historyMark(root);
      const runStartedIso = new Date().toISOString();
      const result = spawnFn(
        process.execPath,
        [command.script, ...command.args],
        {
          cwd: CODE_ROOT,
          env: {
            ...process.env,
            CAREER_OPS_ROOT: root,
            CAREER_OPS_PORTALS: tempPortals,
            // The scanner runs with cwd = the checkout; a relative override is
            // resolved here, the way the web resolves it, so both read one file.
            ...(process.env.CAREER_OPS_PROFILE?.trim() ? { CAREER_OPS_PROFILE: getProfilePath(root) } : {}),
          },
          encoding: "utf8",
          timeout: SCAN_TIMEOUT_MS,
          maxBuffer: MAX_OUTPUT_BYTES,
          windowsHide: true,
        },
      );

      if (result.status === 0) {
        const rolesFound = extractRolesFound(job.engine || "full", result.stdout || "");
        const warnings = options.spawnFn ? "" : sourceWarnings(root, job.engine || "full", runStartedIso);
        return {
          state: "success",
          attempt,
          rolesFound,
          ...(warnings ? { warnings } : {}),
          durationMs: Date.now() - startedAt,
          message: ((job.engine === "portals" || job.engine === "recruiters") && !options.spawnFn)
            ? (() => { try { return breakdownMessage(scanBreakdown(root, mark)); } catch { return `Scan finished with ${rolesFound} matching role${rolesFound === 1 ? "" : "s"}.`; } })()
            : `Scan finished with ${rolesFound} matching role${rolesFound === 1 ? "" : "s"}.`,
        };
      }
      lastError = scanFailureMessage(result, { timeoutMs: SCAN_TIMEOUT_MS });
      if (result.error?.code === "ETIMEDOUT") {
        finalAttempt = attempt;
        break;
      }
    } catch (error) {
      lastError = scanFailureMessage({ error });
    } finally {
      if (tempPortals) {
        try {
          fs.rmSync(tempPortals, { force: true });
        } catch {
          // Temporary filter cleanup is best effort.
        }
      }
    }
  }

  return {
    state: "failed",
    attempt: finalAttempt,
    rolesFound: 0,
    durationMs: Date.now() - startedAt,
    message: lastError,
  };
}

export async function recordCompletion(storePath, claim, result, inMemoryStore = null) {
  const at = nowIso();
  const apply = (store) => {
    const job = claim.job;
    const queueItem = claim.queueId && store.queue.find((item) => item.id === claim.queueId && item.claimToken === claim.claimToken);
    // A stale worker may finish after another worker reclaimed the item. Its
    // result must not overwrite the newer claim's run or job metadata.
    if (claim.queueId && !queueItem) return;
    const current = store.jobs.find((item) => item.id === job.id);
    if (current) {
      current.lastRunAt = at;
      current.rolesFoundCount = result.rolesFound;
      current.updatedAt = at;
      if (result.state === "failed") current.lastError = result.message;
      else delete current.lastError;
      if (result.warnings) current.lastWarning = result.warnings;
      else delete current.lastWarning;
    }

    const run = store.runs.find((item) => item.id === claim.runId && item.jobId === job.id);
    const warn = result.warnings ? { warnings: result.warnings } : {};
    if (run) { Object.assign(run, { at, durationMs: result.durationMs, state: result.state, attempt: result.attempt, message: result.message, rolesFound: result.rolesFound, engine: job.engine || "full" }, warn); if (!result.warnings) delete run.warnings; }
    else store.runs.unshift({ id: claim.runId || randomUUID(), jobId: job.id, at, durationMs: result.durationMs, state: result.state, attempt: result.attempt, message: result.message, rolesFound: result.rolesFound, engine: job.engine || "full", ...warn });
    store.queue = store.queue.filter((item) => !(item.id === claim.queueId && item.claimToken === claim.claimToken));
    if (store.runs.length > MAX_RUNS) store.runs = store.runs.slice(0, MAX_RUNS);
  };
  if (inMemoryStore) apply(inMemoryStore);
  else await withScheduledStore(storePath, apply);
}

async function takeDueJob(storePath) {
  return withScheduledStore(storePath, (store) => {
    enqueueDueJobs(store);
    return claimDueJob(store);
  });
}

function requestedJobId(args) {
  const index = args.indexOf("--job");
  return index >= 0 ? args[index + 1] || null : null;
}

async function main() {
  const root = getCareerOpsRoot();
  const storePath = scheduledStorePath(root);
  const runnerResource = runnerResourcePath(storePath);
  const manualJobId = requestedJobId(process.argv.slice(2));

  return withResourceLock(
    runnerResource,
    async () => {
      let claim;
      if (manualJobId) {
        if (!isSafeScheduledId(manualJobId)) throw new Error("Invalid scheduled job identifier.");
        claim = await withScheduledStore(storePath, (store) => {
          const job = store.jobs.find((item) => item.id === manualJobId && item.status !== "deleted");
          if (!job) throw new Error("Scheduled job not found.");
          const manualClaim = claimManualJob(store, manualJobId);
          if (!manualClaim) throw new Error("Scheduled job is already running.");
          return manualClaim;
        });
      } else {
        claim = await takeDueJob(storePath);
      }

      if (!claim) return { status: "idle" };

      const result = executeJob(root, claim.job);
      await recordCompletion(storePath, claim, result);
      if (result.state === "failed") throw new Error(result.message);
      return { status: "success", jobId: claim.job.id, ...result };
    },
    { timeoutMs: 1_000, staleMs: SCAN_TIMEOUT_MS * MAX_ATTEMPTS + 60_000 },
  );
}

if (isMainModule(import.meta.url)) {
  main()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
