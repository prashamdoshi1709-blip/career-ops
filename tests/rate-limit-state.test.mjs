// tests/rate-limit-state.test.mjs — Workday rate-limit handling (2026-11-23).
//
// From 2026-11-22 Workday answered this machine's scanner with HTTP 429 on the
// first request to almost every tenant on wd1/wd3/wd5/wd12, and each board was
// still tried and retried three times, so a 300-second sweep checked about a
// dozen boards and the coverage counter sat at 45. These tests pin the fixes:
// a shared circuit per cluster that opens after repeated 429s and lets exactly
// one probe through after a jittered cooldown; no in-board retry on 429; and
// coverage that tells "rate-limited, waiting" apart from "never attempted".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { circuitKeyFor, gate, nextCircuit, cooldownMs, openRateLimitBook, LIMIT_STREAK, BASE_COOLDOWN_MS, MAX_COOLDOWN_MS } from '../rate-limit-state.mjs';
import { fetchJsonWithRetry } from '../providers/_http.mjs';
import { rotateCompanies, coverageSummary } from '../scan-ats-full.mjs';

const H = 3_600_000;

test('circuit keys group Workday tenants by cluster and ignore other hosts', () => {
  assert.equal(circuitKeyFor('https://cba.wd3.myworkdayjobs.com/commbank_careers'), 'workday:wd3');
  assert.equal(circuitKeyFor('https://hl.wd1.myworkdayjobs.com/lateral'), 'workday:wd1');
  assert.equal(circuitKeyFor('https://boards.greenhouse.io/x'), null);
  assert.equal(circuitKeyFor('not a url'), null);
});

test('opens only after LIMIT_STREAK consecutive 429s; a success resets the streak', () => {
  let c = {};
  for (let i = 1; i < LIMIT_STREAK; i++) { c = nextCircuit(c, 'limited', { now: 0, rand: 0.5 }); assert.equal(c.state, 'closed'); }
  c = nextCircuit(c, 'ok', { now: 1 });
  assert.equal(c.streak, 0);
  for (let i = 0; i < LIMIT_STREAK; i++) c = nextCircuit(c, 'limited', { now: 2, rand: 0.5 });
  assert.equal(c.state, 'open');
  assert.equal(c.strikes, 1);
});

test('open circuit sends nothing until the cooldown, then exactly one probe', () => {
  const now = Date.parse('2026-11-23T00:00:00Z');
  let c = {};
  for (let i = 0; i < LIMIT_STREAK; i++) c = nextCircuit(c, 'limited', { now, rand: 0.5 });
  assert.equal(gate(c, now + 1).allow, false);
  const after = Date.parse(c.cooldownUntil) + 1;
  const g = gate(c, after);
  assert.equal(g.allow, true);
  assert.equal(g.probe, true);
  // a second caller while the probe lease is held is refused
  assert.equal(gate({ ...c, probeLeaseUntil: new Date(after + 60_000).toISOString() }, after + 1).allow, false);
  // probe fails → re-opens with a longer cooldown; probe succeeds → closed
  const reopened = nextCircuit(c, 'limited', { now: after, rand: 0.5 });
  assert.equal(reopened.state, 'open');
  assert.equal(reopened.strikes, 2);
  assert.ok(Date.parse(reopened.cooldownUntil) - after > Date.parse(c.cooldownUntil) - now);
  assert.equal(nextCircuit(c, 'ok', { now: after }).state, 'closed');
});

test('cooldown doubles per strike with jitter, is capped, and honours a longer Retry-After', () => {
  assert.ok(Math.abs(cooldownMs(1, 0.5) - BASE_COOLDOWN_MS) < 1000);
  assert.ok(cooldownMs(2, 0.5) > cooldownMs(1, 0.5));
  assert.ok(cooldownMs(1, 0) < cooldownMs(1, 0.999));
  assert.ok(cooldownMs(20, 0.999) <= MAX_COOLDOWN_MS);
  assert.equal(cooldownMs(1, 0.5, 10 * H), 10 * H);
});

test('the book persists circuits so the other scanner sees them', () => {
  const dir = mkdtempSync(join(tmpdir(), 'co-rl-'));
  try {
    const f = join(dir, 'rate-limit-state.json');
    let t = Date.parse('2026-11-23T00:00:00Z');
    const a = openRateLimitBook(f, { now: () => t });
    const url = 'https://x.wd3.myworkdayjobs.com/site';
    for (let i = 0; i < LIMIT_STREAK; i++) a.record(url, 'limited');
    const b = openRateLimitBook(f, { now: () => t });
    assert.equal(b.check(url).allow, false);
    assert.equal(b.check('https://y.wd105.myworkdayjobs.com/s').allow, true);
    assert.deepEqual(b.deferredCounts(), { 'workday:wd3': 1 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('retryOn429:false ends a request on its first 429; 5xx is still retried', async () => {
  let calls = 0;
  const ctx = { fetchJson: async () => { calls++; const e = new Error('HTTP 429'); e.status = 429; throw e; }, sleep: async () => {} };
  await assert.rejects(fetchJsonWithRetry(ctx, 'https://x', {}, { retries: 3, retryOn429: false, baseDelayMs: 1, maxDelayMs: 2 }));
  assert.equal(calls, 1);
  calls = 0;
  const ctx5 = { fetchJson: async () => { calls++; const e = new Error('HTTP 503'); e.status = 503; throw e; }, sleep: async () => {} };
  await assert.rejects(fetchJsonWithRetry(ctx5, 'https://x', {}, { retries: 2, retryOn429: false, baseDelayMs: 1, maxDelayMs: 2 }));
  assert.equal(calls, 3);
});

test('workday.mjs does not retry 429 inside a board', async () => {
  const { readFileSync } = await import('node:fs');
  assert.match(readFileSync(new URL('../providers/workday.mjs', import.meta.url), 'utf8'), /RETRY_POLICY = \{ retries: 3, retryOn429: false \}/);
});

test('rotation: never-checked Australian finance boards come first', () => {
  const list = ['acme|wd1|careers', 'bigbank|wd3|careers', 'ozco|wd3|careers_aus', 'ozcapital|wd3|australia_jobs'];
  assert.deepEqual(rotateCompanies(list, 4, {}), ['ozcapital|wd3|australia_jobs', 'ozco|wd3|careers_aus', 'bigbank|wd3|careers', 'acme|wd1|careers']);
});

test('coverage separates rate-limited-waiting from never attempted', () => {
  const list = ['a|wd1|s', 'b|wd1|s', 'c|wd1|s'];
  const r = coverageSummary(list, { 'a|wd1|s': new Date().toISOString() }, Date.now(), 30, {}, { 'b|wd1|s': { outcome: 'rate_limited' } });
  assert.equal(r.coveredEver, 1);
  assert.equal(r.rateLimitedPending, 1);
  assert.equal(r.neverAttempted, 1);
  assert.equal(r.notYetScanned, 2);
});

test('the portals health check sends nothing to a paused Workday cluster and calls it temporary', async () => {
  const { verifyCompanies } = await import('../verify-portals.mjs');
  let calls = 0;
  const fetchJson = async () => { calls++; return { total: 0, jobPostings: [] }; };
  const rows = await verifyCompanies(
    [{ name: 'Paused Bank', careers_url: 'https://pausedbank.wd3.myworkdayjobs.com/careers' }],
    { fetchJson, fetchText: async () => '', rateLimitState: { circuits: { 'workday:wd3': { state: 'open', cooldownUntil: '2099-01-01T00:00:00Z' } } } },
  );
  assert.equal(calls, 0, 'no request to a paused cluster');
  assert.equal(rows[0].errorKind, 'rate_limited');
  assert.match(rows[0].reason, /paused by rate limits/);
  // without the state (tests, other callers) behaviour is unchanged
  const plain = await verifyCompanies([{ name: 'Open Bank', careers_url: 'https://openbank.wd3.myworkdayjobs.com/careers' }], { fetchJson, fetchText: async () => '' });
  assert.notEqual(plain[0].errorKind, 'rate_limited', 'no state → not gated, checked exactly as before');
});
