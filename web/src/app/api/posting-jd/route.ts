import { NextResponse } from "next/server";
import { careerOpsRoot } from "@/lib/career-ops";
import { readJsonObject } from "@/lib/json-body";
import { savePostingJd } from "@/lib/screening.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Local customisation (2026-11-11): save a job description the candidate pasted
// for a scan find (SEEK and LinkedIn pages are never fetched automatically).
// File write only; no Claude call.
export async function POST(req: Request) {
  const b = await readJsonObject<{ url?: string; company?: string; title?: string; location?: string; jd?: string }>(req);
  const jd = String(b?.jd ?? "").replace(/\r\n?/g, "\n").trim();
  if (!b?.url || !/^https?:\/\//.test(b.url) || !b.company || !b.title) return NextResponse.json({ ok: false, error: "url, company and title required" }, { status: 400 });
  if (jd.length < 300) return NextResponse.json({ ok: false, error: "Paste the full job description (at least a paragraph or two)." }, { status: 400 });
  savePostingJd(careerOpsRoot(), { url: b.url, company: b.company, title: b.title, location: b.location ?? "" }, jd, "pasted by you");
  return NextResponse.json({ ok: true });
}
