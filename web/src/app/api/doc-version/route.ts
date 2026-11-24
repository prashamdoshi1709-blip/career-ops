import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { inlineDisposition } from "@/lib/content-disposition.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Local customisation (2026-11-10): open or download any saved version of a
// tailored CV or cover letter. Only PDFs inside output/applications are served.
export async function GET(req: NextRequest) {
  const rel = req.nextUrl.searchParams.get("file") ?? "";
  const base = path.resolve(careerOpsRoot(), "output", "applications");
  const abs = path.resolve(base, rel);
  if (!rel || !abs.startsWith(base + path.sep) || !abs.endsWith(".pdf")) return new Response("not found", { status: 404 });
  let real: string;
  try { real = fs.realpathSync(abs); } catch { return new Response("not found", { status: 404 }); }
  if (!real.startsWith(fs.realpathSync(base) + path.sep) || !fs.statSync(real).isFile()) return new Response("not found", { status: 404 });
  const name = path.basename(real);
  const download = req.nextUrl.searchParams.get("download") === "1";
  return new Response(new Uint8Array(fs.readFileSync(real)), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": download ? `attachment; filename*=UTF-8''${encodeURIComponent(name)}` : inlineDisposition(name),
      "Cache-Control": "no-store",
    },
  });
}
