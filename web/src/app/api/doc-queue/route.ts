import { NextResponse } from "next/server";
import { readJsonObject } from "@/lib/json-body";
import { loadDocJobs, ensureWorker, autoQueue } from "@/lib/doc-jobs";
import { previewBatch } from "@/lib/doc-status.mjs";
import { readQueue, mutateQueue, enqueue, setPaused, cancelPending, summary } from "@/lib/doc-queue-store.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Local customisation (2026-11-11): the document-generation queue.
// Nothing is queued without an explicit "start" carrying confirm:true; the
// worker calls the shared generator, one job at a time by default.

export async function GET() {
  const { root } = loadDocJobs();
  autoQueue(root);
  const started = ensureWorker(root);
  const q = readQueue(root);
  const items = Object.values(q.items as Record<string, { state: string; finishedAt?: string; queuedAt: string }>)
    .sort((a, b) => String(b.finishedAt ?? b.queuedAt).localeCompare(String(a.finishedAt ?? a.queuedAt))).slice(0, 60);
  return NextResponse.json({ ok: true, summary: summary(q), settings: q.settings, items, approvals: (q.approvals ?? []).slice(-5), workerStarted: started });
}

type Body = { revise?: string; action?: string; mode?: "test" | "all"; limit?: number; confirm?: boolean; keys?: string[]; key?: string; concurrency?: number; autoQueueNew?: boolean };

export async function POST(req: Request) {
  const body = await readJsonObject<Body>(req);
  if (!body?.action) return NextResponse.json({ ok: false, error: "action required" }, { status: 400 });
  const { root, jobs, statuses, keyOf } = loadDocJobs();

  if (body.action === "preview") return NextResponse.json({ ok: true, preview: previewBatch(root, jobs, statuses) });

  if (body.action === "start") {
    if (body.confirm !== true) return NextResponse.json({ ok: false, error: "explicit confirmation required" }, { status: 400 });
    const pv = previewBatch(root, jobs, statuses);
    let pick = pv.eligible;
    if (Array.isArray(body.keys) && body.keys.length) pick = pick.filter((e: { key: string }) => body.keys!.includes(e.key));
    if (body.mode === "test") pick = pick.slice(0, Math.max(1, Math.min(5, body.limit ?? 3)));
    const r = enqueue(root, pick, { approvalNote: { mode: body.mode ?? "all", requested: pick.length, estimateTokens: pv.perJob.tokens * pick.length, estimateCostUsd: pv.perJob.cost == null ? null : Math.round(pv.perJob.cost * pick.length * 100) / 100 } });
    ensureWorker(root);
    return NextResponse.json({ ok: true, added: r.added });
  }

  if (body.action === "regenerate") {
    const s = body.key ? statuses[body.key] : null;
    const job = jobs.find((j) => keyOf(j) === body.key);
    if (!s || !job) return NextResponse.json({ ok: false, error: "job not found" }, { status: 404 });
    if (/^Already /.test(s.exclude)) return NextResponse.json({ ok: false, error: s.exclude }, { status: 400 });
    // revise (2026-11-15): with Additional Instructions saved, redraft only the
    // chosen document from the current version; earlier versions stay on disk.
    // A letter-only revision needs a letter to start from; without one the job is regenerated in full.
    const want = ["cv", "cover", "both"].includes(String(body.revise)) && s.cv ? (s.needCover ? body.revise : "cv") : undefined;
    const revise = want === "cover" && !s.cover ? undefined : want;
    const r = enqueue(root, [{ key: s.key, kind: job.kind, n: job.n ?? null, url: job.url, company: job.company, title: job.title, location: job.location as string, cover: s.needCover, priority: s.priority + 100, force: true, ...(revise ? { revise } : {}) }], { requeue: true, approvalNote: { mode: revise ? `regenerate with instructions (${revise})` : "regenerate", requested: 1 } });
    ensureWorker(root);
    return NextResponse.json({ ok: true, added: r.added });
  }

  if (body.action === "pause") { setPaused(root, true, "Paused by you"); return NextResponse.json({ ok: true }); }
  if (body.action === "resume") { setPaused(root, false); ensureWorker(root); return NextResponse.json({ ok: true }); }
  if (body.action === "cancel") return NextResponse.json({ ok: true, cancelled: cancelPending(root) });
  if (body.action === "retry-failed") {
    let n = 0;
    mutateQueue(root, (q: { items: Record<string, { state: string; attempts: number }> }) => { for (const i of Object.values(q.items)) if (i.state === "failed") { i.state = "queued"; i.attempts = 0; n++; } return q; });
    ensureWorker(root);
    return NextResponse.json({ ok: true, requeued: n });
  }
  if (body.action === "settings") {
    mutateQueue(root, (q: { settings: Record<string, unknown> }) => {
      if (typeof body.autoQueueNew === "boolean") q.settings.autoQueueNew = body.autoQueueNew;
      if (body.concurrency === 1 || body.concurrency === 2) q.settings.concurrency = body.concurrency;
      return q;
    });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
}
