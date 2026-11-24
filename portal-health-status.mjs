#!/usr/bin/env node
// Portal health states (2026-11-22), derived from data/portal-health.tsv.
//
//   Healthy                        last scan reached the board (jobs or empty)
//   Temporarily rate-limited       last result was HTTP 429; the scanner waits
//                                  out a backoff window instead of retrying
//   Authentication required        HTTP 401/403 (login wall or WAF)
//   Temporarily unavailable        network errors or 5xx
//   Confirmed broken               404/410 on two or more consecutive scans
//   Unknown                        never scanned, or an unclassified result
//
// Read-only. A 429 never changes a URL, never counts toward "broken", and is
// never bypassed: the board is skipped until its backoff window passes.
//
//   node portal-health-status.mjs            table
//   node portal-health-status.mjs --json     machine output
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { isMainModule } from './lib/is-main-module.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';

export const STATES = ['Healthy', 'Temporarily rate-limited', 'Authentication required', 'Temporarily unavailable', 'Confirmed broken', 'Unknown'];
const HOUR = 3600_000;
/** Backoff after consecutive 429s: 1h, 2h, 4h ... capped at 24h. */
export const rateLimitBackoffMs = (n) => Math.min(24 * HOUR, HOUR * 2 ** Math.max(0, n - 1));

export function readHealthRows(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').slice(1).map((l) => l.split('\t')).filter((p) => p.length >= 3 && p[0]).map(([timestamp, company, status]) => ({ timestamp, company, status }));
}

/** Per-company health from history rows (oldest first). */
export function portalHealth(rows, now = Date.now()) {
  const by = new Map();
  for (const r of rows) { if (!by.has(r.company)) by.set(r.company, []); by.get(r.company).push(r); }
  const out = new Map();
  for (const [company, list] of by) {
    const last = list.at(-1);
    let streak = 0;
    for (let i = list.length - 1; i >= 0 && list[i].status === last.status; i--) streak++;
    const ok = [...list].reverse().find((r) => r.status === 'reachable' || r.status === 'empty');
    let state;
    if (last.status === 'reachable' || last.status === 'empty') state = 'Healthy';
    else if (last.status === 'rate_limited') state = 'Temporarily rate-limited';
    else if (last.status === 'auth') state = 'Authentication required';
    else if (last.status === 'network' || last.status === 'server') state = 'Temporarily unavailable';
    else if (last.status === 'slug_gone') state = streak >= 2 ? 'Confirmed broken' : 'Temporarily unavailable';
    else state = 'Unknown';
    const retryAfter = state === 'Temporarily rate-limited' ? new Date(Date.parse(last.timestamp) + rateLimitBackoffMs(streak)).toISOString() : null;
    out.set(company, { company, state, lastStatus: last.status, lastCheckedAt: last.timestamp, lastSuccessAt: ok?.timestamp ?? null, consecutive: streak, retryAfter, deferred: Boolean(retryAfter && Date.parse(retryAfter) > now) });
  }
  return out;
}

/** Companies whose rate-limit backoff has not yet passed. */
export function deferredByRateLimit(rows, now = Date.now()) {
  return new Map([...portalHealth(rows, now)].filter(([, h]) => h.deferred));
}

function main(args) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: node portal-health-status.mjs [--json]\n  Portal health states from data/portal-health.tsv (read-only).');
    return;
  }
  const file = path.join(getCareerOpsRoot(), 'data', 'portal-health.tsv');
  const health = [...portalHealth(readHealthRows(file)).values()];
  const counts = Object.fromEntries(STATES.map((s) => [s, health.filter((h) => h.state === s).length]));
  if (args.includes('--json')) { console.log(JSON.stringify({ file, counts, portals: health }, null, 2)); return; }
  console.log(`Portal health from ${path.relative(process.cwd(), file) || file} (${health.length} portals with history)`);
  for (const s of STATES) console.log(`  ${s.padEnd(26)} ${counts[s]}`);
  for (const h of health.filter((x) => x.state !== 'Healthy').sort((a, b) => STATES.indexOf(a.state) - STATES.indexOf(b.state))) {
    console.log(`  - ${h.state}: ${h.company} (last ${h.lastStatus} ×${h.consecutive} at ${h.lastCheckedAt.slice(0, 16)}; last success ${h.lastSuccessAt?.slice(0, 10) ?? 'never'}${h.retryAfter ? `; next attempt after ${h.retryAfter.slice(0, 16)}` : ''})`);
  }
}

if (isMainModule(import.meta.url)) main(process.argv.slice(2));
