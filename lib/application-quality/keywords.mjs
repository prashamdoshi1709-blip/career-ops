// Job keywords classified against a candidate's own record (2026-11-17; split 2026-11-19).
//
// Generic part (tracked): the job-ad term list, essential/preferred detection,
// the classifier, the prompt block and the final-document check. The candidate's
// evidence (which cv.md wording supports each term, and in what limited form) is
// passed in as `evidence`; it stays in the candidate's own, untracked files.
// Without evidence for a term, it counts as direct when the term appears in cv.md
// and as unsupported otherwise. No percentage or "ATS score" is produced.
//
// Classes: direct | transferable | careful | unsupported | unverified

/** term: how it is reported. cat: its family. jd: how it is found in a job ad. */
export const TERMS = [
  { term: "financial modelling", cat: "modelling", jd: /financial model(l)?ing|financial models?\b/i },
  { term: "three-statement modelling", cat: "modelling", jd: /three[- ]statement|3[- ]statement|integrated (financial )?model/i },
  { term: "forecasting", cat: "modelling", jd: /forecast/i },
  { term: "scenario and sensitivity analysis", cat: "modelling", jd: /scenario|sensitivit/i },
  { term: "DCF valuation", cat: "valuation", jd: /\bdcf\b|discounted cash flow/i },
  { term: "valuation", cat: "valuation", jd: /valuation|valuing/i },
  { term: "comparable company analysis", cat: "valuation", jd: /comparable compan|trading comp|\bcomps\b|trading multiples|peer (group|set)/i },
  { term: "trading multiples", cat: "valuation", jd: /multiples|ev\/ebitda|ev\/sales|p\/e\b/i },
  { term: "precedent transactions", cat: "valuation", jd: /precedent transaction|transaction comparables|deal comps/i },
  { term: "LBO modelling", cat: "modelling", jd: /\blbo\b|leveraged buyout/i },
  { term: "merger modelling", cat: "modelling", jd: /merger model|accretion|dilution/i },
  { term: "project finance modelling", cat: "modelling", jd: /project finance/i },
  { term: "model review and audit", cat: "modelling", jd: /model (review|audit|integrity)|reviewing models/i },
  { term: "independent expert reports", cat: "valuation", jd: /independent expert/i },
  { term: "M&A", cat: "transactions", jd: /\bm&a\b|mergers and acquisitions|mergers & acquisitions/i },
  { term: "transaction analysis", cat: "transactions", jd: /transaction/i },
  { term: "deal execution", cat: "transactions", jd: /deal execution|execute (transactions|deals)|transaction execution/i },
  { term: "due diligence", cat: "transactions", jd: /due diligence|\bdiligence\b/i },
  { term: "target identification", cat: "transactions", jd: /target (identification|screening)|origination|buyer universe|acquisition targets/i },
  { term: "pitch materials", cat: "transactions", jd: /pitch ?(books?|materials|decks?)|pitches/i },
  { term: "information memoranda", cat: "transactions", jd: /information memorand|\bCIMs?\b/ },
  { term: "capital raising", cat: "transactions", jd: /capital rais|equity rais|fund ?rais/i },
  { term: "IPO", cat: "transactions", jd: /\bipos?\b|initial public offering/i },
  { term: "PE/VC", cat: "transactions", jd: /private equity|venture capital|\bpe\/vc\b/i },
  { term: "equity research", cat: "research", jd: /equity research/i },
  { term: "company research", cat: "research", jd: /company (research|analysis)|fundamental (research|analysis)/i },
  { term: "industry research", cat: "research", jd: /industry|sector (research|analysis)|market (research|analysis)/i },
  { term: "investment notes and reports", cat: "research", jd: /research reports?|investment (notes|memos?|recommendations)|written research|report writing/i },
  { term: "ASX announcements", cat: "research", jd: /\basx\b|announcements|listed compan/i },
  { term: "benchmarking", cat: "research", jd: /benchmark/i },
  { term: "financial statement analysis", cat: "analysis", jd: /financial statement|annual reports?|financial performance|reported results/i },
  { term: "cash flow analysis", cat: "analysis", jd: /cash ?flow/i },
  { term: "credit analysis", cat: "analysis", jd: /credit (analysis|assessment|risk)/i },
  { term: "KPI analysis", cat: "analysis", jd: /\bkpis?\b|key performance/i },
  { term: "stakeholder management", cat: "communication", jd: /stakeholder/i },
  { term: "client presentations", cat: "communication", jd: /client presentation|presenting to clients|presentations?\b/i },
  { term: "written communication", cat: "communication", jd: /written (and verbal )?communication|writing skills|communication skills/i },
  { term: "attention to detail", cat: "quality", jd: /attention to detail|accuracy|high[- ]quality/i },
  { term: "financial reporting", cat: "finance-function", jd: /financial reporting|statutory reporting|regulatory reporting/i },
  { term: "accounting", cat: "finance-function", jd: /\baccounting\b/i },
  { term: "audit", cat: "finance-function", jd: /\baudit\b/i },
  { term: "AASB / IFRS", cat: "finance-function", jd: /\baasb\b|\bifrs\b|accounting standards/i },
  { term: "budgeting and variance analysis", cat: "finance-function", jd: /budget|variance/i },
  { term: "finance systems and transformation", cat: "finance-function", jd: /finance (system|transformation)|system implementation|erp\b/i },
  { term: "controls and compliance", cat: "finance-function", jd: /\bcontrols?\b|compliance|governance/i },
  { term: "trade finance", cat: "finance-function", jd: /trade finance|letters? of credit|treasury operations/i },
  { term: "Excel", cat: "tools", jd: /\bexcel\b/i },
  { term: "PowerPoint", cat: "tools", jd: /powerpoint/i },
  { term: "FactSet", cat: "tools", jd: /factset/i },
  { term: "Bloomberg", cat: "tools", jd: /\bBloomberg\b/i },
  { term: "Capital IQ", cat: "tools", jd: /\bCapital\s*IQ\b/i },
  { term: "PitchBook", cat: "tools", jd: /\bPitchBook\b/i },
  { term: "Python", cat: "tools", jd: /\bPython\b/i },
  { term: "SQL", cat: "tools", jd: /\bSQL\b/i },
  { term: "VBA", cat: "tools", jd: /\bVBA\b/i },
  { term: "Power BI", cat: "tools", jd: /\bPower\s*BI\b/i },
  { term: "Tableau", cat: "tools", jd: /\bTableau\b/i },
  { term: "SAP", cat: "tools", jd: /\bSAP\b/i },
  { term: "Xero", cat: "tools", jd: /\bXero\b/i },
  { term: "MYOB", cat: "tools", jd: /\bMYOB\b/i },
  { term: "Refinitiv", cat: "tools", jd: /\bRefinitiv\b/i },
  { term: "Alteryx", cat: "tools", jd: /\bAlteryx\b/i },
  { term: "CFA", cat: "qualifications", jd: /\bcfa\b/i },
  { term: "CA / CPA", cat: "qualifications", jd: /\b(CPA|CA)\b|[Cc]hartered [Aa]ccountant/ },
  { term: "Master's degree", cat: "qualifications", jd: /master'?s|postgraduate|\bmba\b/i },
  { term: "finance degree", cat: "qualifications", jd: /degree in (finance|commerce|economics|accounting)|tertiary qualification|bachelor/i },
];

/**
 * How a DOCUMENT claims a term (2026-11-19). The job-ad patterns above are made
 * to find a term in an advert and can be loose ("variance" matches
 * "mean-variance optimisation"); judging a CV or letter needs the term itself.
 * Terms not listed here use their job-ad pattern.
 */
export const CLAIM_PATTERNS = {
  "budgeting and variance analysis": /\bbudget(s|ed|ing)?\b|\bvariance (analysis|analyses|reporting|commentary|explanations?)\b/i,
  "finance systems and transformation": /\bfinance (systems?|transformation)\b|\bsystem implementation\b|\berp\b/i,
  "merger modelling": /\bmerger model(l)?(s|ing)?\b|\baccretion[/ -](and )?dilution\b|\baccretion\b/i,
  "audit": /\baudit(s|ed|ing|or|ors)?\b/i,
};

const PREFERRED = /\b(preferred|desirable|desired|nice to have|advantageous|an advantage|a plus|bonus|ideally|beneficial|highly regarded)\b/i;

/** The line of the JD a match sits in, and the few lines before it (to see a "Desirable:" heading). */
function contextOf(jd, index) {
  const before = jd.slice(0, index).split("\n");
  const line = before.pop() + jd.slice(index).split("\n")[0];
  return { line, heading: before.slice(-4).join(" ") };
}

/**
 * Keywords of one job, each classified against cv.md.
 * @param {string} jd full job description
 * @param {string} cvMd cv.md text
 * @param {string[]} [extra] extra keywords (the analysis's ats_keywords), classified by cv.md text only
 */
export function classifyKeywords(jd, cvMd, { evidence = {}, extra = [] } = {}) {
  const out = [];
  const text = String(jd ?? "");
  for (const t of TERMS) {
    const m = t.jd.exec(text);
    if (!m) continue;
    const { line, heading } = contextOf(text, m.index);
    const importance = PREFERRED.test(line) || PREFERRED.test(heading) ? "preferred" : "essential";
    const ev = evidence[t.term];
    // Without the candidate's evidence for this term, support is judged with the
    // strict claim pattern, never the loose job-ad one: "mean-variance
    // optimisation" in cv.md is not evidence of variance analysis (2026-11-19).
    const strict = CLAIM_PATTERNS[t.term] ?? t.jd;
    const supported = ev ? Boolean(ev.cv && ev.cv.test(cvMd)) : new RegExp(strict.source, strict.flags.replace("g", "")).test(cvMd);
    const cls = supported ? (ev?.cls ?? "direct") : "unsupported";
    out.push({ term: t.term, cat: t.cat, importance, cls, use: supported ? ev?.use ?? null : null, jdText: m[0], jdLine: line.trim().slice(0, 200) });
  }
  const known = new Set(out.map((k) => k.term.toLowerCase()));
  for (const k of extra ?? []) {
    const term = String(k).trim();
    if (!term || known.has(term.toLowerCase()) || TERMS.some((t) => t.jd.test(term))) continue;
    out.push({ term, cat: "other", importance: "essential", cls: new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(cvMd) ? "direct" : "unverified", use: null, jdText: term });
  }
  return out;
}

/** Prompt block: what the model may use, in what wording, and what it must not claim. */
export function keywordPromptBlock(keywords) {
  if (!keywords.length) return "";
  const by = (c) => keywords.filter((k) => k.cls === c);
  const fmt = (k) => `${k.term}${k.importance === "preferred" ? " (preferred)" : ""}${k.use ? ` -> only as: "${k.use}"` : ""}`;
  return `JOB KEYWORDS (classified on this computer against cv.md; use the supported ones naturally, each at most twice per document, in the profile, the most relevant bullets, the skills lines and the letter):
- Directly supported: ${by("direct").map(fmt).join("; ") || "none"}
- Transferable (use the cv.md wording shown, never the job's stronger form): ${by("transferable").map(fmt).join("; ") || "none"}
- Careful (only in the limited form shown): ${by("careful").map(fmt).join("; ") || "none"}
- NOT supported, never claim and never mention as missing: ${by("unsupported").map((k) => k.term).join("; ") || "none"}
`;
}

const count = (re, s) => (String(s).match(new RegExp(re.source, "gi")) ?? []).length;
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9%&+$]+/g, " ").replace(/\s+/g, " ").trim();
/** The sentence around position i, whitespace collapsed (PDF text keeps line breaks). */
function sentenceAt(text, i) {
  const t = String(text);
  const start = Math.max(t.lastIndexOf(". ", i), t.lastIndexOf("\n\n", i), t.lastIndexOf("• ", i), 0);
  const ends = [t.indexOf(". ", i), t.indexOf("\n\n", i), t.indexOf("• ", i)].filter((x) => x >= 0);
  const end = ends.length ? Math.min(...ends) + 1 : t.length;
  return t.slice(start, end).replace(/^[.•\s]+/, "").replace(/\s+/g, " ").trim().slice(0, 240);
}
/**
 * Is the match at [i, j) inside wording that appears word for word in cv.md?
 * Then it is the candidate's own verified text (e.g. "mean-variance
 * optimisation" in MBA coursework), not a claim of the job's skill. Checked on
 * a window of words around the match, so PDF line breaks do not matter.
 */
function inVerifiedWording(text, i, j, cvNorm) {
  if (!cvNorm) return false;
  const before = norm(String(text).slice(Math.max(0, i - 80), i)).split(" ").filter(Boolean);
  const after = norm(String(text).slice(j, j + 80)).split(" ").filter(Boolean);
  const hit = norm(String(text).slice(i, j));
  for (const [b, a] of [[4, 4], [3, 3], [5, 2], [2, 5]]) {
    const win = [...before.slice(-b), hit, ...after.slice(0, a)].join(" ").trim();
    if (win.split(" ").length >= 5 && cvNorm.includes(win)) return true;
  }
  return false;
}

/**
 * Check the final documents against the classified keywords (2026-11-19 revision).
 *
 * Four outcomes, kept apart:
 *   present      a supported term appears in the CV
 *   missing      a supported essential term does not (add only where natural)
 *   contextual   an unsupported job term appears only inside verified cv.md
 *                wording, or in a negated or non-first-person letter sentence:
 *                not a claim, nothing to correct
 *   claimed      an unsupported term the documents present as experience:
 *                a document correction is needed (the check fails)
 * Each finding names the document, the sentence, the job-ad line that raised
 * the term, the cv.md evidence and whether the fix belongs in the document or
 * the checker. No percentage or "ATS score" is produced.
 *
 * @param {object[]} keywords classifyKeywords() result
 * @param {{cvText?:string, letterText?:string, cvMd?:string}} docs
 */
/**
 * Whether [start, end) in a letter sentence sits inside the job title or the
 * employer's name, or inside an "applying for the ... position" clause. The
 * 2026-11-22 regression: a letter saying "I am applying for the Financial
 * Analyst and Budget Officer position" was failed for claiming budgeting.
 */
export function namesTheRole(sentence, start, end, { roleTitle = "", company = "" } = {}) {
  const s = String(sentence);
  const within = (needle) => {
    if (!needle || needle.length < 3) return false;
    const low = s.toLowerCase(), n = String(needle).toLowerCase();
    for (let i = low.indexOf(n); i >= 0; i = low.indexOf(n, i + 1)) if (start >= i && end <= i + n.length) return true;
    return false;
  };
  if ([roleTitle].flat().flatMap((r) => String(r ?? "").split(" | ")).some(within) || within(company)) return true;
  const clause = /\b(?:applying|apply|application|applied) for (?:the |this |your )?((?:[A-Z][\w&,'-]*\s*(?:and |& |of |, )?){1,10})(?=\s*(?:position|role|vacancy|opportunity)\b)/g;
  for (const m of s.matchAll(clause)) { const a = m.index + m[0].length - m[1].length; if (start >= a && end <= a + m[1].length + 1) return true; }
  return false;
}

export function keywordFindings(keywords, { cvText = "", letterText = "", cvMd = "", roleTitle = "", company = "" }) {
  const list = [];
  let status = "ok";
  const bump = (s) => { const r = { ok: 0, warning: 1, issue: 2 }; if (r[s] > r[status]) status = s; };
  const termRe = (k) => TERMS.find((t) => t.term === k.term)?.jd ?? new RegExp(k.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const claimRe = (k) => CLAIM_PATTERNS[k.term] ?? termRe(k);
  const cvNorm = norm(cvMd);
  const supported = keywords.filter((k) => ["direct", "transferable", "careful"].includes(k.cls));
  const inCv = supported.filter((k) => termRe(k).test(cvText) || (k.use && k.cls !== "direct" && new RegExp(k.use.split(/[;(]/)[0].trim().split(" ").slice(0, 3).join(" "), "i").test(cvText)));
  const missingEssential = supported.filter((k) => k.importance === "essential" && !inCv.includes(k));
  const unsupported = keywords.filter((k) => k.cls === "unsupported");
  const claimed = [], contextual = [];
  for (const k of unsupported) {
    const re = new RegExp(claimRe(k).source, claimRe(k).flags.replace("g", "") + "g");
    const base = { term: k.term, jdRequirement: k.jdLine ?? k.jdText ?? "", evidence: "none in cv.md" };
    for (const m of String(cvText).matchAll(re)) {
      const sentence = sentenceAt(cvText, m.index);
      if (inVerifiedWording(cvText, m.index, m.index + m[0].length, cvNorm)) contextual.push({ ...base, document: "CV", match: m[0], sentence, reason: "appears only inside wording that is word for word in cv.md (your verified record), not as a claim of this skill", fix: "none: checker context" });
      else claimed.push({ ...base, document: "CV", match: m[0], sentence, reason: `the CV uses "${m[0]}" but cv.md has no evidence for ${k.term}`, fix: "document correction: remove or reword this line" });
    }
    for (const s of String(letterText).split(/(?<=[.!?])\s+/)) {
      const m = s.match(new RegExp(claimRe(k).source, claimRe(k).flags.replace("g", "")));
      if (!m) continue;
      const base2 = { ...base, document: "cover letter", match: m[0], sentence: s.trim().slice(0, 240) };
      if (namesTheRole(s, m.index, m.index + m[0].length, { roleTitle, company })) contextual.push({ ...base2, reason: "the words are part of the job title or employer name the letter is applying to, not a claim of experience", fix: "none: checker context" });
      else if (!/\b(I|[Mm]y|[Mm]e)\b/.test(s)) contextual.push({ ...base2, reason: "the sentence is about the employer or the role, not your experience", fix: "none: checker context" });
      else if (/\b(not|never|no|yet to)\b/i.test(s.slice(0, m.index))) contextual.push({ ...base2, reason: "negated: the sentence does not claim it", fix: "none (but positive positioning may remove the sentence)" });
      else if (inVerifiedWording(s, m.index, m.index + m[0].length, cvNorm)) contextual.push({ ...base2, reason: "appears only inside wording that is word for word in cv.md", fix: "none: checker context" });
      else claimed.push({ ...base2, reason: `the letter presents ${k.term} as your experience, but cv.md has no evidence for it`, fix: "document correction: remove or reword this sentence" });
    }
  }
  // One finding per term, document and sentence ("budgets and variance analysis" is one claim).
  const once = (arr) => arr.filter((c, i) => arr.findIndex((o) => o.term === c.term && o.document === c.document && o.sentence === c.sentence) === i);
  claimed.splice(0, claimed.length, ...once(claimed));
  contextual.splice(0, contextual.length, ...once(contextual));
  const claimedTerms = [...new Set(claimed.map((c) => c.term))];
  const contextualTerms = [...new Set(contextual.map((c) => c.term))].filter((t) => !claimedTerms.includes(t));
  if (claimed.length) {
    bump("issue");
    for (const c of claimed) list.push(`CLAIMED in the ${c.document}: "${c.term}" in "${c.sentence}". Job ad: "${c.jdRequirement}". cv.md evidence: ${c.evidence}. ${c.fix}.`);
  }
  for (const c of contextual) list.push(`Not a claim (${c.document}): "${c.match}" for "${c.term}" ${c.reason}: "${c.sentence}"`);
  const stuffed = supported.map((k) => ({ k, n: count(termRe(k), cvText) })).filter((x) => x.n > 5);
  if (stuffed.length) { bump("warning"); list.push(`Repeated often in the CV (reads as keyword stuffing): ${stuffed.map((x) => `${x.k.term} ×${x.n}`).join(", ")}`); }
  const essentialSupported = supported.filter((k) => k.importance === "essential");
  if (essentialSupported.length && missingEssential.length > essentialSupported.length / 2) bump("warning");
  list.push(`Supported and present in the CV: ${inCv.map((k) => k.term).join(", ") || "none"}`);
  if (missingEssential.length) list.push(`Supported but not in the CV wording (add only where it reads naturally): ${missingEssential.map((k) => `${k.term}${k.use ? ` ("${k.use}")` : ""}`).join(", ")}`);
  const keptOut = unsupported.map((k) => k.term).filter((t) => !claimedTerms.includes(t));
  if (keptOut.length) list.push(`Not supported by your record and not claimed: ${keptOut.join(", ")}`);
  const unverified = keywords.filter((k) => k.cls === "unverified");
  if (unverified.length) list.push(`Not in the term list; check by hand: ${unverified.map((k) => k.term).join(", ")}`);
  return {
    status,
    detail: `${inCv.length} of ${supported.length} supported job keywords appear in the CV; ${unsupported.length} job ${unsupported.length === 1 ? "term" : "terms"} you have no record of: ${claimedTerms.length ? `${claimedTerms.length} CLAIMED in the documents (${claimedTerms.join(", ")})` : "none claimed"}${contextualTerms.length ? `, ${contextualTerms.length} only in verified wording` : ""} (a count of what was checked, not an ATS score)`,
    list,
    summary: { supported: supported.length, present: inCv.length, missingEssential: missingEssential.map((k) => k.term), unsupported: unsupported.map((k) => k.term), claimed: claimedTerms.length, contextual: contextualTerms.length },
    diagnostics: {
      present: inCv.map((k) => ({ term: k.term, cls: k.cls })),
      missing: missingEssential.map((k) => ({ term: k.term, use: k.use ?? null, jdRequirement: k.jdLine ?? "" })),
      claimed, contextual,
      keptOut,
      unverified: unverified.map((k) => k.term),
    },
  };
}
