import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import * as yaml from "js-yaml";
import { careerOpsRoot } from "@/lib/career-ops";
import { DEFAULT_FILTERS, cleanChips, type ExploreFilters } from "@/lib/explore";
import { profileTargetKeywords } from "@/lib/profile-keywords.mjs";
import { getProfilePath } from "@/lib/core/profile-path.mjs";

/**
 * ACL for portals.yml — the core's scan-filter config (a CONTRACT entry-point,
 * see reference_web_core_sync_protocol). The Explorer NEVER mutates the user's
 * real portals.yml: it writes an EPHEMERAL filter file and points the scanner at
 * it via CAREER_OPS_PORTALS, so an ad-hoc search can't clobber the curated config.
 * We also read the real portals.yml + config/profile.yml (tolerantly) only to
 * SEED sensible defaults for the first search.
 *
 * Filter semantics mirror scan.mjs::buildTitleFilter / buildLocationFilter:
 *   title positive → substring match (empty = everything matches)
 *   title negative → substring reject
 *   location block_hard > always_allow > block > allow (case-insensitive substring);
 *   block_hard is the one tier always_allow cannot override (scan.mjs, #2956)
 */
type FilterLists = Pick<ExploreFilters, "positive" | "negative" | "allow" | "block" | "alwaysAllow" | "blockHard">;

function listFrom(v: unknown): string[] {
  return cleanChips(v);
}

// serializePortals lives in portals-serialize.mjs (pure, no TS deps) so the web
// `node --test` suite can load it — the block_hard round-trip (#3102) is exactly
// a "don't silently drop a tier" property that has to be asserted, not eyeballed.
export { serializePortals } from "./portals-serialize.mjs";
import { serializePortals } from "./portals-serialize.mjs";

/** Write the ephemeral filter file to a temp path; caller cleans it up. */
export function writeTempPortals(f: FilterLists): string {
  const file = path.join(os.tmpdir(), `career-ops-explore-${randomUUID()}.yml`);
  // 2026-11-22: carry portals.yml's negative_exempt_phrases, so Explore and the
  // portals scan veto the same titles.
  const tf = (loadYaml(path.join(careerOpsRoot(), "portals.yml"))?.title_filter ?? {}) as Record<string, unknown>;
  const negativeExempt = listFrom(tf.negative_exempt_phrases);
  fs.writeFileSync(file, serializePortals({ ...f, negativeExempt }) + locationFlagsFromUserPortals(f), "utf8");
  return file;
}

/**
 * 2026-11-23: the file the portals scan (SEEK, recruiters, tracked employer
 * sites) runs on from Explore. writeTempPortals carries only the filters, which
 * is all scan-ats-full.mjs needs, but scan.mjs reads its SOURCES from the file
 * too, so this is the user's whole portals.yml with the Explore choices applied:
 * a non-empty Explore title list replaces title_filter.positive, Explore
 * negatives are added, and non-empty Explore location lists replace theirs.
 * Empty Explore lists leave the user's own lists as they are. Caller cleans up.
 */
export function writePortalsScanFile(f: FilterLists): string {
  const file = path.join(os.tmpdir(), `career-ops-explore-${randomUUID()}.yml`);
  const base = (loadYaml(path.join(careerOpsRoot(), "portals.yml")) ?? {}) as Record<string, any>;
  const tf = { ...(base.title_filter ?? {}) };
  if (f.positive.length) tf.positive = [...f.positive];
  if (f.negative.length) tf.negative = cleanChips([...(Array.isArray(tf.negative) ? tf.negative : []), ...f.negative]);
  const lf = { ...(base.location_filter ?? {}) };
  if (f.allow.length) lf.allow = [...f.allow];
  if (f.alwaysAllow.length) lf.always_allow = [...f.alwaysAllow];
  if (f.block.length) lf.block = [...f.block];
  if (f.blockHard.length) lf.block_hard = [...f.blockHard];
  fs.writeFileSync(file, yaml.dump({ ...base, title_filter: tf, location_filter: lf }, { lineWidth: -1, noRefs: true }), "utf8");
  return file;
}

/**
 * Local customisation (2026-11-09): carry the user's own location_filter switches
 * (`strict`, `remote_title_fallback`) into the ephemeral file, so an Explore
 * search applies the same "no location = not Australian" and "a Remote title is
 * not a location" rules as the portals scan. Only emitted when the serialized
 * filters already contain a location_filter block.
 */
function locationFlagsFromUserPortals(f: FilterLists): string {
  // serializePortals writes location_filter as its LAST block, so lines indented
  // by two spaces here land inside that same mapping.
  if (!(f.blockHard.length || f.allow.length || f.block.length || f.alwaysAllow.length)) return "";
  const lf = (loadYaml(path.join(careerOpsRoot(), "portals.yml"))?.location_filter ?? {}) as Record<string, unknown>;
  let out = "";
  if (lf.strict === true) out += "  strict: true\n";
  if (lf.remote_title_fallback === false) out += "  remote_title_fallback: false\n";
  return out;
}

export function cleanupTempPortals(file: string): void {
  try {
    if (file.startsWith(os.tmpdir()) && file.includes("career-ops-explore-")) fs.unlinkSync(file);
  } catch {
    /* best-effort */
  }
}

function loadYaml(file: string): Record<string, unknown> | null {
  try {
    const doc = yaml.load(fs.readFileSync(file, "utf8"));
    return doc && typeof doc === "object" ? (doc as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Tolerantly seed first-search defaults from the user's real config. Reads
 * portals.yml (title_filter / location_filter) and falls back to
 * config/profile.yml (target_roles, location) for the positive keywords when
 * portals has none. Never throws — a bare checkout just yields DEFAULT_FILTERS.
 */
export function seedExploreFilters(): { filters: ExploreFilters; seededFrom: string[] } {
  const filters: ExploreFilters = { ...DEFAULT_FILTERS, ats: [...DEFAULT_FILTERS.ats] };
  const seededFrom: string[] = [];

  const portals = loadYaml(path.join(careerOpsRoot(), "portals.yml"));
  if (portals) {
    const tf = (portals.title_filter ?? {}) as Record<string, unknown>;
    const lf = (portals.location_filter ?? {}) as Record<string, unknown>;
    filters.positive = listFrom(tf.positive);
    filters.negative = listFrom(tf.negative);
    filters.allow = listFrom(lf.allow);
    filters.block = listFrom(lf.block);
    filters.alwaysAllow = listFrom(lf.always_allow);
    filters.blockHard = listFrom(lf.block_hard);
    if (filters.positive.length || filters.allow.length || filters.block.length || filters.blockHard.length) seededFrom.push("portals.yml");
  }

  if (filters.positive.length === 0) {
    // Shape-reading lives in profile-keywords.mjs, mirroring the core's
    // providers/_profile-keywords.mjs. Inlined here it had drifted from the
    // core on BOTH fields — `primary` read as a string when it is a list,
    // `archetypes` spread raw when its entries are objects — so this fallback
    // returned nothing for every profile.yml the app itself writes.
    const fromRoles = listFrom(profileTargetKeywords(loadYaml(getProfilePath(careerOpsRoot()))));
    if (fromRoles.length) {
      filters.positive = fromRoles;
      seededFrom.push("profile.yml");
    }
  }

  return { filters, seededFrom };
}

export { listFrom as normalizeKeywords };
