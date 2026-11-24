import { NextResponse } from "next/server";
import { readJsonObject } from "@/lib/json-body";
import { careerOpsRoot, readApplications } from "@/lib/career-ops";
import { buildOpportunities } from "@/lib/opportunities.mjs";
import { jobKey } from "@/lib/doc-status.mjs";
import { findInstructions, saveInstructions, identitiesOf } from "@/lib/job-instructions.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Local customisation (2026-11-15): save / load "Additional Instructions
// (Optional)" for one job. A file read or write only: it never calls Claude,
// never queues or starts a generation and never touches ratings or statuses.
type Job = { kind: string; n: string | null; url?: string; applyUrl?: string; company?: string; title?: string; sources?: { url: string }[] };

export async function POST(req: Request) {
  const body = await readJsonObject<{ key?: string; text?: string; target?: string; action?: string }>(req);
  const key = String(body?.key ?? "");
  if (!/^(t\d+|p[a-f0-9]{8,40})$/.test(key)) return NextResponse.json({ ok: false, error: "job id required" }, { status: 400 });
  const root = careerOpsRoot();
  const job = (buildOpportunities(root, readApplications()).jobs as Job[]).find((j) => jobKey(j) === key);
  if (!job) return NextResponse.json({ ok: false, error: "This job is no longer in All Job Opportunities." }, { status: 404 });
  const urls = [job.url, job.applyUrl, ...(job.sources ?? []).map((s) => s.url)].filter(Boolean) as string[];
  if (body?.action === "get") return NextResponse.json({ ok: true, instructions: findInstructions(root, identitiesOf(key, urls)) });
  try {
    const saved = saveInstructions(root, key, { text: body?.text, target: body?.target }, { urls, label: `${job.company ?? ""} · ${job.title ?? ""}` });
    return NextResponse.json({ ok: true, instructions: saved });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "not saved" }, { status: 500 });
  }
}
