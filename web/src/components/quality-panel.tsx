"use client";

// Document quality summary, shared by tracked jobs and scan finds (2026-11-15).
// The "Additional Instructions Compliance" group comes first; when an instruction
// was not followed and has a safe automatic correction (a greeting, a sentence
// quoted for removal), it offers that correction on this computer: no Claude call,
// a new version is rendered and checked, the earlier one is kept.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Wrench } from "lucide-react";
import { cn } from "@/lib/cn";
import { explainQuality } from "@/lib/quality-explain.mjs";

export type KeywordFinding = { term: string; document: string; match?: string; sentence: string; jdRequirement: string; evidence: string; reason: string; fix: string };
export type KeywordDiagnostics = {
  present: { term: string; cls: string }[];
  missing: { term: string; use: string | null; jdRequirement: string }[];
  claimed: KeywordFinding[];
  contextual: KeywordFinding[];
  keptOut: string[];
  unverified: string[];
};
export type QItem = { group: string; status: "ok" | "warning" | "review" | "issue"; detail: string; list?: string[]; fixable?: boolean; live?: boolean; diagnostics?: KeywordDiagnostics; explain?: { kind?: string; checks: string; fix: string } };

const KEYWORDS = "ATS keyword alignment";

// 2026-11-19: the keyword check, broken down so a failure explains itself:
// what is present, what is missing, which job terms have no record, and for
// each problem the exact sentence, the job-ad line, the cv.md evidence, the
// reason, and whether the document or the checker needs correcting.
function KeywordBreakdown({ d }: { d: KeywordDiagnostics }) {
  const h = "mt-2 font-medium text-foreground";
  const finding = (f: KeywordFinding, i: number, tone: string) => (
    <li key={`${f.term}-${i}`} className={cn("rounded-lg border px-2 py-1.5", tone)}>
      <div><span className="font-semibold">{f.term}</span> · {f.document}</div>
      <div className="mt-0.5">&ldquo;{f.sentence}&rdquo;</div>
      {f.jdRequirement && <div className="mt-0.5 text-faint">Job ad: &ldquo;{f.jdRequirement}&rdquo;</div>}
      <div className="mt-0.5">cv.md evidence: {f.evidence}</div>
      <div className="mt-0.5">Why: {f.reason}</div>
      <div className="mt-0.5 font-medium">{/^document/i.test(f.fix) ? "Needs a document correction" : "Checker context: no correction needed"} ({f.fix})</div>
    </li>
  );
  return (
    <div className="ml-28 mt-1 space-y-1 text-muted">
      {!!d.claimed.length && (<><p className={h}>Unsupported keywords claimed ({d.claimed.length})</p><ul className="space-y-1">{d.claimed.map((f, i) => finding(f, i, TONE.issue))}</ul></>)}
      <p className={h}>Supported keywords included ({d.present.length})</p>
      <p>{d.present.map((k) => k.term).join(", ") || "none"}</p>
      <p className={h}>Supported keywords missing ({d.missing.length})</p>
      {d.missing.length ? <ul className="list-disc pl-4">{d.missing.map((k) => <li key={k.term}>{k.term}{k.use ? `: only as "${k.use}"` : ""}</li>)}</ul> : <p>none</p>}
      <p className={h}>Job terms you have no record of, not claimed ({d.keptOut.length})</p>
      <p>{d.keptOut.join(", ") || "none"}</p>
      {!!d.contextual.length && (<><p className={h}>Mentions that are not claims ({d.contextual.length})</p><ul className="space-y-1">{d.contextual.map((f, i) => finding(f, i, TONE.ok))}</ul></>)}
      {!!d.unverified.length && (<><p className={h}>Not in the term list (check by hand)</p><p>{d.unverified.join(", ")}</p></>)}
    </div>
  );
}

const TONE: Record<string, string> = {
  ok: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warning: "border-sky-200 bg-sky-50 text-sky-800",
  review: "border-amber-200 bg-amber-50 text-amber-800",
  issue: "border-rose-200 bg-rose-50 text-rose-800",
};
const LABEL: Record<string, string> = { ok: "Passed", warning: "Warning", review: "Requires review", issue: "Failed" };
const COMPLIANCE = "Additional Instructions Compliance";
// Groups from an older run that the live compliance check replaces.
const STALE = new Set([COMPLIANCE, "Instructions applied", "Instructions not applied or partly applied"]);

/** The saved quality items, with a live compliance check (if any) in place of the stale instruction groups. */
export function withCompliance(items: QItem[] | null | undefined, live: QItem | null | undefined): QItem[] | null {
  if (!live) return items ?? null;
  return [live, ...(items ?? []).filter((q) => !STALE.has(q.group))];
}

function LocalFix({ jobKey, applied }: { jobKey: string; applied: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const run = async () => {
    if (busy) return;
    if (!window.confirm(`Correct the cover letter on this computer?\n\nNo Claude call and no tokens: only the instruction that failed (for example the greeting) is changed, then the letter is rendered again and every check is run. A new version is saved; the current one is kept.${applied ? "\n\nThis application is marked as submitted, so the correction is saved separately in \"Drafts after submission\" and the submitted documents are not touched." : ""}`)) return;
    setBusy(true); setMsg("");
    try {
      const d = await fetch("/api/doc-local-fix", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: jobKey }) }).then((r) => r.json()).catch(() => ({ ok: false, error: "no response" }));
      setMsg(d.ok ? `Corrected: ${(d.fixedLocally ?? []).map((f: { detail: string }) => f.detail).join("; ")}. New version saved${d.separateDraft ? " in Drafts after submission" : " and linked"}.` : `Not corrected: ${d.error}`);
      router.refresh();
    } finally { setBusy(false); }
  };
  return (
    <div className="ml-28 mt-1.5 flex flex-wrap items-center gap-2">
      <button type="button" disabled={busy} onClick={run} className="inline-flex items-center gap-1.5 rounded-full border border-brand/40 px-3 py-1 text-xs font-medium text-brand hover:bg-brand-soft disabled:opacity-60">
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Wrench className="size-3.5" />} Fix without AI (free)
      </button>
      <span className="text-[11px] text-faint">Changes only what failed; no regeneration, no tokens</span>
      {msg && <span className="w-full text-[11px] text-muted">{msg}</span>}
    </div>
  );
}

export function QualityPanel({ items, when, jobKey, applied = false }: { items: QItem[]; when?: string; jobKey?: string; applied?: boolean }) {
  const failed = items.filter((q) => q.status === "issue").length;
  const review = items.filter((q) => q.status === "review").length;
  return (
    <div className="mt-3">
      <p className={cn("mb-2 rounded-lg border px-3 py-1.5 text-xs font-medium", failed ? TONE.issue : review ? TONE.review : TONE.ok)}>
        {failed ? `Not ready: ${failed} check${failed > 1 ? "s" : ""} failed. Revise or regenerate before sending.` : review ? `Check before sending: ${review} item${review > 1 ? "s" : ""} require${review > 1 ? "" : "s"} your review.` : "Ready to read through and send. No check failed; read it once yourself before submitting."}
      </p>
      <p className="text-xs font-medium text-foreground">
        Document quality check{when ? ` · ${when}` : ""}
        <span className="ml-1 font-normal text-faint">(local checks; keyword coverage is a diagnostic, not a guarantee of how an employer&apos;s ATS behaves)</span>
      </p>
      <ul className="mt-1.5 space-y-1.5">
        {items.map((q) => (
          <li key={q.group} className="text-xs">
            <details open={q.group === COMPLIANCE || (q.group === KEYWORDS && q.status === "issue")}>
              <summary className="cursor-pointer list-none">
                <span className={cn("mr-2 inline-flex w-24 justify-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold", TONE[q.status])}>{LABEL[q.status]}</span>
                <span className="font-medium text-foreground">{q.group}</span>
                <span className="text-muted"> · {q.detail}</span>
              </summary>
              {q.group === KEYWORDS && q.diagnostics
                ? <KeywordBreakdown d={q.diagnostics} />
                : !!q.list?.length && <ul className="ml-28 mt-1 list-disc space-y-0.5 pl-4 text-muted">{q.list.map((l) => <li key={l}>{l}</li>)}</ul>}
              <Explain q={q} />
            </details>
            {q.group === COMPLIANCE && q.fixable && jobKey && <LocalFix jobKey={jobKey} applied={applied} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Why this result (2026-11-22): what was checked, how reliable it is, the fix,
// and whether it blocks submission. Shown for every non-passing check.
function Explain({ q }: { q: QItem }) {
  const e = explainQuality(q) as { checks: string; reliability: string; fix: string; blocksText: string } | null;
  if (!e) return null;
  return (
    <dl className="ml-28 mt-1 grid grid-cols-[7rem_1fr] gap-x-2 gap-y-0.5 rounded-md border border-border px-2 py-1 text-[11px] text-muted">
      <dt className="font-medium text-foreground">Checks</dt><dd>{e.checks}</dd>
      <dt className="font-medium text-foreground">Reliability</dt><dd>{e.reliability}</dd>
      <dt className="font-medium text-foreground">Recommended fix</dt><dd>{e.fix}</dd>
      <dt className="font-medium text-foreground">Submission</dt><dd>{e.blocksText}</dd>
    </dl>
  );
}
