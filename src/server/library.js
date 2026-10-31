/**
 * The guide library in memory: loaded once from data/guides at start-up, validated (the
 * server refuses to start on bad data, listing every problem) and indexed for the API.
 */
import fs from "node:fs";
import path from "node:path";
import { DIFFICULTY_TIERS, PATH_ORDER, SCOPE_LEVELS, toSummary } from "../../public/shared/guide-model.js";
import { libraryPatterns, libraryStats } from "../../public/shared/engine/patterns.js";
import { makeLib, searchLibrary } from "../../public/shared/search.js";
import { validateGuide } from "../../public/shared/validate.js";
import { ROOT } from "./config.js";

export function loadLibrary({ dir = path.join(ROOT, "data", "guides"), metaFile = path.join(ROOT, "data", "library-meta.json") } = {}) {
  const meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  const problems = [];
  const guides = [];
  for (const f of files) {
    let g;
    try {
      g = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    } catch (err) {
      problems.push(`${f}: ${err.message}`);
      continue;
    }
    if (`${g.id}.json` !== f) problems.push(`${f}: id "${g.id}" doesn't match the file name`);
    problems.push(...validateGuide(g));
    guides.push(Object.freeze(g));
  }
  if (problems.length) throw new Error(`Guide library is invalid (${problems.length} problems):\n  - ${problems.join("\n  - ")}`);

  const byId = new Map(guides.map((g) => [g.id, g]));
  const featured = meta.featured.filter((id) => byId.has(id));
  const summaries = guides.map((g) => ({ ...toSummary(g), featuredRank: featured.includes(g.id) ? featured.indexOf(g.id) : null }));
  const lib = makeLib(summaries);
  const categories = [...new Set(guides.map((g) => g.category))].sort();
  const patterns = libraryPatterns(guides);

  const stats = libraryStats(guides, patterns);

  return {
    meta: { lastChecked: meta.lastChecked, featured, categories, stats },
    guides,
    summaries,
    lib,
    patterns,
    categories,
    get: (id) => byId.get(id),
    has: (id) => byId.has(id),
    /** Filtered and sorted summaries for GET /api/guides. Unknown filter values are ignored. */
    query({ q = "", difficulty = "", approval = "", path: p = "", category = "", scope = "", sort = "" } = {}) {
      let items = q ? searchLibrary(lib, q) : [...summaries];
      if (DIFFICULTY_TIERS.includes(difficulty)) items = items.filter((s) => s.difficulty === difficulty);
      if (approval === "required") items = items.filter((s) => s.approvalRequired === true);
      if (approval === "none") items = items.filter((s) => s.approvalRequired === false);
      if (PATH_ORDER.includes(p)) items = items.filter((s) => s.path === p);
      if (categories.includes(category)) items = items.filter((s) => s.category === category);
      if (SCOPE_LEVELS.includes(scope)) items = items.filter((s) => s.scopeComplexity === scope);
      // "N/A" (no connector path) sorts last both ways.
      const rank = (s, dir) => (s.difficulty === "N/A" ? 99 : dir * DIFFICULTY_TIERS.indexOf(s.difficulty));
      const by = {
        name: (a, b) => a.name.localeCompare(b.name),
        fastest: (a, b) => a.prodDays - b.prodDays || a.name.localeCompare(b.name),
        easiest: (a, b) => rank(a, 1) - rank(b, 1) || a.prodDays - b.prodDays,
        hardest: (a, b) => rank(a, -1) - rank(b, -1) || b.prodDays - a.prodDays,
      }[sort];
      if (by) items.sort(by);
      return items;
    },
  };
}
