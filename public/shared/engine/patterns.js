/**
 * What the research library says about apps like this one. The offline engine borrows these
 * priors for apps nobody has researched yet and cites them as evidence ("6 of 9 researched
 * Productivity & PM apps are self-serve"). Pure and isomorphic.
 */
import { DIFFICULTY_TIERS, PATH_ORDER } from "../guide-model.js";

const median = (xs) => {
  const s = xs.filter((x) => Number.isFinite(x) && x < 999).sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/**
 * Does the research say a customer admin or owner installs, approves or can block the app?
 * Sentence by sentence, ignoring negations ("no workspace admin layer", "admin not required").
 */
export function adminGated(text) {
  return String(text ?? "")
    .split(/(?<=[.;])\s+/)
    .some(
      (sentence) =>
        /\b(admins?|owners?|administrators?)\b/i.test(sentence) &&
        /\b(install|approv|consent|authoriz|must|block|restrict|allow-list|allowlist|enable)/i.test(sentence) &&
        !/\b(no|not|without|never)\b[^.;]{0,30}\b(admins?|owners?|administrators?)\b|\b(admins?|owners?)\b[^.;]{0,40}\b(not required|isn't required|not needed|not documented|undocumented|not stated)/i.test(sentence),
    );
}

/** @param {object[]} guides full v3 guides */
export function libraryPatterns(guides) {
  const byCategory = {};
  for (const g of guides) {
    const c = (byCategory[g.category] ??= {
      total: 0,
      paths: Object.fromEntries(PATH_ORDER.map((p) => [p, 0])),
      scope: { Low: 0, Medium: 0, High: 0, "N/A": 0 },
      adminInstall: 0,
      oauth: 0,
      examples: Object.fromEntries(PATH_ORDER.map((p) => [p, []])),
    });
    c.total += 1;
    c.paths[g.path] += 1;
    c.scope[g.scopes?.complexity ?? "N/A"] += 1;
    c.examples[g.path].push({ id: g.id, name: g.name });
    if (["self", "review", "partner"].includes(g.path)) {
      c.oauth += 1;
      if (adminGated(g.roles?.customer)) c.adminInstall += 1;
    }
  }
  const byPath = {};
  for (const p of PATH_ORDER) {
    const list = guides.filter((g) => g.path === p);
    byPath[p] = { total: list.length, medianProdDays: median(list.map((g) => g.effort?.prodDays)) };
  }
  return { total: guides.length, byCategory, byPath };
}

/** Most common connection path in a category, ignoring "none". Falls back to self-serve. */
export function categoryPrior(patterns, category) {
  const c = patterns.byCategory[category];
  if (!c) return { path: "self", clear: false, mix: [], count: 0, total: 0, examples: [], adminInstallLikely: false, scope: "Medium" };
  const ranked = PATH_ORDER.filter((p) => p !== "none").sort((a, b) => c.paths[b] - c.paths[a]);
  const path = ranked[0] ?? "self";
  // A prior only counts when it is a clear plurality: ahead of the runner-up and at least 40%.
  const clear = c.paths[path] > (c.paths[ranked[1]] ?? 0) && c.paths[path] / c.total >= 0.4;
  const scope = ["Low", "Medium", "High"].sort((a, b) => c.scope[b] - c.scope[a])[0];
  return {
    path,
    clear,
    mix: ranked.filter((p) => c.paths[p] > 0).map((p) => ({ path: p, count: c.paths[p] })),
    count: c.paths[path],
    total: c.total,
    examples: c.examples[path].slice(0, 3),
    adminInstallLikely: c.oauth > 0 && c.adminInstall / c.oauth >= 0.5,
    adminInstallCount: c.adminInstall,
    oauthCount: c.oauth,
    scope,
    scopeCount: c.scope[scope],
  };
}

/** Headline numbers for the dashboard and the Method page. */
export function libraryStats(guides, patterns = libraryPatterns(guides)) {
  return {
    total: guides.length,
    inDepth: guides.filter((g) => g.kind === "in-depth").length,
    researched: guides.filter((g) => g.kind === "researched").length,
    approvalRequired: guides.filter((g) => g.approval?.required === true).length,
    byPath: Object.fromEntries(PATH_ORDER.map((p) => [p, guides.filter((g) => g.path === p).length])),
    byDifficulty: Object.fromEntries(DIFFICULTY_TIERS.map((d) => [d, guides.filter((g) => g.effort?.difficulty === d).length])),
    medianProdDays: Object.fromEntries(PATH_ORDER.map((p) => [p, patterns.byPath[p].medianProdDays])),
    withTimeline: Object.fromEntries(PATH_ORDER.map((p) => [p, guides.filter((g) => g.path === p && (g.effort?.prodDays ?? 999) < 999).length])),
  };
}
