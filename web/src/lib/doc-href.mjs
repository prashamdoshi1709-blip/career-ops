// Link to one generated document under output/applications (served by /api/doc-version).
// A plain module so server pages and client components can both build the link.
/** @param {string} rel @param {boolean} [download] */
export const fileHref = (rel, download = false) => `/api/doc-version?file=${encodeURIComponent(rel)}${download ? "&download=1" : ""}`;
