import { redirect } from "next/navigation";
import { pipelineRedirectTarget } from "@/lib/pipeline-redirect.mjs";

// Local customisation (2026-11-11): old /pipeline/<n>[/apply] links open the job's
// Review page under All Job Opportunities. 2026-11-22: the query string is kept,
// so /pipeline/compare?ids=1,2 (or ?n=) still opens the comparison of those jobs.
export default async function PipelineJobRedirect({ params, searchParams }: { params: Promise<{ slug: string[] }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  redirect(pipelineRedirectTarget(slug, await searchParams));
}
