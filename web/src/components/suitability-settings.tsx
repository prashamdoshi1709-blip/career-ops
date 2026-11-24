"use client";

// Local customisation (2026-11-11): Config → Minimum suitability.
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

type Plan = { total: number; remove: number; protected: number; keep: number; pending: number; conflicts: number; removeList: string[] };
type Settings = { minSuitability: number; applyToPreliminary: boolean; autoCleanup: boolean; screeningGate: number };

export function SuitabilitySettings() {
  const [s, setS] = useState<Settings | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [min, setMin] = useState("6.5");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => { fetch("/api/job-cleanup").then((r) => r.json()).then((d) => { if (d.ok) { setS(d.settings); setPlan(d.plan); setMin(String(d.settings.minSuitability)); } }); }, []);
  const post = async (body: Record<string, unknown>) => {
    setBusy(true); setMsg("");
    try {
      const d = await fetch("/api/job-cleanup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
      if (!d.ok) { setMsg(d.error ?? "Not saved."); return; }
      if (d.settings) { setS(d.settings); setPlan(d.plan); setMsg("Saved."); }
      if (d.result) { setMsg(`${d.removed} job${d.removed === 1 ? "" : "s"} permanently removed.`); const g = await fetch("/api/job-cleanup").then((r) => r.json()); setPlan(g.plan); }
    } finally { setBusy(false); }
  };
  if (!s) return null;
  return (
    <section className="mx-auto mt-6 max-w-3xl rounded-2xl border border-border bg-white px-5 py-4">
      <h2 className="font-display text-xl text-landing">Minimum suitability</h2>
      <p className="mt-1 text-sm text-muted">Jobs rated below this are permanently removed from Career-Ops (not archived). Applications you have submitted, jobs with follow-ups and jobs with documents are always kept. Unscored jobs stay as Pending evaluation. A removed posting&apos;s link is remembered so a scan does not add it again.</p>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <label className="inline-flex items-center gap-2 font-medium text-foreground">Minimum
          <input type="number" min={0} max={10} step={0.1} value={min} onChange={(e) => setMin(e.target.value)} className="w-20 rounded-lg border border-border px-2 py-1" /> /10
        </label>
        <button type="button" disabled={busy || Number(min) === s.minSuitability} onClick={() => post({ action: "settings", minSuitability: Number(min) })} className="rounded-full border border-brand px-3 py-1 text-sm font-medium text-brand disabled:opacity-50">Save</button>
        <label className="inline-flex items-center gap-1.5 text-muted"><input type="checkbox" checked={s.applyToPreliminary} onChange={(e) => post({ action: "settings", applyToPreliminary: e.target.checked })} /> Also apply to preliminary ratings (calculated on this computer, without the job description)</label>
        <label className="inline-flex items-center gap-1.5 text-muted"><input type="checkbox" checked={s.autoCleanup} onChange={(e) => post({ action: "settings", autoCleanup: e.target.checked })} /> Remove new jobs below the minimum automatically (detailed evaluations only)</label>
        <label className="inline-flex items-center gap-1.5 text-muted" title="Screens score lower than detailed evaluations (calibrated 11 Nov: jobs rated 6.6 to 8.4 in detail screened 4.0 to 7.6), so the gate sits below the minimum. A screen never deletes a job.">Screening gate for detailed evaluation
          <select className="rounded-lg border border-border px-1.5 py-1" value={s.screeningGate} onChange={(e) => post({ action: "settings", screeningGate: Number(e.target.value) })}>{[4.5, 5, 5.5, 6, 6.5].map((g) => <option key={g} value={g}>{g}</option>)}</select>
        </label>
        {busy && <Loader2 className="size-4 animate-spin text-muted" />}
      </div>
      {plan && (
        <div className="mt-3 rounded-xl border border-border bg-surface-hover/50 px-3 py-2 text-sm">
          <p className="text-foreground">{plan.total} jobs · {plan.keep} at or above the minimum · {plan.protected} protected applications · {plan.pending} pending evaluation{plan.conflicts ? ` · ${plan.conflicts} with conflicting ratings (kept for review)` : ""}</p>
          <p className="mt-1 text-muted">{plan.remove ? `${plan.remove} job${plan.remove === 1 ? "" : "s"} currently below the minimum.` : "Nothing is below the minimum."}</p>
          {plan.remove > 0 && (
            <>
              <details className="mt-1 text-xs"><summary className="cursor-pointer text-muted">Show them</summary><ul className="mt-1 max-h-48 list-disc overflow-y-auto pl-5 text-foreground">{plan.removeList.map((x) => <li key={x}>{x}</li>)}</ul></details>
              <button type="button" disabled={busy} onClick={() => window.confirm(`Permanently remove ${plan.remove} job${plan.remove === 1 ? "" : "s"} below ${s.minSuitability}/10? This cannot be undone from the dashboard.`) && post({ action: "apply", confirm: true })} className="mt-2 rounded-full bg-rose-700 px-3 py-1 text-xs font-medium text-white">Remove them permanently</button>
            </>
          )}
        </div>
      )}
      {msg && <p className="mt-2 text-xs text-muted">{msg}</p>}
    </section>
  );
}
