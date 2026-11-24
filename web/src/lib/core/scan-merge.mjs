// Pure helpers for runDiscovery's per-source fan-out (scan.ts). Plain .mjs (same
// pattern as explore-error.mjs) so tests/lib/scan-merge.test.mjs can import them
// without a TS runner.
//
// WHY PER-SOURCE: scan-ats-full.mjs --json prints its one result object only on
// exit. A single child spanning every source therefore lost ALL results when the
// slowest source hit the route's deadline — in practice Workday, whose enterprise
// boards page slowly and rate-limit — and the UI reported the kill as "The scanner
// returned no readable output." One child per source keeps every source that
// finished, and names the one that didn't.

/**
 * Fold per-source --json results into the single `summary` event the Explore UI
 * already consumes. Counts add; capHit is true if any source was capped; dataset
 * statuses merge by source name.
 *
 * @param {Array<{companiesScanned?: number, unreachableBoards?: number, postingsKept?: number,
 *   companiesAvailable?: number, capHit?: boolean, datasetStatus?: Record<string, string>,
 *   postingsDroppedNoDate?: number}>} results Parsed --json objects of the sources that finished.
 * @param {number} offerCount Offers actually surfaced — the fallback when no source reports postingsKept.
 */
export function mergeScanResults(results, offerCount) {
  const sum = (key) => results.reduce((n, r) => n + (typeof r[key] === "number" ? r[key] : 0), 0);
  const anyNumber = (key) => results.some((r) => typeof r[key] === "number");
  const datasetStatus = {};
  for (const r of results) Object.assign(datasetStatus, r.datasetStatus || {});
  const coverage = {};
  for (const r of results) Object.assign(coverage, r.coverage || {});
  return {
    companiesScanned: sum("companiesScanned"),
    unreachable: sum("unreachableBoards"),
    matches: anyNumber("postingsKept") ? sum("postingsKept") : offerCount,
    ...(anyNumber("companiesAvailable") ? { companiesAvailable: sum("companiesAvailable") } : {}),
    capHit: results.some((r) => r.capHit === true),
    datasetStatus,
    ...(Object.keys(coverage).length ? { coverage } : {}),
    ...(anyNumber("postingsDroppedNoDate") ? { postingsDroppedNoDate: sum("postingsDroppedNoDate") } : {}),
  };
}

function joinLabels(labels) {
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/**
 * User-facing copy for sources whose results are incomplete because they ran out
 * of time (a stopped source keeps only what it found before the deadline). Names
 * the sources and the levers that fix it, instead of the generic "no readable
 * output" that read as a broken install.
 *
 * @param {string[]} labels Display names of the timed-out sources (e.g. ["Workday"]).
 * @param {number} deadlineSec The deadline they missed, in seconds.
 */
export function timedOutMessage(labels, deadlineSec) {
  const names = joinLabels(labels);
  const plural = labels.length > 1;
  return (
    `${names} didn't finish within ${deadlineSec}s, so ${plural ? "their" : "its"} results are incomplete. ` +
    `Try again without ${names}, with a shorter date range or a lower per-source limit, ` +
    `or raise scan.timeout_seconds in config/profile.yml.`
  );
}

/**
 * One state per source for an Explore run (2026-11-23), from its --json
 * result: "completed" (ran to the end), "partial" (stopped at its time limit
 * or deadline; the next run continues from the rotation checkpoint),
 * "blocked" (rate-limited or paused by a rate-limit circuit, nothing
 * answered) or "unavailable" (no result at all).
 *
 * @param {string} source
 * @param {{ json?: object|null, timedOut?: boolean, failed?: string|null }} run
 * @returns {{ source: string, state: "completed"|"partial"|"blocked"|"unavailable", note: string }}
 */
export function sourceState(source, run = {}) {
  const j = run.json;
  if (!j) return { source, state: "unavailable", note: run.timedOut ? "no result before the deadline" : (run.failed || "no result") };
  const f = j.funnelBySource?.[source] ?? j.funnel ?? {};
  const ok = typeof f.successfulResponses === "number" ? f.successfulResponses : (f.boardsReached ?? 0);
  const limited = (f.rateLimited ?? 0) + (f.deferredRateLimit ?? 0);
  if (ok === 0 && limited > 0) return { source, state: "blocked", note: `rate-limited (${f.rateLimited ?? 0}) or paused (${f.deferredRateLimit ?? 0}); retried automatically later` };
  const counts = `${ok} boards answered, ${f.matched ?? 0} new matches, ${f.duplicates ?? 0} already in Career-Ops${f.undatedKept ? `, ${f.undatedKept} with an unknown posting date` : ""}${limited ? `, ${limited} rate-limited or paused` : ""}`;
  if (run.timedOut || j.stoppedEarly || j.budgetStopped) return { source, state: "partial", note: `time limit reached; the next run continues where this one stopped; ${counts}` };
  return { source, state: "completed", note: counts };
}

/**
 * State of one portals-scan group (SEEK, recruiters, employer sites) for an
 * Explore run (2026-11-23), from scan.mjs's --json receipt.
 *
 * @param {string} group
 * @param {{ receipt?: any, timedOut?: boolean, failed?: string }} run
 * @returns {{ source: string, state: "completed"|"partial"|"blocked"|"unavailable", note: string }}
 */
export function portalsGroupState(group, run = {}) {
  const g = run.receipt?.groups?.[group];
  if (!run.receipt || !g) return { source: group, state: "unavailable", note: run.timedOut ? "no result before the deadline" : (run.failed || "no result") };
  const limited = (g.rateLimited ?? 0) + (g.deferredRateLimit ?? 0);
  if (g.ok === 0 && limited > 0) return { source: group, state: "blocked", note: `rate-limited (${g.rateLimited}) or paused (${g.deferredRateLimit}); retried automatically later` };
  if (run.timedOut) return { source: group, state: "partial", note: "time limit reached" };
  const bits = [`${g.ok} of ${g.targets} sources answered`, `${g.retrieved} postings`, `${g.matched} matching your criteria`, `${g.dupes} already in Career-Ops`, `${g.newUnique} new`];
  if (g.failed) bits.push(`${g.failed} failed`);
  if (limited) bits.push(`${limited} rate-limited or paused`);
  return { source: group, state: g.failed || limited ? "partial" : "completed", note: bits.join(", ") };
}
