import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot, findApplication } from "@/lib/career-ops";
import { reportNumberFromCell } from "@/lib/pipeline-details.mjs";
import { readJsonObject } from "@/lib/json-body";
import { identitiesOf } from "@/lib/job-instructions.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Local customisation (2026-11-15): correct the current cover letter on this
// computer where an Additional Instruction failed and has a safe automatic fix
// (data/cv-original/generate.mjs --local-fix). No Claude call, no tokens. A new
// version is rendered and checked; earlier versions are kept. For an application
// already submitted the correction goes to "Drafts after submission" and is never
// linked, so the submitted documents stay exactly as sent.
const running = new Set<string>();
const SUBMITTED = ["Applied", "Responded", "Assessment", "Interview", "Offer", "Hired"];

export async function POST(req: Request) {
  const body = await readJsonObject<{ key?: string }>(req);
  const key = String(body?.key ?? "");
  const root = careerOpsRoot();
  let args: string[];
  let separateDraft = false;
  if (/^p[a-f0-9]{8,40}$/.test(key)) {
    args = ["--posting", key.slice(1)];
  } else if (/^t\d+$/.test(key)) {
    const n = key.slice(1);
    const app = findApplication(n);
    if (!app) return NextResponse.json({ ok: false, error: "no such tracker row" }, { status: 404 });
    args = ["--row", n];
    if (!reportNumberFromCell(app.report)) {
      const ids = identitiesOf(key, `${app.url ?? ""} ${app.applyLink ?? ""}`.match(/https?:\/\/[^\s)|]+/g) ?? []).filter((i) => i.startsWith("p")).map((i) => i.slice(1));
      const pid = ids.find((i) => fs.existsSync(path.join(root, "data", "posting-jobs", `${i}.json`)));
      if (!pid) return NextResponse.json({ ok: false, error: "No saved job for these documents." }, { status: 400 });
      args = ["--posting", pid];
    }
    if (SUBMITTED.includes(app.status)) { args.push("--separate-draft"); separateDraft = true; }
  } else return NextResponse.json({ ok: false, error: "job id required" }, { status: 400 });
  if (running.has(key)) return NextResponse.json({ ok: false, error: "A correction for this job is already running." }, { status: 409 });
  running.add(key);
  try {
    const result = await new Promise<{ code: number | null; out: string; err: string }>((resolve) => {
      const child = spawn(process.execPath, [path.join(root, "data", "cv-original", "generate.mjs"), ...args, "--local-fix"], { cwd: root, env: { ...process.env, CAREER_OPS_CLAUDE_BIN: "/usr/bin/false" }, stdio: ["ignore", "pipe", "pipe"] });
      let out = "", err = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      const timer = setTimeout(() => child.kill("SIGTERM"), 120_000);
      child.on("close", (code) => { clearTimeout(timer); resolve({ code, out, err }); });
      child.on("error", (e) => { clearTimeout(timer); resolve({ code: 1, out, err: e.message }); });
    });
    const last = result.out.trim().split("\n").pop() ?? "";
    try {
      return NextResponse.json({ ...JSON.parse(last), separateDraft }, { status: result.code === 0 ? 200 : 500 });
    } catch {
      return NextResponse.json({ ok: false, error: (result.err || result.out || "correction failed").slice(-400) }, { status: 500 });
    }
  } finally {
    running.delete(key);
  }
}
