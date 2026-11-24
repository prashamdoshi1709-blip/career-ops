"use client";

// LinkedIn jobs into Career-Ops (2026-11-24). LinkedIn cannot be searched
// automatically (it forbids automated access), so this takes what the user
// pastes — LinkedIn job links, or the text of a LinkedIn job-alert email — and
// checks each job against Career-Ops, SEEK and the employer's own board. Free:
// no AI call and no request to LinkedIn.
import { useState } from "react";

type Result = { linkedinId: string; url: string; title: string; company: string; location: string; status: string; detail: string; canonicalUrl?: string | null };
const STATUS: Record<string, { label: string; tone: string }> = {
  known: { label: "Already in Career-Ops", tone: "text-muted" },
  confirmed: { label: "Confirmed at source", tone: "text-emerald-700 dark:text-emerald-400" },
  "linkedin-only": { label: "LinkedIn only", tone: "text-amber-700 dark:text-amber-400" },
  "not-at-employer": { label: "Not at employer (may be closed)", tone: "text-red-700 dark:text-red-400" },
  incomplete: { label: "Could not read", tone: "text-faint" },
};

export function LinkedInIntake() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"" | "check" | "add">("");
  const [res, setRes] = useState<{ results: Result[]; added: number } | null>(null);
  const [error, setError] = useState("");
  const run = async (add: boolean) => {
    setBusy(add ? "add" : "check"); setError("");
    try {
      const d = await fetch("/api/linkedin-intake", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, add }) }).then((r) => r.json());
      if (!d.ok) setError(d.error || "The check failed."); else setRes({ results: d.results ?? [], added: d.added ?? 0 });
    } catch { setError("No response from Career-Ops."); }
    setBusy("");
  };
  const addable = (res?.results ?? []).filter((r) => r.status === "confirmed" || r.status === "linkedin-only").length;
  return (
    <details className="mb-4 rounded-xl border border-border bg-surface/30 px-4 py-3 text-[13px]">
      <summary className="cursor-pointer font-medium text-foreground">LinkedIn jobs: paste links or a job-alert email</summary>
      <p className="mt-1 text-muted">LinkedIn does not allow automated searching, so Career-Ops never contacts LinkedIn. Paste LinkedIn job links, or the text of a LinkedIn job-alert email, and each job is checked against Career-Ops, SEEK and the employer&apos;s own careers site. Free; no AI.</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} placeholder="https://www.linkedin.com/jobs/view/…  (one or more links, or paste the whole alert email)" className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-[12px] text-foreground outline-none focus:border-brand/60" />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" disabled={!text.trim() || Boolean(busy)} onClick={() => run(false)} className="rounded-full border border-border px-3 py-1.5 text-[12px] font-medium text-foreground disabled:opacity-50">{busy === "check" ? "Checking…" : "Check"}</button>
        <button type="button" disabled={!text.trim() || Boolean(busy)} onClick={() => run(true)} className="rounded-full bg-brand px-3 py-1.5 text-[12px] font-medium text-brand-foreground disabled:opacity-50">{busy === "add" ? "Adding…" : "Check and add new jobs to the inbox"}</button>
        {res && <span className="text-muted">{res.results.length} job(s) read{res.added ? `, ${res.added} added to the inbox` : addable ? `, ${addable} can be added` : ""}.</span>}
        {error && <span className="text-red-600">{error}</span>}
      </div>
      {res && res.results.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {res.results.map((r) => (
            <li key={r.linkedinId} className="rounded-lg border border-border/60 px-3 py-2">
              <span className={`font-medium ${STATUS[r.status]?.tone ?? ""}`}>{STATUS[r.status]?.label ?? r.status}</span>{" · "}
              <span className="text-foreground">{r.title || "?"}</span> — {r.company || "?"}{r.location ? `, ${r.location}` : ""}
              <div className="text-[12px] text-muted">{r.detail}{r.canonicalUrl ? <> · <a href={r.canonicalUrl} target="_blank" rel="noreferrer" className="text-brand hover:underline">open</a></> : null}</div>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
