import { NextResponse } from "next/server";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { readJsonObject } from "@/lib/json-body";
import { addTrackedFromScan } from "@/lib/manual-jobs.mjs";
import { isTrackerWriting } from "@/lib/core/run-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Local customisation (2026-11-11): a scan find marked Applied in All Job
// Opportunities becomes a tracker row (merge-tracker, no score). Only ever from
// the user's own click; generating documents never calls this.
export async function POST(req: Request) {
  const b = await readJsonObject<{ url?: string; company?: string; title?: string; location?: string; status?: string }>(req);
  if (!b?.url || !/^https?:\/\//.test(b.url) || !b.company || !b.title) return NextResponse.json({ ok: false, error: "url, company and title required" }, { status: 400 });
  if (!["Applied", "Responded", "Assessment", "Interview", "Offer", "Hired", "Rejected"].includes(b.status ?? "Applied")) return NextResponse.json({ ok: false, error: "unsupported status" }, { status: 400 });
  if (isTrackerWriting()) return NextResponse.json({ ok: false, error: "The tracker is being updated; try again in a moment." }, { status: 409 });
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
  const r = addTrackedFromScan(path.resolve(process.cwd(), ".."), careerOpsRoot(), { company: b.company, title: b.title, location: b.location ?? "", url: b.url, status: b.status ?? "Applied", today });
  return NextResponse.json(r, { status: r.ok ? 200 : 500 });
}
