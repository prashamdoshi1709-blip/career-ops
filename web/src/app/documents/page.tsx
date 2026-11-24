import { loadDocJobs } from "@/lib/doc-jobs";
import { DocumentLibrary, type LibraryRow } from "@/components/document-library";

export const dynamic = "force-dynamic";

// Local customisation (2026-11-11): every job's own tailored CV and cover letter
// in one place, with the controlled generation queue. File reads only; Claude
// is used only after you approve a batch (or press Regenerate).
export default function DocumentsPage() {
  const { jobs, statuses, keyOf } = loadDocJobs();
  const rows: LibraryRow[] = jobs.map((j) => {
    const key = keyOf(j);
    const s = statuses[key];
    return {
      key, n: j.n ?? null, kind: j.kind, company: j.company, title: j.title, location: String(j.location ?? ""),
      score: (j.score as number | null) ?? null, status: String(j.status ?? (j.kind === "inbox" ? "Not tracked" : "")), category: String(j.category ?? ""),
      doc: s,
    };
  });
  return <DocumentLibrary rows={rows} />;
}
