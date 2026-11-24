// tests/linkedin-intake.test.mjs — LinkedIn jobs into Career-Ops (2026-11-24).
// LinkedIn forbids automated access, so the intake reads only what the user
// pastes and never requests LinkedIn. Pins: parsing alert emails and job
// links, "already known" without false positives, confirmation on SEEK or the
// employer's board, and never treating an unreadable or rate-limited board as
// "the role is gone". Offline: the network pieces are stubs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseLinkedInPaste, titleSimilarity, sameCompany, findKnown, resolveItem } from '../linkedin-intake.mjs';

const ALERT = `Your job alert for investment banking analyst in Sydney
Investment Banking Analyst - Global IB, FIG
Example Bank
Sydney, New South Wales, Australia (Hybrid)
View job: https://www.linkedin.com/comm/jobs/view/4321098765/?trackingId=abc

https://au.linkedin.com/jobs/view/investment-banking-analyst-debt-capital-markets-at-ubs-4319999999?trk=public_jobs
https://www.linkedin.com/jobs/view/4319999999/`;

test('reads title, company and location from an alert email and from a job link slug', () => {
  const items = parseLinkedInPaste(ALERT);
  assert.equal(items.length, 2, 'the same job id twice is one job');
  assert.deepEqual(items[0], { linkedinId: '4321098765', url: 'https://www.linkedin.com/jobs/view/4321098765/', title: 'Investment Banking Analyst - Global IB, FIG', company: 'Example Bank', location: 'Sydney, New South Wales, Australia (Hybrid)' });
  assert.equal(items[1].company, 'UBS');
  assert.equal(items[1].title, 'Investment Banking Analyst Debt Capital Markets');
});

test('ignores links that are not LinkedIn job postings', () => {
  assert.equal(parseLinkedInPaste('https://www.linkedin.com/in/someone\nhttps://example.com/jobs/view/123456789').length, 0);
});

test('title similarity is over the longer title, so generic shared words do not match', () => {
  assert.equal(titleSimilarity('M&A Associate', 'M&A Associate'), 1);
  assert.ok(titleSimilarity('Analyst, Global Investment Banking - Infrastructure', '2028 Capital Markets, Global Investment Banking Summer Analyst') < 0.75);
});

test('company names tolerate suffixes and one typo, not different firms', () => {
  assert.ok(sameCompany('Example Credit Partners Pty Ltd', 'Example Credit Partners'));
  assert.ok(sameCompany('Northwiind Harbour Partners', 'Northwind Harbour Partners'));
  assert.ok(!sameCompany('UBS', 'UBX'), 'short names need an exact match');
  assert.ok(!sameCompany('Macquarie Group', 'Moelis'));
});

const texts = {
  history: 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\nhttps://x/1\t2026-11-01\tworkday-api\t2028 Global Investment Banking Summer Analyst\tRBC Capital Markets\tadded',
  pipeline: '- [ ] https://www.linkedin.com/jobs/view/4000000001/ | Example | Analyst',
  tracker: '| 151 | 2026-01-15 | Northwiind Harbour Partners | — | Investment Analyst / Associate Private Credit | N/A | Applied | ✅ | — | x | y |',
};

test('already known: same LinkedIn id, or the same company and a near-identical role', () => {
  assert.equal(findKnown({ linkedinId: '4000000001', title: 'X', company: 'Y' }, texts).how, 'same LinkedIn job');
  assert.match(findKnown({ linkedinId: '1', title: 'Investment Analyst / Associate | Private Credit', company: 'Northwind Harbour Partners' }, texts).how, /tracker row 151/);
  assert.equal(findKnown({ linkedinId: '2', title: 'Analyst, Global Investment Banking - Infrastructure', company: 'RBC Capital Markets' }, texts), null, 'a different RBC role is not "known"');
});

const item = { linkedinId: '9', url: 'https://www.linkedin.com/jobs/view/9/', title: 'M&A Associate', company: 'Example Advisory Partners', location: 'Sydney' };
const board = [{ kind: 'tracked', entry: { name: 'Example Advisory Partners', careers_url: 'https://careers.example.com/jobs' } }];

test('confirmed on the employer board gives the employer link', async () => {
  const r = await resolveItem(item, { texts, boardsFor: () => board, fetchBoard: async () => [{ title: 'M&A Associate', company: 'Example Advisory Partners', url: 'https://careers.example.com/jobs?ja-job=1' }], searchSeek: async () => [] });
  assert.equal(r.status, 'confirmed');
  assert.equal(r.canonicalUrl, 'https://careers.example.com/jobs?ja-job=1');
});

test('confirmed on SEEK when the employer has no board', async () => {
  const r = await resolveItem(item, { texts, boardsFor: () => [], fetchBoard: async () => [], searchSeek: async () => [{ title: 'M&A Associate', company: 'Example Advisory Partners', url: 'https://au.seek.com/job/1' }] });
  assert.equal(r.status, 'confirmed');
  assert.equal(r.canonicalUrl, 'https://au.seek.com/job/1');
});

test('a board that was read and does not list the role: not added (may be closed)', async () => {
  const r = await resolveItem(item, { texts, boardsFor: () => board, fetchBoard: async () => [{ title: 'Financial Controller', company: 'Example Advisory Partners', url: 'u' }], searchSeek: async () => [] });
  assert.equal(r.status, 'not-at-employer');
});

test('a board that could not be read, or is paused by rate limits, is not evidence the role is gone', async () => {
  const failing = await resolveItem(item, { texts, boardsFor: () => board, fetchBoard: async () => { throw new Error('HTTP 429'); }, searchSeek: async () => [] });
  assert.equal(failing.status, 'linkedin-only');
  let asked = 0;
  const paused = await resolveItem(item, { texts, boardsFor: () => board, fetchBoard: async () => { asked++; return []; }, searchSeek: async () => [], isPaused: () => true });
  assert.equal(paused.status, 'linkedin-only');
  assert.equal(asked, 0, 'no request to a paused board');
  assert.match(paused.detail, /paused by rate limits/);
});

test('the intake never sends a request to LinkedIn', () => {
  const src = readFileSync(new URL('../linkedin-intake.mjs', import.meta.url), 'utf8');
  // No request with a pasted LinkedIn link, and none of LinkedIn's guest endpoints.
  assert.doesNotMatch(src, /fetch\w*\(\s*(item|it|r)\.url/);
  assert.doesNotMatch(src, /linkedInGuestUrl|['"`]https:\/\/[a-z.]*linkedin\.com\/jobs-guest/);
  // The only network pieces are the SEEK search and employer-board providers.
  assert.match(src, /fetchBoard: async \(entry\) =>/);
  assert.match(src, /searchSeek: async \(keywords\) => jobstreet\.fetch/);
});
