"use client";

// Discovery coverage (2026-11-22): how much of the directory has been checked,
// what is left, why postings were rejected in the last run, and how the
// tracked employers and job boards are doing. Figures that were never
// recorded show as "not recorded", never as zero.
import { useCallback, useEffect, useState } from "react";

type SourceRow = { source: string; available: number | null; retired: number; unusable?: number; rateLimitedPending?: number; neverAttempted?: number | null; checked: number; checked30d: number; remaining: number | null; percent: number | null; australianEmployers: number; lastRun: string | null };
type Latest = { at: string; mode: string; companiesChecked: number | null; successful: number | null; failed: number | null; rateLimited: number | null; deferred: number | null; retrieved: number | null; matching: number | null; newUnique: number | null; added: number | null; duplicates: number | null };
type Analytics = { key: string; label: string; latest: Latest | null; lastSuccess: string | null; runsRecorded: number; latestYieldPer100: number | null; added30d: number; relevant30d: number; addedAll: number; relevantAll: number; relevantShare30d: number | null };
type Circuit = { key: string; state: string; cooldownUntil: string | null; strikes: number; lastLimitedAt: string | null; lastOkAt: string | null };
type Funnel = Partial<Record<"deferredRateLimit" | "boardsReached" | "boardsWithPostings" | "postingsSeen" | "postingsListedOnly" | "rejectedDate" | "rejectedUndated" | "rejectedTitle" | "rejectedLocation" | "rejectedContent" | "duplicates" | "matched" | "rateLimited" | "failed" | "notReachedThisRun", number>>;
type RunSummary = { at: string; mode: string; sources: string[]; companiesScanned: number | null; budgetStopped: boolean; funnel: Funnel | null; postingsKept: number | null; deferredRateLimit?: number };
type Coverage = {
  totals: { available: number; unusable?: number; retired: number; checked: number; checked30d: number; remaining: number; rateLimitedPending?: number; australianEmployers: number };
  analytics?: Analytics[];
  circuits?: Circuit[];
  sources: SourceRow[];
  lastRun: RunSummary | null;
  lastSweep?: RunSummary | null;
  lastExplore?: RunSummary | null;
  runsRecorded: number;
  canResume: boolean;
  recruiters?: { name: string; url: string | null; method: string | null; enabled: boolean; lastChecked: string | null; lastStatus: string | null; retrieved: number | null; lastSuccess: string | null; state: string; addedTotal: number; added30d: number }[];
  tracked: { portals: number; counts: Record<string, number>; lastSuccess: string | null; finds: { total: number; recent: number; days: number; bySource: Record<string, number> } };
};

const LABEL: Record<string, string> = { greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby", workday: "Workday" };
const n = (v: number | null | undefined) => (v == null ? "not recorded" : v.toLocaleString());
const when = (iso: string | null) => (iso ? iso.slice(0, 16).replace("T", " ") : "never");

export function CoveragePanel({ refreshKey = 0 }: { refreshKey?: number }) {
  const [c, setC] = useState<Coverage | null>(null);
  const load = useCallback(() => {
    fetch("/api/explore/coverage", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then(setC).catch(() => setC(null));
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);
  if (!c) return null;
  const live = c.totals.available - (c.totals.unusable ?? 0) - c.totals.retired;
  const open = (c.circuits ?? []).filter((x) => x.state !== "closed");
  return (
    <details className="mb-4 rounded-xl border border-border bg-surface/30 px-4 py-3 text-[13px]" open>
      <summary className="cursor-pointer font-medium text-foreground">
        Discovery coverage: {c.totals.checked.toLocaleString()} of {live.toLocaleString()} live directory companies checked ({live ? Math.round((c.totals.checked / live) * 1000) / 10 : 0}%), {c.totals.remaining.toLocaleString()} remaining
      </summary>
      <p className="mt-1 text-muted">
        Each run continues where the last one stopped: Australian employers first ({c.totals.australianEmployers.toLocaleString()} found so far), then companies not yet checked, then the least recently checked. {c.totals.retired.toLocaleString()} boards are retired after repeated 404s and rechecked monthly. {(c.totals.unusable ?? 0).toLocaleString()} directory rows are unusable (the public Workday list has rows whose company name was replaced by a server name such as "wd102") and are not counted as companies.
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left text-[12px]">
          <thead className="text-faint"><tr><th className="py-1 pr-3 font-medium">Source</th><th className="pr-3 font-medium">Directory</th><th className="pr-3 font-medium">Checked</th><th className="pr-3 font-medium">Coverage</th><th className="pr-3 font-medium">Remaining</th><th className="pr-3 font-medium">Never attempted</th><th className="pr-3 font-medium">Rate-limited, waiting</th><th className="pr-3 font-medium">Retired</th><th className="pr-3 font-medium">Unusable rows</th><th className="pr-3 font-medium">Australian employers</th><th className="font-medium">Last run</th></tr></thead>
          <tbody>
            {c.sources.map((s) => (
              <tr key={s.source} className="border-t border-border/60">
                <td className="py-1 pr-3 text-foreground">{LABEL[s.source] ?? s.source}</td>
                <td className="pr-3">{n(s.available)}</td>
                <td className="pr-3">{s.checked.toLocaleString()}</td>
                <td className="pr-3">{s.percent == null ? "—" : `${s.percent}%`}</td>
                <td className="pr-3">{n(s.remaining)}</td>
                <td className="pr-3">{n(s.neverAttempted)}</td>
                <td className="pr-3">{(s.rateLimitedPending ?? 0).toLocaleString()}</td>
                <td className="pr-3">{s.retired.toLocaleString()}</td>
                <td className="pr-3">{(s.unusable ?? 0).toLocaleString()}</td>
                <td className="pr-3">{s.australianEmployers.toLocaleString()}</td>
                <td>{when(s.lastRun)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open.length > 0 && (
        <p className="mt-2 text-muted">
          Paused by rate limits (no requests until the time shown, then one test request): {open.map((x) => `${x.key.replace("workday:", "Workday ")} until ${when(x.cooldownUntil)}`).join(", ")}. Times are UTC.
        </p>
      )}
      {c.analytics && c.analytics.length > 0 && (
        <div className="mt-3">
          <p className="font-medium text-foreground">Which sources find relevant jobs</p>
          <p className="text-muted">Latest scan of each source, then roles added to your inbox in the last 30 days and how many are priority-1/2 finance roles (IB and M&A, corporate finance, valuations, equity research, banking, portfolio and asset management, investment and credit, strategy). Successful checks are companies whose board answered; rate-limited and paused ones were not checked. "Explore" runs preview only, so they add nothing. Per-source figures exist from 23 Nov 2026 onward; earlier scans did not record them and they are not estimated.</p>
          <div className="mt-1 overflow-x-auto">
            <table className="w-full text-left text-[12px]">
              <thead className="text-faint"><tr>
                <th className="py-1 pr-3 font-medium">Source</th><th className="pr-3 font-medium">Latest scan</th><th className="pr-3 font-medium">Checked OK</th><th className="pr-3 font-medium">Failed</th><th className="pr-3 font-medium">Rate-limited / paused</th><th className="pr-3 font-medium">Postings retrieved</th><th className="pr-3 font-medium">Match your criteria</th><th className="pr-3 font-medium">New unique</th><th className="pr-3 font-medium">Added to inbox</th><th className="pr-3 font-medium">Duplicates</th><th className="pr-3 font-medium">Last success</th><th className="pr-3 font-medium">Added per 100 checked</th><th className="font-medium">30 days: added / relevant</th>
              </tr></thead>
              <tbody>
                {c.analytics.map((a) => (
                  <tr key={a.key} className="border-t border-border/60">
                    <td className="py-1 pr-3 text-foreground">{a.label}</td>
                    <td className="pr-3">{a.latest ? `${when(a.latest.at)}${a.latest.mode === "explore" ? " (Explore)" : ""}` : <span title="Per-source figures are recorded from 23 Nov 2026; earlier scans did not record them, so they are not estimated.">first measured at its next scan</span>}</td>
                    <td className="pr-3">{a.latest ? n(a.latest.successful) : "—"}</td>
                    <td className="pr-3">{a.latest ? n(a.latest.failed) : "—"}</td>
                    <td className="pr-3">{a.latest ? `${n(a.latest.rateLimited)} / ${n(a.latest.deferred)}` : "—"}</td>
                    <td className="pr-3">{a.latest ? n(a.latest.retrieved) : "—"}</td>
                    <td className="pr-3">{a.latest ? n(a.latest.matching) : "—"}</td>
                    <td className="pr-3">{a.latest ? n(a.latest.newUnique) : "—"}</td>
                    <td className="pr-3">{a.latest ? n(a.latest.added) : "—"}</td>
                    <td className="pr-3">{a.latest ? n(a.latest.duplicates) : "—"}</td>
                    <td className="pr-3">{a.runsRecorded ? when(a.lastSuccess) : "—"}</td>
                    <td className="pr-3">{a.latestYieldPer100 == null ? "—" : a.latestYieldPer100}</td>
                    <td className={a.relevant30d > 0 ? "text-foreground" : ""}>{a.added30d.toLocaleString()} / {a.relevant30d.toLocaleString()}{a.relevantShare30d != null ? ` (${a.relevantShare30d}%)` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {[["Latest scheduled directory sweep", c.lastSweep], ["Latest manual Explore scan (preview only, adds nothing)", c.lastExplore]].map(([title, r]) => {
        const run = r as RunSummary | null | undefined;
        const rf = run?.funnel;
        if (!run || !rf) return null;
        return (
          <div className="mt-3" key={String(title)}>
            <p className="font-medium text-foreground">{String(title)}: {when(run.at)}, {(run.sources ?? []).map((x) => LABEL[x] ?? x).join(", ")}{run.budgetStopped ? "; stopped at its time budget, the next run continues" : ""}</p>
            <ul className="mt-1 grid gap-x-6 gap-y-0.5 sm:grid-cols-2 text-muted">
              <li>Boards checked: {n(rf.boardsReached)} ({n(rf.boardsWithPostings)} with postings)</li>
              <li>Postings retrieved: {n((rf.postingsSeen ?? 0) + (rf.postingsListedOnly ?? 0))}</li>
              <li>Outside the posting window: {n((rf.rejectedDate ?? 0) + (rf.rejectedUndated ?? 0))}</li>
              <li>Title not a target role: {n((rf.rejectedTitle ?? 0) + (rf.postingsListedOnly ?? 0))}</li>
              <li>Location outside your list: {n(rf.rejectedLocation)}</li>
              <li>Duplicates removed: {n(rf.duplicates)}</li>
              <li className="text-foreground">Matching your criteria: {n(rf.matched)}</li>
              <li className={(rf.rateLimited ?? 0) + (rf.deferredRateLimit ?? 0) > 0 ? "text-amber-600 dark:text-amber-400" : ""}>Rate-limited: {n(rf.rateLimited)}; paused, not asked: {n(rf.deferredRateLimit ?? 0)}</li>
              <li>Unreachable or removed boards: {n(rf.failed)}</li>
              <li>Not reached in this run (next run): {n(rf.notReachedThisRun ?? 0)}</li>
            </ul>
          </div>
        );
      })}
      {c.recruiters && c.recruiters.length > 0 && (
        <div className="mt-3">
          <p className="font-medium text-foreground">Specialist recruiters monitored ({c.recruiters.length})</p>
          <p className="text-muted">Their own mandate pages, checked daily and in every portals scan. Mandates stay eligible for 120 days (no limit where a site lists only current mandates), because recruiters keep a role up while it is open. Times are UTC.</p>
          <div className="mt-1 overflow-x-auto">
            <table className="w-full text-left text-[12px]">
              <thead className="text-faint"><tr><th className="py-1 pr-3 font-medium">Recruiter</th><th className="pr-3 font-medium">Status</th><th className="pr-3 font-medium">Listings last check</th><th className="pr-3 font-medium">Last checked</th><th className="pr-3 font-medium">Last success</th><th className="font-medium">Roles added (30 days / all)</th></tr></thead>
              <tbody>
                {c.recruiters.map((r) => (
                  <tr key={r.name} className="border-t border-border/60">
                    <td className="py-1 pr-3 text-foreground">{r.url ? <a href={r.url} target="_blank" rel="noreferrer" className="hover:underline">{r.name}</a> : r.name}</td>
                    <td className={`pr-3 ${r.state === "Listings retrieved" ? "text-foreground" : "text-muted"}`}>{r.state}</td>
                    <td className="pr-3">{r.retrieved == null ? "not recorded" : r.retrieved.toLocaleString()}</td>
                    <td className="pr-3">{when(r.lastChecked)}</td>
                    <td className="pr-3">{when(r.lastSuccess)}</td>
                    <td>{r.added30d} / {r.addedTotal}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="mt-3">
        <p className="font-medium text-foreground">Tracked employers and job boards (SEEK, employer sites)</p>
        <p className="text-muted">
          {c.tracked.portals.toLocaleString()} with scan history; healthy {c.tracked.counts.Healthy ?? 0}, rate-limited {c.tracked.counts["Temporarily rate-limited"] ?? 0}, login required {c.tracked.counts["Authentication required"] ?? 0}, temporarily unavailable {c.tracked.counts["Temporarily unavailable"] ?? 0}, broken {c.tracked.counts["Confirmed broken"] ?? 0}, unknown {c.tracked.counts.Unknown ?? 0}. Last successful scan {when(c.tracked.lastSuccess)}.
          {" "}Roles added to your inbox in the last {c.tracked.finds.days} days by all scans, scheduled and manual (from scan history): {c.tracked.finds.recent.toLocaleString()}{Object.keys(c.tracked.finds.bySource).length ? ` (${Object.entries(c.tracked.finds.bySource).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")})` : ""}. They are in All Job Opportunities.
        </p>
      </div>
      <button type="button" onClick={load} className="mt-2 text-[12px] font-medium text-brand hover:underline">Refresh</button>
    </details>
  );
}
