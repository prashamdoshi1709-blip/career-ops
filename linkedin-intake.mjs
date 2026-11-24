#!/usr/bin/env node
// linkedin-intake.mjs — LinkedIn-advertised jobs into Career-Ops, legitimately.
//
// LinkedIn cannot be searched automatically: its robots.txt is
// "User-agent: * / Disallow: /" (and names /jobs-guest/ and job search
// explicitly), and CONTRIBUTING.md rejects scrapers of platforms that prohibit
// automated access. So this never sends a request to LinkedIn. It reads what
// the user pastes — LinkedIn job links and/or the text of a LinkedIn job-alert
// email or search page — and for each job:
//
//   1. reads title / company / location from the link's own slug
//      (".../jobs/view/<title>-at-<company>-<id>") or the pasted lines next to it;
//   2. checks scan history, the inbox and the tracker for the same job
//      (LinkedIn id, URL, or company + role);
//   3. looks for the same vacancy at the employer, as AGENTS.md requires for an
//      aggregator listing: a SEEK search (one request) and the employer's or
//      recruiter's own board when Career-Ops knows it (tracked in portals.yml,
//      or in the public Greenhouse / Lever / Ashby directories) (one request);
//   4. reports: already in Career-Ops / confirmed (employer or SEEK link) /
//      not found at a known employer board (possibly closed; not added) /
//      LinkedIn only (no employer board to check; added, clearly labelled).
//
// With --add, new and confirmed jobs go to the inbox and scan history
// (portal "linkedin-intake"), through the same locked writers as the scanners.
// Never invents a date: LinkedIn postings carry none here, so dateStatus is
// "unknown" and the first-seen date is the day of intake.
//
//   node linkedin-intake.mjs --file pasted.txt            # report only
//   node linkedin-intake.mjs --file pasted.txt --add      # report and add
//   pbpaste | node linkedin-intake.mjs --add --json
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadYaml } from './lib/yaml-document.mjs';
import { linkedInJobId } from './lib/linkedin-url.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';

const ROOT = getCareerOpsRoot();
const LOCATION_HINT = /\b(Sydney|Melbourne|Brisbane|Perth|Adelaide|Canberra|Hobart|Darwin|Gold Coast|Parramatta|North Sydney|NSW|VIC|QLD|ACT|WA|SA|TAS|NT|Australia|New South Wales|Victoria|Queensland|Remote|Hybrid|On-site)\b/i;

const words = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}&]+/gu, ' ').trim();
const titleCase = (s) => s.replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\bM ?& ?A\b/gi, 'M&A').replace(/\b(Ib|Fig|Ecm|Dcm|Ma|Pe|Vc|Fp ?& ?A)\b/g, (m) => m.toUpperCase());

/**
 * Pure: the jobs in pasted text. Each LinkedIn job link is one job; its title
 * and company come from the link's slug when it has one, else from the up to
 * three non-link lines just before it (an alert email lists title, company,
 * location, then the link). Duplicate links (same job id) are kept once.
 * @param {string} text
 * @returns {{ linkedinId: string, url: string, title: string, company: string, location: string }[]}
 */
export function parseLinkedInPaste(text) {
  const lines = String(text ?? '').split(/\r?\n/).map((l) => l.trim());
  const out = new Map();
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/https?:\/\/[^\s<>"')\]]+/g)) {
      let u;
      try { u = new URL(m[0]); } catch { continue; }
      const id = linkedInJobId(u);
      if (!id || out.has(id)) continue;
      let title = '', company = '', location = '';
      const slug = (u.pathname.match(/\/jobs\/view\/([^/?#]+?)-\d{6,}\/?$/) || [])[1];
      if (slug && slug.includes('-at-')) {
        const at = slug.lastIndexOf('-at-');
        title = titleCase(decodeURIComponent(slug.slice(0, at)).replace(/-/g, ' '));
        company = titleCase(decodeURIComponent(slug.slice(at + 4)).replace(/-/g, ' '));
        if (/^[a-z]{2,4}$/i.test(company)) company = company.toUpperCase(); // "ubs" -> "UBS", "nab" -> "NAB"
      }
      // Lines before the link (alert email / pasted search card): title, company, location.
      const before = [];
      for (let j = i - 1; j >= 0 && before.length < 3; j--) {
        const l = lines[j];
        if (!l) { if (before.length) break; continue; }
        if (/https?:\/\//.test(l)) break;
        if (/^(view job|apply|easy apply|promoted|actively recruiting|\d+ (applicants?|connections?)|new|be an early applicant|see all jobs)/i.test(l)) continue;
        if (/^(your job alert|jobs? (you may be interested in|for you)|new jobs? (match|for))/i.test(l)) break;
        before.unshift(l.replace(/\s+/g, ' '));
      }
      if (before.length) {
        // The location is the line closest to the link that names a place.
        const loc = [...before].reverse().find((l) => LOCATION_HINT.test(l) && l.length < 80);
        const rest = before.filter((l) => l !== loc);
        if (!title && rest[0]) title = rest[0];
        if (!company && rest[1]) company = rest[1];
        if (loc) location = loc.replace(/\s*\((on-site|hybrid|remote)\)\s*/i, ' ($1)').trim();
      }
      out.set(id, { linkedinId: id, url: `https://www.linkedin.com/jobs/view/${id}/`, title: title.trim(), company: company.trim(), location });
    }
  });
  return [...out.values()];
}

/**
 * Pure: how alike two job titles are, 0..1 — meaningful words shared, over the
 * LONGER title's word count, so a few generic words ("analyst", "investment",
 * "banking") shared with a much longer, different title do not count as the
 * same role.
 */
export function titleSimilarity(a, b) {
  // Recruiters dress titles up ("Leading US Fund – …", "– Sydney"): filler and
  // place words are ignored, and a light stem makes "investing" = "investment".
  const stop = new Set(['the', 'and', 'of', 'a', 'an', 'to', 'in', 'for', 'at', 'with', 'or', 'senior', 'junior', 'sr', 'jr', 'leading', 'global', 'australian', 'australia', 'us', 'fund', 'firm', 'sydney', 'melbourne', 'brisbane', 'perth', 'nsw', 'vic', 'qld', 'hybrid', 'remote']);
  const stem = (w) => w.replace(/(ment|ing|ments|s)$/, '');
  const toks = (x) => new Set(words(x).split(' ').filter((w) => w && !stop.has(w)).map(stem));
  const A = toks(a);
  const B = toks(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / Math.max(A.size, B.size);
}

/** Pure: does `b` name the same company as `a` (ignoring Pty Ltd, Group, etc.)? */
export function sameCompany(a, b) {
  const clean = (s) => words(s).replace(/\b(pty|ltd|limited|inc|llc|group|australia|au|recruitment|executive|search|partners|consulting|the)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const x = clean(a), y = clean(b);
  if (!x || !y) return false;
  if (x === y || x.startsWith(`${y} `) || y.startsWith(`${x} `)) return true;
  // One typo ("Northwiind Harbour" for "Northwind Harbour"), on names long enough
  // that one letter cannot make two different firms look alike.
  return Math.min(x.length, y.length) >= 8 && editDistanceAtMostOne(x, y);
}

function editDistanceAtMostOne(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

// "Already known" needs a near-identical title: a firm often runs similar
// mandates ("Investment Associate – Private Credit" vs "Investment Analyst /
// Associate | Private Credit"), and calling a new one known would hide it.
const KNOWN_THRESHOLD = 0.9;
const MATCH_THRESHOLD = 0.75;
const slugOf = (company) => words(company).replace(/\b(pty|ltd|limited|inc|llc)\b/g, '').replace(/\s+/g, '').trim();

function knownTexts(root) {
  const read = (p) => { try { return readFileSync(path.join(root, p), 'utf8'); } catch { return ''; } };
  return { history: read('data/scan-history.tsv'), pipeline: read('data/pipeline.md'), tracker: read('data/applications.md') };
}

/** Already in Career-Ops? By LinkedIn id (any link shape), or company + similar role. */
export function findKnown(item, texts) {
  const idRe = new RegExp(`linkedin\\.com/[^\\s|)]*?(?:-|/|currentJobId=)${item.linkedinId}(?![0-9])`);
  for (const [where, text] of Object.entries(texts)) if (idRe.test(text)) return { where, how: 'same LinkedIn job' };
  if (!item.company || !item.title) return null;
  let best = null;
  const consider = (score, hit) => { if (score >= KNOWN_THRESHOLD && (!best || score > best.score)) best = { score, ...hit }; };
  for (const line of texts.tracker.split('\n')) {
    if (!line.startsWith('| ')) continue;
    const c = line.split('|').map((x) => x.trim());
    if (c.length > 6 && (sameCompany(c[3], item.company) || sameCompany(c[4], item.company))) consider(titleSimilarity(c[5], item.title) + 0.001, { where: 'tracker', how: `tracker row ${c[1]} (${c[5]})` });
  }
  for (const line of texts.history.split('\n')) {
    const c = line.split('\t');
    if (c.length > 5 && c[5] === 'added' && sameCompany(c[4], item.company)) consider(titleSimilarity(c[3], item.title), { where: 'history', how: `same company and role (${c[3]})`, url: c[0] });
  }
  return best;
}

/** Where Career-Ops can look for this employer's own vacancies. */
export function employerBoards(company, root = ROOT) {
  const boards = [];
  try {
    const cfg = loadYaml(readFileSync(path.join(root, 'portals.yml'), 'utf8')) ?? {};
    for (const e of cfg.tracked_companies ?? []) if (e && e.enabled !== false && sameCompany(e.name, company)) boards.push({ kind: 'tracked', entry: e });
  } catch { /* no portals.yml: directories only */ }
  const slug = slugOf(company);
  if (slug.length >= 3) {
    const dir = (src) => { try { return JSON.parse(readFileSync(path.join(root, 'data', 'cache', 'ats-companies', `${src}.json`), 'utf8')); } catch { return []; } };
    const url = { greenhouse: (s) => `https://job-boards.greenhouse.io/${s}`, lever: (s) => `https://jobs.lever.co/${s}`, ashby: (s) => `https://jobs.ashbyhq.com/${s}` };
    for (const src of Object.keys(url)) for (const s of dir(src)) if (String(s).toLowerCase() === slug) boards.push({ kind: src, entry: { name: company, careers_url: url[src](s) } });
  }
  return boards;
}

/**
 * Resolve one pasted LinkedIn job. `deps` carries the network pieces so tests
 * run offline: { fetchBoard(entry) -> Job[], searchSeek(keywords) -> Job[] }.
 */
export async function resolveItem(item, { texts, boardsFor = employerBoards, fetchBoard, searchSeek, isPaused = null } = {}) {
  const known = findKnown(item, texts);
  if (known) return { ...item, status: 'known', detail: `already in Career-Ops (${known.how})`, canonicalUrl: known.url ?? null };
  if (!item.title || !item.company) return { ...item, status: 'incomplete', detail: 'title or company could not be read from the paste; paste the alert text with the link, or the full job link' };
  // The best-matching posting at or above the threshold, same company.
  const match = (jobs) => (jobs ?? []).filter((j) => j && j.url && (!j.company || sameCompany(j.company, item.company)))
    .map((j) => ({ j, s: titleSimilarity(j.title, item.title) })).filter((x) => x.s >= MATCH_THRESHOLD).sort((a, b) => b.s - a.s)[0]?.j ?? null;
  const boards = boardsFor(item.company);
  const checked = [], unavailable = [];
  const nameOf = (b) => (b.kind === 'tracked' ? b.entry.name : b.kind);
  for (const b of boards) {
    // A board on a paused rate-limit circuit (Workday) is not asked at all,
    // and a board that could not be read is not evidence the role is gone.
    if (isPaused?.(b.entry.careers_url || b.entry.api)) { unavailable.push(`${nameOf(b)} (paused by rate limits)`); continue; }
    let jobs = null;
    try { jobs = await fetchBoard(b.entry); } catch { jobs = null; }
    if (!jobs) { unavailable.push(`${nameOf(b)} (could not be read)`); continue; }
    checked.push(nameOf(b));
    const hit = match(jobs);
    if (hit) return { ...item, status: 'confirmed', detail: `found on ${b.kind === 'tracked' ? b.entry.name + "'s own site" : b.kind}`, canonicalUrl: hit.url, location: hit.location || item.location, source: b.kind };
  }
  let seek = null;
  try { seek = await searchSeek(`${item.title} ${item.company}`); } catch { seek = null; }
  const seekHit = seek ? match(seek) : null;
  if (seekHit) return { ...item, status: 'confirmed', detail: 'found on SEEK', canonicalUrl: seekHit.url, location: seekHit.location || item.location, source: 'seek' };
  if (checked.length) return { ...item, status: 'not-at-employer', detail: `not found on ${checked.join(', ')} or SEEK; it may have closed, so it was not added` };
  if (unavailable.length) return { ...item, status: 'linkedin-only', detail: `the employer board could not be checked now (${unavailable.join(', ')}) and it is not on SEEK; added with its LinkedIn link, unconfirmed` };
  return { ...item, status: 'linkedin-only', detail: 'no employer board Career-Ops can check, and not on SEEK; added with its LinkedIn link, unconfirmed at the employer' };
}

/** The live network pieces (free, public, no LinkedIn request). */
export async function liveDeps(root = ROOT) {
  const { makeHttpCtx } = await import('./providers/_http.mjs');
  const { loadProviders, resolveProvider } = await import('./providers/_registry.mjs');
  const { fileURLToPath } = await import('node:url');
  const providers = await loadProviders(path.join(path.dirname(fileURLToPath(import.meta.url)), 'providers'));
  const jobstreet = (await import('./providers/jobstreet.mjs')).default;
  const { openRateLimitBook, circuitKeyFor } = await import('./rate-limit-state.mjs');
  const rateState = openRateLimitBook(path.join(root, 'data', 'rate-limit-state.json')).state();
  return {
    // Read-only: a paused circuit means no request; the scanners do the test requests.
    isPaused: (url) => { const k = circuitKeyFor(url); const c = k ? rateState.circuits?.[k] : null; return Boolean(c && c.state && c.state !== 'closed'); },
    fetchBoard: async (entry) => {
      const r = resolveProvider(entry, providers, { skipIds: ['local-parser'] });
      if (!r?.provider) return [];
      return r.provider.fetch(entry, makeHttpCtx());
    },
    searchSeek: async (keywords) => jobstreet.fetch({ name: 'SEEK AU (LinkedIn check)', provider: 'jobstreet', api: 'https://au.seek.com/api/jobsearch/v5/search', siteKey: 'AU-Main', searchKeywords: keywords, pageSize: 20, max_pages: 1 }, { ...makeHttpCtx(), maxPages: 1 }),
  };
}

/** Add new / confirmed / LinkedIn-only jobs to the inbox and scan history. */
export async function addResults(results) {
  const { appendToPipeline, appendToScanHistory } = await import('./scan.mjs');
  const { localToday } = await import('./lib/local-today.mjs');
  const offers = results.filter((r) => r.status === 'confirmed' || r.status === 'linkedin-only').map((r) => ({
    url: r.canonicalUrl || r.url,
    title: r.title,
    company: r.company,
    location: r.location || '',
    source: 'linkedin-intake',
    ...(r.status === 'linkedin-only' ? { note: 'LinkedIn only, not confirmed at employer' } : { note: `LinkedIn job ${r.linkedinId}, ${r.detail}` }),
  }));
  if (!offers.length) return 0;
  await appendToPipeline(offers);
  await appendToScanHistory(offers, localToday());
  return offers.length;
}

const USAGE = `Usage: node linkedin-intake.mjs [--file pasted.txt] [--add] [--json]
  Reads LinkedIn job links or LinkedIn job-alert email text (from --file or stdin),
  checks Career-Ops, SEEK and the employer's own board for each job, and reports.
  --add   add new and confirmed jobs to the inbox and scan history
  --json  print the result as JSON
  Never sends a request to LinkedIn.`;

async function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) { console.log(USAGE); return; }
  const unknown = argv.filter((a, i) => a.startsWith('-') && !['--file', '--add', '--json'].includes(a) && argv[i - 1] !== '--file');
  if (unknown.length) { console.error(`linkedin-intake: unknown option ${unknown[0]}\n${USAGE}`); process.exitCode = 1; return; }
  const file = argv.includes('--file') ? argv[argv.indexOf('--file') + 1] : null;
  const text = file ? readFileSync(file, 'utf8') : readFileSync(0, 'utf8');
  const items = parseLinkedInPaste(text);
  const deps = await liveDeps();
  const texts = knownTexts(ROOT);
  const results = [];
  for (const it of items) results.push(await resolveItem(it, { texts, ...deps }));
  const added = argv.includes('--add') ? await addResults(results) : 0;
  if (argv.includes('--json')) { console.log(JSON.stringify({ items: results.length, added, results }, null, 2)); return; }
  for (const r of results) console.log(`${r.status.padEnd(16)} ${r.company || '?'} | ${r.title || '?'} — ${r.detail}${r.canonicalUrl ? ` → ${r.canonicalUrl}` : ''}`);
  console.log(`\n${results.length} LinkedIn job(s) read; ${added} added to the inbox${argv.includes('--add') ? '' : ' (run with --add to add them)'}. No request was sent to LinkedIn.`);
}

export { knownTexts };

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.error(`linkedin-intake: ${e.message}`); process.exitCode = 1; });
}
