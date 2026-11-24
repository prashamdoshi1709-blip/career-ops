// Local customisation (2026-11-10): one-glance job-search overview for Today.
// Server component; file reads only, no Claude.

import Link from "next/link";
import { docStatuses, jobKey } from "@/lib/doc-status.mjs";
import { readSettings } from "@/lib/job-cleanup.mjs";
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot, readApplications } from "@/lib/career-ops";
import { buildOpportunities, readCoverage, lastScanRun } from "@/lib/opportunities.mjs";

type Job = { key: string; n: string | null; company: string; title: string; location: string; score: number | null; ratingType: string; stage: string; deadline: string; posted: string; url: string };

const iso = (s: string) => (s.match(/\d{4}-\d{2}-\d{2}/) ?? [""])[0] || ((m) => (m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : ""))(s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/));
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

function Card({ title, value, href, children }: { title: string; value?: string | number; href?: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-white p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">{title}</h3>
        {href && <Link href={href} className="text-[11px] font-medium text-brand hover:underline">View</Link>}
      </div>
      {value !== undefined && <p className="mt-1 text-2xl font-semibold tabular-nums text-landing">{value}</p>}
      <div className="mt-1 text-sm text-foreground">{children}</div>
    </div>
  );
}

const JobLine = ({ j, extra }: { j: Job; extra?: string }) => (
  <li className="truncate">
    <Link href={j.n ? `/opportunities/${j.n}` : `/opportunities/${jobKey(j)}`} className="text-brand hover:underline">{j.company}</Link>
    <span className="text-muted">, {j.title}</span>
    {extra && <span className="ml-1 tabular-nums text-faint">{extra}</span>}
  </li>
);

export function TodayOverview() {
  const root = careerOpsRoot();
  const apps = readApplications();
  const { jobs, today } = buildOpportunities(root, apps) as { jobs: Job[]; today: string };
  const run = lastScanRun(root);
  const failed = readCoverage(root, jobs).filter((c: { status: string }) => c.status === "Failed");

  // Only jobs at or above the minimum suitability (Config) are recommended.
  const min = readSettings(root).minSuitability;
  const suitable = (j: Job) => j.score == null || j.score >= min;
  const docs = docStatuses(root, jobs as never) as Record<string, { state: string; eligible: boolean }>;
  const awaitingDocs = jobs.filter((j) => docs[jobKey(j)]?.eligible && suitable(j));
  const reviewDocs = jobs.filter((j) => ["needs-review", "outdated", "failed"].includes(docs[jobKey(j)]?.state) && !["Applied", "Interview", "Offer", "Rejected", "Closed"].includes(j.stage));
  const newJobs = jobs.filter((j) => j.stage === "New" && suitable(j));
  const recent = newJobs.filter((j) => iso(j.posted) && days(iso(j.posted), today) <= 7);
  const top = jobs.filter((j) => ["New", "Under Review", "Ready to Apply"].includes(j.stage) && j.score != null && j.score >= min).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 5);
  const closing = jobs.filter((j) => iso(j.deadline) && days(today, iso(j.deadline)) >= 0 && days(today, iso(j.deadline)) <= 14 && !["Applied", "Interview", "Offer", "Rejected", "Closed"].includes(j.stage)).sort((a, b) => iso(a.deadline).localeCompare(iso(b.deadline)));
  const ready = jobs.filter((j) => j.stage === "Ready to Apply");
  const applied = jobs.filter((j) => j.stage === "Applied");

  const interviews = apps.flatMap((a) => [...String(a.notes ?? "").matchAll(/Interview (\d{4}-\d{2}-\d{2})(?::\s*([^;]+))?/g)].map((m) => ({ n: a.n, company: a.company, role: a.role, date: m[1], detail: m[2] ?? "" }))).filter((i) => i.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  let followText = "";
  try { followText = fs.readFileSync(path.join(root, "data", "follow-ups.md"), "utf8"); } catch {}
  const follow = [...followText.matchAll(/^- next #(\d+) (\d{4}-\d{2}-\d{2})/gm)].map((m) => ({ n: m[1], date: m[2], app: apps.find((a) => a.n === m[1]) })).filter((f) => f.app && f.app.status === "Applied").sort((a, b) => a.date.localeCompare(b.date));

  return (
    <section className="mx-auto max-w-5xl px-6 pt-6" aria-label="Job search overview">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-2xl text-landing">Job search overview</h2>
        <Link href="/opportunities" className="text-sm font-medium text-brand hover:underline">All Job Opportunities →</Link>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card title="New opportunities" value={newJobs.length} href="/opportunities">
          <p className="text-muted">{recent.length} posted in the last 7 days, awaiting review</p>
        </Card>
        <Card title="Ready to apply" value={ready.length} href="/opportunities">
          <ul className="space-y-0.5 text-xs">{ready.slice(0, 4).map((j) => <JobLine key={j.key} j={j} extra={j.score != null ? `${j.score}/10` : undefined} />)}</ul>
        </Card>
        <Card title="Applied, awaiting reply" value={applied.length} href="/opportunities?tab=APPLIED">
          <ul className="space-y-0.5 text-xs">{applied.slice(0, 4).map((j) => <JobLine key={j.key} j={j} />)}</ul>
        </Card>
        <Card title="Scan status" value={run ? run.at.slice(0, 10) : "—"} href="/scheduled-scans">
          <p className="text-xs text-muted">{run ? `${run.added} new last run · ${run.errors} error${run.errors === 1 ? "" : "s"}` : "No scan yet"}{failed.length ? ` · failed: ${failed.map((f: { name: string }) => f.name).join(", ")}` : ""}</p>
          <Link href="/opportunities#coverage" className="text-xs font-medium text-brand hover:underline">Search coverage</Link>
        </Card>
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Card title="Documents awaiting generation" value={awaitingDocs.length} href="/documents">
          <p className="text-xs text-muted">Suitable jobs with no tailored CV yet. Generate them one at a time from Review, or all at once from Documents after you confirm.</p>
        </Card>
        <Card title="Documents needing your review" value={reviewDocs.length} href="/documents">
          <ul className="space-y-1 text-sm">{reviewDocs.slice(0, 4).map((j) => <JobLine key={j.key} j={j} />)}</ul>
        </Card>
        <Card title={`Top matches rated ${min}/10 or higher`} href="/opportunities">
          <ul className="space-y-1 text-sm">{top.map((j) => <JobLine key={j.key} j={j} extra={`${j.score}/10 ${j.ratingType === "Detailed" ? "" : "(prelim.)"}`} />)}</ul>
        </Card>
        <div className="grid gap-3">
          <Card title="Closing soon (14 days)">
            {closing.length ? <ul className="space-y-0.5 text-xs">{closing.slice(0, 4).map((j) => <JobLine key={j.key} j={j} extra={`closes ${j.deadline}`} />)}</ul> : <p className="text-xs text-muted">No verified deadlines in the next 14 days.</p>}
          </Card>
          <div className="grid gap-3 sm:grid-cols-2">
            <Card title="Upcoming interviews">
              {interviews.length ? <ul className="space-y-0.5 text-xs">{interviews.slice(0, 4).map((i) => <li key={`${i.n}${i.date}`}><Link href={`/opportunities/${i.n}`} className="text-brand hover:underline">{i.company === "?" ? "Confidential" : i.company}</Link> <span className="tabular-nums text-muted">{i.date}</span>{i.detail && <span className="text-faint"> · {i.detail}</span>}</li>)}</ul> : <p className="text-xs text-muted">None recorded. Add one on the job page.</p>}
            </Card>
            <Card title="Follow-ups" href="/followups">
              {follow.length ? <ul className="space-y-0.5 text-xs">{follow.slice(0, 4).map((f) => <li key={f.n}><Link href={`/opportunities/${f.n}`} className="text-brand hover:underline">{f.app?.company}</Link> <span className="tabular-nums text-muted">{f.date}</span>{f.date <= today && <span className="ml-1 font-medium text-amber-700">due</span>}</li>)}</ul> : <p className="text-xs text-muted">No follow-ups scheduled.</p>}
            </Card>
          </div>
        </div>
      </div>
    </section>
  );
}
