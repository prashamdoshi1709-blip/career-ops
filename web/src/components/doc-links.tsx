"use client";

// Local customisation (2026-11-11): a job's own CV and cover letter, with View
// and Download, and the honest status when they are not ready yet.

import { useEffect, useState } from "react";
import { FileText, Download, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

export type DocInfo = { key: string; state: string; reason: string; cv: string | null; cover: string | null; needCover: boolean; generatedAt: string | null };

export const STATE_LABEL: Record<string, string> = {
  "not-generated": "Not generated", queued: "Queued", generating: "Generating", ready: "Ready",
  "needs-review": "Needs review", failed: "Failed", outdated: "Outdated",
};
export const STATE_TONE: Record<string, string> = {
  ready: "border-emerald-200 bg-emerald-50 text-emerald-800",
  "needs-review": "border-amber-200 bg-amber-50 text-amber-800",
  outdated: "border-amber-200 bg-amber-50 text-amber-800",
  failed: "border-rose-200 bg-rose-50 text-rose-800",
  queued: "border-sky-200 bg-sky-50 text-sky-800",
  generating: "border-sky-200 bg-sky-50 text-sky-800",
  skipped: "border-border bg-surface-hover text-muted",
  "not-generated": "border-border bg-white text-muted",
};
import { fileHref } from "@/lib/doc-href.mjs";
export { fileHref };

// One shared fetch for every card on the page; refreshes while work is running.
let cache: Record<string, DocInfo> | null = null;
let inflight: Promise<Record<string, DocInfo>> | null = null;
const listeners = new Set<(s: Record<string, DocInfo>) => void>();
async function load(): Promise<Record<string, DocInfo>> {
  if (!inflight) inflight = fetch("/api/doc-status").then((r) => r.json()).then((d) => { cache = d.statuses ?? {}; listeners.forEach((l) => l(cache!)); return cache!; }).catch(() => cache ?? {}).finally(() => { inflight = null; });
  return inflight;
}
export function useDocStatuses() {
  const [s, setS] = useState<Record<string, DocInfo> | null>(cache);
  useEffect(() => {
    listeners.add(setS);
    load();
    const t = setInterval(() => { if (cache && Object.values(cache).some((d) => d.state === "queued" || d.state === "generating")) load(); }, 15000);
    return () => { listeners.delete(setS); clearInterval(t); };
  }, []);
  return s;
}

export function StatePill({ info, className }: { info: DocInfo; className?: string }) {
  return (
    <span title={info.reason || STATE_LABEL[info.state]} className={cn("inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold", STATE_TONE[info.state] ?? STATE_TONE["not-generated"], className)}>
      {info.state === "generating" && <Loader2 className="size-3 animate-spin" />}
      {STATE_LABEL[info.state] ?? info.state}
    </span>
  );
}

function Row({ label, rel, missing }: { label: string; rel: string | null; missing: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-medium text-foreground">{label}:</span>
      {rel ? (
        <>
          <a className="inline-flex items-center gap-0.5 font-medium text-brand hover:underline" href={fileHref(rel)} target="_blank" rel="noreferrer" title={`Open the ${label.toLowerCase()} for this job`}><FileText className="size-3" />View</a>
          <span className="text-faint">|</span>
          <a className="inline-flex items-center gap-0.5 font-medium text-brand hover:underline" href={fileHref(rel, true)} title={`Download the ${label.toLowerCase()} for this job`}><Download className="size-3" />Download</a>
        </>
      ) : <span className="text-muted">{missing}</span>}
    </span>
  );
}

/** Compact block for a job card: "CV: View | Download", "Cover Letter: View | Download", plus status. */
export function DocLinks({ jobKey, info: given }: { jobKey: string; info?: DocInfo }) {
  const all = useDocStatuses();
  const info = given ?? all?.[jobKey];
  if (!info) return null;
  const missing = STATE_LABEL[info.state] ?? "Not generated";
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border bg-surface-hover/40 px-2.5 py-1.5 text-xs">
      <StatePill info={info} />
      <Row label="CV" rel={info.cv} missing={missing} />
      {info.needCover && <Row label="Cover Letter" rel={info.cover} missing={info.cv && !info.cover ? "Not created" : missing} />}
      {info.reason && info.state !== "ready" && <span className="w-full text-[11px] text-muted">{info.reason}</span>}
    </div>
  );
}
