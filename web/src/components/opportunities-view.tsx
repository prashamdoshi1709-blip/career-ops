"use client";

// Local customisation (2026-11-10): All Job Opportunities.
// Everything here is client-side filtering of data the server read from files:
// no Claude call happens unless the user presses an "Evaluate" button.

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronsUpDown, Download, ExternalLink, FileText, Search, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { PageFrame } from "@/components/page-frame";
import { CostBadge } from "@/components/cost/cost-badge";
import { useJobs } from "@/components/jobs/job-store";
import { ManualJobDialog } from "@/components/manual-job-dialog";
import { JobStatusControl } from "@/components/job-status-control";
import { EvalQueuePanel } from "@/components/eval-queue-panel";
import { StatePill, STATE_LABEL, fileHref, type DocInfo } from "@/components/doc-links";

type Source = { label: string; url: string };
export type Opportunity = {
  key: string; n: string | null; kind: "tracked" | "inbox";
  company: string; title: string; location: string; category: string;
  score: number | null; ratingType: "Detailed" | "Preliminary" | "Pending"; confidence: string;
  sources: Source[]; url: string; applyUrl: string;
  posted: string; deadline: string; lastVerified: string; verified: boolean; availability: string;
  stage: string; status: string; cv: boolean; cover: boolean; docN: string | null; reason: string; docKey?: string;
  /** Employer prestige, shown apart from suitability (never changes the score). */
  appeal?: string | null;
};
type Coverage = { name: string; method: string; attempted: string; success: string; status: string; discovered: number | null; retained: number; duplicates: number; note: string };
type Run = { at: string; status: string; found: number; added: number; errors: number; filteredLocation: number; dupes: number } | null;

const CONSULTING = ["Commercial Due Diligence", "Strategy Consulting", "Management Consulting", "Corporate Strategy", "Performance Improvement", "Business Transformation"];
const STAGES = ["New", "Under Review", "Ready to Apply", "Applied", "Interview", "Offer", "Rejected", "Closed"];
const STAGE_TONE: Record<string, string> = {
  New: "border-slate-300 bg-white text-slate-700",
  "Under Review": "border-amber-300 bg-amber-50 text-amber-800",
  "Ready to Apply": "border-emerald-300 bg-emerald-50 text-emerald-800",
  Applied: "border-blue-300 bg-blue-50 text-blue-800",
  Interview: "border-violet-300 bg-violet-50 text-violet-800",
  Offer: "border-emerald-400 bg-emerald-100 text-emerald-900",
  Rejected: "border-rose-300 bg-rose-50 text-rose-800",
  Closed: "border-slate-200 bg-slate-50 text-slate-500",
};
const STATUS_TONE: Record<string, string> = {
  Working: "text-emerald-700", Partial: "text-amber-700", Restricted: "text-slate-600", Failed: "text-rose-700", "Not Configured": "text-slate-500",
};

// A date string a few characters long, or "~2026-11-02" / "before 2026-10-10": the ISO day inside it.
const isoIn = (s: string) => (s.match(/\d{4}-\d{2}-\d{2}/) ?? [""])[0];
// Deadline in "13/11/2026" or ISO form → ISO day, else "".
const deadlineIso = (s: string) => {
  const iso = isoIn(s);
  if (iso) return iso;
  const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : "";
};
const daysFrom = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const band = (s: number | null) => (s == null ? "Rating Pending" : s >= 9 ? "Exceptional" : s >= 8 ? "Strong" : s >= 7 ? "Good" : s >= 6 ? "Partial" : "Lower priority");
const scoreTone = (s: number | null) => (s == null ? "text-slate-500" : s >= 8 ? "text-emerald-700" : s >= 7 ? "text-blue-800" : s >= 6 ? "text-amber-700" : "text-slate-500");
const cityOf = (loc: string) => (loc.match(/Sydney|Melbourne|Brisbane|Perth|Adelaide|Canberra|Hobart|Darwin|Gold Coast|National|Australia/i)?.[0] ?? "Other");

type SortKey = "score" | "company" | "title" | "location" | "posted" | "deadline" | "lastVerified" | "stage";

type Filters = {
  q: string; category: string; city: string; minScore: string; ratingType: string; posted: string;
  deadline: string; source: string; stage: string; verified: string; notApplied: boolean; docState: string;
};
const EMPTY: Filters = { q: "", category: "", city: "", minScore: "", ratingType: "", posted: "", deadline: "", source: "", stage: "", verified: "", notApplied: false, docState: "" };

const PRESETS: { label: string; f: Partial<Filters> }[] = [
  { label: "IB & M&A in Sydney, 8+", f: { category: "Investment Banking & M&A", city: "Sydney", minScore: "8" } },
  { label: "Financial Analyst, last 7 days", f: { category: "Financial Analyst & FP&A", posted: "7" } },
  { label: "Equity Research", f: { category: "Equity Research" } },
  { label: "Consulting & strategy", f: { category: "consulting" } },
  { label: "Closing this week, not applied", f: { deadline: "7", notApplied: true } },
  { label: "Posted today", f: { posted: "0" } },
  { label: "Last 7 days", f: { posted: "7" } },
  { label: "Last 14 days", f: { posted: "14" } },
  { label: "Last 30 days", f: { posted: "30" } },
  { label: "Recently verified", f: { verified: "recent" } },
  { label: "Needs verification", f: { verified: "no" } },
];

export function OpportunitiesView({
  jobs, duplicatesRemoved, today, categories, coverage, lastRun, hidden = [], docs = {},
}: {
  docs?: Record<string, DocInfo>;
  hidden?: { company: string; title: string; location: string; url: string; reason: string }[];
  jobs: Opportunity[]; duplicatesRemoved: number; today: string; categories: string[]; coverage: Coverage[]; lastRun: Run;
}) {
  const [f, setF] = useState<Filters>(EMPTY);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "score", dir: -1 });
  const { startJob } = useJobs();
  const set = (patch: Partial<Filters>) => setF((cur) => ({ ...cur, ...patch }));

  const sources = useMemo(() => [...new Set(jobs.flatMap((j) => j.sources.map((s) => (s.label.startsWith("Employer") ? "Employer site" : s.label))))].sort(), [jobs]);
  const cities = useMemo(() => [...new Set(jobs.map((j) => cityOf(j.location)))].sort(), [jobs]);

  const shown = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    const out = jobs.filter((j) => {
      if (q && !`${j.company} ${j.title} ${j.location}`.toLowerCase().includes(q)) return false;
      if (f.category === "consulting" ? !CONSULTING.includes(j.category) : f.category && j.category !== f.category) return false;
      if (f.city && cityOf(j.location) !== f.city) return false;
      if (f.minScore && (j.score == null || j.score < Number(f.minScore))) return false;
      if (f.ratingType && j.ratingType !== f.ratingType) return false;
      if (f.posted) {
        const p = isoIn(j.posted);
        if (!p || daysFrom(p, today) > Number(f.posted)) return false;
      }
      if (f.deadline) {
        const d = deadlineIso(j.deadline);
        if (!d) return false;
        if (f.deadline !== "any" && (daysFrom(today, d) < 0 || daysFrom(today, d) > Number(f.deadline))) return false;
      }
      if (f.source && !j.sources.some((s) => (s.label.startsWith("Employer") ? "Employer site" : s.label) === f.source)) return false;
      if (f.stage && j.stage !== f.stage) return false;
      if (f.verified === "yes" && !j.verified) return false;
      if (f.verified === "no" && j.verified) return false;
      if (f.verified === "recent" && (!j.lastVerified || daysFrom(isoIn(j.lastVerified), today) > 3)) return false;
      if (f.notApplied && ["Applied", "Interview", "Offer", "Rejected", "Closed"].includes(j.stage)) return false;
      if (f.docState && (docs[j.docKey ?? ""]?.state ?? "not-generated") !== f.docState) return false;
      return true;
    });
    const val = (j: Opportunity): string | number => {
      switch (sort.key) {
        case "score": return j.score ?? -1;
        case "posted": return isoIn(j.posted) || "";
        case "deadline": return deadlineIso(j.deadline) || "9999";
        case "lastVerified": return j.lastVerified || "";
        case "stage": return STAGES.indexOf(j.stage);
        default: return String(j[sort.key] ?? "").toLowerCase();
      }
    };
    return out.sort((a, b) => {
      const x = val(a), y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir || (b.score ?? -1) - (a.score ?? -1);
    });
  }, [jobs, f, sort, today]);

  const count = (pred: (j: Opportunity) => boolean) => jobs.filter(pred).length;
  const active = Object.entries(f).some(([k, v]) => (k === "notApplied" ? v : v !== ""));

  const Th = ({ k, label, className }: { k: SortKey; label: string; className?: string }) => (
    <th className={cn("whitespace-nowrap px-3 py-2.5 font-medium", className)} aria-sort={sort.key === k ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-foreground" onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? (s.dir === 1 ? -1 : 1) : k === "score" || k === "posted" || k === "lastVerified" ? -1 : 1 }))}>
        {label}
        <ChevronsUpDown aria-hidden="true" className="size-3" />
      </button>
    </th>
  );
  const sel = "rounded-lg border border-border bg-white px-2.5 py-1.5 text-sm text-foreground focus:border-brand focus:outline-none";

  return (
    <PageFrame className="max-w-[1600px]">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl tracking-tight text-landing">All Job Opportunities</h1>
          <p className="mt-1 text-sm text-muted">
            {jobs.length} Australian roles · {count((j) => j.ratingType === "Detailed")} detailed ratings · {count((j) => j.ratingType === "Preliminary")} preliminary · {count((j) => j.ratingType === "Pending")} pending · {count((j) => !j.verified && j.availability !== "Closed")} need verification · {duplicatesRemoved} duplicates merged
          </p>
        </div>
        <div className="flex flex-col items-end gap-2 text-right text-xs text-muted">
          <ManualJobDialog />
          <div>
          {lastRun ? <p>Last scan {lastRun.at.slice(0, 16).replace("T", " ")} UTC · {lastRun.added} new · {lastRun.errors} source error{lastRun.errors === 1 ? "" : "s"}</p> : <p>No scan recorded yet</p>}
          <Link href="/scheduled-scans" className="mt-1 inline-flex items-center gap-1 font-medium text-brand hover:underline">Run a fresh search (Scheduled scans → Run now) <ExternalLink className="size-3" /></Link>
          </div>
        </div>
      </header>

      <EvalQueuePanel awaiting={jobs.filter((j) => j.kind === "inbox").length} />
      <p className="mt-3 rounded-xl border border-border bg-surface-hover/60 px-3 py-2 text-xs text-muted">
        <b className="text-foreground">Suitability</b> is how well a role fits your goals and experience (out of 10), not the chance of an interview.{" "}
        <b className="text-foreground">Detailed</b> ratings come from a full evaluation report. <b className="text-foreground">Preliminary</b> ratings are calculated on this computer from the title and location, with no Claude call, and are capped at 8.0 until the job description is read.{" "}
        <b className="text-foreground">Rating Pending</b> means there is not enough information for a defensible score. A firm&apos;s <b className="text-foreground">career appeal</b> is shown under its name and never raises the score.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button key={p.label} type="button" onClick={() => setF({ ...EMPTY, ...p.f })} className="rounded-full border border-border bg-white px-3 py-1 text-xs font-medium text-foreground transition-colors hover:border-brand hover:text-brand">
            {p.label}
          </button>
        ))}
        {active && (
          <button type="button" onClick={() => setF(EMPTY)} className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium text-brand hover:underline">
            <X className="size-3" /> Clear filters
          </button>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <input value={f.q} onChange={(e) => set({ q: e.target.value })} placeholder="Company, title or location" aria-label="Search" className={cn(sel, "w-64 pl-8")} />
        </label>
        <select aria-label="Category" className={sel} value={f.category} onChange={(e) => set({ category: e.target.value })}>
          <option value="">All categories</option>
          <option value="consulting">All consulting and strategy</option>
          {categories.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select aria-label="Location" className={sel} value={f.city} onChange={(e) => set({ city: e.target.value })}>
          <option value="">All locations</option>
          {cities.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select aria-label="Minimum suitability" className={sel} value={f.minScore} onChange={(e) => set({ minScore: e.target.value })}>
          <option value="">Any rating</option>
          {["9", "8", "7", "6"].map((s) => <option key={s} value={s}>{s}/10 or above</option>)}
        </select>
        <select aria-label="Rating type" className={sel} value={f.ratingType} onChange={(e) => set({ ratingType: e.target.value })}>
          <option value="">Detailed, preliminary or pending</option>
          <option>Detailed</option><option>Preliminary</option><option>Pending</option>
        </select>
        <select aria-label="Posted within" className={sel} value={f.posted} onChange={(e) => set({ posted: e.target.value })}>
          <option value="">Any posting date</option>
          <option value="0">Posted today</option><option value="7">Within 7 days</option><option value="14">Within 14 days</option><option value="30">Within 30 days</option>
        </select>
        <select aria-label="Deadline" className={sel} value={f.deadline} onChange={(e) => set({ deadline: e.target.value })}>
          <option value="">Any deadline</option>
          <option value="7">Closing within 7 days</option><option value="14">Closing within 14 days</option><option value="any">Has a deadline</option>
        </select>
        <select aria-label="Source" className={sel} value={f.source} onChange={(e) => set({ source: e.target.value })}>
          <option value="">All sources</option>
          {sources.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select aria-label="Application stage" className={sel} value={f.stage} onChange={(e) => set({ stage: e.target.value })}>
          <option value="">All stages</option>
          {STAGES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select aria-label="Document status" className={sel} value={f.docState} onChange={(e) => set({ docState: e.target.value })}>
          <option value="">Any document status</option>
          {Object.entries(STATE_LABEL).map(([k, l]) => <option key={k} value={k}>Documents: {l}</option>)}
        </select>
        <select aria-label="Verification" className={sel} value={f.verified} onChange={(e) => set({ verified: e.target.value })}>
          <option value="">Verified and unverified</option>
          <option value="yes">Verified only</option><option value="no">Needs verification</option><option value="recent">Verified in last 3 days</option>
        </select>
        <label className="inline-flex items-center gap-1.5 text-sm text-foreground">
          <input type="checkbox" checked={f.notApplied} onChange={(e) => set({ notApplied: e.target.checked })} /> Not applied yet
        </label>
      </div>

      <p className="mt-3 text-xs text-muted">{shown.length} of {jobs.length} shown</p>

      <div className="mt-2 overflow-x-auto rounded-2xl border border-border bg-white">
        <table className="w-full min-w-[84rem] text-sm">
          <thead className="border-b border-border bg-surface-hover/50 text-left text-xs uppercase tracking-wide text-faint">
            <tr>
              <Th k="company" label="Company" />
              <Th k="title" label="Job title" />
              <Th k="location" label="Location" />
              <Th k="posted" label="Posted" />
              <Th k="deadline" label="Deadline" />
              <Th k="score" label="Suitability" />
              <Th k="stage" label="Application status" />
              <th className="px-3 py-2.5 font-medium">Availability</th>
              <th className="px-3 py-2.5 font-medium" title="This job's own tailored CV">CV</th>
              <th className="px-3 py-2.5 font-medium" title="This job's own tailored cover letter">Cover letter</th>
              <th className="px-3 py-2.5 font-medium">Review</th>
              <th className="px-3 py-2.5 font-medium">Posting</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {shown.map((j) => {
              const detail = j.n ? `/opportunities/${encodeURIComponent(j.n)}` : null;
              return (
                <tr key={j.key} className="align-top hover:bg-surface-hover/40">
                  <td className="px-3 py-3 font-medium text-foreground">{j.company}{j.appeal && <div className="mt-1 text-[11px] font-normal text-faint" title="Career appeal is separate from suitability and does not change the score">{j.appeal}</div>}</td>
                  <td className="max-w-[22rem] px-3 py-3">
                    <Link href={detail ?? `/opportunities/${j.docKey}`} className="font-medium text-brand hover:underline">{j.title}</Link>
                    <div className="mt-0.5 text-[11px] text-faint">{(j as { priorityTier?: number }).priorityTier ? `Priority ${(j as { priorityTier?: number }).priorityTier} · ` : ""}{j.category}</div>
                  </td>
                  <td className="px-3 py-3 text-muted">{j.location || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-xs tabular-nums text-muted">{j.posted || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-xs tabular-nums">{j.deadline ? <span className="font-medium text-amber-800">{j.deadline}</span> : <span className="text-faint">—</span>}</td>
                  <td className="whitespace-nowrap px-3 py-3">
                    <div className={cn("text-base font-semibold tabular-nums", scoreTone(j.score))}>{j.score == null ? "Pending" : `${j.score.toFixed(1)}/10`}</div>
                    <div className="text-[11px] text-faint">{j.score == null ? "Pending evaluation" : `${j.ratingType}${j.confidence !== "—" ? ` · ${j.confidence} confidence` : ""}`}</div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3"><JobStatusControl job={j} docsReady={docs[j.docKey ?? ""]?.state === "ready"} /></td>
                  <td className="whitespace-nowrap px-3 py-3 text-xs">
                    <span className={cn("font-medium", j.availability === "Open" ? "text-emerald-700" : j.availability === "Closed" ? "text-slate-500" : "text-amber-700")}>{j.availability}</span>
                  </td>
                  {(() => {
                    // 2026-11-11: each job's OWN indexed documents only (never a fallback file).
                    const d = docs[j.docKey ?? ""];
                    const cell = (rel: string | null | undefined, label: string, applies: boolean) => (
                      <td className="whitespace-nowrap px-3 py-3 text-xs">
                        {!applies ? <span className="text-faint" title="No cover letter until the employer is named">—</span>
                          : rel ? (
                            <span className="inline-flex items-center gap-1.5">
                              <a href={fileHref(rel)} target="_blank" rel="noreferrer" title={`View the ${label} for ${j.company}`} aria-label={`View ${label}`} className="rounded p-0.5 text-brand hover:bg-brand/10"><FileText className="size-4" /></a>
                              <a href={fileHref(rel, true)} title={`Download the ${label} for ${j.company}`} aria-label={`Download ${label}`} className="rounded p-0.5 text-brand hover:bg-brand/10"><Download className="size-4" /></a>
                              {d && d.state !== "ready" && <StatePill info={d} />}
                            </span>
                          ) : d ? <StatePill info={d} /> : <span className="text-faint">—</span>}
                      </td>
                    );
                    return (<>{cell(d?.cv, "CV", true)}{cell(d?.cover, "cover letter", d?.needCover ?? true)}</>);
                  })()}
                  <td className="whitespace-nowrap px-3 py-3">
                    <Link href={j.n ? `/opportunities/${encodeURIComponent(j.n)}` : `/opportunities/${j.docKey}`} className="inline-flex items-center gap-1 rounded-full bg-brand px-3 py-1 text-xs font-medium text-brand-foreground hover:opacity-90">Review</Link>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-xs">
                    {j.url ? <a href={j.applyUrl || j.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-brand hover:underline" title={j.applyUrl ? "The employer's application page" : `Listed on ${j.sources[0]?.label ?? "a job board"}; confirm at the employer before applying`}>Open <ExternalLink className="size-3" /></a> : <span className="text-faint">—</span>}
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr><td colSpan={12} className="px-4 py-10 text-center text-sm text-muted">No roles match these filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {hidden.length > 0 && (
        <details className="mt-6 rounded-2xl border border-border bg-white px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-foreground">
            {hidden.length} discovered role{hidden.length === 1 ? "" : "s"} hidden as outside your field (sales, business development, marketing, general graduate schemes, senior leadership)
          </summary>
          <p className="mt-1 text-xs text-muted">Hidden by function, not by single words: business development roles with M&A, origination or capital markets work stay in the list. Nothing here was deleted.</p>
          <ul className="mt-2 space-y-1 text-sm">
            {hidden.map((h) => (
              <li key={h.url}>
                <a href={h.url} target="_blank" rel="noreferrer" className="text-brand hover:underline">{h.company}, {h.title}</a>
                <span className="text-muted"> · {h.location || "—"} · </span><span className="text-faint">{h.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <section id="coverage" className="mt-10">
        <h2 className="font-display text-xl text-landing">Search Coverage</h2>
        <p className="mt-1 text-sm text-muted">
          Where Career-Ops looks for jobs and how the last attempts went. This is not every job in Australia: restricted sites are only searched through their public pages, with each find confirmed at the employer.
          {lastRun && <> Last run found {lastRun.found.toLocaleString()} listings in total, filtered {lastRun.filteredLocation} non-Australian ones and skipped {lastRun.dupes} already-seen links.</>}
        </p>
        <div className="mt-3 overflow-x-auto rounded-2xl border border-border bg-white">
          <table className="w-full min-w-[72rem] text-sm">
            <thead className="border-b border-border bg-surface-hover/50 text-left text-xs uppercase tracking-wide text-faint">
              <tr>
                {["Source", "Search method", "Last attempted", "Last successful", "Status", "Listings seen", "Relevant kept", "Duplicates merged", "Errors or restrictions"].map((h) => <th key={h} className="whitespace-nowrap px-3 py-2.5 font-medium">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {coverage.map((c) => (
                <tr key={c.name}>
                  <td className="px-3 py-2 font-medium text-foreground">{c.name}</td>
                  <td className="px-3 py-2 text-xs text-muted">{c.method}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums text-muted">{c.attempted ? c.attempted.slice(0, 16).replace("T", " ") : "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums text-muted">{c.success ? c.success.slice(0, 16).replace("T", " ") : "—"}</td>
                  <td className={cn("whitespace-nowrap px-3 py-2 text-xs font-semibold", STATUS_TONE[c.status])}>{c.status}</td>
                  <td className="px-3 py-2 text-xs tabular-nums text-muted">{c.discovered == null ? "—" : c.discovered.toLocaleString()}</td>
                  <td className="px-3 py-2 text-xs tabular-nums text-muted">{c.retained}</td>
                  <td className="px-3 py-2 text-xs tabular-nums text-muted">{c.duplicates}</td>
                  <td className="px-3 py-2 text-xs text-muted">{c.note || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-faint">Times are UTC (add 11 hours for Sydney daylight time).</p>
      </section>
    </PageFrame>
  );
}
