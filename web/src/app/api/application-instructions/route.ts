import { NextResponse } from "next/server";
import { careerOpsRoot } from "@/lib/career-ops";
import { readJsonObject } from "@/lib/json-body";
import { getInstructions, saveInstructions, keyOf } from "@/lib/application-instructions.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Local customisation (2026-11-10): save / load "My Instructions for This
// Application". File read and write only; never calls Claude.
export async function POST(req: Request) {
  const body = await readJsonObject<{ reportNum?: string; label?: string; general?: string; cv?: string; cover?: string; tone?: string; emphasis?: string; action?: string }>(req);
  if (!body || !keyOf(body.reportNum)) return NextResponse.json({ ok: false, error: "report number required" }, { status: 400 });
  const root = careerOpsRoot();
  if (body.action === "get") return NextResponse.json({ ok: true, instructions: getInstructions(root, body.reportNum) });
  try {
    return NextResponse.json({ ok: true, instructions: saveInstructions(root, body.reportNum, body, { label: body.label ?? "" }) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "not saved" }, { status: 500 });
  }
}
