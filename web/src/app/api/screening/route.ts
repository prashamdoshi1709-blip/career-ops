import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { careerOpsRoot } from "@/lib/career-ops";
import { readJsonObject } from "@/lib/json-body";
import { loadDocJobs } from "@/lib/doc-jobs";
import { readScreening, jdFor } from "@/lib/screening.mjs";
import { readSettings } from "@/lib/job-cleanup.mjs";
import { isAlive } from "@/lib/doc-queue-store.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Local customisation (2026-11-11): low-cost screening. Measured on 2026-11-11:
// about US$0.03 per job with a description, US$0.003 per job from its title.
const PER_JD = { tokens: 8000, usd: 0.03 }, PER_TITLE = { tokens: 750, usd: 0.0035 };
const JD_API = /myworkdayjobs\.com|smartrecruiters\.com|greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|zohorecruit/i;
const runFile = (root: string) => path.join(root, "data", "screening-run.json");
const readRun = (root: string) => { try { return JSON.parse(fs.readFileSync(runFile(root), "utf8")); } catch { return null; } };

function candidates(onlyKeys?: string[]) {
  const { root, jobs, keyOf } = loadDocJobs();
  const screened = readScreening(root);
  const out: Array<{ key: string; kind: string; n: string | null; url: string; company: string; title: string; location: string; hasJd: boolean; report?: string }> = [];
  for (const j of jobs) {
    if (j.kind !== "inbox") continue;
    const key = keyOf(j);
    if (onlyKeys ? !onlyKeys.includes(key) : screened[key]) continue;
    const it = { key, kind: "inbox", n: null, url: j.url, company: j.company, title: j.title, location: String(j.location ?? "") };
    out.push({ ...it, hasJd: Boolean(jdFor(root, it).jd) || JD_API.test(j.url) });
  }
  return { root, items: out, screened };
}
const estimate = (items: { hasJd: boolean }[]) => {
  const jd = items.filter((i) => i.hasJd).length, t = items.length - jd;
  return { withJd: jd, titleOnly: t, tokens: jd * PER_JD.tokens + t * PER_TITLE.tokens, costUsd: Math.round((jd * PER_JD.usd + t * PER_TITLE.usd) * 100) / 100 };
};

export async function GET() {
  const root = careerOpsRoot();
  const { items, screened } = candidates();
  const gate = readSettings(root).screeningGate;
  const vals = Object.values(screened as Record<string, { score: number; basis: string }>);
  return NextResponse.json({ ok: true, run: readRun(root), gate, unscreened: items.length, screened: vals.length, passing: vals.filter((v) => v.score >= gate).length, withJd: vals.filter((v) => v.basis === "job description").length });
}

export async function POST(req: Request) {
  const b = await readJsonObject<{ action?: string; scope?: "test" | "all"; keys?: string[]; confirm?: boolean }>(req);
  const root = careerOpsRoot();
  if (b?.action === "preview") { const { items } = candidates(b.keys); return NextResponse.json({ ok: true, count: items.length, ...estimate(items), test: estimate(items.slice(0, 10)) }); }
  if (b?.action === "stop") { const r = readRun(root); if (r && ["starting", "running"].includes(r.state)) { r.state = "stopping"; fs.writeFileSync(runFile(root), JSON.stringify(r, null, 2)); } return NextResponse.json({ ok: true }); }
  if (b?.action === "start") {
    if (b.confirm !== true) return NextResponse.json({ ok: false, error: "explicit confirmation required" }, { status: 400 });
    const cur = readRun(root);
    if (cur && ["starting", "running", "stopping"].includes(cur.state) && isAlive(cur.pid)) return NextResponse.json({ ok: false, error: "Screening is already running." }, { status: 409 });
    let { items } = candidates(b.keys);
    if (!b.keys?.length && b.scope === "test") items = items.slice(0, 10);
    if (!items.length) return NextResponse.json({ ok: false, error: "Nothing to screen." }, { status: 400 });
    fs.writeFileSync(runFile(root), JSON.stringify({ state: "starting", scope: b.keys?.length ? "selected" : b.scope ?? "all", items, done: [], failed: [], withJd: 0, titleOnly: 0, usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, estimate: estimate(items), queuedAt: new Date().toISOString() }, null, 2));
    const code = path.resolve(process.cwd(), "..");
    spawn(process.execPath, [path.join(code, "web", "scripts", "screen-worker.mjs")], { cwd: code, env: { ...process.env, CAREER_OPS_ROOT: root }, detached: true, stdio: "ignore" }).unref();
    return NextResponse.json({ ok: true, queued: items.length });
  }
  return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
}
