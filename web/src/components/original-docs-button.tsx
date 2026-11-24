"use client";

// Local customisation (2026-11-10): generate the tailored CV and cover letter in
// the original resume format (data/cv-original/generate.mjs), and show the
// document quality summary. Generating uses Claude once (asks first); "Check
// quality" runs local checks only. Existing documents are reused unless
// "Regenerate" is chosen; submitted applications are never regenerated.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, FileText, ShieldCheck } from "lucide-react";
import { AdditionalInstructionsBox, VersionHistory, useJobInstructions, instructionsLine, generateLabel, regenerateScope, scopeWhat, type JobInstructions, type DocVersion } from "@/components/additional-instructions";
import { QualityPanel, withCompliance, type QItem } from "@/components/quality-panel";
import { CostBadge } from "@/components/cost/cost-badge";

// 2026-11-15: the "My Instructions" panel and the separate Revise box were
// replaced by one "Additional Instructions (Optional)" box above Generate.
export type DocsPanelData = {
  jobKey: string;
  instructions: JobInstructions;
  versions: DocVersion[];
  /** A separate draft can be tailored (an evaluation report or a saved posting exists). */
  canDraft: boolean;
  /** The saved instructions checked now against the linked documents, when the last record did not. */
  compliance?: QItem | null;
};
type Change = { group: string; change: string; from: string | null; to: string | null; added?: string[]; resolved?: string[] };
type Result = { ok: boolean; revised?: string | null; reused?: boolean; recheck?: boolean; saved?: string | null; checkerVersion?: string; previous?: { at?: string | null; verdict?: string | null } | null; changes?: Change[]; cv?: string; cover?: string | null; warnings?: string[]; reviewNotes?: string[]; keywords?: string[]; quality?: QItem[]; error?: string };

export function OriginalDocsButton({ n, hasReport, hasDocs, hasCover = false, confidential, lastQuality = null, panel = null, applied = false, generator = "" }: { n: string; hasReport: boolean; hasDocs: boolean; hasCover?: boolean; confidential: boolean; lastQuality?: unknown; panel?: DocsPanelData | null; applied?: boolean; generator?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"" | "gen" | "check">("");
  const [res, setRes] = useState<Result | null>(null);
  const ctl = useJobInstructions(panel?.jobKey ?? `t${n}`, panel?.instructions ?? { text: "", target: "both", updatedAt: null });
  // An application already submitted can still get a separate draft (never linked).
  const canGenerate = hasReport || (applied && Boolean(panel?.canDraft));
  if (!canGenerate) return <p className="text-xs text-muted">Evaluate this job first; documents are tailored from its report.</p>;
  const saved = lastQuality as { quality?: QItem[]; generatedAt?: string; reviewNotes?: string[]; generator?: string; recheck?: { checkedAt?: string; checkerVersion?: string; changes?: Change[]; previous?: { at?: string | null; verdict?: string | null } | null } } | null;
  // Documents made before the current rules: either no quality record at all
  // (the 2026-11-09 pipeline) or a record from an older generator version.
  // Only for jobs with a report: those are the ones Check quality can re-test.
  const olderRules = hasReport && hasDocs && (!saved || saved.generator !== generator);

  const call = async (body: Record<string, unknown>, kind: "gen" | "check") => {
    setBusy(kind);
    setRes(null);
    try {
      const r = await fetch("/api/original-docs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ n, ...body }) });
      setRes(await r.json().catch(() => ({ ok: false, error: "no response" })));
      router.refresh();
    } finally {
      setBusy("");
    }
  };
  const generate = async () => {
    if (busy) return;
    let instr: JobInstructions;
    try { instr = await ctl.flush(); } catch (e) { setRes({ ok: false, error: e instanceof Error ? e.message : "Your instructions could not be saved; nothing was generated." }); return; }
    // With documents already made, only the chosen document is redrafted (from the
    // current version); the other is kept exactly as it is. Both, with nothing
    // typed, regenerates both fresh as before.
    const scope = regenerateScope(instr.target, { hasCover, confidential });
    const revise = hasDocs && (scope !== "both" || instr.text.trim()) ? scope : null;
    const what = scopeWhat(hasDocs ? scope : confidential ? "cv" : "both", hasDocs, confidential);
    const where = applied ? "\n\nThis application is marked as submitted, so the submitted documents are not touched: the new version is saved separately in \"Drafts after submission\"." : hasDocs ? "\n\nNew versions are saved next to the existing ones; nothing is overwritten." : "";
    if (!window.confirm(`Create ${what} in your original resume format?\n\nThis uses Claude once (about 85,000 tokens): it analyses the job description, picks your most relevant verified experience and drafts the documents. Every line is then checked on this computer against cv.md. Nothing is sent or submitted.${where}${instructionsLine(instr)}`)) return;
    call({ cover: !confidential, force: hasDocs && !revise, ...(revise ? { revise } : {}), ...(applied ? { draft: true } : {}) }, "gen");
  };

  const shown = res?.quality ?? (res ? null : withCompliance(saved?.quality, panel?.compliance));
  return (
    <div className="mt-3 rounded-2xl border border-border bg-white px-4 py-3">
      <AdditionalInstructionsBox ctl={ctl} jobKey={panel?.jobKey ?? `t${n}`} noCover={confidential} />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" disabled={!!busy} onClick={generate} className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-1.5 text-sm font-medium text-brand-foreground disabled:opacity-60">
          {busy === "gen" ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
          {busy === "gen" ? "Analysing, drafting and checking… (2 to 4 min)" : generateLabel(ctl.value.target, { hasDocs, hasCover, confidential, applied })}
        </button>
        <CostBadge kind="spend" size="xs" />
        {hasDocs && hasReport && (
          <button type="button" disabled={!!busy} onClick={() => call({ recheck: true }, "check")} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:border-brand hover:text-brand disabled:opacity-60" title="Re-runs the local checks on the current documents. No Claude call.">
            {busy === "check" ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />} Check quality
          </button>
        )}
        {hasDocs && hasReport && <CostBadge kind="free" size="xs" />}
      </div>
      {olderRules && !res && (
        <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
          {saved ? "These documents were checked under earlier rules." : "These documents were made by an earlier version of the generator, before the current checks existed."} Press <b>Check quality</b> (free, no Claude) to test them against the current standards{applied ? "." : ", or Regenerate to apply them."}
        </p>
      )}
      {applied && <p className="mt-1.5 text-xs text-muted">This application is marked as submitted, so its documents are kept exactly as sent. A new draft is saved separately in &ldquo;Drafts after submission&rdquo; and never replaces them.</p>}
      <p className="mt-1.5 text-xs text-muted">Original two-page format · lines tailored and reordered within each role · every claim checked against cv.md · PDF text checked for ATS readability</p>
      {res && (
        <div className="mt-2 text-xs">
          {res.ok ? (
            <p className="text-emerald-800">{res.recheck ? "Checked the current documents (no Claude call)." : res.reused ? "Existing documents kept (no Claude call)." : (res as { separateDraft?: boolean }).separateDraft ? "New draft created and checked. It is saved separately; the submitted documents are unchanged (see All versions below)." : res.revised ? "New version created and checked. It is now the linked one; the earlier version is kept below." : "Created and checked. Open them with View tailored CV / View cover above."}</p>
          ) : (
            <p className="text-rose-700">Not created: {res.error}</p>
          )}
          {res.recheck && <RecheckChanges saved={res.saved} version={res.checkerVersion} previous={res.previous} changes={res.changes} />}
          {!!res.reviewNotes?.length && <ul className="mt-1 list-disc pl-5 text-foreground"><li className="list-none font-medium">Check before sending:</li>{res.reviewNotes.map((w) => <li key={w}>{w}</li>)}</ul>}
        </div>
      )}
      {!res && !!saved?.reviewNotes?.length && <ul className="mt-2 list-disc pl-5 text-xs text-foreground"><li className="list-none font-medium">Check before sending:</li>{saved.reviewNotes.map((w) => <li key={w}>{w}</li>)}</ul>}
      {!res && saved?.recheck && <div className="mt-2 text-xs"><RecheckChanges saved={null} version={saved.recheck.checkerVersion} previous={saved.recheck.previous} changes={saved.recheck.changes} at={saved.recheck.checkedAt} /></div>}
      {shown && <QualityPanel items={shown} when={!res && saved?.recheck?.checkedAt ? `rechecked ${saved.recheck.checkedAt.slice(0, 10)}` : !res && saved?.generatedAt ? `saved ${saved.generatedAt.slice(0, 10)}` : undefined} jobKey={panel?.jobKey ?? `t${n}`} applied={applied} />}
      {!!panel?.versions.length && <VersionHistory versions={panel.versions} />}
    </div>
  );
}

// What a free recheck changed compared with the previous record (2026-11-22).
function RecheckChanges({ saved, version, previous, changes, at }: { saved?: string | null; version?: string; previous?: { at?: string | null; verdict?: string | null } | null; changes?: Change[]; at?: string }) {
  const list = changes ?? [];
  return (
    <details className="mt-1 rounded-md border border-border px-2 py-1 text-foreground" open={list.some((c) => c.change === "status")}>
      <summary className="cursor-pointer font-medium">
        {at ? `Last recheck ${at.slice(0, 16).replace("T", " ")}` : "Recheck saved"}{version ? ` · checker ${version}` : ""}
        {previous?.at ? ` · compared with ${previous.at.slice(0, 10)} (${previous.verdict ?? "no verdict"})` : ""}
        {` · ${list.length ? `${list.length} change${list.length === 1 ? "" : "s"}` : "no changes"}`}
      </summary>
      {saved && <p className="mt-1 text-muted-foreground">Saved as a new record: {saved}. Earlier records and the PDFs are unchanged.</p>}
      {!!list.length && <ul className="mt-1 list-disc pl-5">{list.map((c) => (
        <li key={c.group}>
          <span className="font-medium">{c.group}</span>: {c.change === "status" ? `${c.from} → ${c.to}` : c.change === "details" ? `details changed (still ${c.to})` : `${c.change}${c.to ? ` (${c.to})` : ""}`}
          {!!c.resolved?.length && <ul className="list-disc pl-5 text-emerald-800">{c.resolved.slice(0, 5).map((x) => <li key={x}>No longer reported: {x}</li>)}</ul>}
          {!!c.added?.length && <ul className="list-disc pl-5 text-amber-800">{c.added.slice(0, 5).map((x) => <li key={x}>New: {x}</li>)}</ul>}
        </li>
      ))}</ul>}
    </details>
  );
}
