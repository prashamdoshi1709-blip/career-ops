"use client";

// Local customisation (2026-11-11): the document library and the controlled
// generation queue. Nothing is generated until you confirm a batch.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, FileText, Loader2, Pause, Play, RotateCcw, Archive, X } from "lucide-react";
import { PageFrame } from "@/components/page-frame";
import { CostBadge } from "@/components/cost/cost-badge";
import { StatePill, STATE_LABEL, fileHref, type DocInfo } from "@/components/doc-links";
import { cn } from "@/lib/cn";

export type LibraryRow = { key: string; n: string | null; kind: string; company: string; title: string; location: string; score: number | null; status: string; category: string; doc: DocInfo & { verdict?: string | null; eligible?: boolean; exclude?: string; priority?: number } };
type Summary = { queued: number; generating: number; ready: number; needsReview: number; failed: number; skipped: number; cancelled: number; total: number; workerRunning: boolean; paused: boolean; pauseReason: string; backoffUntil: string | null; usedTokens: number; usedCostUsd: number; measuredRuns: number };
type QueueItem = { key: string; company: string; title: string; state: string; reason?: string; lastError?: string; attempts?: number; finishedAt?: string | null; usage?: { inputTokens: number; outputTokens: number; costUsd: number | null } | null };
type Preview = { eligible: { key: string; company: string; title: string; priority: number; score: number | null; cover: boolean }[]; cvs: number; covers: number; perJob: { tokens: number; cost: number | null; runs: number; measured: boolean }; estimateTokens: number; estimateCostUsd: number | null; excluded: Record<string, number> };

const sel = "rounded-lg border border-border bg-white px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-brand";
const btn = "inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-3 py-1.5 text-sm font-medium text-foreground hover:border-brand hover:text-brand disabled:opacity-50";
const fmt = (n: number) => n.toLocaleString("en-AU");

export function DocumentLibrary({ rows }: { rows: LibraryRow[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [docState, setDocState] = useState("with-docs");
  const [appStatus, setAppStatus] = useState("");
  const [sort, setSort] = useState<{ k: "company" | "score" | "generated"; dir: 1 | -1 }>({ k: "generated", dir: -1 });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [queue, setQueue] = useState<{ summary: Summary; settings: { paused: boolean; concurrency: number; autoQueueNew: boolean }; items: QueueItem[] } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");

  const refresh = useCallback(async () => {
    const d = await fetch("/api/doc-queue").then((r) => r.json()).catch(() => null);
    if (d?.ok) setQueue(d);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (!queue || !(queue.summary.queued || queue.summary.generating)) return;
    const t = setInterval(() => { refresh(); router.refresh(); }, 10000);
    return () => clearInterval(t);
  }, [queue, refresh, router]);

  const post = async (body: Record<string, unknown>) => {
    const r = await fetch("/api/doc-queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return r.json().catch(() => ({ ok: false, error: "no response" }));
  };
  const act = async (label: string, body: Record<string, unknown>, done?: (d: { ok: boolean; added?: number; cancelled?: number; requeued?: number; error?: string }) => string) => {
    setBusy(label); setMsg("");
    try { const d = await post(body); setMsg(d.ok ? (done ? done(d) : "Done.") : d.error ?? "Not done."); await refresh(); router.refresh(); } finally { setBusy(""); }
  };

  const openPreview = async () => { setBusy("preview"); try { const d = await post({ action: "preview" }); if (d.ok) setPreview(d.preview); } finally { setBusy(""); } };
  const start = async (mode: "test" | "all") => {
    if (!preview) return;
    const n = mode === "test" ? Math.min(3, preview.eligible.length) : preview.eligible.length;
    const tokens = preview.perJob.tokens * n;
    const cost = preview.perJob.cost == null ? "" : `, about US$${(preview.perJob.cost * n).toFixed(2)} as reported by Claude Code`;
    if (!window.confirm(`Generate a tailored CV${preview.covers ? " and cover letter" : ""} for ${n} job${n === 1 ? "" : "s"}?\n\nEstimated usage: about ${fmt(tokens)} tokens${cost} (${preview.perJob.measured ? `average of ${preview.perJob.runs} real runs` : "measured on the 5-job test batch"}).\n\nOne job is processed at a time. You can pause or cancel at any time. Nothing is sent or submitted.`)) return;
    await act("start", { action: "start", mode, limit: 3, confirm: true }, (d) => `${d.added} job${d.added === 1 ? "" : "s"} queued. Generation runs in the background while Career-Ops is open.`);
    setPreview(null);
  };

  const statuses = useMemo(() => [...new Set(rows.map((r) => r.status).filter(Boolean))].sort(), [rows]);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    const out = rows.filter((r) => {
      if (t && !`${r.company} ${r.title} ${r.location}`.toLowerCase().includes(t)) return false;
      if (docState === "with-docs" && !r.doc?.cv) return false;
      if (docState && docState !== "with-docs" && docState !== "all" && r.doc?.state !== docState) return false;
      if (appStatus && r.status !== appStatus) return false;
      return true;
    });
    const v = (r: LibraryRow) => (sort.k === "company" ? r.company.toLowerCase() : sort.k === "score" ? r.score ?? -1 : r.doc?.generatedAt ?? "");
    return out.sort((a, b) => (v(a) < v(b) ? -1 : v(a) > v(b) ? 1 : 0) * sort.dir);
  }, [rows, q, docState, appStatus, sort]);
  const withDocs = rows.filter((r) => r.doc?.cv).length;
  const eligibleNow = rows.filter((r) => r.doc?.eligible).length;
  const s = queue?.summary;
  const toggle = (k: string) => setPicked((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const Th = ({ k, label }: { k: "company" | "score" | "generated"; label: string }) => (
    <th className="cursor-pointer whitespace-nowrap px-3 py-2.5 font-medium" onClick={() => setSort((c) => ({ k, dir: c.k === k ? (c.dir === 1 ? -1 : 1) : -1 }))}>{label}{sort.k === k ? (sort.dir === 1 ? " ↑" : " ↓") : ""}</th>
  );

  return (
    <PageFrame className="max-w-[1500px]">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl tracking-tight text-landing">Documents</h1>
          <p className="mt-1 text-sm text-muted">{withDocs} jobs have their own tailored CV{withDocs === 1 ? "" : "s"} · {eligibleNow} eligible job{eligibleNow === 1 ? "" : "s"} awaiting generation · every document is made in your original format and checked before it is marked Ready</p>
        </div>
        <button type="button" onClick={openPreview} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-medium text-brand-foreground disabled:opacity-60">
          {busy === "preview" ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} Generate missing documents
        </button>
      </header>

      {/* Queue status and controls */}
      <section className="mt-4 rounded-2xl border border-border bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <span className="font-medium text-foreground">Generation queue</span>
          {s ? (
            <>
              <span className="text-muted">{s.generating ? <span className="inline-flex items-center gap-1 text-sky-800"><Loader2 className="size-3.5 animate-spin" />Generating {s.generating}</span> : s.paused ? <span className="text-amber-800">Paused</span> : s.queued ? (s.workerRunning ? "Running" : "Starting…") : "Idle"}</span>
              <span className="text-muted">Queued {s.queued} · Ready {s.ready} · Needs review {s.needsReview} · Failed {s.failed} · Skipped {s.skipped}</span>
              <span className="text-muted" title="As reported by Claude Code for each call. On a subscription plan this is usage against your plan limits, not a separate bill.">Used so far: {fmt(s.usedTokens)} tokens{s.usedCostUsd ? ` · US$${s.usedCostUsd.toFixed(2)}` : ""} ({s.measuredRuns} run{s.measuredRuns === 1 ? "" : "s"})</span>
            </>
          ) : <span className="text-muted">Loading…</span>}
        </div>
        {s?.pauseReason && <p className="mt-1 text-xs text-amber-800">{s.pauseReason}{s.backoffUntil ? ` (until ${new Date(s.backoffUntil).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })})` : ""}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {queue?.settings.paused
            ? <button type="button" className={btn} disabled={!!busy} onClick={() => act("resume", { action: "resume" }, () => "Resumed.")}><Play className="size-4" /> Resume</button>
            : <button type="button" className={btn} disabled={!!busy || !s?.queued} onClick={() => act("pause", { action: "pause" }, () => "Paused. The job being generated now finishes; nothing new starts.")}><Pause className="size-4" /> Pause</button>}
          <button type="button" className={btn} disabled={!!busy || !s?.queued} onClick={() => window.confirm("Cancel every job still waiting in the queue? Jobs already generated keep their documents.") && act("cancel", { action: "cancel" }, (d) => `${d.cancelled} waiting job(s) cancelled.`)}><X className="size-4" /> Cancel pending</button>
          <button type="button" className={btn} disabled={!!busy || !s?.failed} onClick={() => act("retry", { action: "retry-failed" }, (d) => `${d.requeued} failed job(s) queued again.`)}><RotateCcw className="size-4" /> Retry failed</button>
          <label className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted" title="Off by default. When on, newly eligible jobs are queued automatically (at most 10 a day).">
            <input type="checkbox" checked={!!queue?.settings.autoQueueNew} onChange={(e) => { const on = e.target.checked; if (on && !window.confirm("Queue newly eligible jobs automatically (at most 10 a day)? Each uses Claude once.")) return; act("settings", { action: "settings", autoQueueNew: on }, () => (on ? "New eligible jobs will be queued automatically." : "Automatic queueing is off.")); }} />
            Queue new jobs automatically
          </label>
          <label className="inline-flex items-center gap-1.5 text-xs text-muted">At once
            <select className="rounded border border-border bg-white px-1 py-0.5" value={queue?.settings.concurrency ?? 1} onChange={(e) => act("settings", { action: "settings", concurrency: Number(e.target.value) })}><option value={1}>1</option><option value={2}>2</option></select>
          </label>
        </div>
        {msg && <p className="mt-2 text-xs text-muted">{msg}</p>}
        {!!queue?.items?.length && (
          <details className="mt-2 text-xs">
            <summary className="cursor-pointer text-muted">Recent queue activity ({queue.items.length})</summary>
            <ul className="mt-1 max-h-56 space-y-1 overflow-y-auto">
              {queue.items.map((i) => (
                <li key={i.key} className="flex flex-wrap items-center gap-2">
                  <StatePill info={{ key: i.key, state: i.state === "cancelled" ? "not-generated" : i.state === "skipped" ? "failed" : i.state, reason: i.lastError || i.reason || "", cv: null, cover: null, needCover: false, generatedAt: null }} />
                  <span className="text-foreground">{i.company} · {i.title}</span>
                  {(i.lastError || i.reason) && <span className="text-muted">{(i.lastError || i.reason || "").slice(0, 140)}</span>}
                  {i.usage && <span className="text-faint">{fmt(i.usage.inputTokens + i.usage.outputTokens)} tokens</span>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {/* Preview before anything starts */}
      {preview && (
        <section className="mt-3 rounded-2xl border border-brand/30 bg-white px-4 py-3 text-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-medium text-foreground">Generate missing documents: nothing has started yet</p>
              <p className="mt-1 text-muted">{preview.eligible.length} eligible job{preview.eligible.length === 1 ? "" : "s"} · {preview.cvs} CV{preview.cvs === 1 ? "" : "s"} · {preview.covers} cover letter{preview.covers === 1 ? "" : "s"} (one Claude call per job makes both)</p>
              <p className="mt-1 text-muted">Estimated usage: about <b className="text-foreground">{fmt(preview.estimateTokens)} tokens</b>{preview.estimateCostUsd != null ? <> · about <b className="text-foreground">US${preview.estimateCostUsd.toFixed(2)}</b> as reported by Claude Code</> : null} · {preview.perJob.measured ? `${fmt(preview.perJob.tokens)} per job, the average of ${preview.perJob.runs} real runs` : `${fmt(preview.perJob.tokens)} per job, measured on the 5-job test batch of 11 Nov; replaced by your own runs as they finish`}</p>
            </div>
            <button type="button" onClick={() => setPreview(null)} className="text-muted hover:text-foreground" aria-label="Close"><X className="size-4" /></button>
          </div>
          {!!preview.eligible.length && (
            <details className="mt-2"><summary className="cursor-pointer text-xs text-muted">In priority order</summary>
              <ol className="mt-1 max-h-48 list-decimal space-y-0.5 overflow-y-auto pl-5 text-xs text-foreground">{preview.eligible.map((e) => <li key={e.key}>{e.company} · {e.title}{e.score != null ? ` · ${e.score}/10` : ""}{!e.cover ? " · CV only" : ""}</li>)}</ol>
            </details>
          )}
          <details className="mt-1"><summary className="cursor-pointer text-xs text-muted">Excluded ({Object.values(preview.excluded).reduce((a, b) => a + b, 0)}), and why</summary>
            <ul className="mt-1 space-y-0.5 text-xs text-muted">{Object.entries(preview.excluded).sort((a, b) => b[1] - a[1]).map(([r, n]) => <li key={r}>{n} · {r}</li>)}</ul>
          </details>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" disabled={!!busy || !preview.eligible.length} onClick={() => start("test")} className={btn}>Start a test batch ({Math.min(3, preview.eligible.length)})</button>
            <button type="button" disabled={!!busy || !preview.eligible.length} onClick={() => start("all")} className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-1.5 text-sm font-medium text-brand-foreground disabled:opacity-50">Start all {preview.eligible.length}</button>
            <CostBadge kind="spend" size="xs" />
            <span className="text-xs text-muted">Start with the test batch, check those documents, then start the rest.</span>
          </div>
        </section>
      )}

      {/* Library */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input className={cn(sel, "w-64")} placeholder="Company, title or location" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        <select className={sel} value={docState} onChange={(e) => setDocState(e.target.value)} aria-label="Document status">
          <option value="with-docs">Jobs with documents</option>
          <option value="all">All jobs</option>
          {Object.entries(STATE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select className={sel} value={appStatus} onChange={(e) => setAppStatus(e.target.value)} aria-label="Application status">
          <option value="">Any application status</option>
          {statuses.map((x) => <option key={x}>{x}</option>)}
        </select>
        <span className="text-xs text-muted">{shown.length} shown</span>
        <a aria-disabled={!picked.size} href={picked.size ? `/api/doc-bundle?keys=${[...picked].join(",")}` : undefined} className={cn(btn, "ml-auto", !picked.size && "pointer-events-none opacity-50")}><Archive className="size-4" /> Download selected as ZIP ({picked.size})</a>
      </div>
      <div className="mt-2 overflow-x-auto rounded-2xl border border-border bg-white">
        <table className="w-full min-w-[78rem] text-sm">
          <thead className="border-b border-border bg-surface-hover/50 text-left text-xs uppercase tracking-wide text-faint">
            <tr>
              <th className="px-3 py-2.5"><input type="checkbox" aria-label="Select all shown with documents" checked={shown.some((r) => r.doc?.cv) && shown.filter((r) => r.doc?.cv).every((r) => picked.has(r.key))} onChange={(e) => setPicked(e.target.checked ? new Set(shown.filter((r) => r.doc?.cv).map((r) => r.key)) : new Set())} /></th>
              <Th k="company" label="Company" />
              <th className="px-3 py-2.5 font-medium">Job title</th>
              <th className="px-3 py-2.5 font-medium">Location</th>
              <Th k="score" label="Suitability" />
              <th className="px-3 py-2.5 font-medium">Application</th>
              <th className="px-3 py-2.5 font-medium">CV</th>
              <th className="px-3 py-2.5 font-medium">Cover letter</th>
              <Th k="generated" label="Last generated" />
              <th className="px-3 py-2.5 font-medium">Quality check</th>
              <th className="px-3 py-2.5 font-medium">Both</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {shown.map((r) => {
              const d = r.doc;
              const links = (rel: string | null, label: string) => rel ? (
                <span className="inline-flex items-center gap-2 text-xs">
                  <a className="inline-flex items-center gap-0.5 font-medium text-brand hover:underline" href={fileHref(rel)} target="_blank" rel="noreferrer" title={`View the ${label} for ${r.company}`}><FileText className="size-3.5" />View</a>
                  <a className="inline-flex items-center gap-0.5 font-medium text-brand hover:underline" href={fileHref(rel, true)} title={`Download the ${label} for ${r.company}`}><Download className="size-3.5" />Download</a>
                </span>
              ) : <span className="text-xs text-faint">—</span>;
              const canRegen = d?.cv && !/^Already /.test(d.exclude ?? "") && ["outdated", "needs-review"].includes(d.state);
              return (
                <tr key={r.key} className="align-top hover:bg-surface-hover/40">
                  <td className="px-3 py-3">{d?.cv && <input type="checkbox" aria-label={`Select ${r.company}`} checked={picked.has(r.key)} onChange={() => toggle(r.key)} />}</td>
                  <td className="px-3 py-3 font-medium text-foreground">{r.n ? <Link className="hover:text-brand" href={`/opportunities/${r.n}`}>{r.company}</Link> : r.company}</td>
                  <td className="max-w-[18rem] px-3 py-3 text-foreground">{r.title}</td>
                  <td className="px-3 py-3 text-xs text-muted">{r.location || "—"}</td>
                  <td className="px-3 py-3 text-xs tabular-nums">{r.score != null ? `${r.score}/10` : "—"}</td>
                  <td className="px-3 py-3 text-xs text-muted">{r.status || "—"}</td>
                  <td className="px-3 py-3">{links(d?.cv ?? null, "CV")}</td>
                  <td className="px-3 py-3">{d?.needCover ? links(d?.cover ?? null, "cover letter") : <span className="text-xs text-faint" title="No cover letter until the employer is named">CV only</span>}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-xs tabular-nums text-muted">{d?.generatedAt ? new Date(d.generatedAt).toLocaleDateString("en-AU", { day: "numeric", month: "short" }) : "—"}</td>
                  <td className="max-w-[16rem] px-3 py-3 text-xs">
                    {d && <StatePill info={d} />}
                    {d?.reason && d.state !== "ready" && <p className="mt-1 text-[11px] text-muted">{d.reason}</p>}
                    {canRegen && <button type="button" disabled={!!busy} onClick={() => window.confirm(`Regenerate the documents for ${r.company}? New versions are saved beside the current ones (uses Claude once).`) && act("regen", { action: "regenerate", key: r.key }, () => "Queued for regeneration.")} className="mt-1 block text-[11px] font-medium text-brand hover:underline">Regenerate</button>}
                  </td>
                  <td className="px-3 py-3">{d?.cv && <a className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline" href={`/api/doc-bundle?keys=${r.key}`} title={`Download the CV and cover letter for ${r.company} as one ZIP`}><Archive className="size-3.5" />ZIP</a>}</td>
                </tr>
              );
            })}
            {!shown.length && <tr><td colSpan={11} className="px-4 py-10 text-center text-sm text-muted">No jobs match these filters.</td></tr>}
          </tbody>
        </table>
      </div>
    </PageFrame>
  );
}
