import { careerOpsRoot, readApplications } from "@/lib/career-ops";
import { buildOpportunities, readCoverage, lastScanRun, CATEGORIES } from "@/lib/opportunities.mjs";
import { OpportunitiesView, type Opportunity } from "@/components/opportunities-view";
import { docStatuses, jobKey } from "@/lib/doc-status.mjs";
import { autoCleanup } from "@/lib/job-cleanup.mjs";
import path from "node:path";
import type { DocInfo } from "@/components/doc-links";

export const dynamic = "force-dynamic"; // always read fresh local files

// Local customisation (2026-11-10): every job Career-Ops knows about, in one
// table. Pure file reads: opening this page never calls Claude.
export default function OpportunitiesPage() {
  const root = careerOpsRoot();
  // New jobs below the minimum suitability (Config) are removed before display, when enabled.
  try { autoCleanup(root, path.resolve(process.cwd(), "..")); } catch { /* never block the page */ }
  const { jobs, duplicatesRemoved, today, hidden } = buildOpportunities(root, readApplications());
  return (
    <OpportunitiesView
      jobs={jobs.map((j) => ({ ...j, docKey: jobKey(j) })) as unknown as Opportunity[]}
      docs={docStatuses(root, jobs) as Record<string, DocInfo>}
      duplicatesRemoved={duplicatesRemoved}
      hidden={hidden}
      today={today}
      categories={CATEGORIES}
      coverage={readCoverage(root, jobs)}
      lastRun={lastScanRun(root)}
    />
  );
}
