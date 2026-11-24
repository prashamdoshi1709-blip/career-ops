"use client";

// Local customisation (2026-11-11): application status for one job, inside All
// Job Opportunities. Tracked jobs use the canonical tracker states (through
// /api/status → set-status.mjs); scan finds can be skipped or marked Applied.
// Nothing here is ever changed automatically.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

const TRACKED: [string, string][] = [
  ["Evaluated", "Reviewing"], ["Applied", "Applied"], ["Responded", "Responded"], ["Assessment", "Assessment"], ["Interview", "Interview"],
  ["Offer", "Offer"], ["Hired", "Hired"], ["Rejected", "Rejected"], ["SKIP", "Skipped"], ["Discarded", "Skipped (closed)"],
];
const TONE: Record<string, string> = { Applied: "text-sky-800", Responded: "text-sky-800", Assessment: "text-violet-800", Interview: "text-violet-800", Offer: "text-emerald-800", Hired: "text-emerald-800", Rejected: "text-rose-700", SKIP: "text-muted", Discarded: "text-muted" };
const SUBMITTED = new Set(["Applied", "Responded", "Assessment", "Interview", "Offer", "Hired"]);

type Job = { kind: string; n: string | null; status: string; url: string; company: string; title: string; location: string };

export function JobStatusControl({ job, docsReady = false }: { job: Job; docsReady?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const sel = "rounded-md border border-border bg-white px-1.5 py-1 text-xs font-medium outline-none focus:border-brand";

  const confirmSubmitted = (s: string) => !SUBMITTED.has(s) || window.confirm(`Mark ${job.company} · ${job.title} as ${s}?\n\nOnly do this once you have actually submitted the application yourself.`);

  if (job.kind === "tracked" && job.n) {
    const change = async (status: string) => {
      if (status === job.status || !confirmSubmitted(status)) return;
      setBusy(true); setErr("");
      try {
        const r = await fetch("/api/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ n: job.n, status }) });
        if (!r.ok) setErr((await r.json().catch(() => ({}))).error ?? "Not saved");
        router.refresh();
      } finally { setBusy(false); }
    };
    return (
      <div className="flex flex-col gap-1">
        <span className="inline-flex items-center gap-1">
          <select aria-label="Application status" className={cn(sel, TONE[job.status])} value={job.status} disabled={busy} onChange={(e) => change(e.target.value)}>
            {TRACKED.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            {!TRACKED.some(([v]) => v === job.status) && <option value={job.status}>{job.status}</option>}
          </select>
          {busy && <Loader2 className="size-3.5 animate-spin text-muted" />}
        </span>
        {job.status === "Evaluated" && docsReady && <span className="text-[10px] font-semibold text-emerald-700">Documents ready</span>}
        {err && <span className="text-[10px] text-rose-700">{err}</span>}
      </div>
    );
  }

  const change = async (v: string) => {
    if (v === "New") return;
    setBusy(true); setErr("");
    try {
      if (v === "Skipped") {
        const r = await fetch("/api/inbox/skip", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: job.url, done: true }) });
        if (!r.ok) setErr((await r.json().catch(() => ({}))).error ?? "Not saved");
      } else {
        if (!confirmSubmitted(v)) return;
        const r = await fetch("/api/job-status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: job.url, company: job.company, title: job.title, location: job.location, status: v }) });
        const body = await r.json().catch(() => ({}));
        if (!r.ok) setErr(body.error ?? "Not saved");
        // The scan find is now tracker row n. On its own page, go to the row's page
        // (replace, so Back does not return to the old address); the old address
        // also redirects there now (job-identity.mjs).
        else if (body.n && /^\/opportunities\/p[a-f0-9]{12}/.test(window.location.pathname)) {
          router.replace(`/opportunities/${body.n}${window.location.search}`);
          return;
        }
      }
      router.refresh();
    } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-col gap-1">
      <span className="inline-flex items-center gap-1">
        <select aria-label="Application status" className={sel} value="New" disabled={busy} onChange={(e) => change(e.target.value)}>
          <option value="New">New</option><option value="Skipped">Skipped</option><option value="Applied">Applied</option>
        </select>
        {busy && <Loader2 className="size-3.5 animate-spin text-muted" />}
      </span>
      {docsReady && <span className="text-[10px] font-semibold text-emerald-700">Documents ready</span>}
      {err && <span className="text-[10px] text-rose-700">{err}</span>}
    </div>
  );
}
