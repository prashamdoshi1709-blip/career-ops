#!/usr/bin/env node
// Local customisation (2026-11-11): low-cost screening runner.
// Started by the dashboard after you confirm. State in data/screening-run.json.
// Jobs with a job description (archived, saved, pasted, or read from an
// employer job board's public API) are screened one per call; jobs without one
// are screened from their titles, 12 per call. SEEK and LinkedIn pages are never
// fetched. Screening never deletes a job.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const CODE = path.resolve(here, "..", "..");
const ROOT = process.env.CAREER_OPS_ROOT ? path.resolve(CODE, process.env.CAREER_OPS_ROOT) : CODE;
const S = await import(pathToFileURL(path.join(here, "..", "src", "lib", "screening.mjs")).href);
const RUN = path.join(ROOT, "data", "screening-run.json");
const RATE = /rate.?limit|usage limit|limit reached|hit your [\w -]*limit|5-hour limit|weekly limit|429|overloaded|too many requests/i;
const JD_API = /myworkdayjobs\.com|smartrecruiters\.com|greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|zohorecruit/i;
const readRun = () => { try { return JSON.parse(fs.readFileSync(RUN, "utf8")); } catch { return null; } };
const writeRun = (r) => { fs.writeFileSync(`${RUN}.tmp`, JSON.stringify(r, null, 2)); fs.renameSync(`${RUN}.tmp`, RUN); };
const update = (fn) => { const r = readRun(); if (!r) return null; fn(r); writeRun(r); return r; };
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

let run = readRun();
if (!run || run.state !== "starting") process.exit(0);
update((r) => { r.state = "running"; r.pid = process.pid; r.startedAt = new Date().toISOString(); });

const addUsage = (r, u) => { r.usage.inputTokens += u?.inputTokens ?? 0; r.usage.outputTokens += u?.outputTokens ?? 0; r.usage.costUsd += u?.costUsd ?? 0; };

async function withRetry(fn) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (readRun()?.state === "stopping") return { ok: false, stopped: true };
    const r = await fn();
    if (r.ok) return r;
    if (RATE.test(r.error ?? "")) { update((x) => { x.note = "Claude usage limit reached; waiting 20 minutes, then continuing"; }); await sleep(20 * 60 * 1000); continue; }
    if (attempt === 3) return r;
    await sleep(3000);
  }
  return { ok: false, error: "gave up" };
}

try {
  run = readRun();
  const pending = run.items.filter((i) => !run.done.includes(i.key));
  // 1. Jobs that can have a description.
  const withJd = [], titleOnly = [];
  for (const it of pending) {
    let src = S.jdFor(ROOT, it);
    if (!src.jd && JD_API.test(it.url)) {
      const f = spawnSync(process.execPath, [path.join(CODE, "fetch-jd.mjs"), it.url], { cwd: CODE, encoding: "utf8", timeout: 60000, env: process.env });
      if (f.status === 0 && f.stdout.trim().length >= 400) { S.savePostingJd(ROOT, it, f.stdout.trim(), "employer job-board API"); src = S.jdFor(ROOT, it); }
    }
    (src.jd ? withJd : titleOnly).push({ ...it, jd: src.jd, source: src.source });
  }
  for (const it of withJd) {
    const r = await withRetry(() => S.screenWithJd(ROOT, it, it.jd, it.source));
    if (r.stopped) break;
    update((x) => { if (r.ok) { x.done.push(it.key); addUsage(x, r.rec.usage); x.withJd++; } else x.failed.push({ key: it.key, error: r.error }); });
  }
  // 2. Titles only, 12 per call.
  for (let i = 0; i < titleOnly.length; i += 12) {
    const batch = titleOnly.slice(i, i + 12);
    const r = await withRetry(() => S.screenTitles(ROOT, batch));
    if (r.stopped) break;
    update((x) => { if (r.ok) { x.done.push(...batch.map((b) => b.key)); addUsage(x, r.usage); x.titleOnly += batch.length; } else x.failed.push(...batch.map((b) => ({ key: b.key, error: r.error }))); });
  }
} catch (e) {
  update((x) => { x.error = String(e.message ?? e).slice(0, 300); });
} finally {
  update((x) => { x.state = x.state === "stopping" ? "stopped" : "finished"; x.finishedAt = new Date().toISOString(); x.pid = null; x.note = ""; });
}
