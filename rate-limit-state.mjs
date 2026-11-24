// rate-limit-state.mjs — persistent, shared rate-limit circuits (2026-11-23).
//
// Why: on 2026-11-22 Workday began answering this machine's scanner with
// HTTP 429 on the first request to almost every tenant on its wd1/wd3/wd5/wd12
// clusters, hours after a burst of directory sweeps, and gave no Retry-After.
// Each board was still tried (and retried three times), so every run spent its
// Workday time re-provoking the limit, and the tracked employers that actually
// produce roles (Houlihan Lokey, RBC, MUFG, PwC...) shared that penalty.
//
// What: one circuit per host group (Workday: the wdN cluster), stored in
// data/rate-limit-state.json and read by both scanners (scan.mjs and
// scan-ats-full.mjs), so neither hammers a cluster the other just found
// limited.
//   closed     requests flow; LIMIT_STREAK consecutive 429s open it.
//   open       no requests until cooldownUntil (3h, doubling per repeat
//              strike, capped at 48h, with +/-15% jitter so runs do not
//              re-arrive in lockstep). A Retry-After longer than that wins.
//   half-open  after the cooldown exactly ONE probe request is allowed; a
//              success closes the circuit, a 429 re-opens it with the next
//              (longer) cooldown.
// Never a retry storm, never a proxy or a different client: the scanner waits.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const LIMIT_STREAK = 3;
export const BASE_COOLDOWN_MS = 3 * 3_600_000;
export const MAX_COOLDOWN_MS = 48 * 3_600_000;
const PROBE_LEASE_MS = 10 * 60_000;

/** Circuit key for a board URL, or null when the host has no shared limiter we track. */
export function circuitKeyFor(url) {
  let host;
  try { host = new URL(String(url)).hostname.toLowerCase(); } catch { return null; }
  const wd = host.match(/^[a-z0-9-]+\.(wd\d+)\.myworkdayjobs\.com$/);
  return wd ? `workday:${wd[1]}` : null;
}

export function readRateLimitState(file) {
  try { const s = JSON.parse(readFileSync(file, 'utf8')); return s && typeof s === 'object' && s.circuits ? s : { version: 1, circuits: {} }; }
  catch { return { version: 1, circuits: {} }; }
}

export function writeRateLimitState(file, state) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(tmp, file);
}

/** Pure: cooldown for the n-th strike (1-based), jittered by `rand` in [0,1). */
export function cooldownMs(strikes, rand = Math.random(), retryAfterMs = null) {
  const base = Math.min(MAX_COOLDOWN_MS, BASE_COOLDOWN_MS * 2 ** Math.max(0, strikes - 1));
  const jittered = Math.round(base * (0.85 + 0.3 * rand));
  return Math.min(MAX_COOLDOWN_MS, Math.max(jittered, Number.isFinite(retryAfterMs) ? retryAfterMs : 0));
}

/**
 * Pure: may a request go to this circuit now?
 * @returns {{ allow: boolean, probe: boolean, until: string|null, state: string }}
 */
export function gate(circuit, now = Date.now()) {
  if (!circuit || circuit.state === 'closed' || !circuit.state) return { allow: true, probe: false, until: null, state: 'closed' };
  const until = Date.parse(circuit.cooldownUntil ?? '');
  if (Number.isFinite(until) && now < until) return { allow: false, probe: false, until: circuit.cooldownUntil, state: 'open' };
  // Cooldown over: one probe at a time (a lease, so a crashed probe frees it).
  const lease = Date.parse(circuit.probeLeaseUntil ?? '');
  if (Number.isFinite(lease) && now < lease) return { allow: false, probe: false, until: circuit.probeLeaseUntil, state: 'half-open' };
  return { allow: true, probe: true, until: null, state: 'half-open' };
}

/** Pure: next circuit after one outcome ('ok' | 'limited'). */
export function nextCircuit(circuit = {}, outcome, { now = Date.now(), rand = Math.random(), retryAfterMs = null } = {}) {
  const c = { state: 'closed', strikes: 0, streak: 0, ...circuit };
  const iso = new Date(now).toISOString();
  if (outcome === 'ok') {
    const wasOpen = c.state !== 'closed';
    return { ...c, state: 'closed', streak: 0, lastOkAt: iso, probeLeaseUntil: null, cooldownUntil: null, ...(wasOpen ? { closedAt: iso } : {}),
      // A strike decays after a full day without a limit, so one bad day does
      // not make every later cooldown 48h.
      strikes: wasOpen ? c.strikes : (c.lastLimitedAt && now - Date.parse(c.lastLimitedAt) > 24 * 3_600_000 ? 0 : c.strikes) };
  }
  if (outcome !== 'limited') return c;
  const streak = c.streak + 1;
  const halfOpen = c.state !== 'closed';
  if (!halfOpen && streak < LIMIT_STREAK) return { ...c, streak, lastLimitedAt: iso };
  const strikes = c.strikes + 1;
  return { ...c, state: 'open', streak, strikes, lastLimitedAt: iso, openedAt: iso, probeLeaseUntil: null,
    cooldownUntil: new Date(now + cooldownMs(strikes, rand, retryAfterMs)).toISOString() };
}

/**
 * A small stateful wrapper for one scan run. Reads the file once, keeps the
 * circuits in memory, and writes the file after every change (the file is
 * tiny), re-reading first so the other scanner's changes are merged, not lost.
 */
export function openRateLimitBook(file, { now = () => Date.now() } = {}) {
  const merge = (fn) => {
    const s = existsSync(file) ? readRateLimitState(file) : { version: 1, circuits: {} };
    fn(s);
    try { writeRateLimitState(file, s); } catch (e) { console.error(`rate-limit state not saved: ${e.message}`); }
    return s;
  };
  let snapshot = readRateLimitState(file);
  const deferred = new Map();
  return {
    /** null when no tracked circuit; else the gate decision (probe lease taken when it is a probe). */
    check(url) {
      const key = circuitKeyFor(url);
      if (!key) return null;
      const g = gate(snapshot.circuits[key], now());
      if (g.allow && g.probe) {
        snapshot = merge((s) => { const c = s.circuits[key] ?? {}; s.circuits[key] = { ...c, probeLeaseUntil: new Date(now() + PROBE_LEASE_MS).toISOString() }; });
      }
      if (!g.allow) deferred.set(key, (deferred.get(key) ?? 0) + 1);
      return { key, ...g };
    },
    record(url, outcome, retryAfterMs = null) {
      const key = circuitKeyFor(url);
      if (!key) return null;
      const before = snapshot.circuits[key]?.state ?? 'closed';
      snapshot = merge((s) => { s.circuits[key] = nextCircuit(s.circuits[key], outcome, { now: now(), retryAfterMs }); });
      const after = snapshot.circuits[key];
      if (before !== after.state) console.error(`rate-limit: ${key} ${before} → ${after.state}${after.cooldownUntil ? ` until ${after.cooldownUntil.slice(0, 16)}Z` : ''}`);
      return after;
    },
    deferredCounts: () => Object.fromEntries(deferred),
    state: () => snapshot,
  };
}
