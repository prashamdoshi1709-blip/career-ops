import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { PageFrame } from "@/components/page-frame";
import { CompanyLogo } from "@/components/company-logo";
import { DocLinks, type DocInfo } from "@/components/doc-links";
import { JobStatusControl } from "@/components/job-status-control";
import { ScanReviewActions } from "@/components/scan-review-actions";
import { PasteJd } from "@/components/paste-jd";
import { VersionHistory, type DocVersion, type JobInstructions } from "@/components/additional-instructions";
import { findInstructions, identitiesOf } from "@/lib/job-instructions.mjs";
import { docVersions, latestRecord, complianceView } from "@/lib/doc-versions.mjs";
import { QualityPanel, type QItem } from "@/components/quality-panel";

type Job = { kind: string; n: string | null; company: string; title: string; location: string; url: string; applyUrl: string; status: string; score: number | null; ratingType: string; confidence: string; reason: string; category: string; posted: string; deadline: string; availability: string; sources: { label: string; url: string }[]; screen?: { score: number; basis: string; confidence: string } };

// Local customisation (2026-11-11): Review for a scan find that is not in the
// tracker yet. Everything a tracked job's page has, from what is known about it.
export function ScanReview({ root, id, job, doc }: { root: string; id: string; job: Job; doc: DocInfo | undefined }) {
  // Additional Instructions saved for this job (any of its ids) and every saved version.
  const instructions = findInstructions(root, identitiesOf(id, [job.url, job.applyUrl, ...job.sources.map((s) => s.url)])) as JobInstructions;
  const linked = [doc?.cv, doc?.cover].filter(Boolean).map((f) => path.join(root, "output", "applications", f as string));
  const versions = docVersions(root, linked) as DocVersion[];
  // The latest quality check of the linked documents (2026-11-15), led by the
  // Additional Instructions Compliance check: from the record, or checked now
  // against the current documents when the record predates these instructions.
  const record = latestRecord(linked) as { quality?: QItem[]; generatedAt?: string } | null;
  const live = complianceView(linked, instructions, record) as QItem | null;
  const STALE = ["Additional Instructions Compliance", "Instructions applied", "Instructions not applied or partly applied"];
  const quality = live ? [live, ...(record?.quality ?? []).filter((q) => !STALE.includes(q.group))] : record?.quality ?? null;
  let jd = "";
  try { jd = JSON.parse(fs.readFileSync(path.join(root, "data", "posting-jobs", `${id.slice(1)}.json`), "utf8")).jd ?? ""; } catch { jd = ""; }
  const facts: [string, string][] = [
    ["Location", job.location || "—"], ["Posted", job.posted || "—"], ["Deadline", job.deadline || "Not stated"],
    ["Suitability", job.score == null ? "Pending evaluation" : `${job.score.toFixed(1)}/10`], ["Rating", job.score == null ? "—" : `${job.ratingType}${job.confidence !== "—" ? ` · ${job.confidence} confidence` : ""}`],
    ["Availability", job.availability], ["Category", job.category],
  ];
  return (
    <PageFrame className="max-w-3xl xl:max-w-5xl">
      <Link href="/opportunities" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-brand"><ArrowLeft className="size-4" /> All Job Opportunities</Link>
      <header className="mt-5">
        <div className="flex items-center gap-3">
          <CompanyLogo name={job.company} size={40} />
          <h1 className="font-display text-3xl tracking-tight text-landing">{job.company}</h1>
        </div>
        <p className="mt-1 text-muted">{job.title}</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <JobStatusControl job={job} docsReady={doc?.state === "ready"} />
          <a href={job.applyUrl || job.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline">Open the original posting <ExternalLink className="size-3.5" /></a>
          <span className="text-xs text-muted">Found on {job.sources[0]?.label ?? "a job board"}. You submit applications yourself.</span>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 rounded-2xl border border-border bg-surface/40 px-4 py-3 text-sm sm:grid-cols-4 lg:grid-cols-7">
          {facts.map(([k, v]) => <div key={k}><dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">{k}</dt><dd className="mt-0.5 font-medium text-foreground">{v}</dd></div>)}
        </dl>
        <p className="mt-2 text-xs text-muted"><b className="text-foreground">Why this rating:</b> {job.reason}. {job.ratingType === "Preliminary" ? "A preliminary rating is calculated on this computer; Evaluate gives a detailed rating with strengths and weaknesses." : ""}</p>
      </header>

      <section className="mt-5 rounded-2xl border border-border bg-white px-4 py-3">
        <h2 className="text-sm font-medium text-foreground">Tailored CV and cover letter</h2>
        {doc && <DocLinks jobKey={id} info={doc} />}
        <ScanReviewActions jobKey={id} company={job.company} title={job.title} url={job.url} hasDocs={Boolean(doc?.cv)} hasCover={Boolean(doc?.cover)} instructions={instructions} state={doc?.state ?? "not-generated"} canGenerate={!/^No job description|Student|Already|Marked|closed/i.test(doc?.reason ?? "") || Boolean(doc?.cv)} reason={doc?.reason ?? ""} />
        {doc?.cv && quality && <QualityPanel items={quality} when={record?.generatedAt ? `latest version, ${record.generatedAt.slice(0, 10)}` : undefined} jobKey={id} />}
        <VersionHistory versions={versions} />
      </section>

      <section className="mt-5">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">Job description</h2>
        {jd ? <div className="mt-2 whitespace-pre-wrap rounded-2xl border border-border bg-white px-4 py-3 text-sm leading-relaxed text-foreground">{jd}</div>
          : <p className="mt-2 rounded-xl border border-border bg-surface-hover/60 px-3 py-2 text-sm text-muted">The full job description has not been saved for this posting yet. Open the original posting and paste it below.</p>}
        <PasteJd jobKey={id} url={job.url} company={job.company} title={job.title} location={job.location} hasJd={Boolean(jd)} screened={job.screen ? `Screened ${job.screen.score}/10 from its ${job.screen.basis} (${job.screen.confidence} confidence). A screen never deletes a job.` : ""} />
      </section>
    </PageFrame>
  );
}
