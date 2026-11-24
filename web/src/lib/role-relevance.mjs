// Local customisation (2026-11-10): decide from a job TITLE whether a role's main
// function is outside the candidate's field (sales / business development /
// marketing / general-management graduate schemes / senior leadership).
//
// Function-based, not word-based: "business" or "development" alone never
// excludes anything. Business-development titles are kept when they carry deal
// work (M&A, origination, capital markets, PE) or a finance-analysis core
// (FP&A, commercial finance, credit, valuations, corporate development analyst).
// Used for DISPLAY: hidden roles stay in data/pipeline.md and scan history.

const SENIOR = /\b(head of|chief\b|cfo\b(?!\s*[-|/,]?\s*(advisory|services|solutions))|coo\b|ceo\b|general manager|managing director|executive director|vice president|\bvp\b|director of|national manager|engagement manager|senior manager|associate partner|principal\b|director\b)/i;
// "Partner" is senior in consulting ("Partner, Deal Advisory") but "Business Partner"
// is an FP&A title and "Partnerships" is sales (handled below).
const PARTNER = /(?<!business )\bpartner\b(?!ship|ing)/i;
// A manager title in consulting or strategy is above analyst/associate level;
// finance managers (FP&A Manager) are left to the rating instead.
const CONSULTING_MANAGER = /(?<!assistant )\bmanager\b/i;
const CONSULTING_CONTEXT = /consult|strategy|transformation|engagement|performance improvement/i;
const GRAD_BIZ = /(business (management|development|administration)\s+(graduate|grad\b|trainee)|graduate\s+(program(me)?\s*[-–:]?\s*)?business (management|development)|general management (graduate|trainee)|management trainee)/i;
const SALES = /(business development|\bbdm\b|\bsales\b|account (manager|executive|director|coordinator|lead)|key account|lead generation|customer acquisition|client acquisition|\bmarketing\b|\bpartnerships\b|partnership (manager|lead|executive|specialist|coordinator)|growth (manager|lead|executive|marketing|hacker)|new business)/i;
const DEAL = /(\bm&a\b|mergers|\bacquisitions\b|acquisition finance|investment bank|corporate finance|corporate advisory|deal|origination|capital markets|\becm\b|\bdcm\b|transaction|private equity|private credit|private debt|direct lending|special situations|structured credit|leveraged finance|financial sponsors|\bfund(s)?\b)/i;
const FIN_CORE = /(financial analyst|finance analyst|fp&a|financial planning (&|and) analysis|commercial finance|finance business partner|business partner\b.*finance|valuation|financial model|credit analyst|investment analyst|equity research|corporate development analyst|treasury|financial analysis)/i;

/** A reason string when the title's function is outside the target field, else null. */
export function irrelevantReason(title, company = "") {
  const t = String(title ?? "");
  if (!t.trim()) return null;
  if (/\b(infosys|tata consultancy|tcs|wipro|cognizant|hcl|tech mahindra|manhattan associates|datacom|ntt)\b/i.test(company) && /consultant|associate/i.test(t)) return "IT services consultant role, not strategy consulting";
  if (/universit|college|institute|research centre|csiro|tafe|hospital/i.test(company) && /research (associate|fellow|assistant|officer)|fellow\b/i.test(t)) return "Academic research post, not investment research";
  if (SENIOR.test(t)) return "Senior leadership role well above analyst or associate level";
  if (PARTNER.test(t)) return "Partner-level role well above analyst or associate level";
  // "Senior Consultant or Manager" / "Consultant / Manager" lets you apply at consultant level: keep it.
  const levelChoice = /(consultant|associate|analyst)\s*(\/|or)\s*(senior\s+)?manager|manager\s*(\/|or)\s*(senior\s+)?(consultant|associate)/i.test(t);
  if (CONSULTING_MANAGER.test(t) && CONSULTING_CONTEXT.test(t) && !levelChoice) return "Consulting or strategy manager role above analyst or associate level";
  // "X Management Consultant" where X is a specialism, not management consulting.
  if (/(injury|asset|service|project|program(me)?|processing|change|software|property|case|records|facilit(y|ies)|safety|environmental|waste|travel|claims|vendor|contract|supplier|stakeholder|incident|release|test|data)\s+management\s+consult/i.test(t)) return "Specialist consultant role (not management or strategy consulting)";
  if (/(administration|reception|recruitment|employment|careers?|disability|nurs|clinical|it|sap|salesforce|crm|erp|cloud|cyber|network|technical|functional|implementation|servicenow|dynamics|oracle|workday)\b[^|]{0,20}consult/i.test(t) || /consult[^|]{0,20}\b(sap|salesforce|crm|erp|cloud|cyber|servicenow|dynamics|oracle|workday)\b/i.test(t)) return "Technology or specialist services consultant, not strategy consulting";
  if (/\b(sharepoint|aws|azure|salesforce|servicenow|sap|erp|crm|cloud|data engineer|technical business analyst|it business analyst)\b/i.test(t)) return "IT or technology role";
  if (GRAD_BIZ.test(t)) return "General business management or business development graduate programme";
  if (SALES.test(t)) {
    const withoutCustomer = t.replace(/(customer|client) acquisition/gi, "");
    if (FIN_CORE.test(t) || DEAL.test(withoutCustomer)) return null;
    return "Sales, business development, account management or marketing role";
  }
  return null;
}

export const isRelevantTitle = (title, company = "") => irrelevantReason(title, company) === null;
