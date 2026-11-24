// Copied wording between two texts as maximal runs (2026-11-17; moved here 2026-11-19).
// No personal data; no Claude call.

/**
 * Copied wording as maximal runs (2026-11-17). Overlapping 8-word windows from
 * one copied phrase used to count as several phrases ("supported diligence on a
 * live sell-side mandate preparing" counted twice). Each run is returned once,
 * with the letter sentence it sits in. A run made mostly of names, figures and
 * standard financial terms (a conference name, "revenue, EBITDA and PAT") is factual naming, not copied prose: it is returned with
 * `terms: true` and not counted as a writing problem.
 */
const TERM = /^(\d[\d.,%+–-]*|ebitda|pat|p&l|ipo|asx|dcf|fy\d\d\w?|ev\/\w+|p\/e|pe\/vc|m&a|appendix|4c\/5b|it|adtech|kpis?|revenue|margins?|cash|burn|debt|funding|runway|balance|sheet|flow|and|of|the|a|in|at|on|to|for)$/i;
export function copiedPhraseRuns(letter, cv, n = 8) {
  const norm = (s) => String(s).replace(/\*\*/g, "").replace(/[^A-Za-z0-9%+&/\s.-]+/g, " ").replace(/(?<=\w)[.](?=\s|$)/g, " ");
  const lw = norm(letter).split(/\s+/).filter(Boolean);
  const cvGrams = new Set();
  const cw = norm(cv).toLowerCase().split(/\s+/).filter(Boolean);
  for (let i = 0; i + n <= cw.length; i++) cvGrams.add(cw.slice(i, i + n).join(" "));
  const hit = lw.map(() => false);
  for (let i = 0; i + n <= lw.length; i++) if (cvGrams.has(lw.slice(i, i + n).join(" ").toLowerCase())) for (let k = i; k < i + n; k++) hit[k] = true;
  const runs = [];
  for (let i = 0; i < lw.length; i++) {
    if (!hit[i]) continue;
    let j = i; while (j + 1 < lw.length && hit[j + 1]) j++;
    const w = lw.slice(i, j + 1);
    const named = w.filter((x) => /^[A-Z0-9]/.test(x) || TERM.test(x)).length;
    runs.push({ text: w.join(" "), words: w.length, terms: named / w.length >= 0.7 });
    i = j;
  }
  return runs;
}

