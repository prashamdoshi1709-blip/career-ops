"use client";

// Local customisation (2026-11-15): "Additional Instructions (Optional)" for one
// job, shown directly above Generate CV + Cover Letter, and the list of every
// saved version with the instructions it used. Typing saves to
// data/job-instructions.json (a file write, never a Claude call); nothing is
// generated until the Generate button is pressed.

import { useCallback, useEffect, useRef, useState } from "react";

export type JobInstructions = { text: string; target: "both" | "cv" | "cover"; updatedAt: string | null };
export type DocVersion = { file: string; name: string; kind: string; at: number; current: boolean; draft: boolean; version: number | null; verdict: string | null; check: string; instructions: { text: string; target: string } | null; revisedOnly: string | null };

export const TARGET_LABEL: Record<string, string> = { both: "Both CV and Cover Letter", cv: "CV only", cover: "Cover Letter only" };

/** State of one job's instructions, saved automatically shortly after typing stops. */
export function useJobInstructions(jobKey: string, initial: JobInstructions) {
  const [value, setValue] = useState<JobInstructions>(initial);
  const [saved, setSaved] = useState<JobInstructions>(initial);
  const [status, setStatus] = useState<"" | "saving" | "saved" | "error">("");
  const latest = useRef(value);
  latest.current = value;
  const dirty = value.text.trim() !== saved.text.trim() || (value.target !== saved.target && Boolean(value.text.trim() || saved.text.trim()));

  const saveNow = useCallback(async (): Promise<JobInstructions> => {
    const v = latest.current;
    setStatus("saving");
    try {
      const r = await fetch("/api/job-instructions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: jobKey, text: v.text, target: v.target }) });
      const d = await r.json().catch(() => ({ ok: false }));
      if (!d.ok) { setStatus("error"); throw new Error(d.error ?? "Your instructions could not be saved."); }
      const s = { text: d.instructions.text, target: d.instructions.target, updatedAt: d.instructions.updatedAt } as JobInstructions;
      setSaved(s);
      setStatus("saved");
      return s;
    } catch (e) {
      setStatus("error");
      throw e;
    }
  }, [jobKey]);

  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => { saveNow().catch(() => {}); }, 800);
    return () => clearTimeout(t);
  }, [value, dirty, saveNow]);

  /** Save any pending change first; returns what the generator will read. */
  const flush = useCallback(async () => (dirty ? saveNow() : saved), [dirty, saveNow, saved]);
  return { value, setValue, saved, status, dirty, flush };
}

export type InstructionsControl = ReturnType<typeof useJobInstructions>;

/** One line for a confirmation dialog. */
export function instructionsLine(v: JobInstructions) {
  return v.text.trim() ? `\n\nYour additional instructions will be used for: ${TARGET_LABEL[v.target]}. Facts are still checked against your CV; anything unsupported is not added.` : "";
}

export function AdditionalInstructionsBox({ ctl, jobKey, noCover = false }: { ctl: InstructionsControl; jobKey: string; noCover?: boolean }) {
  const { value, setValue, status, dirty } = ctl;
  const [focus, setFocus] = useState(false);
  const tall = focus || value.text.length > 0;
  return (
    <div className="mt-3">
      <label htmlFor={`ai-${jobKey}`} className="text-xs font-medium text-foreground">Additional Instructions (Optional)</label>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted" role="radiogroup" aria-label="Apply instructions to">
        <span>Apply instructions to:</span>
        {(["both", "cv", "cover"] as const).map((t) => (
          <label key={t} className={`inline-flex items-center gap-1 ${noCover && t !== "cv" ? "opacity-50" : ""}`} title={noCover && t !== "cv" ? "No cover letter is written until the employer is named" : undefined}>
            <input type="radio" name={`ai-target-${jobKey}`} checked={value.target === t} disabled={noCover && t === "cover"} onChange={() => setValue({ ...value, target: t })} className="accent-[var(--brand)]" />
            {TARGET_LABEL[t]}{t === "both" ? " (default)" : ""}
          </label>
        ))}
      </div>
      <textarea
        id={`ai-${jobKey}`}
        value={value.text}
        onChange={(e) => setValue({ ...value, text: e.target.value })}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        maxLength={4000}
        rows={tall ? 4 : 2}
        className="mt-1.5 w-full resize-y rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground outline-none transition-[height] focus:border-brand"
        placeholder="Optional: Tell Career-Ops what to emphasise, remove or change in your CV or cover letter for this role..."
      />
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-faint">
        <span>Your instructions apply only to this job. Existing formatting and factual checks remain in place.</span>
        <span className="flex items-center gap-2">
          <span aria-live="polite">{status === "saving" || (dirty && status !== "error") ? "Saving…" : status === "error" ? <span className="text-rose-700">Not saved</span> : value.text.trim() ? "Saved" : ""}</span>
          {value.text && <button type="button" onClick={() => setValue({ ...value, text: "" })} className="text-muted hover:text-foreground">Clear</button>}
        </span>
      </div>
    </div>
  );
}

const fmt = (t: number) => new Date(t).toLocaleString("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export function VersionHistory({ versions }: { versions: DocVersion[] }) {
  if (!versions.length) return null;
  return (
    <details className="mt-3 text-xs">
      <summary className="cursor-pointer font-medium text-foreground">All versions ({versions.length})<span className="ml-1 font-normal text-faint">newest first; earlier versions are never overwritten</span></summary>
      <ul className="mt-1.5 space-y-1.5">
        {versions.map((d) => (
          <li key={d.file}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-24 shrink-0 text-faint">{fmt(d.at)}</span>
              <span className="text-foreground">
                {d.kind === "cover" ? "Cover letter" : "CV"}{d.version ? ` · v${d.version}` : ""}
                {d.current && <span className="ml-1 rounded-full bg-emerald-50 px-1.5 text-[10px] font-semibold text-emerald-800">current</span>}
                {d.draft && <span className="ml-1 rounded-full bg-sky-50 px-1.5 text-[10px] font-semibold text-sky-800">draft, not submitted</span>}
              </span>
              <span className="text-muted">Check: {d.check}</span>
              <a className="font-medium text-brand hover:underline" href={`/api/doc-version?file=${encodeURIComponent(d.file)}`} target="_blank" rel="noreferrer">Open</a>
              <a className="font-medium text-brand hover:underline" href={`/api/doc-version?file=${encodeURIComponent(d.file)}&download=1`}>Download</a>
            </div>
            {d.instructions && (
              <p className="mt-0.5 text-muted sm:ml-[6.5rem]">
                Instructions ({TARGET_LABEL[d.instructions.target] ?? d.instructions.target}): <span className="text-foreground">&ldquo;{d.instructions.text.length > 220 ? `${d.instructions.text.slice(0, 220)}…` : d.instructions.text}&rdquo;</span>
              </p>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * Which documents a Regenerate changes (2026-11-15): the chosen target, except
 * that a letter-only run needs a letter to start from and a confidential job has
 * no letter. With nothing typed and Both chosen, both are regenerated fresh.
 */
export function regenerateScope(target: JobInstructions["target"], { hasCover, confidential }: { hasCover: boolean; confidential: boolean }): "cv" | "cover" | "both" {
  if (confidential) return "cv";
  if (target === "cover" && !hasCover) return "both";
  return target;
}
const SCOPE_LABEL = { cv: "CV Only", cover: "Cover Letter Only", both: "CV + Cover Letter" } as const;

/** The Generate button's words, so it is clear which documents change. */
export function generateLabel(target: JobInstructions["target"], { hasDocs, hasCover, confidential, applied = false }: { hasDocs: boolean; hasCover: boolean; confidential: boolean; applied?: boolean }) {
  const scope = regenerateScope(target, { hasCover, confidential });
  if (applied) return `Generate New Draft: ${SCOPE_LABEL[scope]} (submitted documents kept)`;
  if (!hasDocs) return confidential ? "Generate CV" : "Generate CV + Cover Letter";
  return `Regenerate ${SCOPE_LABEL[scope]}`;
}

/** The confirmation wording for that scope. */
export function scopeWhat(scope: "cv" | "cover" | "both", hasDocs: boolean, confidential = false) {
  if (scope === "cv") return confidential && !hasDocs ? "a tailored CV (no cover letter until the employer is named)" : "a new version of the CV only (the cover letter stays exactly as it is)";
  if (scope === "cover") return "a new version of the cover letter only (the CV stays exactly as it is)";
  return hasDocs ? "a new version of the tailored CV and cover letter" : "a tailored CV and cover letter";
}
