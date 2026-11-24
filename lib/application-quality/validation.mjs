// Final application quality control record (2026-11-17; moved here 2026-11-19).
// Maps quality-check groups to pass / review / fail per area. No invented
// scores; no personal data.

// Final QC areas -> the quality groups that decide them. An area fails on any
// "issue", needs review on "review"/"warning"; groups not run are "not checked".
export const QC_AREAS = {
  factualAccuracy: ["Factual verification", "Letter claims", "Cover letter"],
  jobRelevance: ["First-bullet relevance", "Experience prioritisation", "Technical and capability coverage", "Job-description alignment"],
  keywordCoverage: ["ATS keyword alignment"],
  companyPersonalisation: ["Company personalisation", "Employer-specific motivation"],
  consistency: ["CV and letter consistency"],
  writingQuality: ["Cover-letter originality and structure", "Human readability", "Natural opening and closing", "Length and focus"],
  positiveLanguage: ["Positive positioning"],
  pdfExtraction: ["ATS text extraction", "PDF text layer (CV and letter)"],
  visualFormatting: ["Visual layout", "Formatting", "File validation"],
  recruiterReview: ["Recruiter 10-second scan"],
};
/** `areas` lets a candidate's generator add its own groups to an area. */
export function buildValidation(quality, areas = QC_AREAS) {
  const result = {};
  for (const [area, groups] of Object.entries(areas)) {
    const hit = quality.filter((q) => groups.includes(q.group));
    // Job-description alignment reflects real gaps in the record, not a document fault.
    const st = hit.filter((q) => q.group !== "Job-description alignment").map((q) => q.status);
    result[area] = !hit.length ? "not checked" : st.includes("issue") ? "fail" : st.some((x) => x === "review" || x === "warning") ? "review" : "pass";
  }
  const outstanding = quality.filter((q) => q.status === "issue" || q.status === "review").map((q) => `${q.group}: ${q.detail}`);
  const status = Object.values(result).includes("fail") ? "not-ready" : Object.values(result).includes("review") ? "check" : "ready";
  return { areas: result, outstanding, status };
}
