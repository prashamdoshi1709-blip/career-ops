// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
/** @typedef {import('./_types.js').Job} Job */

// Recruiter-site provider (local, 2026-11-23).
//
// Boutique recruitment firms publish their mandates on their own websites, and
// many never post them to SEEK. This provider reads those websites through the
// public, no-login interfaces the sites themselves use to show their jobs:
//
//   strategy: wordpress  WordPress REST API (/wp-json/wp/v2/<post type>) — the
//                        same data the site's own pages render. The post type is
//                        configured or discovered from /wp-json/wp/v2/types.
//                        Gives the publish date, the content (location is read
//                        from it) and taxonomy terms (level, specialisation).
//   strategy: jobadder   The public JobAdder jobs widget the site embeds
//                        (apps.jobadder.com/widgets, keyed by the board key in
//                        the page). Gives title, classifications (incl.
//                        location), posting date and summary. The job URL is
//                        the site's own page with ?ja-job=<id>, which is what
//                        the widget itself links to.
//   strategy: html       Server-rendered listing pages: links matching
//                        `link_pattern` on the configured host, following a
//                        "next page" link up to max_pages. No dates.
//
// Explicit-only: an entry opts in with `provider: recruiter-site` and a
// `recruiter:` block, so this never claims an unrelated portals.yml entry.
// Every request is pinned to https and to the entry's own host (or
// apps.jobadder.com for the widget).
//
//   - name: Example Recruitment Partners
//     provider: recruiter-site
//     careers_url: https://recruiter.example.com.au/mandates/
//     recruiter:
//       strategy: wordpress
//       post_type: mandates           # optional; discovered when absent
//       default_location: Sydney NSW, Australia

import { htmlToText } from './_html-to-text.mjs';
import { decodeEntities } from './_html-entities.mjs';

const AU_PLACE = /\b(Sydney|Melbourne|Brisbane|Perth|Adelaide|Canberra|Hobart|Darwin|Gold Coast|Newcastle|Parramatta|North Sydney|Geelong|Wollongong|Sunshine Coast|Townsville|Cairns|Ballarat|Bendigo|Toowoomba|NSW|VIC|QLD|ACT|Western Australia|South Australia|Tasmania|Northern Territory|New South Wales|Victoria|Queensland|Australia)\b/i;
const OTHER_PLACE = /\b(Singapore|Hong Kong|Auckland|Wellington|London|New York|Tokyo|Dubai|Shanghai|Mumbai)\b/i;
const JOB_POST_TYPE = /^(mandates?|jobs?|job_listing|job-listings?|vacanc(y|ies)|roles?|positions?|opportunit(y|ies)|careers?|current[-_]?roles)$/i;
const MAX_PAGES_DEFAULT = 10;

/** @param {any} entry */
function config(entry) {
  const r = entry && typeof entry.recruiter === 'object' && entry.recruiter ? entry.recruiter : {};
  return r;
}

/** https URL on the entry's host, or throw. */
function siteUrl(entry) {
  let u;
  try { u = new URL(String(entry.careers_url || '')); } catch { throw new Error(`recruiter-site: invalid careers_url for ${entry.name}`); }
  if (u.protocol !== 'https:') throw new Error(`recruiter-site: careers_url must use https for ${entry.name}`);
  return u;
}

/** Resolve `href` against `base`; null unless https and on `host`. */
function sameHost(href, base, host) {
  try {
    const u = new URL(decodeEntities(String(href)), base);
    if (u.protocol !== 'https:' || u.hostname !== host) return null;
    return u;
  } catch { return null; }
}

const clean = (s) => decodeEntities(String(s ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/**
 * Location for a posting: the first Australian place named in `texts`, else a
 * foreign city, else the entry's default. Kept to what the source says.
 * @param {string[]} texts
 * @param {string} fallback
 */
export function pickLocation(texts, fallback) {
  // Texts are in order of authority (tags, then title, then body): the first
  // text that names any place decides, Australian places first within it.
  for (const t of texts) {
    const au = String(t ?? '').match(AU_PLACE);
    // Places read from a URL slug arrive lower-case: "melbourne" -> "Melbourne", "nsw" -> "NSW".
    const place = au && (au[1].length <= 3 ? au[1].toUpperCase() : au[1].replace(/\b\w/g, (c) => c.toUpperCase()));
    if (au) return /^australia$/i.test(place) ? 'Australia' : `${place}, Australia`;
    const other = String(t ?? '').match(OTHER_PLACE);
    if (other) return other[1];
  }
  return fallback || '';
}

// ── WordPress ───────────────────────────────────────────────────────

async function wpRestBase(origin, cfg, ctx) {
  const types = /** @type {Record<string, any>} */ (await ctx.fetchJson(`${origin}/wp-json/wp/v2/types`));
  const wanted = cfg.post_type ? [String(cfg.post_type)] : Object.keys(types).filter((k) => JOB_POST_TYPE.test(k));
  for (const k of wanted) {
    const t = types[k];
    if (t && typeof t.rest_base === 'string') return { base: t.rest_base, taxonomies: Array.isArray(t.taxonomies) ? t.taxonomies : [] };
  }
  throw new Error(`recruiter-site: no job post type in ${origin}/wp-json/wp/v2/types${cfg.post_type ? ` (asked for "${cfg.post_type}")` : ''}`);
}

async function wpTerms(origin, taxonomy, ctx) {
  try {
    const list = /** @type {any[]} */ (await ctx.fetchJson(`${origin}/wp-json/wp/v2/${encodeURIComponent(taxonomy)}?per_page=100&_fields=id,name`));
    return new Map((Array.isArray(list) ? list : []).map((t) => [t.id, clean(t.name)]));
  } catch { return new Map(); }
}

/** @returns {Promise<Job[]>} */
async function fetchWordpress(entry, cfg, ctx) {
  const site = siteUrl(entry);
  const origin = site.origin;
  const { base, taxonomies } = await wpRestBase(origin, cfg, ctx);
  const taxList = taxonomies.filter((t) => /^[a-z0-9_-]+$/i.test(t)).slice(0, 4);
  const terms = new Map();
  for (const t of taxList) terms.set(t, await wpTerms(origin, t, ctx));
  const maxPages = Math.min(Number(cfg.max_pages) || MAX_PAGES_DEFAULT, Number(ctx.maxPages) || Infinity);
  const fields = ['id', 'date_gmt', 'link', 'title', 'content', 'excerpt', ...taxList].join(',');
  /** @type {Job[]} */
  const jobs = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await ctx.fetchResponse(`${origin}/wp-json/wp/v2/${encodeURIComponent(base)}?per_page=100&page=${page}&orderby=date&order=desc&_fields=${fields}`);
    const rows = /** @type {any[]} */ (await res.json());
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const r of rows) {
      const url = sameHost(r.link, origin, site.hostname);
      const title = clean(r.title?.rendered);
      if (!url || !title) continue;
      const text = htmlToText(String(r.content?.rendered ?? ''));
      const tags = [];
      for (const t of taxList) {
        const names = (Array.isArray(r[t]) ? r[t] : []).map((id) => terms.get(t)?.get(id)).filter(Boolean);
        if (names.length) tags.push(`${t[0].toUpperCase()}${t.slice(1).replace(/[_-]/g, ' ')}: ${names.join(', ')}`);
      }
      const postedAt = Date.parse(`${String(r.date_gmt || '').replace(/Z?$/, 'Z')}`);
      jobs.push({
        title,
        url: url.href,
        company: entry.name,
        location: pickLocation([tags.join(' '), title, text], cfg.default_location),
        ...(Number.isFinite(postedAt) ? { postedAt } : {}),
        description: [tags.join('. '), text].filter(Boolean).join('\n\n').slice(0, 4000),
        externalId: String(r.id),
      });
    }
    const total = Number(res.headers.get('x-wp-totalpages'));
    if (!Number.isFinite(total) || page >= total) break;
  }
  return jobs;
}

// ── JobAdder widget ─────────────────────────────────────────────────

const JOBADDER = 'https://apps.jobadder.com/widgets/V1/Jobs/RenderJobList';

/** Parse the widget's job-list HTML. Exported for tests. */
export function parseJobAdderList(html, pageUrl, company, fallbackLocation) {
  /** @type {Job[]} */
  const jobs = [];
  for (const block of String(html).split(/<div class="job(?: alt)?">/).slice(1)) {
    const id = block.match(/data-job-id="(\d+)"/)?.[1];
    const title = clean(block.match(/<h2 class="title">([\s\S]*?)<\/h2>/)?.[1]);
    if (!id || !title) continue;
    const classes = [...block.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => clean(m[1]));
    const date = block.match(/class="date-posted">\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    const postedAt = date ? Date.UTC(Number(date[3]), Number(date[2]) - 1, Number(date[1])) : NaN;
    const summary = clean(block.match(/<p class="summary">([\s\S]*?)<\/p>/)?.[1]);
    const u = new URL(pageUrl);
    u.searchParams.set('ja-job', id);
    jobs.push({
      title,
      url: u.href,
      company,
      location: pickLocation([...classes, summary, title], fallbackLocation),
      ...(Number.isFinite(postedAt) ? { postedAt } : {}),
      description: [classes.join(' · '), summary].filter(Boolean).join('\n\n'),
      externalId: id,
    });
  }
  return jobs;
}

async function fetchJobAdder(entry, cfg, ctx) {
  const site = siteUrl(entry);
  const key = String(cfg.jobadder_key || '');
  if (!/^AU\d_[a-z0-9]{20,40}$/i.test(key)) throw new Error(`recruiter-site: jobadder_key missing or malformed for ${entry.name}`);
  const maxPages = Math.min(Number(cfg.max_pages) || MAX_PAGES_DEFAULT, Number(ctx.maxPages) || Infinity);
  /** @type {Job[]} */
  const jobs = [];
  const seen = new Set();
  for (let page = 1; page <= maxPages; page++) {
    const q = new URLSearchParams({ key, pageNumber: String(page), jobsPerPage: '100', showDatePosted: 'true', callback: 'cb' });
    const raw = await ctx.fetchText(`${JOBADDER}?${q}`);
    const m = raw.match(/^\s*cb\(([\s\S]*)\);?\s*$/);
    if (!m) throw new Error(`recruiter-site: unexpected JobAdder response for ${entry.name}`);
    const html = JSON.parse(m[1]);
    const batch = parseJobAdderList(html, site.href, entry.name, cfg.default_location).filter((j) => !seen.has(j.externalId));
    if (batch.length === 0) break;
    for (const j of batch) { seen.add(j.externalId); jobs.push(j); }
    if (!/class="[^"]*\bnext\b/.test(html)) break;
  }
  return jobs;
}

// ── Plain HTML listing ──────────────────────────────────────────────

/** A regex for an element carrying `cls` as one of its class tokens. */
function classRe(cls) {
  const c = String(cls).replace(/[^a-z0-9_-]/gi, '');
  return new RegExp(`class="(?:[^"]*\\s)?${c}(?:\\s[^"]*)?"[^>]*>([\\s\\S]*?)<\\/`, 'i');
}

/**
 * Extract job links from one listing page. Exported for tests.
 * With `item_marker`, the page is split into list items at that literal
 * string and each item gives one job: its first link matching link_pattern,
 * titled by the item's `title_class` element (for cards whose link only says
 * "View role"). Otherwise every matching link is a job, titled by its
 * `title_class` element or its own text.
 */
export function parseHtmlListing(html, pageUrl, cfg, company) {
  const base = new URL(pageUrl);
  const pattern = new RegExp(String(cfg.link_pattern || '^$'));
  const titleRe = cfg.title_class ? classRe(cfg.title_class) : null;
  const anchors = (chunk) => [...String(chunk).matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((m) => ({ u: sameHost(m[1], base, base.hostname), inner: m[2] }))
    .filter((a) => a.u && pattern.test(a.u.pathname));
  const placeholder = (t) => !t || /^(view|apply|read more|more|view role|view job|details)\b/i.test(t);
  /** @type {Map<string, Job>} */
  const out = new Map();
  const add = (u, title, context) => {
    u.hash = '';
    if (placeholder(title) || out.has(u.href)) return;
    out.set(u.href, { title, url: u.href, company, location: pickLocation([title, context, u.pathname.replace(/[-_/]+/g, ' ')], cfg.default_location) });
  };
  if (cfg.item_marker) {
    for (const item of String(html).split(String(cfg.item_marker)).slice(1)) {
      const a = anchors(item)[0];
      if (!a) continue;
      add(a.u, clean(titleRe ? item.match(titleRe)?.[1] : a.inner), clean(item));
    }
  } else {
    for (const a of anchors(html)) add(a.u, clean(titleRe ? a.inner.match(titleRe)?.[1] : a.inner), clean(a.inner));
  }
  return [...out.values()];
}

async function fetchHtml(entry, cfg, ctx) {
  const site = siteUrl(entry);
  const maxPages = Math.min(Number(cfg.max_pages) || MAX_PAGES_DEFAULT, Number(ctx.maxPages) || Infinity);
  const seen = new Map();
  // listing_urls: several listing pages on the same host (e.g. one per
  // category); careers_url is read first.
  const starts = [site.href, ...(Array.isArray(cfg.listing_urls) ? cfg.listing_urls : [])]
    .map((u) => sameHost(u, site, site.hostname)?.href).filter(Boolean);
  for (const start of [...new Set(starts)]) {
    let url = start;
    for (let page = 1; page <= maxPages && url; page++) {
      const html = await ctx.fetchText(url);
      for (const j of parseHtmlListing(html, url, cfg, entry.name)) if (!seen.has(j.url)) seen.set(j.url, j);
      const next = cfg.next_class
        ? html.match(new RegExp(`<a[^>]*href="([^"]+)"[^>]*class="[^"]*\\b${String(cfg.next_class).replace(/[^a-z0-9_-]/gi, '')}\\b`, 'i'))?.[1]
        : null;
      const nextUrl = next ? sameHost(next, url, site.hostname) : null;
      url = nextUrl && nextUrl.href !== url ? nextUrl.href : '';
    }
  }
  return [...seen.values()];
}

/** @type {Provider} */
export default {
  id: 'recruiter-site',

  detect(entry) {
    return entry?.provider === 'recruiter-site' && entry.careers_url ? { url: String(entry.careers_url) } : null;
  },

  async fetch(entry, ctx) {
    const cfg = config(entry);
    let jobs;
    switch (cfg.strategy) {
      case 'wordpress': jobs = await fetchWordpress(entry, cfg, ctx); break;
      case 'jobadder': jobs = await fetchJobAdder(entry, cfg, ctx); break;
      case 'html': jobs = await fetchHtml(entry, cfg, ctx); break;
      default: throw new Error(`recruiter-site: unknown recruiter.strategy "${cfg.strategy}" for ${entry.name} (wordpress, jobadder or html)`);
    }
    // listing_confirms_active: the site takes applications by email or a
    // pop-up form, so scan --verify treats "on the live listing" as open
    // rather than dropping the role for having no Apply button.
    return cfg.listing_confirms_active === true ? jobs.map((j) => ({ ...j, listingConfirmed: true })) : jobs;
  },
};
