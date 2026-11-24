"use client";

// Local customisation (2026-11-11): paste a scan find's job description (SEEK
// and LinkedIn pages are not read automatically), then screen it cheaply.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { CostBadge } from "@/components/cost/cost-badge";

export function PasteJd({ jobKey, url, company, title, location, hasJd, screened }: { jobKey: string; url: string; company: string; title: string; location: string; hasJd: boolean; screened: string }) {
  const router = useRouter();
  const [jd, setJd] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const save = async () => {
    setBusy("save"); setMsg("");
    try {
      const d = await fetch("/api/posting-jd", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url, company, title, location, jd }) }).then((r) => r.json());
      setMsg(d.ok ? "Saved. You can now screen this job, generate its documents or evaluate it." : d.error ?? "Not saved.");
      if (d.ok) { setJd(""); router.refresh(); }
    } finally { setBusy(""); }
  };
  const screen = async () => {
    if (!window.confirm(`Screen ${company} · ${title} against your profile? This uses Claude once (about US$0.03). It never deletes the job.`)) return;
    setBusy("screen"); setMsg("");
    try {
      const d = await fetch("/api/screening", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start", keys: [jobKey], confirm: true }) }).then((r) => r.json());
      setMsg(d.ok ? "Screening started; refresh in a few seconds for the result." : d.error ?? "Not started.");
      setTimeout(() => router.refresh(), 12000);
    } finally { setBusy(""); }
  };
  return (
    <div className="mt-3 rounded-xl border border-border bg-surface-hover/40 px-3 py-2 text-sm">
      {!hasJd && (
        <>
          <p className="text-xs text-muted">Paste the job description from the posting. Career-Ops does not read SEEK or LinkedIn job pages automatically, because those sites do not allow it.</p>
          <textarea value={jd} onChange={(e) => setJd(e.target.value)} className="mt-2 h-40 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-brand" placeholder="Paste the whole job description here" />
          <button type="button" disabled={!!busy || jd.trim().length < 300} onClick={save} className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-brand px-3 py-1 text-xs font-medium text-brand disabled:opacity-50">{busy === "save" && <Loader2 className="size-3.5 animate-spin" />} Save job description</button>
          <CostBadge kind="free" size="xs" />
        </>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" disabled={!!busy} onClick={screen} className="rounded-full border border-border px-3 py-1 text-xs font-medium text-foreground hover:border-brand hover:text-brand disabled:opacity-50">{busy === "screen" ? <Loader2 className="size-3.5 animate-spin" /> : null} {screened ? "Screen again" : "Screen this job"}{hasJd ? " (from its description)" : " (from its title)"}</button>
        <CostBadge kind="spend" size="xs" />
        {screened && <span className="text-xs text-muted">{screened}</span>}
      </div>
      {msg && <p className="mt-1 text-xs text-muted">{msg}</p>}
    </div>
  );
}
