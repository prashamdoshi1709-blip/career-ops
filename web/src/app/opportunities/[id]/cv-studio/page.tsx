import Link from "next/link";
import { PageFrame } from "@/components/page-frame";

export const dynamic = "force-dynamic";

// Local customisation (2026-11-10): CV Studio edited the generic-template CV
// (a different design, outside the quality gates). Tailored CVs are now made
// and revised only by the shared original-format generator on the job page
// (Generate / Regenerate / Revise Using My Instructions), so this page points
// there instead of offering a second editing path. The original component is
// kept in components/cv-studio for a future career-ops update.
export default async function CvStudioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <PageFrame className="max-w-2xl">
      <h1 className="font-display text-2xl text-landing">CV editing has moved</h1>
      <p className="mt-2 text-sm text-muted">
        Tailored CVs and cover letters are created in your original format on the job page, where every version is checked for
        relevance, accuracy and clean PDF text. To change one, use <b>Revise Using My Instructions</b> there.
      </p>
      <Link href={`/opportunities/${encodeURIComponent(id)}`} className="mt-4 inline-flex rounded-full bg-brand px-4 py-1.5 text-sm font-medium text-brand-foreground">Open the job page</Link>
    </PageFrame>
  );
}
