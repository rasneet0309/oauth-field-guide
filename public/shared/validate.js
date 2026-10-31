/**
 * Guide schema v3: validation (lists every problem, never throws) and sanitising (clamps
 * untrusted guides, such as a live model's output, to the schema's shapes and sizes).
 * Pure and isomorphic.
 */
import {
  CONFIDENCE_LEVELS,
  DIFFICULTY_TIERS,
  GUIDE_KINDS,
  RESEARCH_RATINGS,
  SCHEMA_VERSION,
  SCOPE_LEVELS,
  WHO,
  isPath,
} from "./guide-model.js";
import { clampText, isSlug, safeUrl } from "./text.js";

const isStr = (v) => typeof v === "string";
const isNonEmpty = (v) => isStr(v) && v.trim().length > 0;
const isStrList = (v) => Array.isArray(v) && v.every(isStr);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** @returns {string[]} problems, prefixed with the guide id; empty when valid */
export function validateGuide(g) {
  const p = [];
  const id = g && isStr(g.id) ? g.id : "(no id)";
  const bad = (msg) => p.push(`${id}: ${msg}`);
  if (!g || typeof g !== "object" || Array.isArray(g)) return ["guide must be an object"];

  if (g.schema !== SCHEMA_VERSION) bad(`schema must be ${SCHEMA_VERSION}`);
  if (!isSlug(g.id)) bad("id must be a slug");
  if (!isNonEmpty(g.name)) bad("name is required");
  if (!isNonEmpty(g.category)) bad("category is required");
  if (!isStr(g.website)) bad("website must be a string");
  if (!GUIDE_KINDS.includes(g.kind)) bad(`kind must be one of ${GUIDE_KINDS.join(", ")}`);
  if (!DATE_RE.test(g.lastChecked ?? "")) bad("lastChecked must be YYYY-MM-DD");
  if (!CONFIDENCE_LEVELS.includes(g.confidence)) bad("confidence must be High, Medium or Low");
  if (!isPath(g.path)) bad("path is invalid");
  if (!isNonEmpty(g.verdict)) bad("verdict is required");

  const a = g.auth ?? {};
  if (!isNonEmpty(a.model)) bad("auth.model is required");
  if (!["yes", "partner-only", "no"].includes(a.userOAuth)) bad("auth.userOAuth must be yes, partner-only or no");

  const e = g.effort ?? {};
  if (!DIFFICULTY_TIERS.includes(e.difficulty)) bad("effort.difficulty is invalid");
  if (!RESEARCH_RATINGS.includes(e.researchRating)) bad("effort.researchRating is invalid");
  if (!isNonEmpty(e.firstShort) || !isNonEmpty(e.prodShort)) bad("effort needs firstShort and prodShort");
  if (typeof e.prodDays !== "number") bad("effort.prodDays must be a number");

  const ap = g.approval ?? {};
  if (![true, false, null].includes(ap.required)) bad("approval.required must be true, false or null");
  if (!isNonEmpty(ap.kind)) bad("approval.kind is required");
  if (ap.timeline != null && !Array.isArray(ap.timeline)) bad("approval.timeline must be a list");
  if (ap.atScale != null && !isStr(ap.atScale)) bad("approval.atScale must be a string");
  // Optional. True on generated guides whose approval is an estimate nobody has checked.
  if (ap.unconfirmed != null && typeof ap.unconfirmed !== "boolean") bad("approval.unconfirmed must be true or false");

  const s = g.scopes ?? {};
  if (!SCOPE_LEVELS.includes(s.complexity)) bad("scopes.complexity is invalid");
  if (s.table != null && !Array.isArray(s.table)) bad("scopes.table must be a list");

  if (!isStrList(g.prerequisites ?? [])) bad("prerequisites must be a list of strings");
  if (!Array.isArray(g.phases) || g.phases.length === 0) bad("phases must be a non-empty list");
  else {
    let steps = 0;
    g.phases.forEach((ph, i) => {
      if (!isNonEmpty(ph?.name)) bad(`phases[${i}].name is required`);
      if (ph?.gate != null && !["required", "optional"].includes(ph.gate)) bad(`phases[${i}].gate must be required or optional`);
      if (!Array.isArray(ph?.steps)) return bad(`phases[${i}].steps must be a list`);
      ph.steps.forEach((st, j) => {
        steps += 1;
        if (!isNonEmpty(st?.do)) bad(`phases[${i}].steps[${j}].do is required`);
        if (!WHO.includes(st?.who)) bad(`phases[${i}].steps[${j}].who must be one of ${WHO.join(", ")}`);
        if (typeof st?.agent !== "boolean") bad(`phases[${i}].steps[${j}].agent must be true or false`);
      });
    });
    if (steps === 0) bad("a guide needs at least one step");
  }
  if (g.registerAt != null) {
    if (!isStr(g.registerAt.path)) bad("registerAt.path must be a string");
    if (g.registerAt.url && !safeUrl(g.registerAt.url)) bad("registerAt.url must be an http(s) URL");
  }
  for (const key of ["testing", "gotchas", "uncertain", "customerExperience"]) {
    if (!isStrList(g[key] ?? [])) bad(`${key} must be a list of strings`);
  }
  if (!Array.isArray(g.blockers) || !g.blockers.every((b) => isNonEmpty(b?.problem) && isStr(b?.fix ?? "")))
    bad("blockers must be a list of { problem, fix }");
  if (!Array.isArray(g.sources) || !g.sources.every((x) => safeUrl(x?.url) && isStr(x?.label ?? "")))
    bad("sources must be a list of { url, label } with http(s) URLs");
  if (g.kind !== "generated" && (g.sources ?? []).length === 0) bad("researched guides need at least one source");
  const r = g.roles ?? {};
  for (const k of ["team", "console", "customer"]) if (!isStr(r[k] ?? "")) bad(`roles.${k} must be a string`);
  const au = g.automation ?? {};
  if (!isStr(au.agentCan ?? "") || !isStr(au.humanMust ?? "")) bad("automation must have agentCan and humanMust strings");
  return p;
}

/* ---------------------------------------------------------------------------------------- */
/* Sanitising untrusted guides (live model output, stored records).                         */
/* ---------------------------------------------------------------------------------------- */

const LIMITS = { short: 120, line: 400, para: 1600, list: 24, steps: 14, phases: 8, sources: 12, table: 30 };
const t = (v, max = LIMITS.line) => clampText(v, max);
const list = (v, max = LIMITS.list, len = LIMITS.line) =>
  (Array.isArray(v) ? v : isStr(v) && v ? [v] : [])
    .map((x) => t(x, len))
    .filter(Boolean)
    .slice(0, max);
const pick = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);

/** Clamp a step from any source to the schema. */
export function sanitizeStep(st) {
  return {
    do: t(st?.do, LIMITS.para),
    who: pick(st?.who, WHO, "Developer"),
    agent: st?.agent === true,
  };
}

/**
 * Coerce an untrusted guide-shaped object into schema-shaped data: strings clamped, lists
 * capped, enums checked, URLs restricted to http(s). Unknown keys are dropped. The caller
 * still runs finalizeGuide() and validateGuide().
 */
export function sanitizeGuide(g) {
  const x = g && typeof g === "object" ? g : {};
  const phases = (Array.isArray(x.phases) ? x.phases : [])
    .slice(0, LIMITS.phases)
    .map((ph) => ({
      name: t(ph?.name, LIMITS.short) || "Steps",
      duration: t(ph?.duration, LIMITS.short),
      ...(["required", "optional"].includes(ph?.gate) ? { gate: ph.gate } : {}),
      steps: (Array.isArray(ph?.steps) ? ph.steps : []).slice(0, LIMITS.steps).map(sanitizeStep).filter((s) => s.do),
    }))
    .filter((ph) => ph.steps.length);
  const sources = (Array.isArray(x.sources) ? x.sources : [])
    .map((s) => (isStr(s) ? { url: s, label: "" } : s))
    .map((s) => ({ url: safeUrl(s?.url), label: t(s?.label, LIMITS.short) }))
    .filter((s) => s.url)
    .slice(0, LIMITS.sources);
  return {
    schema: SCHEMA_VERSION,
    id: isSlug(x.id) ? x.id : "generated",
    name: t(x.name, 80) || "Unknown app",
    category: t(x.category, 60) || "Uncategorised",
    website: t(x.website, LIMITS.short),
    tagline: t(x.tagline, LIMITS.short),
    kind: pick(x.kind, GUIDE_KINDS, "generated"),
    featured: false,
    listNumber: null,
    lastChecked: DATE_RE.test(x.lastChecked ?? "") ? x.lastChecked : new Date().toISOString().slice(0, 10),
    confidence: pick(x.confidence, CONFIDENCE_LEVELS, "Low"),
    path: isPath(x.path) ? x.path : "none",
    verdict: t(x.verdict, LIMITS.para),
    needGuide: t(x.needGuide, LIMITS.para),
    auth: {
      model: t(x.auth?.model, LIMITS.short) || "Unknown",
      detail: t(x.auth?.detail, LIMITS.para),
      userOAuth: pick(x.auth?.userOAuth, ["yes", "partner-only", "no"], "no"),
      access: t(x.auth?.access, LIMITS.short),
    },
    effort: {
      difficulty: pick(x.effort?.difficulty, DIFFICULTY_TIERS, undefined),
      researchRating: pick(x.effort?.researchRating, RESEARCH_RATINGS, "N/A"),
      timeToFirstTest: t(x.effort?.timeToFirstTest, LIMITS.line),
      timeToProduction: t(x.effort?.timeToProduction, LIMITS.line),
      firstShort: t(x.effort?.firstShort, 48),
      prodShort: t(x.effort?.prodShort, 48),
    },
    approval: {
      kind: t(x.approval?.kind, 60),
      gate: t(x.approval?.gate, LIMITS.para),
      when: t(x.approval?.when, LIMITS.para),
      timeline: (Array.isArray(x.approval?.timeline) ? x.approval.timeline : []).slice(0, 8).map((r) => ({
        label: t(r?.label, LIMITS.short),
        official: t(r?.official, LIMITS.line),
        reported: t(r?.reported, LIMITS.line),
      })),
      recurring: t(x.approval?.recurring, LIMITS.para),
      ...(x.approval?.atScale ? { atScale: t(x.approval.atScale, LIMITS.line) } : {}),
      ...(x.approval?.unconfirmed === true ? { unconfirmed: true } : {}),
    },
    scopes: {
      complexity: pick(x.scopes?.complexity, SCOPE_LEVELS, undefined),
      why: t(x.scopes?.why, LIMITS.line),
      summary: t(x.scopes?.summary, LIMITS.para),
      table: (Array.isArray(x.scopes?.table) ? x.scopes.table : []).slice(0, LIMITS.table).map((r) => ({
        use: t(r?.use, LIMITS.short),
        scope: t(r?.scope, LIMITS.line),
        tier: t(r?.tier, 60),
        note: t(r?.note, LIMITS.line),
      })),
    },
    cost: t(x.cost, LIMITS.line),
    tiers: (Array.isArray(x.tiers) ? x.tiers : []).slice(0, 6).map((r) => ({
      label: t(r?.label, LIMITS.short),
      eg: t(r?.eg, LIMITS.short),
      difficulty: pick(r?.difficulty, RESEARCH_RATINGS, "N/A"),
      time: t(r?.time, 60),
      note: t(r?.note, LIMITS.line),
    })),
    prerequisites: list(x.prerequisites),
    registerAt:
      x.registerAt && (x.registerAt.url || x.registerAt.path)
        ? { url: safeUrl(x.registerAt.url), path: t(x.registerAt.path, LIMITS.para) }
        : null,
    phases,
    roles: {
      team: t(x.roles?.team, LIMITS.para),
      console: t(x.roles?.console, LIMITS.para),
      customer: t(x.roles?.customer, LIMITS.para),
      consoleRoles: (Array.isArray(x.roles?.consoleRoles) ? x.roles.consoleRoles : []).slice(0, 8).map((r) => ({
        role: t(r?.role, LIMITS.short),
        can: t(r?.can, LIMITS.line),
        who: t(r?.who, LIMITS.short),
      })),
    },
    customerExperience: list(x.customerExperience),
    testing: list(x.testing),
    blockers: (Array.isArray(x.blockers) ? x.blockers : [])
      .map((b) => (isStr(b) ? { problem: b, fix: "" } : b))
      .map((b) => ({ problem: t(b?.problem, LIMITS.line), fix: t(b?.fix, LIMITS.line) }))
      .filter((b) => b.problem)
      .slice(0, 10),
    gotchas: list(x.gotchas, 10),
    automation: { agentCan: t(x.automation?.agentCan, LIMITS.para), humanMust: t(x.automation?.humanMust, LIMITS.para) },
    uncertain: list(x.uncertain, 10),
    sources,
  };
}
