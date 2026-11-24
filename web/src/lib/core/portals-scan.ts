import { spawn } from "node:child_process";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";
import type { DiscoveredOffer, ScanEvent } from "@/lib/explore";

// ── Australian finance sources (2026-11-23) ─────────────────────────────
// Explore searched only the four public ATS directories (Greenhouse, Lever,
// Ashby, Workday), which hold few Australian finance roles: of 208,841 postings
// in a full sweep, 543 passed date and title and 540 of those were outside
// Australia. The sources that found ~98% of relevant roles in the last 30 days
// are SEEK, the specialist recruiters and the tracked employer sites — the
// portals scan (scan.mjs). Explore now runs it first, as a dry run (nothing is
// written; the scheduled scans keep adding to the inbox), with the same Explore
// filters, and reports each group's results.
export const AU_GROUPS = ["seek", "recruiters", "employers"] as const;
export const AU_GROUP_LABEL: Record<string, string> = { seek: "SEEK", recruiters: "Specialist recruiters", employers: "Employer sites" };
type PortalsReceipt = { offers?: { title: string; company: string; location: string | null; url: string; postedAt: string | null; dateStatus?: string; group: string | null; source: string | null }[]; groups?: Record<string, { targets: number; ok: number; failed: number; rateLimited: number; deferredRateLimit: number; retrieved: number; matched: number; dupes: number; newUnique: number }>; found?: number; duplicates?: number };

export function runPortalsScan(tempPortals: string, timeoutMs: number, onEvent: (e: ScanEvent) => void): Promise<{ receipt: PortalsReceipt | null; timedOut: boolean; failed?: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [rootScript("scan"), "--dry-run", "--json", "--quiet"], {
      cwd: careerOpsRoot(),
      env: { ...process.env, CAREER_OPS_PORTALS: tempPortals },
    });
    let out = "";
    let timedOut = false;
    let done = false;
    const finish = (r: { receipt: PortalsReceipt | null; timedOut: boolean; failed?: string }) => { if (done) return; done = true; clearTimeout(killer); resolve(r); };
    const killer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, timeoutMs);
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.stderr.on("data", () => { /* provider warnings: not shown */ });
    onEvent({ kind: "log", line: "Searching SEEK, specialist recruiters and tracked employer sites…" });
    child.on("error", (e) => finish({ receipt: null, timedOut, failed: e.message }));
    child.on("close", () => {
      const line = out.trim().split("\n").filter((l) => l.trim().startsWith("{")).pop();
      try { finish({ receipt: line ? JSON.parse(line) : null, timedOut, ...(line ? {} : { failed: "no result" }) }); }
      catch { finish({ receipt: null, timedOut, failed: "unreadable result" }); }
    });
  });
}

/** `decorate(title)` adds the same matchedKeyword / fit fields the directory offers carry (scan.ts). */
export function ingestPortalsOffers(receipt: PortalsReceipt, sink: { offers: DiscoveredOffer[]; seen: Set<string> }, onEvent: (e: ScanEvent) => void, decorate: (title: string) => Partial<DiscoveredOffer>) {
  for (const o of receipt.offers ?? []) {
    const url = (o.url || "").trim();
    if (!url || sink.seen.has(url) || !o.title || !o.company) continue;
    sink.seen.add(url);
    const offer: DiscoveredOffer = {
      company: o.company,
      title: o.title,
      location: o.location || "",
      postedAt: o.postedAt || "",
      ats: o.group || "employers",
      source: o.source || o.group || "portals",
      url,
      ...decorate(o.title),
    };
    sink.offers.push(offer);
    onEvent({ kind: "offer", offer });
  }
}

