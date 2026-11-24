"use client";

// Local customisation (2026-11-11): batch evaluation of scan finds that have
// only a preliminary rating. Each evaluation reads the posting, archives the job
// description, gives a detailed rating with strengths and weaknesses, and then
// applies the minimum-suitability rule. Nothing starts without your confirmation.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pause, Play, RotateCcw, X } from "lucide-react";
import { CostBadge } from "@/components/cost/cost-badge";
import { cn } from "@/lib/cn";
import { ScreeningStep } from "@/components/screening-step";

type Summary = { queued: number; generating: number; ready: number; failed: number; total: number; workerRunning: boolean; paused: boolean; pauseReason: string; backoffUntil: string | null; usedTokens: number; usedCostUsd: number; measuredRuns: number };
type Item = { key: string; company: string; title: string; state: string; reason?: string; lastError?: string; score?: number | null; usage?: { inputTokens: number; costUsd: number | null } | null };
type Preview = { eligible: { key: string; company: string; title: string; score: number | null; hasJd: boolean }[]; excluded: Record<string, number>; perJob: { tokens: number; cost: number | null; runs: number } | null; estimateTokens: number | null; estimateCostUsd: number | null };
const btn = "inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-3 py-1 text-xs font-medium text-foreground hover:border-brand hover:text-brand disabled:opacity-50";
const fmt = (n: number) => n.toLocaleString("en-AU");
const LABEL: Record<string, string> = { queued: "Queued", generating: "Evaluating", ready: "Evaluated", removed: "Removed (below minimum)", failed: "Evaluation failed", cancelled: "Cancelled" };

export function EvalQueuePanel({ awaiting }: { awaiting: number }) {
  const router = useRouter();
  const [q, setQ] = useState<{ summary: Summary; settings: { paused: boolean }; items: Item[] } | null>(null);
  const [pv, setPv] = useState<Preview | null>(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const refresh = useCallback(async () => { const d = await fetch("/api/eval-queue").then((r) => r.json()).catch(() => null); if (d?.ok) setQ(d); }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (!q || !(q.summary.queued || q.summary.generating)) return;
    const t = setInterval(() => { refresh(); router.refresh(); }, 15000);
    return () => clearInterval(t);
  }, [q, refresh, router]);
  const post = (body: Record<string, unknown>) => fetch("/api/eval-queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false, error: "no response" }));
  const act = async (label: string, body: Record<string, unknown>, ok: (d: { added?: number; cancelled?: number; requeued?: number }) => string) => {
    setBusy(label); setMsg("");
    try { const d = await post(body); setMsg(d.ok ? ok(d) : d.error ?? "Not done."); await refresh(); } finally { setBusy(""); }
  };
  const start = (mode: "test" | "top" | "all") => {
    if (!pv) return;
    const n = mode === "test" ? Math.min(3, pv.eligible.length) : mode === "top" ? Math.min(20, pv.eligible.length) : pv.eligible.length;
    const est = pv.perJob ? `about ${fmt(pv.perJob.tokens * n)} tokens${pv.perJob.cost != null ? `, about US$${(pv.perJob.cost * n).toFixed(2)} as reported by Claude Code` : ""} (average of ${pv.perJob.runs} real evaluation${pv.perJob.runs === 1 ? "" : "s"})` : "not measured yet; this test batch measures it";
    if (!window.confirm(`Evaluate ${n} job${n === 1 ? "" : "s"} with Claude?\n\nEstimated usage: ${est}.\n\nOne job at a time. Each gets a full report, the job description archived and a detailed rating. Any job rated below your minimum is then removed permanently. You can pause or cancel at any time. Nothing is applied for or sent.`)) return;
    act("start", { action: "start", mode, limit: 20, confirm: true }, (d) => `${d.added} job${d.added === 1 ? "" : "s"} queued for evaluation.`).then(() => setPv(null));
  };
  const s = q?.summary;
  return (
    <details className="mt-3 rounded-2xl border border-border bg-white px-4 py-3 text-sm" open={Boolean(s?.queued || s?.generating) || undefined}>
      <summary className="cursor-pointer font-medium text-foreground">
        Batch screening and evaluation
        <span className="ml-2 text-xs font-normal text-muted">{awaiting} scan find{awaiting === 1 ? "" : "s"} with only a preliminary rating{s ? ` · ${s.generating ? `evaluating ${s.generating}` : s.paused ? "paused" : s.queued ? `${s.queued} queued` : "idle"}` : ""}</span>
      </summary>
      <ScreeningStep />
      <p className="mt-3 text-xs font-medium text-foreground">Step 2 · Detailed evaluation <span className="font-normal text-muted">(about US$1.70 a job; only for jobs that passed the screen and have a job description)</span></p>
      <p className="mt-1 text-xs text-muted">A detailed evaluation uses the saved job description (it never fetches SEEK or LinkedIn pages), writes a full report and gives a detailed rating with strengths and weaknesses. Jobs rated below your minimum (Config) are removed afterwards; that is the only step that removes jobs. It starts only when you confirm.</p>
      {s && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          <span>Queued {s.queued} · Evaluating {s.generating} · Done {s.ready} · Failed {s.failed}</span>
          <span title="As reported by Claude Code. On a subscription plan this is usage against your plan limits.">Used so far: {fmt(s.usedTokens)} tokens{s.usedCostUsd ? ` · US$${s.usedCostUsd.toFixed(2)}` : ""}</span>
          {s.pauseReason && <span className="text-amber-800">{s.pauseReason}{s.backoffUntil ? ` (until ${new Date(s.backoffUntil).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })})` : ""}</span>}
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" className={cn(btn, "border-brand text-brand")} disabled={!!busy} onClick={async () => { setBusy("preview"); try { const d = await post({ action: "preview" }); if (d.ok) setPv(d.preview); } finally { setBusy(""); } }}>{busy === "preview" ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />} Evaluate pending jobs…</button>
        {q?.settings.paused
          ? <button type="button" className={btn} disabled={!!busy} onClick={() => act("resume", { action: "resume" }, () => "Resumed.")}><Play className="size-3.5" /> Resume</button>
          : <button type="button" className={btn} disabled={!!busy || !s?.queued} onClick={() => act("pause", { action: "pause" }, () => "Paused. The evaluation running now finishes; nothing new starts.")}><Pause className="size-3.5" /> Pause</button>}
        <button type="button" className={btn} disabled={!!busy || !s?.queued} onClick={() => window.confirm("Cancel every evaluation still waiting?") && act("cancel", { action: "cancel" }, (d) => `${d.cancelled} cancelled.`)}><X className="size-3.5" /> Cancel pending</button>
        <button type="button" className={btn} disabled={!!busy || !s?.failed} onClick={() => act("retry", { action: "retry-failed" }, (d) => `${d.requeued} queued again.`)}><RotateCcw className="size-3.5" /> Retry failed</button>
        {msg && <span className="text-xs text-muted">{msg}</span>}
      </div>
      {pv && (
        <div className="mt-3 rounded-xl border border-brand/30 px-3 py-2">
          <p className="font-medium text-foreground">Nothing has started yet</p>
          <p className="mt-1 text-xs text-muted">{pv.eligible.length} job{pv.eligible.length === 1 ? "" : "s"} to evaluate ({pv.eligible.filter((e) => !e.hasJd).length} without a readable job description, which evaluation reads from the posting).</p>
          <p className="mt-1 text-xs text-muted">Estimated usage: {pv.perJob ? <>about <b className="text-foreground">{fmt(pv.estimateTokens ?? 0)} tokens</b>{pv.estimateCostUsd != null ? <> · about <b className="text-foreground">US${pv.estimateCostUsd.toFixed(2)}</b></> : null} ({fmt(pv.perJob.tokens)} per job, from {pv.perJob.runs} real evaluation{pv.perJob.runs === 1 ? "" : "s"})</> : <b className="text-foreground">not measured yet. Run the 3-job test batch first; the estimate for the rest is then based on its real usage.</b>}</p>
          <details className="mt-1 text-xs"><summary className="cursor-pointer text-muted">In priority order</summary><ol className="mt-1 max-h-44 list-decimal overflow-y-auto pl-5 text-foreground">{pv.eligible.map((e) => <li key={e.key}>{e.company} · {e.title}{e.score != null ? ` · ${e.score}/10 preliminary` : ""}</li>)}</ol></details>
          {Object.keys(pv.excluded).length > 0 && <details className="text-xs"><summary className="cursor-pointer text-muted">Excluded</summary><ul className="mt-1 pl-4 text-muted">{Object.entries(pv.excluded).map(([r, n]) => <li key={r}>{n} · {r}</li>)}</ul></details>}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" className={btn} disabled={!!busy || !pv.eligible.length} onClick={() => start("test")}>Start a test batch (3)</button>
            <button type="button" className={btn} disabled={!!busy || !pv.perJob || pv.eligible.length <= 3} title={pv.perJob ? "The highest-priority jobs first" : "Run the test batch first"} onClick={() => start("top")}>Start the top {Math.min(20, pv.eligible.length)}{pv.perJob?.cost != null ? ` (~US$${(pv.perJob.cost * Math.min(20, pv.eligible.length)).toFixed(0)})` : ""}</button>
            <button type="button" className="inline-flex items-center gap-1.5 rounded-full bg-brand px-3 py-1 text-xs font-medium text-brand-foreground disabled:opacity-50" disabled={!!busy || !pv.perJob || !pv.eligible.length} title={pv.perJob ? "" : "Run the test batch first"} onClick={() => start("all")}>Start all {pv.eligible.length}</button>
            <CostBadge kind="spend" size="xs" />
          </div>
        </div>
      )}
      {!!q?.items.length && (
        <details className="mt-2 text-xs"><summary className="cursor-pointer text-muted">Recent evaluations ({q.items.length})</summary>
          <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto">{q.items.map((i) => <li key={i.key}><span className={cn("font-medium", i.state === "failed" ? "text-rose-700" : i.state === "removed" ? "text-muted" : "text-foreground")}>{LABEL[i.state] ?? i.state}</span> · {i.company} · {i.title}{i.reason ? ` · ${i.reason}` : ""}{i.lastError ? ` · ${i.lastError.slice(0, 120)}` : ""}{i.usage?.inputTokens ? ` · ${fmt(i.usage.inputTokens)} tokens` : ""}</li>)}</ul>
        </details>
      )}
    </details>
  );
}
