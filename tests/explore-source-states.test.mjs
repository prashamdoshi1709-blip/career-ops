// tests/explore-source-states.test.mjs — Explore per-source outcome (2026-11-23).
// Explore said only "Scanned N of 27,806 companies"; a source that ran out of
// time, was rate-limited or returned nothing looked the same as one that
// finished. Each source now reports completed / partial / blocked /
// unavailable, from the scanner's own --json result.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const hasWeb = existsSync(new URL('../web/src/lib/core/scan-merge.mjs', import.meta.url));
const lib = hasWeb ? await import('../web/src/lib/core/scan-merge.mjs') : null;
const skip = !lib;

test('a source that ran to the end is completed', { skip }, () => {
  const r = lib.sourceState('greenhouse', { json: { budgetStopped: false, funnelBySource: { greenhouse: { successfulResponses: 900, rateLimited: 0, deferredRateLimit: 0 } } } });
  assert.equal(r.state, 'completed');
});

test('a source stopped at its time budget is partial, not complete', { skip }, () => {
  assert.equal(lib.sourceState('lever', { json: { budgetStopped: true, funnelBySource: { lever: { successfulResponses: 300 } } } }).state, 'partial');
  assert.equal(lib.sourceState('lever', { json: { stoppedEarly: true, funnel: { boardsReached: 10 } } }).state, 'partial');
  assert.equal(lib.sourceState('lever', { json: { funnel: { boardsReached: 10 } }, timedOut: true }).state, 'partial');
});

test('a source where nothing answered and boards were rate-limited or paused is blocked', { skip }, () => {
  const r = lib.sourceState('workday', { json: { budgetStopped: true, funnelBySource: { workday: { successfulResponses: 0, rateLimited: 2, deferredRateLimit: 241 } } } });
  assert.equal(r.state, 'blocked');
  assert.match(r.note, /rate-limited \(2\) or paused \(241\)/);
});

test('a source with no result is unavailable', { skip }, () => {
  assert.equal(lib.sourceState('ashby', { json: null, failed: 'crashed' }).state, 'unavailable');
  assert.equal(lib.sourceState('ashby', {}).state, 'unavailable');
});

test('the scanner JSON carries what the states need, and counts each board once', () => {
  const src = readFileSync(new URL('../scan-ats-full.mjs', import.meta.url), 'utf8');
  assert.match(src, /funnelBySource,\n\s+budgetStopped,\n\s+sources: opts\.ats,/);
  assert.match(src, /if \(ok && !answered\.has\(entry\)\) \{ answered\.add\(entry\); sourceStats\.successfulResponses\+\+; \}/);
  assert.match(src, /markChecked\(entry, false\); \}/, 'a 404 is checked but not counted as a successful response');
});

test('an undated posting goes through the title and location checks and, if relevant, is kept as date unknown', () => {
  const src = readFileSync(new URL('../scan-ats-full.mjs', import.meta.url), 'utf8');
  const chain = src.slice(src.indexOf('const processJobs = async'), src.indexOf('keepAndMaybeEmit(job, `${sourceName}-full`'));
  assert.doesNotMatch(chain, /dateClass === 'undated' && !opts\.includeUndated\) \{[^}]*continue;/, 'no early drop of undated postings');
  assert.ok(chain.indexOf('const undated = dateClass') < chain.indexOf('titleFilter(job.title, companySlug)) { funnel.rejectedTitle++'), 'undated is noted, then the title check runs');
  assert.match(chain, /if \(undated\) funnel\.undatedKept/);
  assert.match(src, /dateStatus: job\.postedAt \? 'dated' : 'unknown'/, 'kept undated postings are labelled unknown, never given a date');
});


test('a run with no location restriction never marks boards as Australian employers', () => {
  const src = readFileSync(new URL('../scan-ats-full.mjs', import.meta.url), 'utf8');
  assert.match(src, /const locationRestricted = \['allow', 'always_allow'\]\.some/);
  assert.match(src, /const markAustralian = \(entry, jobs\) => \{ if \(!opts\.rotate \|\| !locationRestricted/);
});
