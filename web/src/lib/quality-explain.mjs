// Plain-English explanation for each quality check (2026-11-22), shown under
// every warning, review point and failure on the job page: what was checked,
// whether the result is mechanical (a genuine problem unless the source file is
// wrong) or a judgement (it can be a false positive), what to do, and whether
// it blocks submission. It explains; it never changes a result.

const D = "mechanical", J = "judgement";
const TABLE = {
  "ATS keyword alignment": [D, "Job-ad terms against cv.md: supported terms present in the CV, and unsupported terms the documents present as your experience.", "Remove or reword any sentence listed as CLAIMED. Repetition warnings are style only."],
  "ATS text extraction": [D, "That the PDF text can be extracted in reading order, as an applicant tracking system would.", "Regenerate the PDF if text is missing or out of order."],
  "PDF text layer (CV and letter)": [D, "That both PDFs carry a real text layer, not images of text.", "Regenerate the PDF."],
  "File validation": [D, "That both PDFs open, sit in this job's folder, and that the file names and letter address name the employer (case and punctuation ignored).", "Rename the file or correct the address line to the employer named in the job."],
  "Factual verification": [D, "Every figure and named fact in the documents against cv.md and your other records.", "Remove or correct any figure not in your records; never add one to make the check pass."],
  "Letter claims": [J, "Sentences in the letter that claim leading, outcomes, tools, qualifications or experience length beyond cv.md.", "Reword the sentence to what cv.md states."],
  "Visual layout": [D, "Rendered pages: overlapping or clipped text, page count and empty pages.", "Shorten the content or regenerate."],
  "Formatting": [D, "House format: no bold in letters, no em dashes or contractions, Australian spelling, dates as in cv.md.", "Use Fix automatically where offered; it changes punctuation and spelling only."],
  "Length and focus": [D, "Letter length (about 250 to 320 words, tolerance 230 to 335) and paragraph count; CV pages.", "Trim the longest paragraph; keep the strongest evidence."],
  "Company personalisation": [J, "That the letter names the employer, the role and its location, and gives a reason traced to the job ad or employer sources. A recruiter's office address can differ from the job's city.", "Name the employer in the opening and give one sourced reason for applying. If the address is a recruiter's office, this can be a false positive."],
  "Employer-specific motivation": [J, "Whether the reasons for applying and the contribution are specific to this employer rather than restating the CV.", "Replace a restated CV line with what it means for this role."],
  "Cover-letter originality and structure": [J, "Similarity to your other letters, restated CV bullets and figure density.", "Rewrite the flagged opening or sentence in your own words for this job."],
  "Human readability": [J, "Sentence variety (how many start with \"I\"), long phrases copied from the CV, and openings shared with other letters.", "Vary sentence openings; rephrase copied phrases. Review, not a failure."],
  "Experience prioritisation": [J, "Whether each role leads with the bullets most relevant to this job type.", "Move the most relevant bullet first; wording is never changed."],
  "First-bullet relevance": [J, "Whether the first bullet of each role matches the job's main requirements.", "Reorder bullets."],
  "Recruiter 10-second scan": [J, "What a recruiter sees first: profile opening, current role and headline evidence.", "Make the first profile sentence say who you are now."],
  "Positive positioning": [D, "Apologetic or gap statements (\"although I have not\", \"limited experience\").", "Remove the clause and lead with the related strength."],
  "Natural opening and closing": [J, "Template-like openings and closings.", "Rewrite in a direct, natural voice."],
  "CV and letter consistency": [D, "That titles, employers, dates and figures agree between the CV and the letter.", "Correct the letter to match the CV."],
  "Job-description alignment": [J, "Essential requirements met, partly met or not met by your evidence. Informational.", "No document change; be ready to address gaps honestly."],
  "Requirements you may not meet": [J, "Requirements with no evidence in your records. Informational; nothing was added to the documents.", "Prepare an honest answer; do not add the skill."],
  "Relevant experience coverage": [J, "Whether the strongest relevant evidence for this role type appears in the documents.", "Swap in the stronger verified bullet."],
  "Technical and capability coverage": [J, "Technical skills the job asks for that your records support.", "Mention supported skills where natural."],
  "Communication and stakeholder coverage": [J, "Communication evidence, weighted by role type.", "Add supported communication evidence only where the job asks."],
};

/** Explanation for one quality item, or null for a passed check. */
export function explainQuality(item) {
  if (!item || item.status === "ok" || item.status == null) return null;
  // A check may carry its own explanation ({ kind, checks, fix }), e.g. a
  // generator's personal checks that this generic table does not know.
  const own = item.explain && typeof item.explain === "object" ? [item.explain.kind === "mechanical" ? D : J, item.explain.checks, item.explain.fix] : null;
  const [kind, checks, fix] = own ?? TABLE[item.group] ?? [J, "A local document check.", "Read the points listed and decide whether a change is needed."];
  const blocks = item.status === "issue";
  return {
    checks,
    reliability: kind === D ? "Mechanical check: a genuine problem unless the source record itself is wrong." : "Judgement check: read the sentence; it can be a false positive.",
    fix,
    blocks,
    blocksText: blocks ? "Blocks submission until fixed or confirmed as a false positive." : item.status === "review" ? "Does not block; review before sending." : "Does not block.",
  };
}
