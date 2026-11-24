import { NextResponse } from "next/server";
import path from "node:path";
import { careerOpsRoot, readApplications } from "@/lib/career-ops";
import { isTrackerWriting } from "@/lib/core/run-registry";
import { readJsonObject } from "@/lib/json-body";
import {
  validateInput, findDuplicates, createManualJob, updateManualJob, removeManualJob, checkPosting,
} from "@/lib/manual-jobs.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Local customisation (2026-11-10): "+ Add Job Manually" and "Edit job".
// Saving, editing, the duplicate check and the optional posting check are all
// local file work and public job-board API reads: no Claude call ever happens
// here. Documents are generated only from the job page, when asked.

type Body = {
  action?: "create" | "update" | "remove" | "check-posting" | "duplicates";
  n?: string;
  company?: string; role?: string; location?: string; url?: string; jd?: string; deadline?: string; source?: string;
  allowDuplicate?: boolean;
  liveness?: string;
};

const sydneyToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
// A posting-check result echoed back by the form; only these shapes are recorded.
const verificationFrom = (liveness?: string) =>
  liveness && /^(active|expired|uncertain) \((employer job-board API|[a-z]+)\)$|^could not be confirmed$/.test(liveness)
    ? `posting checked ${sydneyToday()}: ${liveness}`
    : "";

let writing = false;

export async function POST(req: Request) {
  const body = await readJsonObject<Body>(req);
  if (!body?.action) return NextResponse.json({ ok: false, error: "action required" }, { status: 400 });
  const root = careerOpsRoot();
  const codeRoot = path.resolve(process.cwd(), "..");

  if (body.action === "check-posting") {
    return NextResponse.json(checkPosting(codeRoot, root, String(body.url ?? "")));
  }

  const n = String(body.n ?? "");
  if (body.action !== "create" && body.action !== "duplicates" && !/^\d+$/.test(n)) {
    return NextResponse.json({ ok: false, error: "job number required" }, { status: 400 });
  }

  if (body.action === "remove") {
    if (writing || isTrackerWriting()) return NextResponse.json({ ok: false, error: "The tracker is being updated; try again in a moment." }, { status: 409 });
    writing = true;
    try {
      const r = removeManualJob(codeRoot, root, n);
      return NextResponse.json(r, { status: r.ok ? 200 : (r as { status?: number }).status ?? 500 });
    } finally { writing = false; }
  }

  const checked = validateInput(body);
  if (!checked.value) return NextResponse.json({ ok: false, error: checked.error }, { status: 400 });
  const v = checked.value;
  const duplicates = findDuplicates(root, readApplications(), v, { excludeN: body.action === "update" ? n : null });
  if (body.action === "duplicates") return NextResponse.json({ ok: true, duplicates });
  if (body.action === "create" && duplicates.length && !body.allowDuplicate) {
    return NextResponse.json({ ok: false, duplicates, error: "This job may already be in Career-Ops." }, { status: 409 });
  }

  if (writing || isTrackerWriting()) return NextResponse.json({ ok: false, error: "The tracker is being updated; try again in a moment." }, { status: 409 });
  writing = true;
  try {
    if (body.action === "create") {
      const r = createManualJob(codeRoot, root, v, { today: sydneyToday(), verification: verificationFrom(body.liveness) });
      return NextResponse.json(r, { status: r.ok ? 200 : 500 });
    }
    if (body.action === "update") {
      const r = updateManualJob(codeRoot, root, n, v, { verification: verificationFrom(body.liveness) });
      return NextResponse.json(r, { status: r.ok ? 200 : (r as { status?: number }).status ?? 500 });
    }
    return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
  } finally { writing = false; }
}
