import { NextResponse } from "next/server";
import { readJsonObject } from "@/lib/json-body";
import { careerOpsRoot } from "@/lib/career-ops";
import { evalQueue } from "@/lib/doc-queue-store.mjs";
import { evalPreview, ensureEvalWorker, evalSummary } from "@/lib/eval-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Local customisation (2026-11-11): batch evaluation of scan finds. Nothing is
// queued without confirm:true; "all" needs a measured test batch first.
const originOf = (req: Request) => { const u = new URL(req.url); return `http://127.0.0.1:${u.port || "3000"}`; };

export async function GET(req: Request) {
  const root = careerOpsRoot();
  const started = ensureEvalWorker(root, originOf(req));
  const q = evalQueue.readQueue(root);
  const items = Object.values(q.items as Record<string, { finishedAt?: string; queuedAt: string }>).sort((a, b) => String(b.finishedAt ?? b.queuedAt).localeCompare(String(a.finishedAt ?? a.queuedAt))).slice(0, 80);
  return NextResponse.json({ ok: true, summary: evalSummary(root), settings: q.settings, items, workerStarted: started });
}

export async function POST(req: Request) {
  const b = await readJsonObject<{ action?: string; mode?: "test" | "top" | "all"; limit?: number; confirm?: boolean; keys?: string[] }>(req);
  const root = careerOpsRoot();
  if (!b?.action) return NextResponse.json({ ok: false, error: "action required" }, { status: 400 });
  if (b.action === "preview") return NextResponse.json({ ok: true, preview: evalPreview() });
  if (b.action === "start") {
    if (b.confirm !== true) return NextResponse.json({ ok: false, error: "explicit confirmation required" }, { status: 400 });
    const pv = evalPreview();
    let pick = pv.eligible;
    if (Array.isArray(b.keys) && b.keys.length) pick = pick.filter((e) => b.keys!.includes(e.key));
    else if (b.mode === "test") pick = pick.slice(0, 3);
    else if (b.mode === "top" && pv.perJob) pick = pick.slice(0, Math.max(1, Math.min(50, b.limit ?? 20)));
    else if (!pv.perJob) return NextResponse.json({ ok: false, error: "Run the 3-job test batch first, so the estimate for the rest is based on real usage." }, { status: 400 });
    const r = evalQueue.enqueue(root, pick, { approvalNote: { mode: b.keys?.length ? "selected" : b.mode ?? "all", requested: pick.length, estimateTokens: pv.perJob ? pv.perJob.tokens * pick.length : null } });
    ensureEvalWorker(root, originOf(req));
    return NextResponse.json({ ok: true, added: r.added });
  }
  if (b.action === "pause") { evalQueue.setPaused(root, true, "Paused by you"); return NextResponse.json({ ok: true }); }
  if (b.action === "resume") { evalQueue.setPaused(root, false); ensureEvalWorker(root, originOf(req)); return NextResponse.json({ ok: true }); }
  if (b.action === "cancel") return NextResponse.json({ ok: true, cancelled: evalQueue.cancelPending(root) });
  if (b.action === "retry-failed") {
    let n = 0;
    evalQueue.mutateQueue(root, (q: { items: Record<string, { state: string; attempts: number }> }) => { for (const i of Object.values(q.items)) if (i.state === "failed") { i.state = "queued"; i.attempts = 0; n++; } return q; });
    ensureEvalWorker(root, originOf(req));
    return NextResponse.json({ ok: true, requeued: n });
  }
  return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
}
