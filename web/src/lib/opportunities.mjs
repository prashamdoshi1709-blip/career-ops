// Local customisation (2026-11-10): "All Job Opportunities".
//
// One list of every job Career-Ops knows about: tracker rows (evaluated, with a
// Detailed rating from their report) plus inbox postings (awaiting evaluation,
// with a Preliminary rating computed HERE, locally, with zero Claude calls).
// Genuine duplicates found on several sites are merged into one entry that
// keeps every source link and prefers the employer's own page.
//
// Read-only: nothing in this module writes a file or changes a status.

import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { readPipelineDetails, deadlineFromNotes } from "./pipeline-details.mjs";
import { irrelevantReason } from "./role-relevance.mjs";
import { postingIdFor } from "./posting-id.mjs";

// ---------- small helpers ----------

const read = (root, rel) => {
  try { return fs.readFileSync(path.join(root, rel), "utf8"); } catch { return ""; }
};
const lines = (s) => s.split(/\r?\n/);
// Calendar day in Sydney, not UTC (Sydney is 10-11 hours ahead).
const isoDay = (d) => d.toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const linkHref = (cell) => {
  const s = String(cell ?? "").trim();
  const m = s.match(/\((https?:\/\/[^)\s]+)\)/);
  if (m) return m[1];
  return /^https?:\/\//.test(s) ? s : "";
};

// ---------- source of a link ----------

const EMPLOYER_HOSTS = [
  [/myworkdayjobs\.com/, "Employer (Workday)"], [/smartrecruiters\.com/, "Employer (SmartRecruiters)"],
  [/greenhouse\.io/, "Employer (Greenhouse)"], [/lever\.co/, "Employer (Lever)"], [/ashbyhq\.com/, "Employer (Ashby)"],
  [/oraclecloud\.com/, "Employer (Oracle)"], [/eightfold\.ai/, "Employer (Eightfold)"], [/jobs\.deloitte\.com\.au/, "Employer (Deloitte)"],
  [/careers\.ey\.com/, "Employer (EY)"], [/jobs\.citi\.com/, "Employer (Citi)"], [/bamboohr\.com/, "Employer (BambooHR)"],
];

/** "SEEK" | "LinkedIn" | "Employer (…)" | host */
export function sourceOf(url) {
  const u = String(url ?? "");
  if (/seek\.com/.test(u)) return "SEEK";
  if (/linkedin\.com/.test(u)) return "LinkedIn";
  if (/indeed\./.test(u)) return "Indeed";
  if (/efinancialcareers/.test(u)) return "eFinancialCareers";
  for (const [re, label] of EMPLOYER_HOSTS) if (re.test(u)) return label;
  try { return new URL(u).host.replace(/^www\./, ""); } catch { return "Unknown"; }
}
export const isEmployerSource = (s) => String(s).startsWith("Employer");

// ---------- normalisation for duplicate detection ----------

const COMPANY_ALIASES = [[/^j\.?\s?p\.?\s?morgan.*|^jpmorgan.*/, "jpmorgan"], [/^kpmg.*/, "kpmg"], [/^deloitte.*/, "deloitte"], [/^ey\b.*|^ernst.*/, "ey"], [/^pwc.*/, "pwc"]];
export function normCompany(name) {
  let s = String(name ?? "").toLowerCase().replace(/\(.*?\)/g, " ").replace(/[^a-z0-9& ]+/g, " ");
  s = s.replace(/\b(pty|ltd|limited|inc|llc|plc|services|group|holdings|australia|australian|the|co|corporation|corp)\b/g, " ").replace(/\s+/g, " ").trim();
  for (const [re, v] of COMPANY_ALIASES) if (re.test(s)) return v;
  return s;
}
export function normTitle(title) {
  return String(title ?? "").toLowerCase().replace(/[–—]/g, "-").replace(/\s+-\s+(sydney|melbourne|brisbane|perth|adelaide)\b.*$/, "")
    .replace(/[^a-z0-9&/ ]+/g, " ").replace(/\s+/g, " ").trim();
}
const CITY = /\b(sydney|melbourne|brisbane|perth|adelaide|canberra|hobart|darwin|gold coast|newcastle|national)\b/i;
export const cityOf = (loc) => (String(loc ?? "").match(CITY)?.[1] ?? "").toLowerCase();
const REQ_RE = /\b(?:req(?:uisition)?(?:\s*id)?|job\s*ref|ref|jr|r_)\s*[#:]?\s*([A-Z]*\d[\w-]{2,})/i;
export const reqIdOf = (s) => (String(s ?? "").match(REQ_RE)?.[1] ?? "").toUpperCase();

/** Two entries are the same vacancy only on strong evidence; similar titles alone never merge. */
export function sameVacancy(a, b) {
  if (a.url && b.url && a.url === b.url) return true;
  if (a.reqId && b.reqId) return a.reqId === b.reqId && a.companyKey === b.companyKey;
  if (!a.companyKey || a.companyKey !== b.companyKey || a.titleKey !== b.titleKey) return false;
  const ca = cityOf(a.location), cb = cityOf(b.location);
  return !ca || !cb || ca === cb || ca === "national" || cb === "national";
}

// ---------- categories and the preliminary rating ----------

export const CATEGORIES = [
  "Investment Banking & M&A",
  "Corporate Finance & Corporate Development",
  "Equity Research",
  "Valuations & Financial Modelling",
  "Transaction Services & Restructuring",
  "Investment, PE & Credit",
  "Financial Analyst & FP&A",
  // Added 2026-11-10: consulting and strategy.
  "Commercial Due Diligence",
  "Strategy Consulting",
  "Management Consulting",
  "Corporate Strategy",
  "Performance Improvement",
  "Business Transformation",
  // Added 2026-11-22.
  "Corporate & Institutional Banking",
  "Portfolio & Asset Management",
  "Other",
];

// Priority tiers (2026-11-22), from your order: 1 IB and M&A, corporate finance,
// transaction advisory, modelling and valuations; 2 equity research, corporate
// and institutional banking, portfolio and asset management, investment, PE and
// credit, strategy; 3 consulting, FP&A and other finance. A tier ranks jobs; it
// never hides one.
export const PRIORITY_TIERS = {
  1: ["Investment Banking & M&A", "Corporate Finance & Corporate Development", "Transaction Services & Restructuring", "Commercial Due Diligence", "Valuations & Financial Modelling"],
  2: ["Equity Research", "Corporate & Institutional Banking", "Portfolio & Asset Management", "Investment, PE & Credit", "Corporate Strategy", "Strategy Consulting"],
  3: ["Management Consulting", "Performance Improvement", "Business Transformation", "Financial Analyst & FP&A", "Other"],
};
export function priorityTier(category) {
  for (const t of [1, 2, 3]) if (PRIORITY_TIERS[t].includes(category)) return t;
  return 3;
}

// Strategy firms (MBB and specialist strategy houses). Used for the category and
// for a separate "career appeal" tag; firm reputation never changes suitability.
const STRATEGY_FIRMS = /\b(mckinsey|boston consulting|bcg|bain & company|bain and company|oliver wyman|kearney|l\.?e\.?k\.? consulting|roland berger|strategy&|parthenon|monitor deloitte|simon-kucher|arthur d\.? little|oc&c|port jackson|alphabeta|nous group|partners in performance|sia partners)\b/i;
const CONSULTING_FIRMS = /\b(accenture|deloitte|pwc|pricewaterhouse|\bey\b|ernst|kpmg|grant thornton|bdo|rsm|fti consulting|kordamentha|alvarez|protiviti|capgemini|marsh mclennan)\b/i;

/** Career appeal of the employer, kept separate from suitability. */
export function careerAppeal(company, title = "") {
  if (/\b(mckinsey|boston consulting|bcg|bain & company|bain and company)\b/i.test(company)) return "High career appeal, highly competitive";
  if (STRATEGY_FIRMS.test(company) || /parthenon|strategy&|monitor deloitte/i.test(`${company} ${title}`)) return "High career appeal, competitive";
  return null;
}

/** category, objective alignment (0-10) and base skills match (0-10) from the title (and JD text when present). */
const PROPERTY_FIRMS = /\b(jll|cbre|colliers|knight frank|savills|herron todd white|cushman|opteon|preston rowe|m3 property)\b/i;

export function classify(title, jd = "", company = "") {
  const t = String(title ?? "").toLowerCase();
  if (PROPERTY_FIRMS.test(company) && /valuation|valuer|analyst/.test(t)) return { category: "Other", alignment: 3, skills: 4, note: "real-estate rather than business valuation" };
  if (/universit|college|institute|tafe|hospital|research centre|csiro/i.test(company) && /research/.test(t)) return { category: "Other", alignment: 2, skills: 3, note: "academic research, not investment research" };
  if (/workday|\bsap\b|oracle|systems|payroll|bookkeep|accounts (payable|receivable)|accountant|finance officer|accounts officer/.test(t)) return { category: "Other", alignment: 2.5, skills: 4, note: "finance systems or routine accounting rather than analysis" };
  // 2026-11-23: private markets credit and investing come before the retail
  // lending and property rules, which would otherwise catch "direct lending"
  // and "real estate investing".
  if (/private (credit|debt)|direct lending|special situations|structured (credit|lending)|credit (investments?|opportunities)|capital solutions|distressed|mezzanine|infrastructure debt|fund finance|real estate (investing|investment|credit|debt)|investment underwriting|portfolio analytics|capital allocation/.test(t)) return { category: "Investment, PE & Credit", alignment: 8, skills: 7.5 };
  if (/residential|home loan|mortgage|(?<!corporate |institutional |commercial |structured |direct )lending|broking|broker/.test(t)) return { category: "Investment, PE & Credit", alignment: 4, skills: 4, note: "retail or business lending credit" };
  if (/business management graduate|general graduate/.test(t)) return { category: "Other", alignment: 3, skills: 4 };
  if (/\btax\b|transfer pricing|\baudit\b|assurance|regulatory risk|risk (&|and) compliance|actuar/.test(t)) return { category: "Other", alignment: 3, skills: 4, note: "tax, audit, risk or actuarial rather than strategy or finance analysis" };
  if (/(workforce|people|hr|marketing|brand|digital|ai|data|it|technology|product|customer experience)\s+strategy/.test(t)) return { category: "Corporate Strategy", alignment: 5, skills: 5, note: "functional strategy (HR, marketing, technology) rather than corporate or commercial strategy" };
  const any = (re) => re.test(t);
  if (any(/financial planner|financial advis|paraplanner|mortgage broker/)) return { category: "Other", alignment: 1, skills: 2, note: "personal financial advice, not analytical finance" };
  if (any(/property valuation|valuer|real estate|property|capital markets.*(hotel|office)|hotel capital/)) return { category: "Other", alignment: 3, skills: 4, note: "real-estate rather than business valuation" };
  if (any(/equity research|research analyst|research associate|equity analyst|sell-side|buy-side/)) return { category: "Equity Research", alignment: 8.5, skills: 9 };
  if (any(/valuation|financial model/)) return { category: "Valuations & Financial Modelling", alignment: 8.5, skills: 8.5 };
  // Consulting (2026-11-10). CDD / deal strategy reuses IB and research evidence directly.
  if (any(/commercial due diligence|\bcdd\b|deal strategy|transaction strategy|transactions strategy|m&a strategy|strategy (&|and) transactions/)) return { category: "Commercial Due Diligence", alignment: 9, skills: 8.5 };
  if (any(/transaction (services|support|analytics)|due diligence|restructuring|turnaround|insolvency/)) return { category: "Transaction Services & Restructuring", alignment: 7.5, skills: 7 };
  if (any(/investment bank|\bm&a\b|mergers|corporate advisory|\becm\b|\bdcm\b|capital markets|leveraged finance|acquisition finance|financial sponsors|deal advisory|deals advisory|transaction advisory/)) return { category: "Investment Banking & M&A", alignment: 10, skills: 8.5 };
  if (any(/corporate finance|corporate development|strategy & m|group strategy/)) return { category: "Corporate Finance & Corporate Development", alignment: 9.5, skills: 8.5 };
  const atStrategyFirm = STRATEGY_FIRMS.test(company) || /parthenon|monitor deloitte|strategy&/i.test(t);
  const atConsultancy = atStrategyFirm || CONSULTING_FIRMS.test(company);
  if (any(/performance improvement|operational excellence|operations improvement/)) return { category: "Performance Improvement", alignment: 6, skills: 5.5 };
  if (any(/transformation/)) return { category: "Business Transformation", alignment: 5.5, skills: 5 };
  // No consulting projects on the CV: transferable analysis, so skills match is moderate.
  if (atStrategyFirm && any(/business analyst|associate|consultant|analyst|graduate|strategy/)) return { category: "Strategy Consulting", alignment: 8, skills: 6.5 };
  if (any(/strategy (consultant|analyst|associate)|strategy & operations|graduate strategy/) && atConsultancy) return { category: "Strategy Consulting", alignment: 8, skills: 6.5 };
  if (any(/corporate strategy|business strategy|commercial strategy|growth strategy|operations strategy|strategy analyst|strategy associate|strategy manager|strategic planning/)) return { category: "Corporate Strategy", alignment: 8, skills: 7.5 };
  if (any(/management consult|consulting analyst|associate consultant|graduate consultant|\bconsulting\b|business analyst.*(consult|strategy)/) || (atConsultancy && any(/consultant|associate|business analyst/))) return { category: "Management Consulting", alignment: 7, skills: 6 };
  // 2026-11-22: relationship, coverage and lending roles in corporate and
  // institutional banking; portfolio, asset allocation and funds management.
  if (any(/corporate banking|institutional banking|business banking|global banking|transaction banking|relationship (manager|analyst|associate)|coverage analyst|corporate lending|structured finance|project finance/)) return { category: "Corporate & Institutional Banking", alignment: 7, skills: 6.5 };
  if (any(/portfolio manag|asset allocation|multi[- ]asset|asset management|funds? management|fund analyst|funds analyst|investment strategy/)) return { category: "Portfolio & Asset Management", alignment: 7, skills: 6.5 };
  if (any(/credit analyst|credit management/)) return { category: "Investment, PE & Credit", alignment: 6, skills: 5.5 };
  if (any(/private equity|private credit|investment analyst|investment associate|portfolio analyst|infrastructure|investments?\b.*analyst|fund/)) return { category: "Investment, PE & Credit", alignment: 7.5, skills: 7.5 };
  if (any(/fp&a|financial planning (&|and) analysis/)) return { category: "Financial Analyst & FP&A", alignment: 7, skills: 6.5 };
  if (any(/treasury/)) return { category: "Financial Analyst & FP&A", alignment: 6, skills: 5 };
  if (any(/financial reporting|reporting analyst/)) return { category: "Financial Analyst & FP&A", alignment: 5.5, skills: 5 };
  if (any(/strategic finance|commercial finance|corporate financial|capital planning|business finance|investment finance|financial analyst|finance analyst/)) return { category: "Financial Analyst & FP&A", alignment: 7.5, skills: 7 };
  if (any(/graduate|analyst/) && /finance|financ/.test(t + " " + jd.slice(0, 2000).toLowerCase())) return { category: "Financial Analyst & FP&A", alignment: 6, skills: 6 };
  return { category: "Other", alignment: 4, skills: 4 };
}

function seniorityScore(title, jd) {
  const t = String(title ?? "").toLowerCase();
  const years = [...String(jd ?? "").matchAll(/(\d{1,2})\s*\+?\s*(?:-|to|–)?\s*\d{0,2}\s*\+?\s*years?/gi)].map((m) => Number(m[1])).filter((n) => n > 0 && n < 20);
  if (years.length) {
    const min = Math.min(...years);
    return min <= 2 ? 9 : min === 3 ? 6.5 : min === 4 ? 5 : 3;
  }
  if (/off-cycle/.test(t)) return 6;
  if (/\b(intern|internship|vacation|summer|winter)\b/.test(t)) return 4;
  if (/\b(manager|head|lead|principal|director)\b/.test(t) && !/assistant manager/.test(t)) return 3;
  if (/senior (analyst|associate|consultant)|assistant manager|analyst ii|analyst 2/.test(t)) return 6;
  if (/graduate|junior|entry/.test(t)) return 8.5;
  if (/\bassociate\b/.test(t) && /bank|m&a|corporate finance|sponsors/.test(t)) return 5.5;
  if (/\banalyst\b|\bconsultant\b|\bassociate\b/.test(t)) return 8.5;
  return 6.5;
}

function practicalScore(location, title, jd) {
  const loc = String(location ?? "").toLowerCase();
  let s = /sydney/.test(loc) ? 10 : CITY.test(loc) || /australia|nsw|vic|qld|\bwa\b|\bsa\b|act/.test(loc) ? 9 : 6;
  const text = `${title} ${jd}`.toLowerCase();
  if (/contract|fixed[- ]term|temp\b|interim/.test(text)) s -= 1.5;
  if (/\b(ca|cpa|cfa)\b[^.]{0,30}(required|essential|must)/.test(text)) s -= 2;
  return Math.max(0, s);
}

/**
 * Preliminary suitability (0-10), using the agreed weights:
 * 30% objective alignment, 25% experience and skills, 20% seniority,
 * 15% responsibilities, 10% qualifications/location/practical.
 * Returns null score (Rating Pending) when the title or an Australian location is missing.
 */
export function preliminaryRating({ title, location, jd = "", company = "" }) {
  if (!title || !location) return { score: null, type: "Pending", confidence: "—", category: classify(title, jd).category, reason: !title ? "no job title" : "location not confirmed" };
  const c = classify(title, jd, company);
  let skills = c.skills;
  let resp = c.alignment * 0.9;
  const low = jd.toLowerCase();
  if (jd) {
    const plus = ["valuation", "dcf", "financial model", "m&a", "due diligence", "research", "comparable", "forecast", "capital raising", "investment committee", "market analysis", "competitor", "commercial analysis", "recommendation"].filter((k) => low.includes(k)).length;
    const minus = ["power bi", "sql", "python", "tableau", "sap ", "payroll", "accounts payable"].filter((k) => low.includes(k)).length;
    skills = Math.min(10, skills + Math.min(1.5, plus * 0.4) - Math.min(2, minus * 0.7));
    resp = Math.min(10, Math.max(0, 5 + plus * 0.8 - minus));
  }
  const sen = seniorityScore(title, jd);
  const prac = practicalScore(location, title, jd);
  let raw = 0.3 * c.alignment + 0.25 * skills + 0.2 * sen + 0.15 * resp + 0.1 * prac;
  // Without the job description the experience bar is unknown, so a title-only
  // rating is shrunk toward the middle and capped at 8.0 (no inflated scores).
  if (!jd) raw = Math.min(8, 5 + (raw - 5) * 0.75);
  // With a job description (manually added jobs) the keyword reading is still a
  // heuristic: it cannot judge the real experience bar or the competition, so a
  // preliminary rating never reaches the 9+ "Exceptional" band; that needs a
  // detailed evaluation.
  else raw = Math.min(8.5, raw);
  const score = Math.round(raw * 10) / 10;
  return { score, type: "Preliminary", confidence: jd ? "Medium" : "Low", category: c.category, reason: c.note ?? (jd ? "title, location and job description" : "title and location only; open the job to confirm") };
}

export function ratingBand(score) {
  if (score == null) return "Rating Pending";
  if (score >= 9) return "Exceptional match";
  if (score >= 8) return "Strong match";
  if (score >= 7) return "Good opportunity";
  if (score >= 6) return "Partial match";
  return "Lower priority";
}

// ---------- inputs ----------

/** scan-history.tsv: url → {firstSeen, portal, status, postedAt, reqId, location} (latest row wins for status) */
export function readScanHistory(root) {
  const map = new Map();
  const text = read(root, "data/scan-history.tsv");
  const rows = lines(text);
  const head = (rows[0] ?? "").split("\t");
  const ix = (k) => head.indexOf(k);
  for (const line of rows.slice(1)) {
    if (!line) continue;
    const f = line.split("\t");
    const url = f[0];
    const prev = map.get(url);
    map.set(url, {
      firstSeen: prev?.firstSeen && prev.firstSeen < f[ix("first_seen")] ? prev.firstSeen : f[ix("first_seen")],
      lastSeen: prev?.lastSeen && prev.lastSeen > f[ix("first_seen")] ? prev.lastSeen : f[ix("first_seen")],
      portal: f[ix("portal")],
      status: f[ix("status")],
      postedAt: f[ix("posted_at")] || prev?.postedAt || "",
      reqId: f[ix("requisition_id")] || "",
      location: f[ix("location")] || "",
      title: f[ix("title")] || "",
      company: f[ix("company")] || "",
    });
  }
  return map;
}

/** Pending inbox lines of data/pipeline.md, including the `note:` label. */
export function readInbox(root) {
  const out = [];
  let section = "";
  for (const line of lines(read(root, "data/pipeline.md"))) {
    if (line.startsWith("## ")) section = line.trim();
    if (section !== "## Pending") continue;
    const m = line.match(/^\s*-\s*\[ \]\s*(.+)$/);
    if (!m) continue;
    const cells = m[1].split("|").map((s) => s.trim());
    const url = cells.find((c) => /^https?:\/\//.test(c));
    if (!url) continue;
    const rest = cells.slice(cells.indexOf(url) + 1);
    const labels = Object.fromEntries(rest.slice(2).map((c) => c.match(/^(posted|note|trust|rank):\s*(.*)$/i)).filter(Boolean).map((x) => [x[1].toLowerCase(), x[2]]));
    const positional = rest.filter((c, i) => i < 2 || !/^(posted|note|trust|rank):/i.test(c));
    out.push({ url, company: positional[0] ?? "", title: positional[1] ?? "", location: positional[2] ?? "", posted: labels.posted ?? "", note: labels.note ?? "" });
  }
  return out;
}

// ---------- build ----------

/**
 * @param {string} root career-ops data root
 * @param {object[]} applications tracker rows (Application shape)
 * @param {{today?: string}} [opts]
 */
export function buildOpportunities(root, applications, opts = {}) {
  const today = opts.today ?? isoDay(new Date());
  const history = readScanHistory(root);
  const details = readPipelineDetails(root, applications);
  const entries = [];

  for (const a of applications) {
    const d = details[a.n] ?? {};
    const url = linkHref(a.url);
    const reportFile = (String(a.report ?? "").match(/\(([^)]+\.md)\)/) ?? [])[1];
    const report = reportFile ? read(root, path.join("reports", path.basename(reportFile))) : "";
    const verification = (report.match(/^\*\*Verification:\*\*\s*(.+)$/m) ?? [])[1] ?? "";
    const reportDate = (report.match(/^\*\*Date:\*\*\s*(\d{4}-\d{2}-\d{2})/m) ?? [])[1] ?? a.date;
    const conf = (report.match(/^confidence:\s*"?(\w+)"?/m) ?? [])[1];
    const score5 = Number(String(a.score).match(/([\d.]+)\s*\/\s*5/)?.[1]);
    const h = history.get(url);
    const closed = /discarded|skip/i.test(a.status) && /closed|no longer|withdrawn|expired/i.test(a.notes ?? "") || h?.status === "skipped_expired";
    const unconfirmed = /unconfirmed|not found on|could not be matched|cannot be confirmed/i.test(verification);
    let category = classify(a.role, report.split(/^## Job Description/m)[1] ?? "", a.company).category;
    // An ambiguous title ("Metals & Mining Analyst") takes its category from the report's archetype.
    const archetype = (report.match(/^\*\*Archetype:\*\*\s*(.+)$/m) ?? [])[1] ?? "";
    if ((category === "Financial Analyst & FP&A" || category === "Other") && archetype && !/financial analyst|fp&a/i.test(a.role)) {
      category = /Equity Research|Investment Research/i.test(archetype) ? "Equity Research"
        : /Financial Modelling|Valuation|Transaction Advisory/i.test(archetype) ? "Valuations & Financial Modelling"
        : /Private Equity|Private Credit|Investment Management/i.test(archetype) ? "Investment, PE & Credit"
        : /Investment Banking|M&A|Leveraged|Acquisition|Institutional Banking/i.test(archetype) ? (/corporate finance|corporate development/i.test(a.role) ? "Corporate Finance & Corporate Development" : "Investment Banking & M&A")
        : category;
    }
    // Jobs added by hand (+ Add Job Manually) carry no score: rate them locally
    // from the pasted JD, exactly like a scan find, until an AI evaluation exists.
    const manual = /^\*\*Source:\*\*\s*Manual\b/m.test(report);
    const manualSource = manual ? ((report.match(/^\*\*Source:\*\*\s*Manual \((.+)\)/m) ?? [])[1] ?? "Other") : "";
    const prelim = manual && !Number.isFinite(score5)
      ? preliminaryRating({ title: a.role, location: d.location || "", jd: report.split(/^## Job Description[^\n]*\n/m)[1] ?? "", company: a.company })
      : null;
    entries.push({
      key: `t${a.n}`,
      n: a.n,
      kind: "tracked",
      company: a.company === "?" ? `Confidential${a.via && a.via !== "—" ? ` (via ${a.via})` : ""}` : a.company,
      companyKey: normCompany(a.company === "?" ? `${a.via} ${a.role}` : a.company),
      title: a.role,
      titleKey: normTitle(a.role),
      location: d.location || "",
      category,
      score: Number.isFinite(score5) ? Math.round(score5 * 20) / 10 : prelim?.score ?? null,
      ratingType: Number.isFinite(score5) ? "Detailed" : prelim?.type ?? "Pending",
      confidence: Number.isFinite(score5) ? (conf ? conf[0].toUpperCase() + conf.slice(1).toLowerCase() : "High") : prelim?.confidence ?? "—",
      sources: [{ label: manual ? `Added manually (${manualSource})` : sourceOf(url), url }],
      manual,
      jdUpdatedAt: manual ? ((report.match(/^\*\*JD updated:\*\*\s*(\S+)/m) ?? [])[1] ?? "") : "",
      url,
      applyUrl: isEmployerSource(sourceOf(url)) || sourceOf(url) === "SEEK" ? url : "",
      posted: d.posted || h?.postedAt || "",
      deadline: d.deadline || deadlineFromNotes(a.notes),
      lastVerified: h?.lastSeen && h.lastSeen > reportDate ? h.lastSeen : reportDate,
      verified: !unconfirmed && !closed,
      availability: closed ? "Closed" : unconfirmed ? "Needs verification" : "Open",
      stage: d.stage ?? "Under Review",
      status: a.status,
      cv: Boolean(d.cv),
      cover: Boolean(d.cover),
      docN: d.reportNum ?? a.n,
      reqId: reqIdOf(a.notes) || reqIdOf(url) || h?.reqId || "",
      reason: manual ? `Added manually from ${manualSource}; ${prelim?.reason ?? "rated from the pasted job description"}` : "Evaluated in a Career-Ops report",
      appeal: careerAppeal(a.company === "?" ? "" : a.company, a.role),
      notes: a.notes ?? "",
    });
  }

  // Screening results (screening.mjs) replace a preliminary rating, never a detailed one.
  let screening = {};
  try { screening = JSON.parse(read(root, "data/screening.json") || "{}"); } catch { screening = {}; }
  const screenedKeyFor = (e) => (e.kind === "tracked" ? `t${e.n}` : `p${postingIdFor(e.url)}`);
  const applyScreen = (e) => {
    const sc = screening[screenedKeyFor(e)];
    if (!sc || e.ratingType === "Detailed") return e;
    return { ...e, prelimScore: e.score, score: sc.score, ratingType: "Screened", confidence: sc.confidence[0].toUpperCase() + sc.confidence.slice(1), screen: sc, reason: `Screened from ${sc.basis}${sc.fit?.length ? `. Fits: ${sc.fit.join("; ")}` : ""}${sc.concerns?.length ? `. Concerns: ${sc.concerns.join("; ")}` : ""}` };
  };

  const hidden = [];
  for (const j of readInbox(root)) {
    // Inbox finds whose main function is sales/BD/marketing/senior leadership are
    // hidden from the list (still kept in data/pipeline.md). Tracked rows never are.
    const why = irrelevantReason(j.title, j.company);
    if (why) { hidden.push({ company: j.company, title: j.title, location: j.location, url: j.url, reason: why }); continue; }
    const h = history.get(j.url);
    const r = preliminaryRating({ title: j.title, location: j.location, company: j.company });
    const src = sourceOf(j.url);
    const fromScan = Boolean(h);
    const lastVerified = h?.lastSeen ?? "";
    const fresh = lastVerified && daysBetween(lastVerified, today) <= 14;
    entries.push({
      key: `i${j.url}`,
      n: null,
      kind: "inbox",
      company: j.company.replace(/^\?\s*\(via (.+)\)$/, "Confidential (via $1)"),
      companyKey: normCompany(j.company.replace(/^\?\s*\(via (.+)\)$/, "$1")),
      title: j.title,
      titleKey: normTitle(j.title),
      location: j.location,
      category: r.category,
      score: r.score,
      ratingType: r.type,
      confidence: r.confidence,
      sources: [{ label: src, url: j.url }],
      url: j.url,
      applyUrl: isEmployerSource(src) || src === "SEEK" ? j.url : "",
      posted: /^\d{4}-\d{2}-\d{2}$/.test(j.posted) ? j.posted : h?.postedAt || "",
      deadline: deadlineFromNotes(j.note),
      lastVerified,
      verified: fromScan && Boolean(fresh) && src !== "LinkedIn",
      availability: h?.status === "skipped_expired" ? "Closed" : fromScan && fresh && src !== "LinkedIn" ? "Open" : "Needs verification",
      stage: "New",
      status: "",
      cv: false,
      cover: false,
      docN: null,
      reqId: reqIdOf(j.url) || h?.reqId || "",
      reason: r.reason,
      appeal: careerAppeal(j.company, j.title),
      notes: j.note,
    });
  }

  // Merge genuine duplicates. A tracked row always wins; otherwise prefer the employer's own page.
  const rank = (e) => (e.kind === "tracked" ? 0 : isEmployerSource(e.sources[0].label) ? 1 : e.sources[0].label === "SEEK" ? 2 : 3);
  const merged = [];
  let duplicatesRemoved = 0;
  for (const e of [...entries].sort((x, y) => rank(x) - rank(y))) {
    const host = merged.find((m) => sameVacancy(m, e));
    if (!host) { merged.push(e); continue; }
    duplicatesRemoved++;
    for (const s of e.sources) if (!host.sources.some((x) => x.url === s.url)) host.sources.push(s);
    if (!host.applyUrl && e.applyUrl) host.applyUrl = e.applyUrl;
    if (!host.posted && e.posted) host.posted = e.posted;
    if (!host.deadline && e.deadline) host.deadline = e.deadline;
    if (e.lastVerified > (host.lastVerified ?? "")) host.lastVerified = e.lastVerified;
    if (host.availability === "Needs verification" && e.availability === "Open") { host.availability = "Open"; host.verified = true; }
  }
  return { jobs: merged.map(applyScreen).map((j) => ({ ...j, priorityTier: priorityTier(j.category) })), duplicatesRemoved, today, hidden };
}

// ---------- search coverage ----------

const PUBLIC_ONLY = [
  ["LinkedIn Jobs", "Public job pages read on request, then confirmed at the employer", "Restricted", "No API; logged-in search not used. Only public listing pages, read during an interactive search."],
  ["Indeed", "Not searched automatically", "Restricted", "Blocks automated access; use web search results and the employer link."],
  ["Glassdoor", "Not searched automatically", "Restricted", "Login wall; not accessed."],
  ["eFinancialCareers", "Public listing pages read on request", "Partial", "Public pages only; mostly senior or non-target roles seen so far."],
  ["GradConnection / SEEK Grad", "Covered through SEEK", "Partial", "GradConnection now redirects to SEEK Grad listings, which the SEEK searches return."],
  ["Prosple", "Not configured", "Not Configured", "No supported reader yet."],
  ["Jora", "Not configured", "Not Configured", "Aggregator of SEEK and employer ads; no supported reader yet."],
  ["Adzuna", "Not configured", "Not Configured", "Has a free API but needs your own API key; not set up."],
  ["Google-indexed listings", "Web search during interactive sessions", "Partial", "Used to find employer pages; not run on a schedule."],
];

/** Per-source coverage from data/portal-health.tsv, data/scan-history.tsv and portals.yml. */
export function readCoverage(root, jobs = []) {
  const health = new Map();
  for (const line of lines(read(root, "data/portal-health.tsv")).slice(1)) {
    const [ts, name, status] = line.split("\t");
    if (!name) continue;
    const h = health.get(name) ?? { attempted: "", success: "", status: "" };
    if (ts > h.attempted) { h.attempted = ts; h.status = status; }
    if (status === "reachable" && ts > h.success) h.success = ts;
    health.set(name, h);
  }
  const history = readScanHistory(root);
  const seekRows = [...history.values()].filter((h) => h.portal === "jobstreet-api");
  const rows = [];
  const seekNames = [...health.keys()].filter((n) => /^SEEK AU/.test(n));
  const seekH = seekNames.map((n) => health.get(n));
  const last = (k) => seekH.map((h) => h[k]).filter(Boolean).sort().pop() ?? "";
  const kept = (pred) => jobs.filter((j) => j.sources.some((s) => pred(s))).length;
  const dupes = (pred) => jobs.reduce((n, j) => n + (j.sources.length > 1 && j.sources.slice(1).some(pred) ? 1 : 0), 0);
  rows.push({
    name: `SEEK (${seekNames.length} searches)`, method: "SEEK public search API, zero tokens",
    attempted: last("attempted"), success: last("success"),
    status: seekH.length === 0 ? "Not Configured" : seekH.every((h) => h.status === "reachable") ? "Working" : seekH.some((h) => h.status === "reachable") ? "Partial" : "Failed",
    discovered: seekRows.length, retained: kept((s) => s.label === "SEEK"), duplicates: dupes((s) => s.label === "SEEK"),
    note: seekH.some((h) => h.status !== "reachable") ? "One or more searches failed on the last run" : "",
  });
  const companyRows = [...history.values()].reduce((m, h) => m.set(h.company, (m.get(h.company) ?? 0) + 1), new Map());
  for (const [name, h] of [...health.entries()].filter(([n]) => !/^SEEK AU/.test(n)).sort((a, b) => a[0].localeCompare(b[0]))) {
    rows.push({
      name, method: "Employer careers board (ATS API), zero tokens", attempted: h.attempted, success: h.success,
      status: h.status === "reachable" ? "Working" : "Failed", discovered: companyRows.get(name) ?? 0,
      retained: jobs.filter((j) => normCompany(j.company) === normCompany(name)).length, duplicates: 0,
      note: h.status === "reachable" ? "" : `Last check: ${h.status}`,
    });
  }
  for (const [name, method, status, note] of PUBLIC_ONLY) {
    const label = name.split(" ")[0];
    rows.push({ name, method, attempted: "", success: "", status, discovered: null, retained: kept((s) => s.label === label), duplicates: dupes((s) => s.label === label), note });
  }
  return rows;
}

/** Last scan run (data/scan-runs.tsv). */
export function lastScanRun(root) {
  const rows = lines(read(root, "data/scan-runs.tsv")).filter(Boolean);
  if (rows.length < 2) return null;
  const head = rows[0].split("\t");
  const f = rows[rows.length - 1].split("\t");
  const g = (k) => f[head.indexOf(k)];
  return { at: g("timestamp"), status: g("status"), found: Number(g("found")), added: Number(g("new_added")), errors: Number(g("errors")), filteredLocation: Number(g("filtered_location")), dupes: Number(g("dupes")) };
}
