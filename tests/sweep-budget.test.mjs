// tests/sweep-budget.test.mjs — sweep time budget (2026-11-23).
//
// Two findings from the run logs: a three-source sweep ran 1,164s against a
// 900s budget because a board in flight when the budget ended could keep going
// for the full 5-minute watchdog; and a Workday sweep ran 935s for 34s of work
// because macOS slept for 901s in the middle of it (pmset log). The first is
// capped; the second is measured and reported, never mistaken for a slow scan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boardTimeoutMs, BUDGET_GRACE_MS, startSleepMeter } from '../scan-ats-full.mjs';

const FIVE_MIN = 5 * 60_000;

test('without a budget a board keeps the full 5-minute watchdog', () => {
  assert.equal(boardTimeoutMs(null, 0), FIVE_MIN);
});

test('with a budget a board never outlives it by more than the grace', () => {
  const end = 1_000_000;
  assert.equal(boardTimeoutMs(end, end - 10 * 60_000), FIVE_MIN, 'early in the budget: the normal watchdog');
  assert.equal(boardTimeoutMs(end, end - 60_000), 60_000 + BUDGET_GRACE_MS, 'a minute left: that minute plus the grace');
  assert.equal(boardTimeoutMs(end, end + 5 * 60_000), BUDGET_GRACE_MS, 'already past the budget: only the grace');
});

test('the sleep meter counts a frozen stretch, not normal ticks', async () => {
  let t = 0;
  const meter = startSleepMeter({ tickMs: 5, thresholdMs: 50, now: () => t });
  try {
    t += 5; await new Promise((r) => setTimeout(r, 15));
    assert.equal(meter.sleptMs(), 0, 'on-time ticks are not sleep');
    t += 901_000; await new Promise((r) => setTimeout(r, 15));
    assert.ok(meter.sleptMs() >= 900_000, `a 901s gap is counted (got ${meter.sleptMs()})`);
  } finally { meter.stop(); }
});

const hasWeb = existsSync(new URL('../web/scripts/scheduled-jobs-runner.mjs', import.meta.url));
test('a scheduled sweep that lost time to sleep says so', { skip: !hasWeb }, async () => {
  const { sourceWarnings } = await import('../web/scripts/scheduled-jobs-runner.mjs');
  const r = mkdtempSync(join(tmpdir(), 'co-budget-'));
  try {
    mkdirSync(join(r, 'data'), { recursive: true });
    writeFileSync(join(r, 'data', 'explore-runs.jsonl'), JSON.stringify({ at: '2026-11-23T19:16:47Z', mode: 'sweep', funnelBySource: { workday: { rateLimited: 0, deferredRateLimit: 0, sleptSeconds: 901 } } }));
    assert.match(sourceWarnings(r, 'sweep', '2026-11-23T19:00:00Z'), /Mac was asleep for 15 min of this run/);
    writeFileSync(join(r, 'data', 'explore-runs.jsonl'), JSON.stringify({ at: '2026-11-23T19:16:47Z', mode: 'sweep', funnelBySource: { workday: { sleptSeconds: 20 } } }));
    assert.equal(sourceWarnings(r, 'sweep', '2026-11-23T19:00:00Z'), '', 'short pauses are not reported');
  } finally { rmSync(r, { recursive: true, force: true }); }
});

test('a stopped sweep saves the matches it found before marking boards checked', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../scan-ats-full.mjs', import.meta.url), 'utf8');
  const handler = src.slice(src.indexOf("process.on('SIGTERM', async () => {"), src.indexOf('coverage: (() => { saveCoverage();'));
  assert.ok(handler.length > 0, 'SIGTERM handler found');
  assert.match(handler, /if \(!opts\.dryRun && kept\.length\)[\s\S]*await appendToPipeline\(kept\);[\s\S]*await appendToScanHistory\(kept, date\);/);
});
