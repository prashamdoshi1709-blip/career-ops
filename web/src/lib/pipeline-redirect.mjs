// Where an old /pipeline URL now lives (2026-11-22). Keeps the query string;
// /pipeline/compare?ids=1,2 becomes /opportunities/compare?n=1,2, the parameter
// the compare page reads. Before, the redirect dropped the query and the
// comparison opened empty.
export function pipelineRedirectTarget(slug = [], searchParams = {}) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams ?? {})) {
    for (const x of [v].flat()) if (x != null) sp.append(k, String(x));
  }
  const parts = (slug ?? []).map(String);
  if (parts[0] === "compare" && sp.has("ids") && !sp.has("n")) {
    for (const x of sp.getAll("ids")) sp.append("n", x);
    sp.delete("ids");
  }
  const base = parts.length ? `/opportunities/${parts.map(encodeURIComponent).join("/")}` : "/opportunities";
  const q = sp.toString();
  return q ? `${base}?${q}` : base;
}
