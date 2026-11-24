// tests/providers/recruiter-site.test.mjs — recruiter mandate pages (2026-11-23).
//
// Regression cases: two recruiter mandates found by hand
// by hand on 2026-11-23 that no scan had surfaced. Causes found:
//   1. the firm's own mandate page was not a monitored source at all;
//   2. both were older than the scan's 30-day --since window (posted
//      2026-10-16 and 2026-09-14), so they would have been dropped anyway.
// These tests pin the provider, the title filter, the per-company age window
// and the classifier so neither can silently exclude them again. No network.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { pathToFileURL } from 'url';
import * as yaml from 'js-yaml';

console.log('\nProvider — recruiter-site');

const check = (label, ok, detail = '') => (ok ? pass(label) : fail(`${label}${detail ? `: ${detail}` : ''}`));
const mod = await import(pathToFileURL(join(ROOT, 'providers/recruiter-site.mjs')).href);
const provider = mod.default;
const scan = await import(pathToFileURL(join(ROOT, 'scan.mjs')).href);
// web/ is optional in a checkout (#3269): the classifier checks run only with it.
const opp = existsSync(join(ROOT, 'web', 'src')) ? await import(pathToFileURL(join(ROOT, 'web/src/lib/opportunities.mjs')).href) : null;

const NOW = Date.parse('2026-11-23T00:00:00Z');
const PPP = 'https://recruiter.example.com.au';
const CASES = [
  { id: 6101, title: 'Investment Analyst &#8211; Multi Sector Private Debt', date: '2026-10-16T04:33:41', slug: 'investment-analyst-multi-sector-private-debt', text: 'Our client is a multi-sector private debt manager. Build models to inform portfolio construction, capital allocation and risk management.' },
  { id: 6092, title: 'Investment Analyst / Associate | Private Credit', date: '2026-09-14T03:00:00', slug: 'investment-analyst-associate-private-credit', text: 'A Sydney-based private credit fund is hiring an Analyst or Associate for direct lending and investment underwriting.' },
];

// ── detect: explicit-only ──
check('id is recruiter-site', provider.id === 'recruiter-site');
check('detect() claims only entries that name the provider',
  provider.detect({ name: 'X', careers_url: `${PPP}/mandates/` }) === null
  && provider.detect({ name: 'X', provider: 'recruiter-site', careers_url: `${PPP}/mandates/` })?.url === `${PPP}/mandates/`);

// ── WordPress strategy against a recorded REST payload ──
const rows = CASES.map((c) => ({ id: c.id, date_gmt: c.date, link: `${PPP}/mandates/${c.slug}/`, title: { rendered: c.title }, content: { rendered: `<p>${c.text}</p>` }, specialisations: [61], levels: [52, 53] }));
rows.push({ id: 1, date_gmt: '2026-11-01T00:00:00', link: 'https://evil.example/x/', title: { rendered: 'Off-site link' }, content: { rendered: '' } });
const requested = [];
const ctx = {
  transport: 'http',
  async fetchJson(url) {
    requested.push(url);
    if (url.endsWith('/wp-json/wp/v2/types')) return { mandates: { rest_base: 'mandates', taxonomies: ['levels', 'specialisations'] } };
    if (url.includes('/wp-json/wp/v2/levels')) return [{ id: 52, name: 'Analyst' }, { id: 53, name: 'Associate/Executive' }];
    if (url.includes('/wp-json/wp/v2/specialisations')) return [{ id: 61, name: 'Private Debt and Special Situations' }];
    throw new Error(`unexpected ${url}`);
  },
  async fetchResponse(url) {
    requested.push(url);
    return { json: async () => rows, headers: new Map([['x-wp-totalpages', '1']]) };
  },
  async fetchText() { throw new Error('not used'); },
};
const entry = { name: 'Example Recruitment Partners', provider: 'recruiter-site', careers_url: `${PPP}/mandates/`, recruiter: { strategy: 'wordpress', default_location: 'Sydney, Australia' } };
const jobs = await provider.fetch(entry, ctx);
check('wordpress: discovers the mandates post type', requested.some((u) => u.includes('/wp-json/wp/v2/mandates?')));
check('wordpress: off-site links are dropped', !jobs.some((j) => j.url.includes('evil.example')));
for (const c of CASES) {
  const j = jobs.find((x) => x.url === `${PPP}/mandates/${c.slug}/`);
  check(`wordpress: retrieves "${c.slug}" at its original URL`, Boolean(j));
  if (!j) continue;
  check(`wordpress: decodes the title of "${c.slug}"`, !/&#\d+;/.test(j.title), j.title);
  check(`wordpress: "${c.slug}" has an Australian location`, /Australia/.test(j.location), j.location);
  check(`wordpress: "${c.slug}" keeps its publish date`, j.postedAt === Date.parse(`${c.date}Z`));
  check(`wordpress: "${c.slug}" carries the specialisation`, /Private Debt and Special Situations/.test(j.description));
}

// ── title filter (the real portals.yml when present; it is user data) ──
const portalsPath = join(ROOT, 'portals.yml');
if (existsSync(portalsPath)) {
  const cfg = yaml.load(readFileSync(portalsPath, 'utf8'));
  const tf = scan.buildTitleFilterWithOverrides(cfg.title_filter, scan.buildTitleFilterOverrides(cfg.title_filter_overrides));
  for (const t of ['Investment Analyst – Multi Sector Private Debt', 'Investment Analyst / Associate | Private Credit', 'Associate – Private Credit / Structured Lending', 'Associate – Special Situations & Capital Solutions – Global Private Credit Platform', 'Analyst – Direct Lending']) {
    check(`title filter keeps "${t}"`, tf(t, 'example recruitment partners'));
  }
  check('title filter still vetoes senior private credit titles', !tf('Vice President – Institutional Private Credit – Real Estate', 'x'));
  const ppp = (cfg.tracked_companies ?? []).find((e) => e.name === 'Example Recruitment Partners');
  check('portals.yml monitors the Example Recruitment Partners mandate page', ppp && ppp.enabled !== false && ppp.provider === 'recruiter-site' && /recruiter\.exampleficpartners\.com\.au\/mandates/.test(ppp.careers_url));
  check('its posting window covers a 70-day-old mandate', ppp && (Number(ppp.max_posting_age_days) === 0 || Number(ppp.max_posting_age_days) >= 70), String(ppp?.max_posting_age_days));
} else {
  pass('portals.yml absent (user data) — title-filter and source checks skipped');
}

// ── per-company age window vs the run's --since ──
const age120 = scan.buildPostingAgeFilter(120, NOW);
const since30 = scan.buildPostedDateFilter(scan.resolveEffectiveAfter(null, 30, NOW), null);
for (const c of CASES) {
  const t = Date.parse(`${c.date}Z`);
  check(`a 30-day --since alone would drop "${c.slug}" (the original miss)`, !since30(t));
  check(`a 120-day recruiter window keeps "${c.slug}"`, age120(t));
}
const scanSrc = readFileSync(join(ROOT, 'scan.mjs'), 'utf8');
check('scan.mjs lets a company max_posting_age_days replace --since', /company\.max_posting_age_days == null && !postedDateFilter\(job\.postedAt\)/.test(scanSrc));

// ── dedup: the two mandates are different vacancies ──
const [a, b] = CASES.map((c) => scan.normalizeUrlForDedup(`${PPP}/mandates/${c.slug}/`));
check('the two mandate URLs stay distinct after URL normalisation', a && b && a !== b);
check('their company+role keys differ', scan.companyRoleDedupKey('Example Recruitment Partners', 'Investment Analyst – Multi Sector Private Debt') !== scan.companyRoleDedupKey('Example Recruitment Partners', 'Investment Analyst / Associate | Private Credit'));

// ── classifier ──
if (opp) {
  for (const t of ['Investment Analyst – Multi Sector Private Debt', 'Investment Analyst / Associate | Private Credit', 'Analyst – Direct Lending', 'Associate – Real Estate Investing']) {
    const c = opp.classify(t);
    check(`classify("${t}") is Investment, PE & Credit`, c.category === 'Investment, PE & Credit' && c.alignment >= 7.5, JSON.stringify(c));
  }
  check('classify keeps home-loan lending as retail credit', opp.classify('Home Loan Lending Specialist').alignment <= 4);
} else {
  pass('web/ absent — classifier checks skipped');
}

// ── JobAdder widget and HTML listing parsers ──
const ja = mod.parseJobAdderList(
  '<div class="job"> <h2 class="title"> <a data-job-id="123" href="#" title="x">Analyst &amp; Associate - Private Credit</a> </h2> <div class="meta"><ul class="classifications"><li data-id="1"> Banking </li><li data-id="2"> Sydney CBD </li></ul><p class="date-posted"> 05/11/2026 </p></div><p class="summary">Credit fund.</p></div>',
  'https://www.example.com.au/jobs', 'Example Recruiter', '');
check('jobadder: parses id, title, location and date', ja.length === 1 && ja[0].url === 'https://www.example.com.au/jobs?ja-job=123' && ja[0].title === 'Analyst & Associate - Private Credit' && /Sydney/.test(ja[0].location) && ja[0].postedAt === Date.UTC(2026, 10, 5), JSON.stringify(ja));
const html = mod.parseHtmlListing(
  '<a href="/opportunities/associate-private-credit"><div class="opportunity-text">Associate – Private Credit</div></a><a href="/opportunities/associate-private-credit">View role</a><a href="https://other.example/opportunities/x">X</a><a href="/about">About</a>',
  'https://www.example.com.au/mandates', { link_pattern: '^/opportunities/[^/]+$', title_class: 'opportunity-text', default_location: 'Australia' }, 'Example');
check('html: one job per link, title from the title element, same host only', html.length === 1 && html[0].title === 'Associate – Private Credit' && html[0].url === 'https://www.example.com.au/opportunities/associate-private-credit', JSON.stringify(html));

// ── card listings (2026-11-23): link says "View Role", title sits in the card ──
const cards = mod.parseHtmlListing(
  '<div role="listitem" class="w-dyn-item"><p class="content-title-1">Opportunity</p><p class="terms-text-2 title">Associate – Private Credit</p><a href="/assignments/associate-private-credit" class="main-button"><div>View Role</div></a></div>'
  + '<div role="listitem" class="w-dyn-item"><p class="content-title-1">Opportunity</p><p class="terms-text-2 title">Melbourne | Analyst – Special Situations</p><a href="/assignments/analyst-special-situations">View Role</a></div>',
  'https://www.example.com.au/assignments', { item_marker: '<div role="listitem" class="w-dyn-item">', link_pattern: '^/assignments/[^/]+$', title_class: 'title', default_location: 'Sydney, Australia' }, 'Example');
check('html cards: title from the card, not "View Role" or a class like content-title-1', cards.length === 2 && cards[0].title === 'Associate – Private Credit' && cards[1].title === 'Melbourne | Analyst – Special Situations', JSON.stringify(cards.map((c) => c.title)));
check('html cards: location read from the card title', cards[1].location === 'Melbourne, Australia', cards[1].location);

// ── listing_confirms_active marks jobs for scan --verify ──
const confirmCtx = { ...ctx, async fetchResponse() { return { json: async () => rows.slice(0, 1), headers: new Map([['x-wp-totalpages', '1']]) }; } };
const confirmed = await provider.fetch({ ...entry, recruiter: { ...entry.recruiter, listing_confirms_active: true } }, confirmCtx);
const plain = await provider.fetch(entry, confirmCtx);
check('listing_confirms_active marks every job listingConfirmed', confirmed.length > 0 && confirmed.every((j) => j.listingConfirmed === true));
check('without it, jobs are not marked', plain.every((j) => j.listingConfirmed === undefined));
check('scan --verify accepts a listed recruiter role with no Apply button, and only those', /code === 'no_apply_control' && offer\.listingConfirmed === true/.test(scanSrc));
