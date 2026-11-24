// Positive, strength-focused positioning (2026-11-17, permanent rule).
//
// Employer-facing text never advertises what the candidate has not done. This module
// finds negative or apologetic statements and revises them WITHOUT adding any
// claim: a leading concessive clause ("Although I have not worked in audit, ...")
// is removed and the strength that follows is kept; a sentence that only states
// a gap or apologises is removed. Every change is reported before -> after.
// Nothing is added, so no fact can be invented here.
//
// Direct factual questions (an application form asks "Do you hold a CPA?") are
// different: the honest answer is required, so `directQuestion: true` leaves
// the text unchanged and only reports what it saw.

// A clause or sentence is negative when it states a gap, a limit or an apology about him.
const GAP = /\b(I (do not|don't|did not|didn't) (have|hold|possess)|I have(n't| not)( yet)? (had|worked|built|done|been|held|used|managed|led)|I (lack|am lacking)|my (limited|lack of)|limited (experience|exposure|background)|little (experience|exposure)|lack(ing)? (of )?(direct |formal )?(experience|exposure)|no (direct |formal |prior )?(experience|exposure|background)|I have never|never (worked|had|used|built)|not (an exact|a perfect|a direct) (fit|match)|may not (fully )?(meet|match|align)|do not (fully )?(meet|match)|not (yet )?had the (chance|opportunity)|new to (the|this)|still (learning|developing) (the|my)|I (understand|appreciate|recognise|realise) (that )?my (experience|background))\b/i;
const APOLOGY = /\b(I apologi[sz]e|unfortunately,? I|I am (only|just) (a|an)|forgive|despite my (limited|short|brief)|only (a|one) (year|few months)|although (it is|I am) early in my career)\b/i;
const CONCESSIVE = /^(although|though|while|whilst|even though|despite|in spite of|while I may not|if I lack)\b/i;

const sentencesOf = (s) => String(s).split(/(?<=[.!?])\s+/).filter(Boolean);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * @param {string} text a paragraph, bullet or answer
 * @param {{directQuestion?: boolean}} [opts]
 * @returns {{text: string, changes: {before: string, after: string, why: string}[], kept: string[]}}
 */
export function positiveRewrite(text, { directQuestion = false } = {}) {
  const changes = [];
  const kept = [];
  const out = [];
  for (const s of sentencesOf(text)) {
    const negative = GAP.test(s) || APOLOGY.test(s);
    if (!negative) { out.push(s); continue; }
    if (directQuestion) { kept.push(s); out.push(s); continue; }
    // "Although I have not worked in audit, my analysis of reported results ..."
    const comma = s.indexOf(",");
    if (CONCESSIVE.test(s.trim()) && comma > 0 && !GAP.test(s.slice(comma + 1)) && !APOLOGY.test(s.slice(comma + 1))) {
      const rest = cap(s.slice(comma + 1).trim());
      if (rest.split(/\s+/).length >= 5) { changes.push({ before: s, after: rest, why: "removed a clause about missing experience; kept the strength" }); out.push(rest); continue; }
    }
    changes.push({ before: s, after: "", why: "removed a sentence that only stated a gap or apologised" });
  }
  return { text: out.join(" "), changes, kept };
}

/** The same over a letter body (paragraphs and one-level lists); empty items are dropped. */
export function positiveLetterBody(body) {
  const changes = [];
  const fix = (s) => { const r = positiveRewrite(s); changes.push(...r.changes); return r.text; };
  const out = (body ?? []).map((p) => (Array.isArray(p) ? p.map(fix).filter((x) => x.trim()) : fix(p))).filter((p) => (Array.isArray(p) ? p.length : String(p).trim()));
  return { body: out, changes };
}

/** Negative statements still present (for the final check; nothing is changed). */
export function negativeStatements(text) {
  return sentencesOf(text).filter((s) => GAP.test(s) || APOLOGY.test(s)).map((s) => s.trim());
}
