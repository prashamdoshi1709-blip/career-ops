"use client";

// One-click documents (through the queue and the shared generator) and a
// detailed evaluation for a scan find. Both use Claude, and both ask first.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2, RotateCcw } from "lucide-react";
import { CostBadge } from "@/components/cost/cost-badge";
import { useJobs } from "@/components/jobs/job-store";
import { AdditionalInstructionsBox, useJobInstructions, instructionsLine, generateLabel, regenerateScope, scopeWhat, type JobInstructions } from "@/components/additional-instructions";

export function ScanReviewActions({ jobKey, company, title, url, hasDocs, hasCover = true, state, canGenerate, reason, instructions }: { jobKey: string; company: string; title: string; url: string; hasDocs: boolean; hasCover?: boolean; state: string; canGenerate: boolean; reason: string; instructions: JobInstructions }) {
  const router = useRouter();
  const ctl = useJobInstructions(jobKey, instructions);
  const { startJob } = useJobs();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const generate = async () => {
    if (busy) return;
    let instr: JobInstructions;
    try { instr = await ctl.flush(); } catch (e) { setMsg(e instanceof Error ? e.message : "Your instructions could not be saved; nothing was generated."); return; }
    // With documents already made, only the chosen document is redrafted from the
    // current version; the other stays exactly as it is. Earlier versions are kept.
    const scope = regenerateScope(instr.target, { hasCover, confidential: false });
    const reviseTarget = hasDocs && (scope !== "both" || instr.text.trim()) ? scope : null;
    const what = scopeWhat(hasDocs ? scope : "both", hasDocs);
    if (!window.confirm(`Create ${what} for ${company} · ${title}?\n\nThis uses Claude once (about 85,000 tokens). The documents are made in your original format, checked, and saved against this job. Nothing is sent or submitted.${hasDocs ? " Earlier versions are kept." : ""}${instructionsLine(instr)}`)) return;
    setBusy(true); setMsg("");
    try {
      const body = hasDocs || state === "failed" ? { action: "regenerate", key: jobKey, ...(reviseTarget ? { revise: reviseTarget } : {}) } : { action: "start", mode: "all", confirm: true, keys: [jobKey] };
      const d = await fetch("/api/doc-queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
      setMsg(d.ok ? (d.added ? "Queued. Generation takes about 2 minutes; this page updates when it is done." : "Already queued or done.") : d.error ?? "Not started.");
      router.refresh();
    } finally { setBusy(false); }
  };
  return (
    <>
    {canGenerate && <AdditionalInstructionsBox ctl={ctl} jobKey={jobKey} />}
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {canGenerate ? (
        <button type="button" disabled={busy || state === "queued" || state === "generating"} onClick={generate} className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-1.5 text-sm font-medium text-brand-foreground disabled:opacity-60">
          {busy ? <Loader2 className="size-4 animate-spin" /> : state === "failed" ? <RotateCcw className="size-4" /> : <FileText className="size-4" />}
          {state === "failed" ? "Retry" : generateLabel(ctl.value.target, { hasDocs, hasCover, confidential: false })}
        </button>
      ) : <span className="text-xs text-muted">{reason}</span>}
      {canGenerate && <CostBadge kind="spend" size="xs" />}
      <button type="button" onClick={() => startJob({ title: `Evaluate · ${company}`, subtitle: title, kind: "evaluate", input: url, page: "/opportunities" })} className="rounded-full border border-brand/40 px-3 py-1.5 text-sm font-medium text-brand hover:bg-brand-soft" title="A full Career-Ops evaluation with Claude: detailed rating, strengths and weaknesses, and the job description archived">Evaluate</button>
      <CostBadge kind="spend" size="xs" />
      {msg && <span className="w-full text-xs text-muted">{msg}</span>}
    </div>
    </>
  );
}
