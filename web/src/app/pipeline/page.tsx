import { redirect } from "next/navigation";
import { pipelineRedirectTarget } from "@/lib/pipeline-redirect.mjs";

// Local customisation (2026-11-11): Pipeline was merged into All Job Opportunities.
// 2026-11-22: the query string is kept.
export default async function PipelineRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(pipelineRedirectTarget([], await searchParams));
}
