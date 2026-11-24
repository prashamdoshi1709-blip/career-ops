/**
 * Flags for one scan-ats-full.mjs child, after the script path. Explore always
 * caps each source, so it asks for a rotation (2026-11-22; before, a shuffled
 * sample): companies never scanned first, then the least recently scanned, so
 * repeated runs cover the whole directory instead of overlapping samples.
 *
 * @param {{ ats: string[], json: boolean, sinceDays: number, limitPerAts: number, budgetSeconds?: number }} options
 * @returns {string[]}
 */
export function scannerArgs({ ats, json, sinceDays, limitPerAts, budgetSeconds = 0 }) {
  // 2026-11-22: limitPerAts 0 means no company cap. The run is bounded by
  // --budget-seconds instead (set just inside Explore's deadline), stops
  // cleanly, and the next run continues through the directory.
  const args = [
    "--dry-run",
    "--since",
    String(Math.max(1, sinceDays || 7)),
    "--ats",
    ats.join(","),
    ...(limitPerAts > 0 ? ["--limit", String(limitPerAts)] : []),
    "--rotate",
    ...(budgetSeconds > 0 ? ["--budget-seconds", String(Math.floor(budgetSeconds))] : []),
  ];
  if (json) args.push("--json");
  return args;
}
