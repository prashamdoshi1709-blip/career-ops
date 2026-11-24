// Free, deterministic corrections for generated CV lines and cover letters.
//
// Only changes that cannot alter meaning are made here: dash punctuation,
// contractions, US to Australian spelling, emphasis markers and spacing. Every
// change is returned so the quality record lists it. Anything that needs a
// rewrite (a sentence that restates the CV, a weak link to the job, length) is
// NOT changed here; the checks flag it for review instead. No Claude call.

const CONTRACTIONS = [
  [/\bI'm\b/g, "I am"], [/\bI've\b/g, "I have"], [/\bI'd\b/g, "I would"], [/\bI'll\b/g, "I will"],
  [/\bcan't\b/gi, "cannot"], [/\bwon't\b/gi, "will not"], [/\bdon't\b/gi, "do not"], [/\bdoesn't\b/gi, "does not"],
  [/\bdidn't\b/gi, "did not"], [/\bisn't\b/gi, "is not"], [/\baren't\b/gi, "are not"], [/\bwasn't\b/gi, "was not"],
  [/\bweren't\b/gi, "were not"], [/\bcouldn't\b/gi, "could not"], [/\bwouldn't\b/gi, "would not"], [/\bshouldn't\b/gi, "should not"],
  [/\bhaven't\b/gi, "have not"], [/\bhasn't\b/gi, "has not"], [/\bit's\b/g, "it is"], [/\bIt's\b/g, "It is"],
  [/\bthat's\b/g, "that is"], [/\bThat's\b/g, "That is"], [/\bthere's\b/g, "there is"], [/\bThere's\b/g, "There is"],
  [/\bwe're\b/gi, "we are"], [/\bthey're\b/gi, "they are"], [/\byou're\b/gi, "you are"], [/\byou'll\b/gi, "you will"],
];
// Whole words only, so proper names (a course called "... Program") are left alone.
const SPELLING = [
  ["analyze", "analyse"], ["analyzed", "analysed"], ["analyzing", "analysing"], ["analyzes", "analyses"],
  ["modeling", "modelling"], ["modeled", "modelled"], ["organization", "organisation"], ["organizations", "organisations"],
  ["prioritize", "prioritise"], ["prioritized", "prioritised"], ["standardize", "standardise"], ["standardized", "standardised"],
  ["optimize", "optimise"], ["optimized", "optimised"], ["optimization", "optimisation"], ["recognize", "recognise"],
  ["recognized", "recognised"], ["specialize", "specialise"], ["specialized", "specialised"], ["summarize", "summarise"],
  ["summarized", "summarised"], ["emphasize", "emphasise"], ["utilize", "use"], ["utilized", "used"], ["finalize", "finalise"],
  ["center", "centre"], ["behavior", "behaviour"], ["favor", "favour"], ["color", "colour"], ["judgment", "judgement"],
  ["fulfill", "fulfil"], ["enrollment", "enrolment"], ["labor", "labour"],
];
const keepCase = (from, to) => (from[0] === from[0].toUpperCase() ? to[0].toUpperCase() + to.slice(1) : to);

/**
 * @param {string} text one line, sentence or paragraph
 * @param {{keepBold?: boolean}} [opts] keepBold for CV lines (highlights carry a bold lead-in)
 * @returns {{text: string, fixes: string[]}}
 */
export function safeFixes(text, { keepBold = false } = {}) {
  let t = String(text ?? "");
  const fixes = [];
  const apply = (re, rep, why) => {
    const before = t;
    t = t.replace(re, rep);
    if (t !== before) fixes.push(why);
  };
  // CV highlights need their bold lead-in; letters never have bold.
  if (!keepBold) apply(/\*\*|__/g, "", "removed bold markers");
  // An em dash used as punctuation becomes a comma (his rule: no em dashes).
  // En dashes are left alone: ranges ("3–4") and role titles
  // ("Senior Consultant – Financial Modelling") must stay exactly as written.
  apply(/\s*—\s*/g, ", ", "replaced em dash with a comma");
  for (const [re, rep] of CONTRACTIONS) apply(re, rep, "expanded a contraction");
  for (const [us, au] of SPELLING) apply(new RegExp(`\\b${us}\\b`, "gi"), (m) => keepCase(m, au), `Australian spelling (${us} → ${au})`);
  apply(/ {2,}/g, " ", "removed double spaces");
  apply(/\s+([,.;:!?])/g, "$1", "removed a space before punctuation");
  apply(/,\s*,/g, ",", "removed a doubled comma");
  return { text: t.trim(), fixes: [...new Set(fixes)] };
}

/** Apply safeFixes to a letter body (paragraphs and one-level lists). */
export function fixLetterBody(body) {
  const fixes = [];
  const one = (s) => { const r = safeFixes(s); fixes.push(...r.fixes); return r.text; };
  const out = (body ?? []).map((p) => (Array.isArray(p) ? p.map(one) : one(p)));
  return { body: out, fixes: [...new Set(fixes)] };
}
