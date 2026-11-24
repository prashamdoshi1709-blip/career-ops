import { NextResponse } from "next/server";
import { careerOpsRoot } from "@/lib/career-ops";
import { discoveryCoverage } from "@/lib/discovery-coverage.mjs";

export const dynamic = "force-dynamic";

// Discovery coverage for Explore (2026-11-22). Read only; no network.
export async function GET() {
  return NextResponse.json(discoveryCoverage(careerOpsRoot()));
}
