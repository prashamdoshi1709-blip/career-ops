import { NextResponse } from "next/server";
import { loadDocJobs, ensureWorker } from "@/lib/doc-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Local customisation (2026-11-11): document status for every job, keyed by job
// key (t<tracker#> or p<posting id>). File reads only; also restarts an approved
// queue after the dashboard restarts.
export async function GET() {
  const { root, statuses } = loadDocJobs();
  ensureWorker(root);
  return NextResponse.json({ ok: true, statuses });
}
