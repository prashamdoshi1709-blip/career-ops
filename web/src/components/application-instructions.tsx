"use client";

// Local customisation (2026-11-10): "My Instructions for This Application".
// Saved per job (data/application-instructions.json); used by Generate and by
// Revise. Saving, clearing and copying never call Claude.

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { CostBadge } from "@/components/cost/cost-badge";

export type Instructions = { general: string; cv: string; cover: string; tone: string; emphasis: string; updatedAt?: string | null };
export type OtherInstructions = Instructions & { reportNum: string; label: string };

const TONES = ["", "Natural", "Professional", "Concise", "Confident"];
const EMPHASES = ["", "Investment Banking", "Management Consulting", "Strategy Consulting", "Corporate Finance", "Valuations", "Equity Research", "Financial Analysis", "Client Communication and Stakeholder Engagement"];
const box = "mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground outline-none focus:border-brand";

export function ApplicationInstructions({ reportNum, label, initial, others }: { reportNum: string; label: string; initial: Instructions; others: OtherInstructions[] }) {
  const [v, setV] = useState<Instructions>(initial);
  const [saved, setSaved] = useState<Instructions>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const dirty = (["general", "cv", "cover", "tone", "emphasis"] as const).some((k) => v[k] !== saved[k]);
  const count = (["general", "cv", "cover"] as const).filter((k) => saved[k]).length + (saved.tone ? 1 : 0) + (saved.emphasis ? 1 : 0);
  const set = (k: keyof Instructions) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));

  const save = async (next: Instructions) => {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/application-instructions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reportNum, label, ...next }) });
      const d = await r.json().catch(() => ({ ok: false }));
      if (!d.ok) { setMsg(d.error ?? "Not saved."); return; }
      setV(d.instructions); setSaved(d.instructions);
      setMsg(next.general || next.cv || next.cover || next.tone || next.emphasis ? "Saved. Generate and Revise will use these." : "Cleared.");
    } finally { setBusy(false); }
  };
  const copyFrom = (key: string) => {
    const o = others.find((x) => x.reportNum === key);
    if (!o) return;
    if ((v.general || v.cv || v.cover) && !window.confirm(`Replace the text below with the instructions saved for ${o.label}? Nothing is saved until you press Save.`)) return;
    setV({ ...v, general: o.general, cv: o.cv, cover: o.cover, tone: o.tone, emphasis: o.emphasis });
    setMsg(`Copied from ${o.label}. Edit anything employer-specific, then Save.`);
  };
  const copyText = async () => {
    const t = [`General: ${v.general}`, `CV: ${v.cv}`, `Cover letter: ${v.cover}`, v.tone && `Tone: ${v.tone}`, v.emphasis && `Emphasis: ${v.emphasis}`].filter(Boolean).join("\n\n");
    try { await navigator.clipboard.writeText(t); setMsg("Copied to the clipboard."); } catch { setMsg("Could not copy."); }
  };

  return (
    <details className="mb-3 rounded-xl border border-border bg-surface-hover/40 px-3 py-2" open={count > 0 || undefined}>
      <summary className="cursor-pointer text-sm font-medium text-foreground">
        My Instructions for This Application
        <span className="ml-2 text-xs font-normal text-muted">{count ? `${count} saved${saved.updatedAt ? ` · ${new Date(saved.updatedAt).toLocaleDateString("en-AU", { timeZone: "Australia/Sydney" })}` : ""}` : "optional · used by Generate and Revise"}</span>
      </summary>
      <div className="mt-2 grid gap-2">
        <label className="text-xs font-medium text-foreground">General Application Instructions <span className="font-normal text-muted">(both documents)</span>
          <textarea className={`${box} h-20`} value={v.general} onChange={set("general")} placeholder="e.g. Emphasise my communication and relationship-building. Explain why I want to move into management consulting." />
        </label>
        <label className="text-xs font-medium text-foreground">CV-Specific Instructions <span className="font-normal text-muted">(the CV only)</span>
          <textarea className={`${box} h-16`} value={v.cv} onChange={set("cv")} placeholder="e.g. Shorten the first project bullet. Trim the second bullet of the earlier role. Keep the comparables bullet unchanged." />
        </label>
        <label className="text-xs font-medium text-foreground">Cover Letter-Specific Instructions <span className="font-normal text-muted">(the letter only)</span>
          <textarea className={`${box} h-16`} value={v.cover} onChange={set("cover")} placeholder="e.g. Make it more natural and personal. Show that I enjoy client interaction and understanding businesses." />
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs font-medium text-foreground">Writing tone (optional)
            <select className={box} value={v.tone} onChange={set("tone")}>{TONES.map((t) => <option key={t} value={t}>{t || "Default"}</option>)}</select>
          </label>
          <label className="text-xs font-medium text-foreground">Main emphasis (optional)
            <select className={box} value={v.emphasis} onChange={set("emphasis")}>{EMPHASES.map((t) => <option key={t} value={t}>{t || "Default for this role type"}</option>)}</select>
          </label>
        </div>
        <p className="text-[11px] text-faint">Your written instructions take priority over tone and emphasis. Neither can add facts that are not in your CV: anything unsupported is reported back as not applied.</p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={busy || !dirty} onClick={() => save(v)} className="inline-flex items-center gap-1.5 rounded-full border border-brand bg-white px-3 py-1 text-xs font-medium text-brand disabled:opacity-50">
            {busy && <Loader2 className="size-3.5 animate-spin" />} Save instructions
          </button>
          <CostBadge kind="free" size="xs" />
          <button type="button" disabled={busy || !(saved.general || saved.cv || saved.cover || saved.tone || saved.emphasis)} onClick={() => window.confirm("Clear the saved instructions for this job?") && save({ general: "", cv: "", cover: "", tone: "", emphasis: "" })} className="text-xs text-muted hover:text-foreground disabled:opacity-50">Clear</button>
          <button type="button" onClick={copyText} className="text-xs text-muted hover:text-foreground">Copy text</button>
          {others.length > 0 && (
            <select className="rounded-lg border border-border bg-white px-2 py-1 text-xs text-muted" value="" onChange={(e) => copyFrom(e.target.value)} aria-label="Reuse instructions from another job">
              <option value="">Reuse from another job…</option>
              {others.map((o) => <option key={o.reportNum} value={o.reportNum}>{o.label}</option>)}
            </select>
          )}
          {msg && <span className="text-xs text-muted">{msg}</span>}
        </div>
      </div>
    </details>
  );
}
