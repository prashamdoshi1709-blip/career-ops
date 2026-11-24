"use client";

// Local customisation (2026-11-11): step 1 of batch evaluation, the low-cost
// screen. Never deletes a job; decides which jobs merit a detailed evaluation.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Play, X } from "lucide-react";
import { CostBadge } from "@/components/cost/cost-badge";

type Run = { state: string; items: unknown[]; done: string[]; failed: { key: string; error: string }[]; withJd: number; titleOnly: number; usage: { inputTokens: number; outputTokens: number; costUsd: number }; note?: string };
type Status = { run: Run | null; gate: number; unscreened: number; screened: number; passing: number; withJd: number };
type Est = { count: number; withJd: number; titleOnly: number; tokens: number; costUsd: number; test: { withJd: number; titleOnly: number; tokens: number; costUsd: number } };
const btn = "inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-3 py-1 text-xs font-medium text-foreground hover:border-brand hover:text-brand disabled:opacity-50";
const fmt = (n: number) => Math.round(n).toLocaleString("en-AU");

export function ScreeningStep() {
  const router = useRouter();
  const [s, setS] = useState<Status | null>(null);
  const [est, setEst] = useState<Est | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const refresh = useCallback(async () => { const d = await fetch("/api/screening").then((r) => r.json()).catch(() => null); if (d?.ok) setS(d); }, []);
  useEffect(() => { refresh(); fetch("/api/screening", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "preview" }) }).then((r) => r.json()).then((d) => d.ok && setEst(d)); }, [refresh]);
  const running = s?.run && ["starting", "running", "stopping"].includes(s.run.state);
  useEffect(() => { if (!running) return; const t = setInterval(() => { refresh(); router.refresh(); }, 8000); return () => clearInterval(t); }, [running, refresh, router]);
  const start = async (scope: "test" | "all") => {
    const e = scope === "test" ? est?.test : est;
    if (!e) return;
    if (!window.confirm(`Screen ${e.withJd + e.titleOnly} job${e.withJd + e.titleOnly === 1 ? "" : "s"} against your profile?\n\n${e.withJd} from a job description, ${e.titleOnly} from the title only (12 per call).\nEstimated usage: about ${fmt(e.tokens)} tokens, about US$${e.costUsd.toFixed(2)}.\n\nScreening never deletes a job.`)) return;
    setBusy(true); setMsg("");
    try {
      const d = await fetch("/api/screening", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start", scope, confirm: true }) }).then((r) => r.json());
      setMsg(d.ok ? `${d.queued} job${d.queued === 1 ? "" : "s"} being screened.` : d.error ?? "Not started.");
      await refresh();
    } finally { setBusy(false); }
  };
  const r = s?.run;
  return (
    <div className="mt-2 rounded-xl border border-border bg-surface-hover/40 px-3 py-2">
      <p className="text-xs font-medium text-foreground">Step 1 · Low-cost screen <span className="font-normal text-muted">(about US$0.03 a job with a description, US$0.003 from a title; never deletes a job)</span></p>
      {s && <p className="mt-1 text-xs text-muted">{s.screened} screened ({s.withJd} from a description) · {s.passing} at or above the screening gate of {s.gate} · {s.unscreened} not screened yet</p>}
      {r && <p className="mt-1 text-xs text-muted">Last run: {r.state}{running ? <Loader2 className="ml-1 inline size-3 animate-spin" /> : null} · {r.done.length} of {r.items.length} screened ({r.withJd} with a description, {r.titleOnly} from titles){r.failed.length ? ` · ${r.failed.length} failed` : ""} · {fmt(r.usage.inputTokens + r.usage.outputTokens)} tokens · US${r.usage.costUsd.toFixed(2)}{r.note ? ` · ${r.note}` : ""}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" className={btn} disabled={busy || Boolean(running) || !est?.count} onClick={() => start("test")}><Play className="size-3.5" /> Screen 10 (~US${est?.test.costUsd.toFixed(2) ?? "0"})</button>
        <button type="button" className={btn} disabled={busy || Boolean(running) || !est?.count} onClick={() => start("all")}><Play className="size-3.5" /> Screen all {est?.count ?? 0} (~US${est?.costUsd.toFixed(2) ?? "0"})</button>
        {running && <button type="button" className={btn} onClick={() => fetch("/api/screening", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "stop" }) }).then(refresh)}><X className="size-3.5" /> Stop</button>}
        <CostBadge kind="spend" size="xs" />
        {msg && <span className="text-xs text-muted">{msg}</span>}
      </div>
      <p className="mt-2 text-[11px] text-faint">Jobs on SEEK or LinkedIn are screened from their title until you paste their description on the Review page; those sites do not allow automated reading. Step 2 below runs a full evaluation only for jobs that passed the screen and have a description.</p>
    </div>
  );
}
