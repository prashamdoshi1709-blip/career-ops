// Explore caps each source at a few hundred companies. Without --shuffle the
// scanner takes the dataset's alphabetical prefix, so every Explore saw the
// same companies whose names start with a digit or "a". A shuffled sample fixed
// that but overlapped from run to run; --rotate (2026-11-22) covers the directory.
//
// Run:  node --test tests/lib/scan-args.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scannerArgs } from "../../src/lib/core/scan-args.mjs";

const CORE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

// scan-ats-full.mjs imports js-yaml, which a web-only install does not have.
let scanner = null;
try {
  scanner = await import(path.join(CORE, "scan-ats-full.mjs"));
} catch {
  scanner = null;
}

const DIRECTORY = Array.from({ length: 2000 }, (_, i) => `company-${String(i).padStart(4, "0")}`);

test("Explore rotates through the whole directory: successive runs never overlap until it is covered (2026-11-22)", { skip: !scanner }, () => {
  const argv = ["node", "scan-ats-full.mjs", ...scannerArgs({ ats: ["greenhouse"], json: true, sinceDays: 7, limitPerAts: 150 })];
  const opts = scanner.parseArgs(argv);
  assert.equal(opts.dryRun, true); assert.equal(opts.rotate, true);
  const seen = {};
  const runs = [];
  for (let r = 0; r < 3; r++) {
    const pick = scanner.rotateCompanies(DIRECTORY, opts.limit, seen);
    assert.equal(pick.length, 150);
    const at = new Date(Date.UTC(2026, 10, 1 + r)).toISOString();
    for (const x of pick) seen[scanner.companyKey(x)] = at;
    runs.push(pick);
  }
  assert.equal(new Set(runs.flat()).size, 450, "three runs cover 450 distinct companies");
  const cov = scanner.coverageSummary(DIRECTORY, seen, Date.UTC(2026, 10, 10));
  assert.deepEqual(cov, { available: 2000, coveredEver: 450, covered30d: 450, notYetScanned: 1550, rateLimitedPending: 0, neverAttempted: 1550, australianEmployers: 0 });
});

test("rotation puts finance-named employers first, then the least recently scanned", { skip: !scanner }, () => {
  const dir = ["acme-retail", "harbour-capital", "zeta-foods", "north-bank"];
  assert.deepEqual(scanner.rotateCompanies(dir, 2, {}), ["harbour-capital", "north-bank"]);
  const seen = { "acme-retail": "2026-11-05T00:00:00Z", "harbour-capital": "2026-11-01T00:00:00Z", "zeta-foods": "2026-11-03T00:00:00Z", "north-bank": "2026-11-04T00:00:00Z" };
  assert.deepEqual(scanner.rotateCompanies(dir, 4, seen), ["harbour-capital", "zeta-foods", "north-bank", "acme-retail"]);
});

test("scannerArgs keeps the window, sources, cap and output mode Explore asked for", () => {
  assert.deepEqual(
    scannerArgs({ ats: ["greenhouse", "lever"], json: false, sinceDays: 30, limitPerAts: 300 }),
    ["--dry-run", "--since", "30", "--ats", "greenhouse,lever", "--limit", "300", "--rotate"],
  );
  assert.deepEqual(
    scannerArgs({ ats: ["ashby"], json: true, sinceDays: 0, limitPerAts: 0 }),
    ["--dry-run", "--since", "7", "--ats", "ashby", "--rotate", "--json"],
  );
  // 2026-11-22: no company cap by default; the run is bounded by time instead.
  assert.deepEqual(
    scannerArgs({ ats: ["lever"], json: true, sinceDays: 30, limitPerAts: 0, budgetSeconds: 205 }),
    ["--dry-run", "--since", "30", "--ats", "lever", "--rotate", "--budget-seconds", "205", "--json"],
  );
});


test("employers seen posting Australian roles are rechecked first (2026-11-22)", { skip: !scanner }, () => {
  const dir = ["acme-retail", "harbour-capital", "zeta-foods", "north-bank"];
  const now = Date.UTC(2026, 10, 22, 12);
  const seen = { "acme-retail": "2026-11-22T00:00:00Z", "zeta-foods": "2026-11-21T00:00:00Z" };
  const au = { "zeta-foods": "2026-11-21T00:00:00Z" };
  assert.deepEqual(scanner.rotateCompanies(dir, 4, seen, { au, now }), ["zeta-foods", "harbour-capital", "north-bank", "acme-retail"]);
  // Checked within the last 6 hours: not pulled forward again.
  assert.deepEqual(scanner.rotateCompanies(dir, 1, { ...seen, "zeta-foods": "2026-11-22T10:00:00Z" }, { au, now }), ["harbour-capital"]);
});
