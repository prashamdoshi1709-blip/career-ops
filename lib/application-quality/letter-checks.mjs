// Letter and CV checks with no personal data (2026-11-17; moved here 2026-11-19).
//
//   repeatedCvSentences  a letter sentence that restates a CV bullet, and whether
//                        it explains how that work relates to the job
//   letterClaimIssues    claims a letter or CV line must not make unless cv.md
//                        says so (leading deals, model types, qualifications,
//                        tools, years of experience, unrecorded outcomes)
// Everything is judged against the candidate's own cv.md text passed in, so
// the rules hold for any candidate. Deterministic; no Claude call.

const words = (s) => new Set(String(s).toLowerCase().replace(/\*\*/g, "").match(/[a-z0-9&]+/g) ?? []);

// ---------- repeated CV wording, judged with its context (2026-11-17) ----------
const CONTENT_STOP = new Set("about above after again against also among and another any because been before being below between both but can could does doing during each either every from further have having here into itself just more most other over same should since some such than that their them then there these they this those through under until very was were what when where which while will with within would your role team work years year support supporting assist assisting providing including range across ability strong experience opportunity".split(" "));
const contentWords = (s) => (String(s).toLowerCase().match(/[a-z][a-z&'-]{4,}/g) ?? []).filter((w) => !CONTENT_STOP.has(w));
const stem = (w) => w.replace(/(ings?|ions?|ed|es|s|al|ity)$/, "").slice(0, 7);
const LINK = /\b(which|so that|that is|this is|the same|relevant|close to|similar|useful|applies|apply|matters?|helps?|means|directly|kind of|type of|why|because|for (a|this) (role|team)|in (a|this) role|for your)\b/i;
const overlapOf = (a, b) => { const A = words(a), B = words(b); const inter = [...A].filter((w) => B.has(w)).length; return inter / Math.max(1, Math.min(A.size, B.size)); };
/** Every letter sentence or bullet of 10+ words with the CV line it is closest to (ratio >= 0.5). */
export function repeatsAll({ paras, cvEvidence = null, cvBullets = [] }) {
  const pool = cvEvidence?.length ? cvEvidence : cvBullets.map((text) => ({ id: null, text }));
  const out = [];
  paras.forEach((p, pi) => {
    const units = Array.isArray(p) ? p.map((b) => [b]) : [String(p).split(/(?<=[.!?])\s+/)];
    for (const group of units) group.forEach((sentence, si) => {
      if (sentence.split(/\s+/).length < 10) return;
      let best = null;
      for (const e of pool) { const r = overlapOf(sentence, e.text); if (!best || r > best.r) best = { r, e }; }
      if (best && best.r >= 0.5) out.push({ sentence: sentence.trim(), id: best.e.id, cv: best.e.text, ratio: best.r, next: group[si + 1] ?? (Array.isArray(p) ? "" : ""), para: pi });
    });
  });
  return out;
}
/** Sentences that restate a CV bullet (75%+), with whether they explain the link to the job. */
export function repeatedCvSentences({ paras, cvBullets = [], cvEvidence = null, jdTerms = "" }) {
  const jd = new Set(contentWords(jdTerms).map(stem));
  return repeatsAll({ paras, cvEvidence, cvBullets }).filter((r) => r.ratio >= 0.75).map((r) => {
    const cvStems = new Set(contentWords(r.cv).map(stem));
    const ctx = `${r.sentence} ${r.next}`;
    const added = [...new Set(contentWords(ctx).filter((w) => !cvStems.has(stem(w)) && jd.has(stem(w))))];
    const linked = jd.size ? (added.length >= 3 || (added.length >= 2 && LINK.test(ctx))) : LINK.test(ctx);
    const jdHint = [...new Set(contentWords(jdTerms))].filter((w) => !cvStems.has(stem(w))).slice(0, 3).join(", ");
    return { sentence: r.sentence, id: r.id, overlap: Math.round(r.ratio * 100), verbatim: r.ratio >= 0.9, linked, added, jdHint };
  });
}

// ---------- claims a letter must never make (2026-11-17) ----------
// Run on every letter and CV line before it is accepted. Each rule names what cv.md says,
// so the finding explains itself. A rule is skipped when cv.md supports it.
const LETTER_CLAIMS = [
  { re: /\bI (led|ran|executed|headed|managed|closed|drove|originated)\b[^.]{0,60}\b(transactions?|deals?|mandates?|m&a|ipos?|diligence|engagements?|acquisitions?|capital raisings?)\b/i, why: "leading or executing transactions; cv.md does not say the candidate led them" },
  { re: /\b(LBO|leveraged buyout|merger models?|accretion|dilution analysis|project finance models?|monte carlo|operating models? for clients)\b/i, why: "a model type cv.md never mentions" },
  { re: /\b(dozens of|numerous|many|countless|a large number of|extensive|hundreds of)(\s+[\w-]+){0,2}\s+models\b/i, why: "more models than cv.md supports" },
  { re: /\b(CA|CPA|CFA|chartered accountant|qualified accountant|certified practising accountant)\b/, why: "a professional qualification cv.md does not list" },
  // Product spellings, case-sensitive: "a good pitchbook" is a document, "PitchBook" the database.
  { re: /\b(Python|SQL|VBA|Power BI|Tableau|Bloomberg|Capital IQ|PitchBook|Alteryx|SAP|Xero|MYOB|Oracle|NetSuite)\b/, why: "a tool cv.md does not list" },
  { re: /\bI (have )?(prepared|audited|lodged|signed off)\b[^.]{0,40}\b(financial statements|statutory accounts|annual reports?|audit|tax returns?)\b/i, why: "preparing or auditing financial statements; cv.md has analysis, not preparation" },
  { re: /\b(my|I have|with) (audit|external audit|statutory reporting|AASB|IFRS|month-end close|finance transformation|system implementation) (experience|background|work)\b/i, why: "accounting or finance-function experience cv.md does not show" },
  { re: /\b\d+\+?\s*(years?|yrs)\b[^.]{0,40}\bexperience\b|\b(years|year) of (\w+ ){0,3}experience\b|\b(years|year) of (experience )?(in )?(investment banking|equity research|m&a|consulting|audit|private equity)\b/i, why: "a length of experience cv.md does not state" },
];
// Outcomes cv.md never records (2026-11-19): "so errors surface early", "reduced
// errors", "saved time". cv.md says the models are "easier to review" and that
// unsupported claims were "corrected before client use", nothing more. Level
// "review": the letter is still created but never marked ready; a CV line falls
// back to its cv.md wording.
LETTER_CLAIMS.push({ level: "review", re: /\bso (that )?(errors|mistakes|issues|problems) (surface|are caught|show up|are found)\b|\b(reduc|improv|increas|sav|prevent|eliminat|cut|minimis)(ed|ing|es|e)? (the )?(errors?|mistakes|risk|time|hours|accuracy|efficiency|turnaround|rework|review time)\b/i, why: "an outcome cv.md does not record" });
// Third-person forms for CV lines ("leading M&A deal execution", "executed deals").
const CV_ONLY_CLAIMS = [
  { re: /\b(led|leading|ran|running|executed|executing|headed|heading|closed|closing|drove|driving|originated|originating)\b[^.]{0,40}\b(transactions?|deals?|mandates?|m&a|ipos?|diligence|engagements?|acquisitions?|capital raisings?|deal execution)\b/i, why: "leading or executing transactions; cv.md does not say the candidate led them" },
];
/**
 * Unsupported claims: [{sentence, phrase, why}]. Letters: first-person sentences
 * only (a sentence about the employer is not his claim). CV lines
 * (`cv: true`) are always about him and also get the third-person forms.
 */
export function letterClaimIssues(text, cvMd = "", { cv = false } = {}) {
  const out = [];
  for (const sentence of String(text).replace(/\*\*/g, "").split(/(?<=[.!?])\s+/)) {
    if (!cv && !/\b(I|[Mm]y|[Mm]e|I've|I'm)\b/.test(sentence)) continue;
    for (const c of cv ? [...LETTER_CLAIMS, ...CV_ONLY_CLAIMS] : LETTER_CLAIMS) {
      const m = sentence.match(c.re);
      if (!m) continue;
      // An honest negative ("I have not yet built an LBO model") is not a claim.
      const before = sentence.slice(0, m.index).split(/[,;:]/).pop();
      if (/\b(not|never|no|yet to|without|rather than|instead of)\b/i.test(before)) continue;
      if (new RegExp(m[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(cvMd)) continue;
      out.push({ sentence: sentence.trim(), phrase: m[0], why: c.why, level: c.level ?? "issue" });
    }
  }
  return out;
}
