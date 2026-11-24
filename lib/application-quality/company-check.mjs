// Company personalisation check for cover letters (2026-11-17; moved here 2026-11-19).
// Employer, role title and location right; a reason for applying traced to a
// source; not a name-swapped copy of a letter to another employer. No personal
// data; no Claude call.

// ---------- company personalisation ----------
const CONTENT = (s) => (String(s).toLowerCase().match(/[a-z][a-z&'-]{4,}/g) ?? []).filter((w) => !/^(about|their|which|there|these|those|would|could|should|where|while|with|this|that|have|from|into|work|team|role)$/.test(w));
const companyKey = (c) => String(c ?? "").toLowerCase().replace(/^confidential via /, "").replace(/\b(pty|ltd|limited|australia|group|holdings|corporation|inc)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();
/**
 * @param {{coverSpec:object, company:string, role:string, location?:string, sources:string[], otherLetters?:{company:string, body:string}[]}} p
 * sources: verified text about the employer (the job ad, employer notes with sources)
 */
export function companyFindings({ coverSpec, company, role, location = "", sources = [], otherLetters = [] }) {
  const f = [];
  const paras = (coverSpec?.body ?? []).map((p) => (Array.isArray(p) ? p.join(" ") : String(p)));
  const all = paras.join(" ");
  const key = companyKey(company).split(" ")[0];
  const address = (coverSpec?.address ?? []).join(" ");
  if (key && !companyKey(address).includes(key)) f.push({ level: "issue", text: `The address block does not name the employer (${company}): "${address}"` });
  if (key && !companyKey(paras[0]).includes(key)) f.push({ level: "warning", text: "The opening paragraph does not name the employer" });
  const norm = (s) => String(s).toLowerCase().replace(/[–—-]/g, " ").replace(/[^a-z0-9& ]+/g, " ").replace(/\s+/g, " ").trim();
  if (role && !norm(all).includes(norm(role)) && !norm(coverSpec?.re ?? "").includes(norm(role))) f.push({ level: "warning", text: `The exact role title ("${role}") is not used in the letter or its Re: line` });
  const places = String(location).split(/[,/;|]|\bor\b|\band\b/).map((x) => x.trim().split(/\s+/)[0]).filter((x) => x && x.length > 2 && !/remote|hybrid|australia|multiple|various|nationwide/i.test(x));
  if (places.length && !places.some((c) => new RegExp(`\\b${c}\\b`, "i").test(address))) f.push({ level: "warning", text: `The address says "${address}" but the job is in ${location}` });
  // Why THIS employer: the closing must rest on something the sources say.
  const closing = paras.at(-1) ?? "";
  const srcWords = new Set(CONTENT(sources.join(" ")));
  const shared = [...new Set(CONTENT(closing).filter((w) => srcWords.has(w)))];
  const generic = new Set(["finance", "financial", "clients", "business", "analysis", "experience", "growth"]);
  if (shared.filter((w) => !generic.has(w)).length < 2) f.push({ level: "review", text: "The reason for applying to this employer is not traced to anything the job ad or your employer notes say; name one concrete thing about the firm, team or work" });
  // Not a template: compare the body (without the standard opening sentence) with letters to OTHER employers.
  const bodyWords = new Set(CONTENT(paras.slice(1).join(" ")));
  for (const o of otherLetters) {
    if (companyKey(o.company) === companyKey(company)) continue;
    const ow = new Set(CONTENT(o.body));
    const inter = [...bodyWords].filter((w) => ow.has(w)).length;
    const sim = inter / Math.max(1, Math.min(bodyWords.size, ow.size));
    // 0.82: across 94 real letters (2026-11-17) the closest pair for different
    // employers shared 76% of content words, since they reuse the same verified
    // evidence; a name-swapped copy shares well over 90%.
    if (sim > 0.82) { f.push({ level: "review", text: `Reads very like your ${o.company} letter (${Math.round(sim * 100)}% shared wording); make the employer-specific parts distinct` }); break; }
  }
  return f;
}


/**
 * Whether a file name or letter address names the employer. Case, accents and
 * punctuation are ignored, and the first significant word of the company is
 * enough ("HARBOUR Super" matches "Harbour Super, Melbourne VIC"; "NORTHWIND
 * ADVISORY (WA) PTY LTD" matches "Northwind Advisory (WA) Pty Ltd"). 2026-11-22:
 * the comparison was case-sensitive, so two correct applications failed.
 */
export function employerKey(company) {
  const words = String(company ?? "").replace(/^Confidential via /i, "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9&]+/).filter(Boolean);
  return words.find((w) => !/^(the|a|an)$/.test(w)) ?? "";
}
export function namesEmployer(text, company) {
  const key = employerKey(company);
  if (!key) return true;
  const hay = String(text ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9&]+/);
  return hay.includes(key);
}
