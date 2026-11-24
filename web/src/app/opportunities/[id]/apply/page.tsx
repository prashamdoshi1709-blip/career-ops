import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { notFound, redirect } from "next/navigation";
import { resolveJobId } from "@/lib/job-identity.mjs";
import { careerOpsRoot, findApplication, isRegularContainedFile, readReport, rootScript } from "@/lib/career-ops";
import { resolvePdfIndexPath } from "@/lib/core/pdf-index";
import { parseReport } from "@/lib/format";
import { pipelineQuery } from "@/lib/pipeline-navigation.mjs";
import { resolvePostingUrl } from "@/lib/posting-url.mjs";
import { answerCopyItems, cvCopyFields, indexedPdf, PORTAL_TIPS, reportNumberFor } from "@/lib/apply-checklist.mjs";
import { ApplyChecklist } from "@/components/apply-checklist";
import { buildOpportunities } from "@/lib/opportunities.mjs";
import { readApplications } from "@/lib/career-ops";
import { docStatuses } from "@/lib/doc-status.mjs";
import type { DocInfo } from "@/components/doc-links";
import { fileHref } from "@/lib/doc-href.mjs";

export const dynamic = "force-dynamic";

function fileUnderOutput(root: string, abs: string): boolean {
  return isRegularContainedFile(abs, path.join(root, "output"));
}

export default async function ApplyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = pipelineQuery(await searchParams);
  // A scan find's id (p…) that became a tracker row opens that row's checklist (2026-11-11).
  if (/^[pt][a-f0-9]+$/.test(id)) {
    const r = resolveJobId(careerOpsRoot(), id, buildOpportunities(careerOpsRoot(), readApplications()).jobs);
    if (r.type === "redirect" && /^\/opportunities\/\d+$/.test(r.to)) redirect(`${r.to}/apply${query ? `?${query}` : ""}`);
    notFound();
  }
  const app = findApplication(id);
  const report = readReport(id);
  if (!app && !report) notFound();

  const reportNum = reportNumberFor(id, app, report?.file ?? null);
  const reportUrl = report ? parseReport(report.content).fields.find((field) => field.label === "URL")?.value : "";
  const postingUrl = resolvePostingUrl((app as { url?: string } | null)?.url, reportUrl);

  let answers: { label: string; text: string }[] = [];
  if (report?.content) {
    const mod = await import(/* webpackIgnore: true */ pathToFileURL(rootScript("application-answers")).href);
    const snapshot = mod.parseApplicationAnswersSection(report.content, { strict: true });
    answers = answerCopyItems(snapshot);
  }

  const root = careerOpsRoot();
  const cvPath = path.join(root, "cv.md");
  let cvText: string | null = null;
  try {
    cvText = fs.readFileSync(cvPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    cvText = null;
  }
  const fields = cvText == null ? { work: [], education: "" } : cvCopyFields(cvText);

  let indexText = "";
  const indexPath = await resolvePdfIndexPath();
  if (indexPath) {
    try {
      indexText = fs.readFileSync(indexPath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      indexText = "";
    }
  }
  const resumeHit = reportNum == null ? null : indexedPdf(indexText, reportNum, "cv", root, (abs) => fileUnderOutput(root, abs));
  const coverHit = reportNum == null ? null : indexedPdf(indexText, reportNum, "cover", root, (abs) => fileUnderOutput(root, abs));
  // Documents for a row with no report of its own (a scan find marked Applied)
  // are filed under the posting; use the same lookup as the job page (2026-11-11).
  const opp0 = app ? buildOpportunities(root, readApplications()).jobs.find((j: { kind?: string; n?: unknown }) => j.kind === "tracked" && String(j.n) === String(app.n)) : undefined;
  const doc0 = opp0 ? ((docStatuses(root, [opp0]) as Record<string, DocInfo>)[`t${opp0.n}`] ?? null) : null;
  const resume = resumeHit
    ? { relativePath: resumeHit.relativePath, downloadHref: `/api/cv-pdf?n=${reportNum}` }
    : doc0?.cv ? { relativePath: `output/applications/${doc0.cv}`, downloadHref: fileHref(doc0.cv) } : null;
  const cover = coverHit
    ? { relativePath: coverHit.relativePath, downloadHref: `/api/cv-pdf?n=${reportNum}&kind=cover` }
    : doc0?.cover ? { relativePath: `output/applications/${doc0.cover}`, downloadHref: fileHref(doc0.cover) } : null;

  // "PDF ready" follows the same document status as the job page and All Job Opportunities.
  const docState = doc0;

  const suffix = query ? `?${query}` : "";
  const company = app?.company || parseReport(report?.content ?? "").title || `Report #${id}`;
  return (
    <ApplyChecklist
      company={company}
      role={app?.role ?? ""}
      backHref={`/opportunities${suffix}`}
      reportHref={`/opportunities/${encodeURIComponent(id)}${suffix}`}
      postingUrl={postingUrl}
      resume={resume}
      cover={cover}
      answers={answers}
      work={fields.work}
      education={fields.education}
      cvMissing={cvText == null}
      tips={PORTAL_TIPS}
      trackerNum={app?.n ?? null}
      reportNum={reportNum}
      status={app?.status ?? ""}
      pdfReady={(app?.pdf ?? "").includes("✅")}
      docState={docState}
    />
  );
}
