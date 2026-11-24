import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";
import { careerOpsRoot, findApplication } from "@/lib/career-ops";
import { recordRevision } from "@/lib/application-instructions.mjs";
import { reportNumberFromCell } from "@/lib/pipeline-details.mjs";
import { readJsonObject } from "@/lib/json-body";
import fs from "node:fs";
import { identitiesOf } from "@/lib/job-instructions.mjs";

// One generation per job at a time (2026-11-15): a second click while one is
// running is refused instead of starting a second paid call.
const running = new Set<string>();

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 420;

// Local customisation (2026-11-10): tailored CV (+ cover letter) in the user's
// ORIGINAL resume format, via data/cv-original/generate.mjs. That script calls
// Claude once with no tools, validates the wording against cv.md, renders,
// fact-checks and links the PDFs. Without {force:true} it reuses documents that
// already exist and makes no Claude call. It never submits or sends anything.
export async function POST(req: Request) {
  const body = await readJsonObject<{ n?: string; cover?: boolean; force?: boolean; recheck?: boolean; revise?: string; feedback?: string; draft?: boolean }>(req);
  if (!body?.n || !/^\d+$/.test(body.n)) return NextResponse.json({ ok: false, error: "row number required" }, { status: 400 });
  const app = findApplication(body.n);
  if (!app) return NextResponse.json({ ok: false, error: "no such tracker row" }, { status: 404 });
  const root = careerOpsRoot();
  const args = [path.join(root, "data", "cv-original", "generate.mjs"), "--row", body.n];
  // draft (2026-11-15): a separate new version for an application already
  // submitted. Written to "Drafts after submission" and never linked, so the
  // submitted documents stay exactly as sent. A row with no evaluation report
  // uses the saved posting its documents were made from.
  if (body.draft) {
    args.push("--separate-draft");
    if (!reportNumberFromCell(app.report)) {
      const ids = identitiesOf(`t${body.n}`, `${app.url ?? ""} ${app.applyLink ?? ""}`.match(/https?:\/\/[^\s)|]+/g) ?? []).filter((i) => i.startsWith("p")).map((i) => i.slice(1));
      const pid = ids.find((i) => fs.existsSync(path.join(root, "data", "posting-jobs", `${i}.json`)));
      if (!pid) return NextResponse.json({ ok: false, error: "No saved job description for this job, so a draft cannot be tailored. Evaluate it or paste the job description first." }, { status: 400 });
      args.splice(1, 2, "--posting", pid);
    }
  }
  if (body.cover) args.push("--cover");
  if (body.force) args.push("--force");
  // recheck: local quality checks on the linked documents only (no Claude).
  if (body.recheck) args.push("--recheck");
  // revise: redraft only the chosen document from the candidate's feedback (one
  // Claude call); earlier versions stay on disk. Feedback is passed as a single
  // argv entry (no shell), and kept with the job's instructions.
  if (body.revise) {
    if (!["cv", "cover", "both"].includes(body.revise)) return NextResponse.json({ ok: false, error: "choose CV, cover letter or both" }, { status: 400 });
    const feedback = String(body.feedback ?? "").slice(0, 4000);
    args.push("--revise", body.revise, "--feedback", feedback);
    const reportNum = reportNumberFromCell(app.report);
    if (reportNum && feedback.trim()) recordRevision(root, reportNum, { docs: body.revise, feedback });
  }
  const lock = `t${body.n}`;
  if (!body.recheck && running.has(lock)) return NextResponse.json({ ok: false, error: "A generation for this job is already running. Wait for it to finish." }, { status: 409 });
  if (!body.recheck) running.add(lock);
  const result = await new Promise<{ code: number | null; out: string; err: string }>((resolve) => {
    const child = spawn(process.execPath, args, { cwd: root, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => child.kill("SIGTERM"), 400_000);
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out, err }); });
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: 1, out, err: e.message }); });
  });
  running.delete(lock);
  const last = result.out.trim().split("\n").pop() ?? "";
  try {
    return NextResponse.json(JSON.parse(last), { status: result.code === 0 ? 200 : 500 });
  } catch {
    return NextResponse.json({ ok: false, error: (result.err || result.out || "generation failed").slice(-400) }, { status: 500 });
  }
}
