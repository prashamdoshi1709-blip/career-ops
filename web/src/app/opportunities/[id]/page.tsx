import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { resolveJobId } from "@/lib/job-identity.mjs";
import { PageFrame } from "@/components/page-frame";
import { careerOpsRoot, readReport, findApplication, pdfReadyForReport, trackerCanDelete } from "@/lib/career-ops";
import { readPipelineDetails, readPdfIndex } from "@/lib/pipeline-details.mjs";
import { parseManualReport, docsOutdated } from "@/lib/manual-jobs.mjs";
import { findInstructions, identitiesOf } from "@/lib/job-instructions.mjs";
import { docVersions, complianceView } from "@/lib/doc-versions.mjs";
import type { QItem } from "@/components/quality-panel";
import fs from "node:fs";
import path from "node:path";
import { resolveTailoredCover } from "@/lib/apply/cover";
import { ReportView } from "@/components/report-view";
import { pipelineQuery } from "@/lib/pipeline-navigation.mjs";
import { reportNumberFor } from "@/lib/apply-checklist.mjs";
import { buildOpportunities } from "@/lib/opportunities.mjs";
import { readApplications } from "@/lib/career-ops";
import { docStatuses, jobKey } from "@/lib/doc-status.mjs";
import { ScanReview } from "@/components/scan-review";
import type { DocInfo } from "@/components/doc-links";
import { latestQualityRecord } from "@/lib/latest-quality.mjs";

export const dynamic = "force-dynamic";

export default async function ReportPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = pipelineQuery(await searchParams);
  // One source of truth for ratings and document status: the same builder as All Job Opportunities.
  const opportunities = buildOpportunities(careerOpsRoot(), readApplications()).jobs;
  // Every job id ever handed out keeps working (2026-11-11): a scan find that was
  // marked Applied (now a tracker row), merged into a duplicate, skipped or
  // hidden resolves to where it lives now instead of a 404. See job-identity.mjs.
  if (/^[pt][a-f0-9]+$/.test(id)) {
    const r = resolveJobId(careerOpsRoot(), id, opportunities);
    if (r.type === "redirect") redirect(`${r.to}${query ? `?${query}` : ""}`);
    if (r.type === "gone") return <JobNoLongerListed record={r.record as { url: string; company: string; title: string; location: string; where: string }} />;
    if (r.type !== "job") notFound();
    const job = r.job;
    const docs = docStatuses(careerOpsRoot(), [job]) as Record<string, DocInfo>;
    return <ScanReview root={careerOpsRoot()} id={id} job={job as never} doc={docs[jobKey(job)]} />;
  }
  const app = findApplication(id);
  const report = readReport(id);
  if (!app && !report) notFound();
  // Resolved here rather than in the component so the link is only rendered when
  // THIS application's cover is actually on disk. `id` is passed as the
  // application number, never as a company: a report with no tracker row has no
  // identity to match on, and guessing one from the id would surface another
  // offer's cover.
  // Local customisation (2026-11-09): facts from the report and the PDF index;
  // a cover letter indexed in data/pdf-index.tsv also counts as ready.
  const rawFacts = app ? readPipelineDetails(careerOpsRoot(), [app])[app.n] : undefined;
  const opp = app ? opportunities.find((j) => j.kind === "tracked" && String(j.n) === String(app.n)) : undefined;
  const facts = rawFacts ? { ...rawFacts, suitability: opp?.score ?? rawFacts.suitability } : undefined;
  const coverReady = Boolean(facts?.cover) || (await resolveTailoredCover(app?.company, id)) !== null;
  // Latest saved quality summary for this job's documents (written by
  // data/cv-original/generate.mjs next to the PDFs). File read only.
  let lastQuality: unknown = null;
  try {
    const idx = fs.readFileSync(path.join(careerOpsRoot(), "data", "pdf-index.tsv"), "utf8").split("\n").map((l) => l.split("\t"));
    const cvRow = idx.find((r) => facts?.reportNum && String(Number(r[0])) === String(Number(facts.reportNum)) && (r[5] || "cv") === "cv");
    if (cvRow) {
      const dir = path.join(careerOpsRoot(), path.dirname(cvRow[1]));
      lastQuality = latestQualityRecord(dir);
    }
  } catch { lastQuality = null; }
  // Manually added jobs (+ Add Job Manually): values for "Edit job", and whether
  // the documents predate the last change to the job description.
  const manual = report ? parseManualReport(report.content) : null;
  let manualJob: { values: Record<string, string>; outdated: boolean; jdUpdatedAt: string } | null = null;
  if (manual) {
    const docs = (facts?.reportNum && readPdfIndex(careerOpsRoot()).get(String(Number(facts.reportNum)))) || {};
    const times = [docs.cv, docs.cover].filter(Boolean).map((f) => { try { return fs.statSync(f as string).mtimeMs; } catch { return 0; } });
    manualJob = {
      values: { company: manual.company, role: manual.role, location: manual.location, url: manual.url, jd: manual.jd, deadline: /^\d{4}-\d{2}-\d{2}$/.test(manual.deadline) ? manual.deadline : "", source: manual.source },
      outdated: docsOutdated(report!.content, times.length ? Math.max(...times) : null),
      jdUpdatedAt: manual.jdUpdatedAt,
    };
  }
  // Additional Instructions (Optional) for this job + every saved version of its
  // documents (2026-11-15). Keyed by the job (t{n}) and the posting ids of its
  // URLs, so instructions typed before it was marked Applied are still found.
  const docsPanel = app ? (() => {
    const root = careerOpsRoot();
    const jobKey = `t${app.n}`;
    const urls = (`${app.url ?? ""} ${app.applyLink ?? ""}`.match(/https?:\/\/[^\s)|]+/g) ?? []) as string[];
    const ids = identitiesOf(jobKey, urls) as string[];
    const st = opp ? ((docStatuses(root, [opp]) as Record<string, DocInfo>)[jobKey] ?? null) : null;
    const idx = facts?.reportNum ? readPdfIndex(root).get(String(Number(facts.reportNum))) ?? {} : {};
    const linked = [st?.cv ? path.join(root, "output", "applications", st.cv) : idx.cv, st?.cover ? path.join(root, "output", "applications", st.cover) : idx.cover].filter(Boolean) as string[];
    const instructions = findInstructions(root, ids);
    return {
      jobKey,
      instructions,
      versions: docVersions(root, linked),
      compliance: complianceView(linked, instructions) as QItem | null,
      canDraft: Boolean(report) || ids.some((i) => i.startsWith("p") && fs.existsSync(path.join(root, "data", "posting-jobs", `${i.slice(1)}.json`))),
    };
  })() : null;
  // 2026-11-22: a saved posting has no report, so the pdf-index lookup above
  // finds nothing; fall back to the documents linked for this job.
  if (!lastQuality && opp) {
    try {
      const st = (docStatuses(careerOpsRoot(), [opp]) as Record<string, DocInfo>)[`t${opp.n}`];
      if (st?.cv) lastQuality = latestQualityRecord(path.dirname(path.join(careerOpsRoot(), "output", "applications", st.cv)));
    } catch { /* no record */ }
  }
  let generator = "";
  try { generator = JSON.parse(fs.readFileSync(path.join(careerOpsRoot(), "data", "cv-original", "version.json"), "utf8")).generator ?? ""; } catch { generator = ""; }
  return (
    <ReportView
      docState={opp ? ((docStatuses(careerOpsRoot(), [opp]) as Record<string, DocInfo>)[`t${opp.n}`] ?? null) : null}
      generator={generator}
      docsPanel={docsPanel}
      manualJob={manualJob}
      id={id}
      app={app}
      report={report?.content ?? null}
      file={report?.file ?? null}
      canDelete={trackerCanDelete()}
      pdfReadyFromIndex={await pdfReadyForReport(id)}
      coverReady={coverReady}
      facts={facts}
      lastQuality={lastQuality}
      backHref={`/opportunities${query ? `?${query}` : ""}`}
      applyHref={`/opportunities/${encodeURIComponent(id)}/apply${query ? `?${query}` : ""}`}
      reportNum={reportNumberFor(id, app, report?.file ?? null)}
    />
  );
}

/** A posting that left the list (skipped, hidden or cleaned up): say so instead of a bare 404. */
function JobNoLongerListed({ record }: { record: { url: string; company: string; title: string; location: string; where: string } }) {
  return (
    <PageFrame className="max-w-2xl">
      <Link href="/opportunities" className="text-sm text-muted hover:text-brand">← All Job Opportunities</Link>
      <h1 className="mt-5 font-display text-2xl text-landing">{record.company || "This job"}{record.title ? ` · ${record.title}` : ""}</h1>
      <p className="mt-2 text-sm text-muted">
        This job is no longer in All Job Opportunities (it was skipped, hidden or removed from the list). It is still
        recorded in your {record.where}{record.location ? `, ${record.location}` : ""}. Nothing was deleted by opening this link.
      </p>
      <a href={record.url} target="_blank" rel="noreferrer" className="mt-4 inline-flex text-sm font-medium text-brand hover:underline">Open the original posting</a>
    </PageFrame>
  );
}
