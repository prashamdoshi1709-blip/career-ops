import { NextResponse } from "next/server";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { readJsonObject } from "@/lib/json-body";
import { readSettings, writeSettings, planCleanup, applyCleanup } from "@/lib/job-cleanup.mjs";
import { isTrackerWriting } from "@/lib/core/run-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Local customisation (2026-11-11): Config → Minimum suitability.
const summary = (p: ReturnType<typeof planCleanup>) => ({ total: p.total, remove: p.remove.length, protected: p.protected.length, keep: p.keep.length, pending: p.pending.length, conflicts: p.conflicts.length, removeList: p.remove.slice(0, 200).map((r: { company: string; title: string; score: number | null; ratingType: string }) => `${r.company} · ${r.title} · ${r.score}/10 (${r.ratingType})`) });

export async function GET() {
  const root = careerOpsRoot();
  return NextResponse.json({ ok: true, settings: readSettings(root), plan: summary(planCleanup(root, path.resolve(process.cwd(), ".."))) });
}

export async function POST(req: Request) {
  const b = await readJsonObject<{ action?: string; minSuitability?: number; applyToPreliminary?: boolean; autoCleanup?: boolean; screeningGate?: number; confirm?: boolean }>(req);
  const root = careerOpsRoot();
  const code = path.resolve(process.cwd(), "..");
  if (b?.action === "settings") {
    try {
      const s = writeSettings(root, { ...(b.minSuitability != null ? { minSuitability: Number(b.minSuitability) } : {}), ...(typeof b.applyToPreliminary === "boolean" ? { applyToPreliminary: b.applyToPreliminary } : {}), ...(typeof b.autoCleanup === "boolean" ? { autoCleanup: b.autoCleanup } : {}), ...(b.screeningGate != null ? { screeningGate: Number(b.screeningGate) } : {}) });
      return NextResponse.json({ ok: true, settings: s, plan: summary(planCleanup(root, code)) });
    } catch (e) { return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "not saved" }, { status: 400 }); }
  }
  if (b?.action === "apply") {
    if (b.confirm !== true) return NextResponse.json({ ok: false, error: "explicit confirmation required" }, { status: 400 });
    if (isTrackerWriting()) return NextResponse.json({ ok: false, error: "The tracker is being updated; try again in a moment." }, { status: 409 });
    const plan = planCleanup(root, code);
    return NextResponse.json({ ok: true, removed: plan.remove.length, result: applyCleanup(root, code, plan) });
  }
  return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
}
