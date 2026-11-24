import { NextRequest } from "next/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadDocJobs } from "@/lib/doc-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Local customisation (2026-11-11): download the CV and cover letter of one or
// more jobs as a ZIP, with filenames naming the company and role. Only files
// inside output/applications that are linked to the requested jobs are included.
const safe = (s: string) => s.replace(/[\u2013\u2014]/g, "-").replace(/[^\x20-\x7E]/g, "").replace(/[\/\\:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 90);

export async function GET(req: NextRequest) {
  const keys = (req.nextUrl.searchParams.get("keys") ?? "").split(",").filter((k) => /^[tp][a-z0-9]+$/.test(k)).slice(0, 300);
  if (!keys.length) return new Response("no jobs selected", { status: 400 });
  const { root, jobs, statuses, keyOf } = loadDocJobs();
  const base = path.join(root, "output", "applications");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-docs-"));
  let n = 0;
  try {
    for (const key of keys) {
      const s = statuses[key];
      const job = jobs.find((j) => keyOf(j) === key);
      if (!s || !job) continue;
      for (const [rel, label] of [[s.cv, "CV"], [s.cover, "Cover Letter"]] as const) {
        if (!rel) continue;
        const abs = path.resolve(base, rel);
        if (!abs.startsWith(base + path.sep) || !fs.existsSync(abs)) continue;
        fs.copyFileSync(abs, path.join(tmp, `${safe(`${job.company} - ${job.title}`)} - ${label}.pdf`));
        n++;
      }
    }
    if (!n) return new Response("none of the selected jobs has documents yet", { status: 404 });
    const zip = path.join(tmp, "documents.zip");
    const r = spawnSync("/usr/bin/zip", ["-q", "-j", zip, ...fs.readdirSync(tmp).filter((f) => f.endsWith(".pdf")).map((f) => path.join(tmp, f))]);
    if (r.status !== 0) return new Response("could not create the ZIP", { status: 500 });
    const name = keys.length === 1 ? `${safe(`${jobs.find((j) => keyOf(j) === keys[0])?.company} - ${jobs.find((j) => keyOf(j) === keys[0])?.title}`)} - documents.zip` : `Application documents (${keys.length} jobs).zip`;
    return new Response(new Uint8Array(fs.readFileSync(zip)), { status: 200, headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`, "Cache-Control": "no-store" } });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
