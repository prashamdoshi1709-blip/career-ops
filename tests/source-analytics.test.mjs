// tests/source-analytics.test.mjs — per-source discovery analytics (2026-11-23).
// Pins what each figure means: the latest scan of a source (never a sum over
// history), successful checks apart from attempted / rate-limited / paused,
// figures an old run never recorded shown as null, and 30-day inbox additions
// counted from scan-history by the source that found them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
// web/ is optional in a checkout (#3269).
const lib = existsSync(new URL('../web/src', import.meta.url)) ? await import('../web/src/lib/discovery-coverage.mjs') : null;
const sourceAnalytics = (...a) => lib.sourceAnalytics(...a);
const discoveryCoverage = (...a) => lib.discoveryCoverage(...a);
const skip = !lib;

const NOW = Date.parse('2026-11-23T12:00:00Z');
function root() {
  const r = mkdtempSync(join(tmpdir(), 'co-analytics-'));
  mkdirSync(join(r, 'data', 'cache', 'ats-companies'), { recursive: true });
  return r;
}
const runs = [
  // old multi-source run without per-source figures: must not be attributed
  { at: '2026-11-22T13:34:29Z', mode: 'sweep', sources: ['greenhouse', 'lever', 'ashby', 'workday'], funnel: { boardsReached: 7905, matched: 6 }, postingsKept: 6 },
  { at: '2026-11-23T03:35:00Z', mode: 'sweep', sources: ['workday'], funnel: {}, funnelBySource: { workday: { boardsAttempted: 30, successfulResponses: 20, rateLimited: 4, deferredRateLimit: 6, failed: 6, postingsSeen: 900, postingsListedOnly: 100, matched: 3, duplicates: 2, matchesKept: 3 } } },
];
const scanRuns = [
  { at: '2026-11-20T06:05:00Z', kind: 'scan', groups: { seek: { ok: 40, failed: 0, rateLimited: 0, deferredRateLimit: 0, retrieved: 1200, matched: 50, dupes: 30, newUnique: 20, added: 19 } } },
  { at: '2026-11-23T06:05:00Z', kind: 'scan', groups: { seek: { ok: 38, failed: 1, rateLimited: 0, deferredRateLimit: 0, retrieved: 1100, matched: 40, dupes: 35, newUnique: 5, added: 4 }, employers: { ok: 30, failed: 2, rateLimited: 3, deferredRateLimit: 12, retrieved: 3000, matched: 25, dupes: 20, newUnique: 5, added: 5 } } },
];
const hist = [
  'url\tfirst_seen\tportal\ttitle\tcompany\tstatus',
  'https://a\t2026-11-22\tjobstreet-api\tM&A Analyst\tX\tadded',
  'https://b\t2026-11-22\tjobstreet-api\tReceptionist\tX\tadded',
  'https://c\t2026-09-01\tjobstreet-api\tM&A Analyst\tX\tadded',
  'https://d\t2026-11-22\tworkday-full\tPrivate Credit Associate\tY\tadded',
  'https://e\t2026-11-22\trecruiter-site-api\tInvestment Analyst – Private Debt\tZ\tadded',
  'https://f\t2026-11-22\tworkday-api\tAnalyst, Investment Banking\tHL\tadded',
  'https://g\t2026-11-22\tjobstreet-api\tM&A Analyst\tX\tskipped_title',
].join('\n');

test('latest-scan figures come from the newest run that covered the source, never a history sum', { skip }, () => {
  const r = root();
  try {
    writeFileSync(join(r, 'data', 'explore-runs.jsonl'), runs.map((x) => JSON.stringify(x)).join('\n'));
    writeFileSync(join(r, 'data', 'source-runs.jsonl'), scanRuns.map((x) => JSON.stringify(x)).join('\n'));
    writeFileSync(join(r, 'data', 'scan-history.tsv'), hist);
    const a = Object.fromEntries(sourceAnalytics(r, NOW).map((x) => [x.key, x]));
    assert.equal(a.workday.latest.successful, 20, 'successful checks, not boards attempted (30)');
    assert.equal(a.workday.latest.rateLimited, 4);
    assert.equal(a.workday.latest.deferred, 6);
    assert.equal(a.workday.latest.retrieved, 1000);
    assert.equal(a.workday.latest.matching, 5);
    assert.equal(a.workday.latest.newUnique, 3);
    assert.equal(a.workday.latest.added, 3);
    assert.equal(a.workday.latestYieldPer100, 15);
    assert.equal(a.greenhouse.latest, null, 'the multi-source run without per-source figures is not attributed');
    assert.equal(a.seek.latest.added, 4, 'latest SEEK run, not 19 + 4');
    assert.equal(a.employers.latest.deferred, 12);
    assert.equal(a.recruiters.latest, null);
  } finally { rmSync(r, { recursive: true, force: true }); }
});

test('30-day inbox additions are counted per source, with priority-1/2 relevance', { skip }, () => {
  const r = root();
  try {
    writeFileSync(join(r, 'data', 'scan-history.tsv'), hist);
    const a = Object.fromEntries(sourceAnalytics(r, NOW).map((x) => [x.key, x]));
    assert.equal(a.seek.added30d, 2, 'skipped rows and rows older than 30 days are not counted');
    assert.equal(a.seek.addedAll, 3);
    assert.equal(a.seek.relevant30d, 1, 'receptionist is not a finance role');
    assert.equal(a.workday.added30d, 1, 'workday-full = directory sweep');
    assert.equal(a.employers.added30d, 1, 'workday-api = a tracked employer site');
    assert.equal(a.recruiters.added30d, 1);
    assert.equal(a.recruiters.relevant30d, 1);
  } finally { rmSync(r, { recursive: true, force: true }); }
});

test('Workday rows that cannot name a board are unusable, not counted as companies', { skip }, () => {
  const r = root();
  try {
    writeFileSync(join(r, 'data', 'cache', 'ats-companies', 'workday.json'), JSON.stringify(['cba|wd3|commbank_careers', 'wd102|wd1|external', 'wd5|wd5|x', 'bad name|wd1|s']));
    writeFileSync(join(r, 'data', 'explore-coverage.json'), JSON.stringify({ sources: { workday: {} }, attempts: { workday: { 'cba|wd3|commbank_careers': { outcome: 'rate_limited' } } } }));
    const w = discoveryCoverage(r, NOW).sources.find((s) => s.source === 'workday');
    assert.equal(w.available, 4);
    assert.equal(w.unusable, 3);
    assert.equal(w.remaining, 1);
    assert.equal(w.rateLimitedPending, 1);
    assert.equal(w.neverAttempted, 0);
  } finally { rmSync(r, { recursive: true, force: true }); }
});

test('the latest scheduled sweep and the latest manual Explore run are reported apart', { skip }, () => {
  const r = root();
  try {
    writeFileSync(join(r, 'data', 'explore-runs.jsonl'), [
      { at: '2026-11-22T13:34:29Z', mode: 'sweep', sources: ['greenhouse', 'lever', 'ashby'], funnel: { boardsReached: 7905 } },
      { at: '2026-11-22T14:26:00Z', mode: 'explore', sources: ['workday'], funnel: { boardsReached: 1, deferredRateLimit: 4 } },
    ].map((x) => JSON.stringify(x)).join('\n'));
    const c = discoveryCoverage(r, NOW);
    assert.equal(c.lastSweep.funnel.boardsReached, 7905, 'a one-board Explore run does not hide the sweep');
    assert.equal(c.lastExplore.funnel.boardsReached, 1);
    assert.equal(c.lastExplore.deferredRateLimit, 4);
  } finally { rmSync(r, { recursive: true, force: true }); }
});

test('a successful scheduled run still reports failed, rate-limited and paused sources', { skip }, async () => {
  const { sourceWarnings } = await import('../web/scripts/scheduled-jobs-runner.mjs');
  const r = root();
  try {
    writeFileSync(join(r, 'data', 'source-runs.jsonl'), [
      { at: '2026-11-20T06:05:00Z', groups: { seek: { failed: 9 } } },
      { at: '2026-11-24T06:05:00Z', groups: { seek: { failed: 0, rateLimited: 0, deferredRateLimit: 0 }, employers: { failed: 2, rateLimited: 1, deferredRateLimit: 12 } } },
    ].map((x) => JSON.stringify(x)).join('\n'));
    writeFileSync(join(r, 'data', 'explore-runs.jsonl'), JSON.stringify({ at: '2026-11-24T03:35:00Z', mode: 'sweep', funnelBySource: { workday: { rateLimited: 3, deferredRateLimit: 40 } } }));
    writeFileSync(join(r, 'data', 'rate-limit-state.json'), JSON.stringify({ circuits: { 'workday:wd3': { state: 'open' }, 'workday:wd105': { state: 'closed' } } }));
    const portals = sourceWarnings(r, 'portals', '2026-11-24T06:00:00Z');
    assert.match(portals, /Employer sites: 2 failed, 1 rate-limited, 12 paused/);
    assert.doesNotMatch(portals, /SEEK/, 'a clean source and an older run are not reported');
    assert.match(portals, /Workday paused: wd3$/);
    assert.match(sourceWarnings(r, 'sweep', '2026-11-24T03:00:00Z'), /Workday: 3 rate-limited, 40 paused/);
    assert.equal(sourceWarnings(r, 'recruiters', '2026-11-25T00:00:00Z'), '');
  } finally { rmSync(r, { recursive: true, force: true }); }
});
