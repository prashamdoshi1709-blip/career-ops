import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";
import { readJsonObject } from "@/lib/json-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// LinkedIn intake (2026-11-24). LinkedIn forbids automated access (robots.txt
// "Disallow: /"), so Career-Ops never requests LinkedIn. The user pastes their
// own LinkedIn job links or job-alert email text; linkedin-intake.mjs reads the
// jobs from that text, checks Career-Ops for each, and looks for the same
// vacancy on SEEK and at the employer's or recruiter's own board (free public
// sources). With add: true, new jobs go to the inbox. No Claude call.

let running = false;

export async function POST(req: Request) {
  const body = await readJsonObject<{ text?: string; add?: boolean }>(req);
  const text = typeof body?.text === "string" ? body.text.slice(0, 200_000) : "";
  if (!text.trim()) return NextResponse.json({ ok: false, error: "Paste LinkedIn job links or a LinkedIn job-alert email first." }, { status: 400 });
  if (running) return NextResponse.json({ ok: false, error: "A LinkedIn check is already running." }, { status: 409 });
  running = true;
  try {
    const result = await new Promise<{ code: number | null; out: string; err: string }>((resolve) => {
      const child = spawn(process.execPath, [rootScript("linkedin-intake"), "--json", ...(body?.add ? ["--add"] : [])], { cwd: careerOpsRoot(), env: process.env });
      let out = "", err = "";
      const killer = setTimeout(() => child.kill("SIGTERM"), 110_000);
      child.stdout.on("data", (d) => { out += d.toString(); });
      child.stderr.on("data", (d) => { err += d.toString(); });
      child.on("close", (code) => { clearTimeout(killer); resolve({ code, out, err }); });
      child.on("error", (e) => { clearTimeout(killer); resolve({ code: 1, out: "", err: e.message }); });
      child.stdin.end(text);
    });
    if (result.code !== 0) return NextResponse.json({ ok: false, error: result.err.trim().split("\n").pop() || "The LinkedIn check failed." }, { status: 500 });
    return NextResponse.json({ ok: true, ...JSON.parse(result.out) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "The LinkedIn check failed." }, { status: 500 });
  } finally {
    running = false;
  }
}
