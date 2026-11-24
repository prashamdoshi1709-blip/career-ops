"use client";

// Local customisation (2026-11-10): "+ Add Job Manually" (All Job Opportunities)
// and "Edit job" (job page of a manually added job). Saving and editing are
// local file writes through /api/manual-job; no Claude call. The optional
// posting check reads the employer's public job-board API only.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, Loader2, Pencil, Plus, X } from "lucide-react";
import { CostBadge } from "@/components/cost/cost-badge";

export type ManualJobValues = { company: string; role: string; location: string; url: string; jd: string; deadline: string; source: string };
type Dup = { kind: "tracked" | "inbox"; n?: string; company: string; role: string; location: string; url: string; status?: string; manual?: boolean; why: string };

const EMPTY: ManualJobValues = { company: "", role: "", location: "", url: "", jd: "", deadline: "", source: "LinkedIn" };
const SOURCES = ["LinkedIn", "SEEK", "Company website", "Other"];
const input = "mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground outline-none focus:border-brand";

export function ManualJobDialog({ mode = "create", n, initial, canRemove = false, hasDocs = false }: {
  mode?: "create" | "edit"; n?: string; initial?: Partial<ManualJobValues>; canRemove?: boolean; hasDocs?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<ManualJobValues>({ ...EMPTY, ...initial });
  const [busy, setBusy] = useState<"" | "save" | "check" | "remove">("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [liveness, setLiveness] = useState("");
  const [dups, setDups] = useState<Dup[] | null>(null);
  const set = (k: keyof ManualJobValues) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));

  const post = async (body: Record<string, unknown>) => {
    const r = await fetch("/api/manual-job", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: r.status, data: await r.json().catch(() => ({ ok: false, error: "no response" })) };
  };

  const checkPosting = async () => {
    setBusy("check"); setError(""); setNote("");
    try {
      const { data } = await post({ action: "check-posting", url: v.url });
      if (!data.ok) { setError(data.error); return; }
      setLiveness(data.liveness ?? "");
      if (data.jd && (!v.jd.trim() || window.confirm("Replace the job description in the box with the text read from the job board?"))) setV((x) => ({ ...x, jd: data.jd }));
      setNote(`${data.message}${data.liveness && data.liveness !== "not checked" ? ` Posting status: ${data.liveness}.` : ""}`);
    } finally { setBusy(""); }
  };

  const save = async (allowDuplicate = false) => {
    setBusy("save"); setError(""); setDups(null);
    try {
      const { status, data } = await post({ action: mode === "edit" ? "update" : "create", n, ...v, allowDuplicate, liveness });
      if (status === 409 && data.duplicates) { setDups(data.duplicates); return; }
      if (!data.ok) { setError(data.error ?? "Not saved."); return; }
      if (mode === "edit") {
        setOpen(false);
        if (data.jdChanged && hasDocs) window.alert("Saved. The job description changed, so the existing CV and cover letter are now flagged as possibly outdated. They were not changed or regenerated.");
        router.refresh();
      } else {
        router.push(`/opportunities/${data.n}`);
      }
    } finally { setBusy(""); }
  };

  const updateExisting = async (d: Dup) => {
    if (!window.confirm(`Update ${d.company} · ${d.role} (#${d.n}) with the details in this form? Its status and notes stay as they are.`)) return;
    setBusy("save"); setError("");
    try {
      const { data } = await post({ action: "update", n: d.n, ...v, liveness });
      if (!data.ok) { setError(data.error ?? "Not updated."); return; }
      router.push(`/opportunities/${d.n}`);
    } finally { setBusy(""); }
  };

  const remove = async () => {
    if (!window.confirm("Remove this manually added job? Its tracker row and job description are deleted. Jobs with documents or a status other than Evaluated cannot be removed.")) return;
    setBusy("remove"); setError("");
    try {
      const { data } = await post({ action: "remove", n });
      if (!data.ok) { setError(data.error ?? "Not removed."); return; }
      router.push("/opportunities");
    } finally { setBusy(""); }
  };

  const trigger = mode === "edit" ? (
    <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-medium text-muted transition-colors hover:border-brand/40 hover:text-brand max-sm:min-h-[44px]">
      <Pencil className="size-3.5" /> Edit job
    </button>
  ) : (
    <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-medium text-brand-foreground shadow-sm hover:opacity-90">
      <Plus className="size-4" /> Add Job Manually
    </button>
  );

  return (
    <>
      {trigger}
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/30 p-4 sm:p-8" role="dialog" aria-modal="true" aria-label={mode === "edit" ? "Edit job" : "Add job manually"}>
          <div className="w-full max-w-2xl rounded-2xl border border-border bg-white p-5 text-left shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-xl text-landing">{mode === "edit" ? "Edit job" : "Add job manually"}</h2>
                <p className="mt-0.5 text-xs text-muted">
                  {mode === "edit" ? "Correct the details or the job description. Generated documents are never changed or regenerated by saving." : "For a role you found yourself on LinkedIn, SEEK, a company website or elsewhere. Company, job title and the job description are enough."}
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="rounded-full p-1 text-muted hover:text-foreground" aria-label="Close"><X className="size-5" /></button>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-medium text-foreground">Company name *<input className={input} value={v.company} onChange={set("company")} placeholder="e.g. Macquarie Group" /></label>
              <label className="text-xs font-medium text-foreground">Job title *<input className={input} value={v.role} onChange={set("role")} placeholder="e.g. M&A Analyst" /></label>
              <label className="text-xs font-medium text-foreground">Location<input className={input} value={v.location} onChange={set("location")} placeholder="e.g. Sydney NSW" /></label>
              <label className="text-xs font-medium text-foreground">Source
                <select className={input} value={v.source} onChange={set("source")}>{SOURCES.map((s) => <option key={s}>{s}</option>)}</select>
              </label>
              <label className="text-xs font-medium text-foreground sm:col-span-2">Job posting URL (optional)
                <div className="mt-1 flex gap-2">
                  <input className={input.replace("mt-1 ", "")} value={v.url} onChange={set("url")} placeholder="https://…" />
                  <button type="button" disabled={!v.url || !!busy} onClick={checkPosting} className="shrink-0 rounded-lg border border-border px-3 text-xs font-medium text-foreground hover:border-brand hover:text-brand disabled:opacity-50" title="Reads the employer's public job board, if it has one. LinkedIn and other sites that need a login are not read. No Claude call.">
                    {busy === "check" ? <Loader2 className="size-4 animate-spin" /> : "Check posting"}
                  </button>
                </div>
              </label>
              <label className="text-xs font-medium text-foreground">Application deadline (optional)<input type="date" className={input} value={v.deadline} onChange={set("deadline")} /></label>
              <label className="text-xs font-medium text-foreground sm:col-span-2">Full job description *
                <textarea className={`${input} h-64 font-sans leading-relaxed`} value={v.jd} onChange={set("jd")} placeholder="Paste the whole job description: responsibilities, requirements and anything about the team or firm." />
              </label>
            </div>

            {note && <p className="mt-2 rounded-lg border border-border bg-surface-hover/60 px-3 py-2 text-xs text-muted">{note}</p>}
            {error && <p className="mt-2 text-xs text-rose-700">{error}</p>}

            {dups && (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <p className="font-medium">This job may already be in Career-Ops:</p>
                <ul className="mt-1.5 space-y-1.5">
                  {dups.map((d) => (
                    <li key={`${d.kind}${d.n ?? d.url}`} className="flex flex-wrap items-center gap-2">
                      <span><b>{d.company}</b> · {d.role}{d.location ? ` · ${d.location}` : ""} <span className="text-amber-700">({d.why}{d.kind === "tracked" ? `, #${d.n}, ${d.status}` : ", found by a scan"})</span></span>
                      {d.kind === "tracked" ? (
                        <Link href={`/opportunities/${d.n}`} className="font-medium text-brand hover:underline">Open it</Link>
                      ) : (
                        <a href={d.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-brand hover:underline">Open posting <ExternalLink className="size-3" /></a>
                      )}
                      {d.kind === "tracked" && d.manual && <button type="button" onClick={() => updateExisting(d)} className="font-medium text-brand hover:underline">Update it with these details</button>}
                    </li>
                  ))}
                </ul>
                <button type="button" onClick={() => save(true)} className="mt-2 font-medium text-amber-900 underline">It is a different job: save it separately</button>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <button type="button" disabled={!!busy} onClick={() => save(false)} className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-1.5 text-sm font-medium text-brand-foreground disabled:opacity-60">
                  {busy === "save" && <Loader2 className="size-4 animate-spin" />}{mode === "edit" ? "Save changes" : "Save job"}
                </button>
                <CostBadge kind="free" size="xs" />
                <button type="button" onClick={() => setOpen(false)} className="text-sm text-muted hover:text-foreground">Cancel</button>
              </div>
              {mode === "edit" && canRemove && (
                <button type="button" disabled={!!busy} onClick={remove} className="text-xs text-rose-700 hover:underline disabled:opacity-60">{busy === "remove" ? "Removing…" : "Remove this job"}</button>
              )}
            </div>
            <p className="mt-2 text-[11px] text-faint">Saving does not apply for the job, contact anyone or use Claude. Generate the CV and cover letter from the job page when you are ready.</p>
          </div>
        </div>
      )}
    </>
  );
}
