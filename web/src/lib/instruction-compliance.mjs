// Local customisation (2026-11-15): does a generated CV / cover letter actually
// follow the job's Additional Instructions? Local only: no Claude call.
//
// Each instruction is split into its points. A point that can be tested in the
// text (a greeting, a quoted sentence to remove or include, a word limit, a named
// experience to feature or drop, a shorter opening or letter) is checked against
// the FINAL documents, never against the model's own report. A subjective point
// ("more natural", "less formal") is reported as not verifiable by an exact text
// match, with what the model says it did, so it is read rather than assumed.
//
// Some failures have a safe deterministic correction (a greeting; removing a
// sentence quoted word for word). applyFixes() makes it on a copy of the letter
// spec, so no second AI generation is needed for it.
//
// Used by data/cv-original/generate.mjs (after each generation and by
// --local-fix) and by the job pages (instructions vs the current documents).

const strip = (s) => String(s ?? "").replace(/\*\*/g, "");
const flatBody = (body) => (body ?? []).map((b) => (Array.isArray(b) ? b.join(" ") : String(b))).map(strip).join(" ");
const words = (t) => String(t ?? "").split(/\s+/).filter(Boolean).length;
const lc = (t) => strip(t).toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();

import { readCandidate, toRegExp } from "./candidate-profile.mjs";

export const TARGET_DOC = { both: "Both CV and Cover Letter", cv: "CV only", cover: "Cover Letter only" };
export const DEFAULT_SALUTATION = "Dear Hiring Manager,";

/** The CV's text (profile, highlights, skills, every bullet). */
export const cvTextOf = (spec) => (spec ? strip([spec.profile, ...(spec.highlights ?? []), ...(spec.skills ?? []).map((k) => k.text), ...(spec.jobs ?? []).flatMap((j) => j.bullets ?? []), ...(spec.leadership ?? [])].join(" ")) : "");
/** The letter's text: recipient, greeting and body. */
export const letterTextOf = (spec) => (spec ? strip([spec.recipient, spec.salutation, flatBody(spec.body)].join(" ")) : "");

// Named items (employers, projects, courses) come from the candidate's own
// git-ignored profile (data/candidate-profile.json, 2026-11-19).
const CANDIDATE = readCandidate();
const ENTITIES = (CANDIDATE.instructionEntities ?? []).map((e) => ({ ...e, ask: toRegExp(e.ask), in: toRegExp(e.in) }));
const REJECTIONS = (CANDIDATE.instructionRejections ?? []).map((r) => ({ all: r.all.map(toRegExp), detail: r.detail }));
const REMOVE = /\b(remove|delete|drop|leave out|cut out|omit|exclude|take out|get rid of|do not mention|don't mention|dont mention|no mention of|stop mentioning)\b/i;
const EMPHASISE = /\b(emphasi[sz]e|highlight|focus(?: more)? on|more (?:prominent(?:ly)?|important|weight|space|detail)|give (?:more )?(?:importance|weight|prominence|space)|feature|lead with|bring out|stress|mention|include|talk (?:more )?about|add|showcase|put .{0,20} first)\b/i;
const SHORTER = /\b(shorter|shorten|more concise|concise|cut (?:it |this )?down|trim|tighten|reduce (?:the )?length|less long|briefer)\b/i;
const OPENING = /\b(opening|first|intro(?:duction)?)\b(?:\s+\w+){0,2}?\s*\b(paragraph|sentence|lines?)\b|\bopening\b/i;
const NAME_STOP = new Set(["instead", "rather", "not", "in", "of", "and", "or", "to", "with", "as", "at", "for", "please", "the", "a", "an", "on", "from", "throughout", "only", "but", "so", "then", "when", "is", "be", "it", "this"]);
const TITLES = new Set(["mr", "mrs", "ms", "miss", "dr", "prof", "mr.", "mrs.", "ms.", "dr.", "prof."]);

const titleCase = (w) => (/^[a-z]/.test(w) ? w[0].toUpperCase() + w.slice(1) : w);

/** "write dear Jonah instead of Dear Hiring Manager" → "Dear Jonah,". Null when no greeting is requested. */
export function requestedGreeting(s) {
  const t = String(s ?? "");
  const cands = [];
  for (const m of t.matchAll(/\b(dear|hi|hello)\s+([^\s,.;:!?"“”()]+(?:\s+[^\s,.;:!?"“”()]+){0,3})/gi)) {
    const before = t.slice(Math.max(0, m.index - 24), m.index).toLowerCase();
    if (/(instead of|rather than|replace|replacing|not|of the|from)\s*["“']?\s*$/.test(before)) continue; // the greeting being replaced
    cands.push({ word: m[1], rest: m[2] });
  }
  for (const m of t.matchAll(/\b(?:address(?:ed)?|direct(?:ed)?)\s+(?:it|this|the (?:cover )?letter|the letter)\s+to\s+([^\s,.;:!?"“”()]+(?:\s+[^\s,.;:!?"“”()]+){0,3})/gi)) cands.push({ word: "Dear", rest: m[1] });
  for (const m of t.matchAll(/\b(?:greeting|salutation)\b[^"“\n]{0,30}?(?:to|be|as|:|=)\s*["“']?(?:dear\s+)?([^\s,.;:!?"“”()]+(?:\s+[^\s,.;:!?"“”()]+){0,3})/gi)) cands.push({ word: "Dear", rest: m[1] });
  for (const c of cands) {
    const toks = [];
    for (const w of c.rest.split(/\s+/)) {
      if (NAME_STOP.has(w.toLowerCase())) break;
      if (!/^[A-Za-z][A-Za-z'’.-]*$/.test(w)) break;
      toks.push(w);
    }
    if (!toks.length) continue;
    const name = toks.map((w) => (TITLES.has(w.toLowerCase()) ? titleCase(w) : titleCase(w))).join(" ");
    if (/^hiring manager$/i.test(name) || TITLES.has(name.toLowerCase())) continue;
    return { greeting: `${titleCase(c.word.toLowerCase())} ${name},`, name };
  }
  return null;
}

/** A model-written or requested salutation, kept only when it is a plain greeting. */
export function cleanSalutation(s) {
  let t = String(s ?? "").replace(/\s+/g, " ").trim();
  if (!t) return DEFAULT_SALUTATION;
  if (!/[,]$/.test(t)) t = t.replace(/[.;:!]+$/, "") + ",";
  if (t.length > 60 || !/^(Dear|Hi|Hello)\s+[A-Za-z][A-Za-z '’.-]*,$/.test(t) || /[\[\]{}<>]|\b(name|tbc|xx+)\b/i.test(t)) return DEFAULT_SALUTATION;
  return t;
}

/** Split saved instructions into separately checkable points. */
export function splitPoints(text) {
  return String(text ?? "")
    .split(/\n+|;\s*|(?<=[.!?])\s+(?=[A-Z"“])/)
    .map((s) => s.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter((s) => s.replace(/[^a-z]/gi, "").length >= 3);
}

/** What one instruction point asks for, and how (if at all) it can be tested. */
export function analysePoint(s, target) {
  const t = String(s);
  const greet = requestedGreeting(t);
  if (greet) return { kind: "greeting", doc: "cover", expect: greet };
  const lim = t.match(/\b(?:under|no more than|not more than|at most|max(?:imum)?(?: of)?|below|fewer than|less than|within|up to)\s+(\d{2,4})\s+words\b/i) ?? t.match(/\b(\d{2,4})\s+words\s+(?:or less|or fewer|max(?:imum)?)\b/i);
  if (lim) return { kind: "word_limit", doc: "cover", expect: { max: Number(lim[1]) } };
  const quoted = t.match(/["“]([^"”]{3,400})["”]/);
  if (quoted && REMOVE.test(t.slice(0, quoted.index))) return { kind: "remove_text", doc: target === "cv" ? "cv" : target === "cover" ? "cover" : "both", expect: { phrase: quoted[1].trim() } };
  if (quoted && /\b(include|mention|add|use|say|write|state|put)\b/i.test(t.slice(0, quoted.index))) return { kind: "include_text", doc: target === "cv" ? "cv" : target === "cover" ? "cover" : "both", expect: { phrase: quoted[1].trim() } };
  const ent = ENTITIES.find((e) => e.ask.test(t));
  // "remove the second bullet under <employer>" is about a part of a section, not the employer itself.
  const part = /\b(bullet|sentence|line|paragraph|point|part|example|detail)s?\b/i.test(t);
  if (ent && REMOVE.test(t) && !part) return { kind: "remove_entity", doc: target === "cv" ? "cv" : target === "cover" ? "cover" : "both", expect: { entity: ent.name } };
  if (OPENING.test(t) && SHORTER.test(t)) return { kind: "shorter_opening", doc: "cover" };
  if (SHORTER.test(t) && (target === "cover" || /\b(letter|cover)\b/i.test(t)) && !/\b(bullet|cv|resume|profile|highlight)\b/i.test(t)) return { kind: "shorter_letter", doc: "cover" };
  if (ent && EMPHASISE.test(t)) return { kind: "feature_entity", doc: target === "cv" ? "cv" : target === "cover" ? "cover" : "both", expect: { entity: ent.name } };
  return { kind: "subjective", doc: target === "cv" ? "cv" : target === "cover" ? "cover" : "both" };
}

const DOC_NAME = { cv: "CV", cover: "Cover letter", both: "CV and cover letter" };
const overlap = (a, b) => {
  const A = new Set(lc(a).split(/\W+/).filter((w) => w.length > 2));
  const B = lc(b).split(/\W+/).filter((w) => w.length > 2);
  return B.filter((w) => A.has(w)).length / Math.max(1, Math.min(A.size, B.length));
};

/**
 * Check the saved instructions against the documents.
 * @param {object} a
 * @param {{text: string, target: string}} a.extra the job's Additional Instructions
 * @param {{instruction: string, why: string}[]} [a.refused] requests the fact rules refused
 * @param {object|null} a.cover final letter spec (null when no letter exists)
 * @param {object|null} a.cv final CV spec
 * @param {{cv?: boolean, cover?: boolean}} [a.changed] which documents this version changed
 * @param {object|null} [a.prevCover] the letter this version replaced (for "shorter")
 * @param {{instruction: string, status: string, how?: string}[]} [a.modelReport]
 * @param {string[]} [a.fixedLocally] fixes already made on this computer
 */
export function checkCompliance({ extra, refused = [], cover = null, cv = null, changed = { cv: true, cover: true }, prevCover = null, modelReport = [], fixedLocally = [] }) {
  const text = String(extra?.text ?? "").trim();
  if (!text) return [];
  const target = ["cv", "cover"].includes(extra?.target) ? extra.target : "both";
  const out = [];
  for (const point of splitPoints(text)) {
    const a = analysePoint(point, target);
    const base = { instruction: point, target, doc: a.doc, kind: a.kind };
    const rej = refused.find((r) => lc(r.instruction).includes(lc(point)) || lc(point).includes(lc(r.instruction)));
    if (rej) { out.push({ ...base, status: "rejected", detail: `asks for ${rej.why}, which cv.md does not support, so it was not followed` }); continue; }
    if (/\b(visa|work rights|sponsorship|grades?|marks|gpa|wam)\b/i.test(point) && !REMOVE.test(point)) { out.push({ ...base, status: "rejected", detail: "your permanent rules never mention visa, work rights or grades" }); continue; }
    { const rj = REJECTIONS.find((r) => r.all.every((re) => re.test(point))); if (rj) { out.push({ ...base, status: "rejected", detail: rj.detail }); continue; } }
    // A letter instruction set to "CV only" (or the reverse) cannot take effect.
    if ((a.doc === "cover" && target === "cv") || (a.doc === "cv" && target === "cover")) { out.push({ ...base, status: "wrong_target", detail: `this is a ${a.doc === "cover" ? "cover-letter" : "CV"} instruction, but it is set to ${TARGET_DOC[target]}; choose ${a.doc === "cover" ? "Cover Letter only or Both" : "CV only or Both"}` }); continue; }
    const docs = a.doc === "both" ? ["cv", "cover"] : [a.doc];
    const present = docs.filter((d) => (d === "cv" ? cv : cover));
    const inRun = present.filter((d) => changed[d] !== false);
    if (!present.length) { out.push({ ...base, status: "not_produced", detail: `there is no ${a.doc === "cv" ? "CV" : "cover letter"} to check yet` }); continue; }
    if (!inRun.length) { out.push({ ...base, status: "not_in_this_run", detail: `the ${a.doc === "cv" ? "CV" : "cover letter"} was not changed in this version` }); continue; }
    const textOf = (d) => (d === "cv" ? cvTextOf(cv) : letterTextOf(cover));
    const model = modelReport.map((r) => ({ r, s: overlap(r.instruction, point) })).sort((x, y) => y.s - x.s)[0];
    const said = model && model.s >= 0.5 ? model.r : null;
    const fixedHere = fixedLocally.find((f) => f.instruction === point);
    const v = (ok, detail, fix = null) => out.push({ ...base, status: ok ? "verified" : "not_followed", detail, ...(fix && !ok ? { fix } : {}), ...(fixedHere && ok ? { fixedLocally: fixedHere.detail } : {}) });
    switch (a.kind) {
      case "greeting": {
        const got = String(cover?.salutation ?? DEFAULT_SALUTATION).trim();
        const ok = lc(got) === lc(a.expect.greeting);
        const extraNote = "";
        v(ok, ok ? `the letter greets "${got}"${/hiring manager/i.test(got) ? "" : " (Dear Hiring Manager removed)"}${extraNote}` : `Requested greeting was not applied: the letter says "${got}", not "${a.expect.greeting}"`, { type: "greeting", greeting: a.expect.greeting, name: a.expect.name });
        break;
      }
      case "word_limit": {
        const n = words(flatBody(cover.body));
        v(n <= a.expect.max, n <= a.expect.max ? `${n} words, within ${a.expect.max}` : `Requested length was not met: ${n} words, more than ${a.expect.max}`);
        break;
      }
      case "remove_text": {
        const hits = inRun.filter((d) => lc(textOf(d)).includes(lc(a.expect.phrase)));
        v(!hits.length, !hits.length ? `"${a.expect.phrase.slice(0, 80)}" is not in the ${DOC_NAME[a.doc].toLowerCase()}` : `Requested removal was not made: "${a.expect.phrase.slice(0, 80)}" is still in the ${hits.map((d) => DOC_NAME[d].toLowerCase()).join(" and ")}`, hits.includes("cover") ? { type: "remove_text", phrase: a.expect.phrase } : null);
        break;
      }
      case "include_text": {
        const miss = inRun.filter((d) => !lc(textOf(d)).includes(lc(a.expect.phrase)));
        v(!miss.length, !miss.length ? `"${a.expect.phrase.slice(0, 80)}" appears as requested` : `Requested wording is missing from the ${miss.map((d) => DOC_NAME[d].toLowerCase()).join(" and ")} ("${a.expect.phrase.slice(0, 80)}"); it is added only if your CV supports it`);
        break;
      }
      case "remove_entity": {
        const ent = ENTITIES.find((e) => e.name === a.expect.entity);
        if (ent.mandatory) { out.push({ ...base, status: "rejected", detail: ent.mandatory }); break; }
        // In the CV only the summary can drop it: employment history and Leadership stay as in cv.md.
        const hits = inRun.filter((d) => ent.in.test(d === "cv" ? flatBody([cv?.profile, ...(cv?.highlights ?? [])]) : flatBody(cover.body)));
        v(!hits.length, !hits.length ? `${ent.name} is not mentioned in the ${inRun.map((d) => (d === "cv" ? "CV summary" : "letter")).join(" or ")}` : `Requested removal was not made: ${ent.name} is still mentioned in the ${hits.map((d) => (d === "cv" ? "CV summary" : "letter")).join(" and ")}`);
        break;
      }
      case "shorter_opening": {
        const now = words(strip(Array.isArray(cover.body?.[0]) ? cover.body[0].join(" ") : cover.body?.[0]));
        const was = prevCover ? words(strip(Array.isArray(prevCover.body?.[0]) ? prevCover.body[0].join(" ") : prevCover.body?.[0])) : null;
        if (was == null) out.push({ ...base, status: "unverifiable", detail: `opening paragraph is ${now} words; there is no earlier letter to compare with${said ? `. The model reports: ${said.status}${said.how ? ` (${strip(said.how).slice(0, 160)})` : ""}` : ""}` });
        else v(now < was, now < was ? `opening paragraph is ${now} words, down from ${was}` : `Requested shorter opening was not applied: ${now} words, previously ${was}`);
        break;
      }
      case "shorter_letter": {
        const now = words(flatBody(cover.body));
        const was = prevCover ? words(flatBody(prevCover.body)) : null;
        if (was == null) out.push({ ...base, status: "unverifiable", detail: `letter is ${now} words; there is no earlier letter to compare with` });
        else v(now < was, now < was ? `letter is ${now} words, down from ${was}` : `Requested shorter letter was not applied: ${now} words, previously ${was}`);
        break;
      }
      case "feature_entity": {
        const ent = ENTITIES.find((e) => e.name === a.expect.entity);
        const miss = inRun.filter((d) => !ent.in.test(textOf(d)));
        if (miss.length) v(false, `Requested emphasis was not applied: ${ent.name} is not mentioned in the ${miss.map((d) => DOC_NAME[d].toLowerCase()).join(" and ")}`);
        else out.push({ ...base, status: "partly_verified", detail: `${ent.name} appears in the ${inRun.map((d) => DOC_NAME[d].toLowerCase()).join(" and ")}; how much weight it gets is a judgement, so read it to confirm${said ? `. The model reports: ${said.status}${said.how ? ` (${strip(said.how).slice(0, 160)})` : ""}` : ""}` });
        break;
      }
      default: {
        const modelNo = said && said.status !== "applied";
        out.push({ ...base, status: modelNo ? "model_not_applied" : "unverifiable", detail: `${modelNo ? "the model reports it did not fully apply this" : "a judgement that an exact text match cannot verify; read the document to confirm"}${said ? `. The model reports: ${said.status}${said.how ? ` (${strip(said.how).slice(0, 200)})` : ""}` : ""}` });
      }
    }
  }
  return out;
}

/**
 * Safe deterministic corrections for failed points, made on a copy of the letter
 * spec: the requested greeting, and removing a sentence or bullet the instruction
 * quotes word for word. Nothing is invented; anything else is left for review.
 */
export function applyFixes(coverSpec, items) {
  if (!coverSpec) return { spec: coverSpec, applied: [] };
  const spec = JSON.parse(JSON.stringify(coverSpec));
  const applied = [];
  for (const it of items) {
    if (it.status !== "not_followed" || !it.fix) continue;
    if (it.fix.type === "greeting") {
      const g = cleanSalutation(it.fix.greeting);
      if (g === DEFAULT_SALUTATION && !/hiring manager/i.test(it.fix.greeting)) continue;
      spec.salutation = g;
      // The name appears only in the greeting: never a separate recipient line (2026-11-15).
      spec.recipient = "";
      applied.push({ instruction: it.instruction, detail: `greeting set to "${g}" on this computer (no AI call)` });
    }
    if (it.fix.type === "remove_text") {
      const ph = lc(it.fix.phrase);
      let done = false;
      spec.body = (spec.body ?? []).map((b) => {
        if (Array.isArray(b)) {
          const kept = b.filter((x) => !(lc(x).includes(ph) && ph.length >= 0.6 * lc(x).length));
          if (kept.length !== b.length) done = true;
          return kept;
        }
        const sentences = String(b).split(/(?<=[.!?])\s+/);
        const kept = sentences.filter((x) => !(lc(x).includes(ph) && ph.length >= 0.6 * lc(x).length));
        if (kept.length !== sentences.length) done = true;
        return kept.join(" ");
      }).filter((b) => (Array.isArray(b) ? b.length : String(b).trim()));
      if (done) applied.push({ instruction: it.instruction, detail: "the quoted sentence was removed on this computer (no AI call)" });
    }
  }
  return { spec, applied };
}

const MARK = { verified: "✓ Verified", partly_verified: "~ Partly verified", not_followed: "✗ Instruction not followed", unverifiable: "~ Not verifiable by exact text", model_not_applied: "! Not applied", rejected: "⊘ Rejected", wrong_target: "! Wrong document selected", not_produced: "– Not checked", not_in_this_run: "– Not changed in this version" };

/** The "Additional Instructions Compliance" quality-panel group. */
export function complianceGroup(items) {
  if (!items.length) return null;
  const n = (s) => items.filter((i) => i.status === s).length;
  const failed = n("not_followed");
  const reviewNeeded = n("model_not_applied") + n("wrong_target");
  const status = failed ? "issue" : reviewNeeded ? "review" : "ok";
  const verified = n("verified"), partly = n("partly_verified"), judged = n("unverifiable"), rejected = n("rejected");
  const parts = [`${verified} verified in the text`, partly && `${partly} partly verified`, judged && `${judged} to read (not testable by exact text)`, failed && `${failed} not followed`, rejected && `${rejected} rejected for a factual or safety reason`, reviewNeeded && `${reviewNeeded} need${reviewNeeded > 1 ? "" : "s"} your attention`].filter(Boolean);
  return {
    group: "Additional Instructions Compliance",
    ok: !failed,
    status,
    detail: `${failed ? "Instruction not followed. " : ""}${parts.join(", ")}`,
    list: items.map((i) => `${MARK[i.status] ?? i.status} [${DOC_NAME[i.doc] ?? i.doc}]: "${i.instruction.length > 140 ? `${i.instruction.slice(0, 140)}…` : i.instruction}": ${i.detail}${i.fixedLocally ? ` (${i.fixedLocally})` : ""}`),
    items,
    fixable: items.some((i) => i.status === "not_followed" && i.fix),
  };
}
