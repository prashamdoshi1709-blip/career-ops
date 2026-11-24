// Discovery coverage for the Explore dashboard (2026-11-22). Read only, zero
// network: everything comes from files the scanners already write.
//
//   data/cache/ats-companies/<source>.json   the public directory per source
//   data/explore-coverage.json               last check per company, Australian employers, last run
//   data/explore-runs.jsonl                  one line per rotated run, with its rejection funnel
//   data/dead-boards.tsv                     boards retired after repeated 404s
//   data/portal-health.tsv                   tracked employers and job boards (scan.mjs)
//   data/scan-history.tsv                    every posting the portals scan has seen
//
// The health states mirror portal-health-status.mjs in the repository root
// (web code does not import root scripts at build time).
import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { classify, priorityTier } from "./opportunities.mjs";

export const DIRECTORY_SOURCES = ["greenhouse", "lever", "ashby", "workday"];
const DAY = 86_400_000;

const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const readLines = (p) => { try { return fs.readFileSync(p, "utf8").split("\n").filter(Boolean); } catch { return []; } };

function directorySize(root, src) {
  const list = readJson(path.join(root, "data", "cache", "ats-companies", `${src}.json`), null);
  return Array.isArray(list) ? list.length : null;
}

// Mirrors scan-ats-full.mjs's toEntry() rejections for a run that predates
// the recorded split: Workday rows whose tenant is a cluster name ("wd102")
// or whose parts fall outside the slug charset cannot name a board.
function unusableDirectoryRows(root, src) {
  if (src !== "workday") return 0;
  const list = readJson(path.join(root, "data", "cache", "ats-companies", "workday.json"), null);
  if (!Array.isArray(list)) return 0;
  const slug = /^[A-Za-z0-9._-]+$/;
  return list.filter((line) => { const p = String(line).split("|"); return p.length < 3 || !p.slice(0, 3).every((x) => x && slug.test(x)) || /^wd\d+$/i.test(p[0]); }).length;
}

function retiredBoards(root) {
  const out = Object.fromEntries(DIRECTORY_SOURCES.map((s) => [s, 0]));
  for (const line of readLines(path.join(root, "data", "dead-boards.tsv")).slice(1)) {
    const [ats, , misses] = line.split("\t");
    if (ats in out && Number(misses) >= 3) out[ats]++; // DEAD_BOARD_MISSES in dead-boards.mjs
  }
  return out;
}

/** Tracked employers and job boards: health state per portal from its latest scan. */
export function trackedPortalHealth(root) {
  const by = new Map();
  for (const line of readLines(path.join(root, "data", "portal-health.tsv")).slice(1)) {
    const [timestamp, company, status] = line.split("\t");
    if (!company) continue;
    if (!by.has(company)) by.set(company, []);
    by.get(company).push({ timestamp, status });
  }
  const counts = { Healthy: 0, "Temporarily rate-limited": 0, "Authentication required": 0, "Temporarily unavailable": 0, "Confirmed broken": 0, Unknown: 0 };
  let lastSuccess = null;
  for (const list of by.values()) {
    const last = list.at(-1);
    let streak = 0;
    for (let i = list.length - 1; i >= 0 && list[i].status === last.status; i--) streak++;
    const s = last.status;
    const state = s === "reachable" || s === "empty" ? "Healthy" : s === "rate_limited" ? "Temporarily rate-limited" : s === "auth" ? "Authentication required" : s === "network" || s === "server" ? "Temporarily unavailable" : s === "slug_gone" ? (streak >= 2 ? "Confirmed broken" : "Temporarily unavailable") : "Unknown";
    counts[state]++;
    for (const r of list) if ((r.status === "reachable" || r.status === "empty") && (!lastSuccess || r.timestamp > lastSuccess)) lastSuccess = r.timestamp;
  }
  return { portals: by.size, counts, lastSuccess };
}

/** Roles the portals scan added, by source, in the last `days` days. */
export function trackedFinds(root, days = 30, now = Date.now()) {
  const lines = readLines(path.join(root, "data", "scan-history.tsv"));
  const head = (lines[0] ?? "").split("\t");
  const iUrl = head.indexOf("url"), iSeen = head.indexOf("first_seen"), iPortal = head.indexOf("portal"), iStatus = head.indexOf("status");
  const bySource = {};
  let total = 0, recent = 0;
  for (const line of lines.slice(1)) {
    const c = line.split("\t");
    if (c[iStatus] !== "added" || !c[iUrl]) continue;
    total++;
    if (now - Date.parse(c[iSeen]) > days * DAY) continue;
    recent++;
    const src = String(c[iPortal] ?? "").replace(/-(api|full)$/, "") || "other";
    bySource[src] = (bySource[src] ?? 0) + 1;
  }
  return { total, recent, days, bySource };
}

/**
 * Specialist recruiter sources (2026-11-23): every portals.yml entry with
 * source_type: specialist_recruiter, its last check and outcome from
 * data/source-checks.tsv (postings returned) and data/portal-health.tsv, and
 * the roles it added, from scan-history.
 */
export function specialistRecruiters(root, now = Date.now()) {
  let entries = [];
  try {
    const cfg = yaml.load(fs.readFileSync(path.join(root, "portals.yml"), "utf8")) ?? {};
    entries = [...(cfg.tracked_companies ?? []), ...(cfg.job_boards ?? [])].filter((e) => e && e.source_type === "specialist_recruiter");
  } catch { entries = []; }
  const checks = new Map();
  for (const line of readLines(path.join(root, "data", "source-checks.tsv")).slice(1)) {
    const [timestamp, company, status, retrieved] = line.split("\t");
    if (!company) continue;
    if (!checks.has(company)) checks.set(company, []);
    checks.get(company).push({ timestamp, status, retrieved: retrieved === "" || retrieved == null ? null : Number(retrieved) });
  }
  const health = new Map();
  for (const line of readLines(path.join(root, "data", "portal-health.tsv")).slice(1)) {
    const [timestamp, company, status] = line.split("\t");
    if (company) health.set(company, { timestamp, status });
  }
  const lines = readLines(path.join(root, "data", "scan-history.tsv"));
  const head = (lines[0] ?? "").split("\t");
  const iC = head.indexOf("company"), iS = head.indexOf("status"), iSeen = head.indexOf("first_seen");
  const added = new Map();
  for (const line of lines.slice(1)) {
    const c = line.split("\t");
    if (c[iS] !== "added") continue;
    const k = String(c[iC] ?? "").toLowerCase();
    const o = added.get(k) ?? { total: 0, recent: 0 };
    o.total++;
    if (now - Date.parse(c[iSeen]) <= 30 * DAY) o.recent++;
    added.set(k, o);
  }
  return entries.map((e) => {
    const list = checks.get(e.name) ?? [];
    const last = list.at(-1) ?? null;
    const lastOk = [...list].reverse().find((r) => (r.status === "reachable" || r.status === "empty") && r.retrieved != null) ?? null;
    const h = health.get(e.name) ?? null;
    const a = added.get(String(e.name).toLowerCase()) ?? { total: 0, recent: 0 };
    const state = !e.enabled && e.enabled !== undefined ? "Disabled"
      : !last ? (h ? (h.status === "reachable" ? "Checked" : "Problem") : "Not checked yet")
      : last.status === "reachable" ? (last.retrieved > 0 ? "Listings retrieved" : "No listings returned")
      : last.status === "empty" ? "No listings returned"
      : last.status === "rate_limited" ? "Rate-limited"
      : "Failed";
    return {
      name: e.name,
      url: e.careers_url ?? null,
      method: e.recruiter?.strategy ?? e.provider ?? null,
      enabled: e.enabled !== false,
      lastChecked: last?.timestamp ?? h?.timestamp ?? null,
      lastStatus: last?.status ?? h?.status ?? null,
      retrieved: last?.retrieved ?? null,
      lastSuccess: lastOk?.timestamp ?? null,
      state,
      addedTotal: a.total,
      added30d: a.recent,
    };
  });
}

// ── Source analytics (2026-11-23) ───────────────────────────────────
// Seven rows: the four public ATS directories (scan-ats-full.mjs runs,
// data/explore-runs.jsonl) and SEEK, tracked employer sites and specialist
// recruiters (scan.mjs runs, data/source-runs.jsonl). "Latest scan" figures
// come from the newest run that covered the source; "30 days" figures come
// from data/scan-history.tsv (roles added to the inbox, and how many of them
// are in your priority-1/2 finance categories). A figure an older run never
// recorded is null ("not recorded"), never 0.
export const ANALYTICS_SOURCES = [
  ["greenhouse", "Greenhouse"], ["lever", "Lever"], ["ashby", "Ashby"], ["workday", "Workday"],
  ["seek", "SEEK"], ["employers", "Tracked employer websites"], ["recruiters", "Specialist recruitment firms"],
];

function groupOfPortal(portal) {
  const p = String(portal ?? "");
  const full = p.match(/^(greenhouse|lever|ashby|workday)-full$/);
  if (full) return full[1];
  if (p === "jobstreet-api") return "seek";
  if (p === "recruiter-site-api") return "recruiters";
  return p ? "employers" : null;
}

function fromDirectoryRun(run, src) {
  const f = run.funnelBySource?.[src] ?? (run.sources?.length === 1 && run.sources[0] === src ? run.funnel : null);
  if (!f) return null;
  const perSource = Boolean(run.funnelBySource?.[src]);
  const n = (k) => (typeof f[k] === "number" ? f[k] : null);
  const retrieved = (n("postingsSeen") ?? 0) + (n("postingsListedOnly") ?? 0);
  const matched = n("matched");
  return {
    at: run.at, mode: run.mode,
    companiesChecked: perSource ? n("successfulResponses") : n("boardsReached"),
    successful: perSource ? n("successfulResponses") : n("boardsReached"),
    failed: n("failed"), rateLimited: n("rateLimited"), deferred: n("deferredRateLimit") ?? 0,
    retrieved, matching: matched == null ? null : matched + (n("duplicates") ?? 0),
    newUnique: matched, added: run.mode === "sweep" ? (perSource ? n("matchesKept") : run.postingsKept ?? null) : 0,
    duplicates: n("duplicates"),
  };
}

function fromScanRun(run, group) {
  const g = run.groups?.[group];
  if (!g) return null;
  return {
    at: run.at, mode: run.kind,
    companiesChecked: g.ok, successful: g.ok, failed: g.failed, rateLimited: g.rateLimited, deferred: g.deferredRateLimit,
    retrieved: g.retrieved, matching: g.matched, newUnique: g.newUnique, added: g.added, duplicates: g.dupes,
  };
}

export function sourceAnalytics(root, now = Date.now()) {
  const dirRuns = readLines(path.join(root, "data", "explore-runs.jsonl")).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const scanRuns = readLines(path.join(root, "data", "source-runs.jsonl")).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const lines = readLines(path.join(root, "data", "scan-history.tsv"));
  const head = (lines[0] ?? "").split("\t");
  const iP = head.indexOf("portal"), iS = head.indexOf("status"), iSeen = head.indexOf("first_seen"), iT = head.indexOf("title"), iC = head.indexOf("company");
  const hist = {};
  for (const line of lines.slice(1)) {
    const c = line.split("\t");
    const g = groupOfPortal(c[iP]);
    if (!g) continue;
    const h = hist[g] ??= { seen30d: 0, added30d: 0, relevant30d: 0, addedAll: 0, relevantAll: 0 };
    const recent = now - Date.parse(c[iSeen]) <= 30 * DAY;
    if (recent) h.seen30d++;
    if (c[iS] !== "added") continue;
    const relevant = priorityTier(classify(c[iT], "", c[iC]).category) <= 2;
    h.addedAll++; if (relevant) h.relevantAll++;
    if (recent) { h.added30d++; if (relevant) h.relevant30d++; }
  }
  return ANALYTICS_SOURCES.map(([key, label]) => {
    const dir = ["greenhouse", "lever", "ashby", "workday"].includes(key);
    const runs = dir
      ? dirRuns.filter((r) => r.sources?.includes(key)).map((r) => fromDirectoryRun(r, key)).filter(Boolean)
      : scanRuns.map((r) => fromScanRun(r, key)).filter(Boolean);
    const latest = runs.at(-1) ?? null;
    const lastSuccess = [...runs].reverse().find((r) => (r.successful ?? 0) > 0)?.at ?? null;
    const h = hist[key] ?? { seen30d: 0, added30d: 0, relevant30d: 0, addedAll: 0, relevantAll: 0 };
    return {
      key, label, latest, lastSuccess, runsRecorded: runs.length,
      // Yield: roles added per 100 companies successfully checked in the
      // latest scan, and the share of the last 30 days' additions that are
      // priority-1/2 finance roles.
      latestYieldPer100: latest && latest.successful ? Math.round(((latest.added ?? 0) / latest.successful) * 1000) / 10 : null,
      added30d: h.added30d, relevant30d: h.relevant30d, addedAll: h.addedAll, relevantAll: h.relevantAll,
      relevantShare30d: h.added30d ? Math.round((h.relevant30d / h.added30d) * 100) : null,
    };
  });
}

/** Rate-limit circuits (data/rate-limit-state.json), for the coverage panel. */
export function rateLimitCircuits(root) {
  const s = readJson(path.join(root, "data", "rate-limit-state.json"), { circuits: {} });
  return Object.entries(s.circuits ?? {}).map(([key, c]) => ({ key, state: c.state ?? "closed", cooldownUntil: c.cooldownUntil ?? null, strikes: c.strikes ?? 0, lastLimitedAt: c.lastLimitedAt ?? null, lastOkAt: c.lastOkAt ?? null }));
}

/** Everything the coverage panel shows. Figures that were never recorded are null, never guessed. */
export function discoveryCoverage(root, now = Date.now()) {
  const cov = readJson(path.join(root, "data", "explore-coverage.json"), { sources: {}, au: {}, lastRun: {} });
  const retired = retiredBoards(root);
  const runs = readLines(path.join(root, "data", "explore-runs.jsonl")).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const sources = DIRECTORY_SOURCES.map((src) => {
    const seen = cov.sources?.[src] ?? {};
    const times = Object.values(seen).map((t) => Date.parse(t)).filter(Number.isFinite);
    const available = directorySize(root, src);
    const checked = times.length;
    // 2026-11-23: rows that cannot name a board (Workday's "wd102|..." rows)
    // are unusable, not retired; the sweep records the split it applied.
    const dir = cov.directory?.[src] ?? null;
    const unusable = dir?.unusable ?? unusableDirectoryRows(root, src);
    const attempts = Object.entries(cov.attempts?.[src] ?? {}).filter(([k]) => !seen[k]);
    const rateLimitedPending = attempts.length;
    const live = available == null ? null : Math.max(0, available - unusable - retired[src]);
    return {
      source: src,
      available,
      retired: retired[src],
      checked,
      checked30d: times.filter((t) => now - t <= 30 * DAY).length,
      remaining: live == null ? null : Math.max(0, live - checked),
      unusable,
      rateLimitedPending,
      neverAttempted: live == null ? null : Math.max(0, live - checked - rateLimitedPending),
      percent: live ? Math.round((checked / live) * 1000) / 10 : null,
      australianEmployers: Object.keys(cov.au?.[src] ?? {}).length,
      lastRun: cov.lastRun?.[src] ?? null,
    };
  });
  const lastRun = runs.at(-1) ?? null;
  // 2026-11-23: the latest scheduled sweep and the latest manual Explore run
  // are kept apart, so a one-board Explore preview never hides the sweep.
  const summarise = (r) => r ? { at: r.at, mode: r.mode, sources: r.sources, companiesScanned: r.companiesScanned ?? null, budgetStopped: Boolean(r.budgetStopped || r.stoppedEarly), funnel: r.funnel ?? null, postingsKept: r.postingsKept ?? null, deferredRateLimit: r.funnel?.deferredRateLimit ?? 0 } : null;
  const lastSweep = [...runs].reverse().find((r) => r.mode === "sweep") ?? null;
  const lastExplore = [...runs].reverse().find((r) => r.mode === "explore") ?? null;
  const sum = (k) => sources.reduce((n, s) => n + (s[k] ?? 0), 0);
  return {
    totals: { available: sum("available"), unusable: sum("unusable"), retired: sum("retired"), checked: sum("checked"), checked30d: sum("checked30d"), remaining: sum("remaining"), rateLimitedPending: sum("rateLimitedPending"), australianEmployers: sum("australianEmployers") },
    sources,
    lastSweep: summarise(lastSweep),
    lastExplore: summarise(lastExplore),
    lastRun: lastRun ? { at: lastRun.at, mode: lastRun.mode, sources: lastRun.sources, companiesScanned: lastRun.companiesScanned ?? null, budgetStopped: Boolean(lastRun.budgetStopped || lastRun.stoppedEarly), funnel: lastRun.funnel ?? null, postingsKept: lastRun.postingsKept ?? null } : null,
    runsRecorded: runs.length,
    canResume: true,
    tracked: { ...trackedPortalHealth(root), finds: trackedFinds(root, 30, now) },
    recruiters: specialistRecruiters(root, now),
    analytics: sourceAnalytics(root, now),
    circuits: rateLimitCircuits(root),
  };
}
