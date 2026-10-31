/**
 * Turn research records into v3 guides. Two inputs share this code path:
 *  - the library import (data/research → data/guides), and
 *  - the live research agent, which answers in the same "research profile" shape the
 *    v2 research brief (docs/research/BRIEF.md) used, so live output and library entries
 *    are produced by one converter and look the same.
 * Pure and isomorphic.
 */
import { SCHEMA_VERSION, finalizeGuide, normalizeWho } from "./guide-model.js";
import { clampText, safeUrl } from "./text.js";

const ABBREVIATIONS = /(?:\b(?:e\.g|i\.e|etc|vs|approx|incl|Inc|No|Ltd|Co|St|U\.S|v\d+)\.)$/;

/** Split prose into sentences without breaking "e.g. Slack" or "v2. Then". Conservative by design. */
export function sentences(text) {
  const s = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return [];
  const parts = s.split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/);
  const out = [];
  for (const part of parts) {
    if (out.length && ABBREVIATIONS.test(out[out.length - 1])) out[out.length - 1] += ` ${part}`;
    else out.push(part);
  }
  return out;
}

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const endStop = (s) => (s && !/[.!?)]$/.test(s) ? `${s}.` : s);
const trimStop = (s) => String(s ?? "").replace(/[.\s]+$/, "");

/**
 * "Problem: fix" research blockers → { problem, fix }. Only clear separators split the text;
 * anything else stays whole, so a sentence is never cut in a misleading place.
 */
export function splitBlocker(text) {
  const s = String(text ?? "").trim();
  const marked = /\.?\s+Fix:\s+/.exec(s);
  if (marked && marked.index > 8) {
    return { problem: trimStop(s.slice(0, marked.index)), fix: endStop(cap(s.slice(marked.index + marked[0].length))) };
  }
  for (const sep of [": ", " — ", "; "]) {
    const i = s.indexOf(sep);
    if (i > 8 && i < 180) {
      const problem = s.slice(0, i).trim();
      const fix = s.slice(i + sep.length).trim();
      if (fix.length > 8) return { problem: trimStop(problem), fix: endStop(cap(fix)) };
    }
  }
  const so = s.indexOf(", so ");
  if (so > 8) return { problem: trimStop(s.slice(0, so)), fix: endStop(cap(s.slice(so + 5).trim())) };
  return { problem: trimStop(s), fix: "" };
}

/** Readable label for a bare source URL: "docs.stripe.com/stripe-apps/publish-app". */
export function sourceLabel(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const path = decodeURIComponent(u.pathname).replace(/\/+$/, "");
    const label = `${host}${path}`;
    return label.length > 72 ? `${label.slice(0, 70)}…` : label;
  } catch {
    return String(url ?? "");
  }
}

const toSources = (list) =>
  (Array.isArray(list) ? list : [])
    .map((s) => (typeof s === "string" ? { url: s, label: "" } : s))
    .filter((s) => safeUrl(s?.url))
    .map((s) => ({ url: s.url, label: s.label || sourceLabel(s.url) }));

const toList = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()) : sentences(v));

/** v2 path classification from a profile's auth facts (scripts/lib/library.mjs#classify). */
export function classifyPath(p) {
  if (p.authModel === "No auth (local tool)") return "none";
  if (p.userOAuth === "no") return p.authModel === "Other" || p.authModel === "MCP OAuth" ? "none" : "key";
  if (p.userOAuth === "partner-only") return "partner";
  if (p.access === "Self-serve") return "self";
  return "review";
}

/** Prerequisites a flat research profile implies, quoted from its own fields (nothing invented). */
function profilePrereqs(p) {
  const out = [];
  if (p.roles?.team) out.push(`Account and owner: ${p.roles.team}`);
  if (p.registerAt?.path) out.push(`Where you register: ${p.registerAt.path}`);
  if (p.cost) out.push(`Cost: ${p.cost}`);
  return out;
}

/**
 * Research profile (+ its headline record) → v3 guide.
 * @param {object} p        profile in the BRIEF.md shape
 * @param {object} extra    { headline, path, scope: {level, why}, atScale, lastChecked, kind, featured }
 */
export function fromProfile(p, extra = {}) {
  const h = extra.headline ?? {};
  const path = extra.path ?? classifyPath(p);
  return finalizeGuide({
    schema: SCHEMA_VERSION,
    id: p.id,
    name: p.name,
    category: p.category,
    website: p.website ?? "",
    tagline: "",
    kind: extra.kind ?? "researched",
    featured: Boolean(extra.featured),
    listNumber: Number.isInteger(p.n) ? p.n : null,
    lastChecked: extra.lastChecked,
    confidence: p.confidence,
    path,
    verdict: h.headline || p.productionGate || "",
    needGuide: h.needGuide || "",
    auth: { model: p.authModel, detail: p.authDetail ?? "", userOAuth: p.userOAuth, access: p.access ?? "" },
    effort: {
      researchRating: p.difficulty,
      timeToFirstTest: p.timeToFirstTest ?? "",
      timeToProduction: p.timeToProduction ?? "",
      firstShort: h.firstShort,
      prodShort: h.prodShort,
    },
    approval: { gate: p.productionGate ?? "", when: "", timeline: [], recurring: "", ...(extra.atScale ? { atScale: extra.atScale } : {}) },
    scopes: {
      complexity: extra.scope?.level,
      why: extra.scope?.why ?? "",
      summary: p.scopes ?? "",
      table: [],
    },
    cost: p.cost ?? "",
    tiers: [],
    prerequisites: profilePrereqs(p),
    registerAt: p.registerAt?.url || p.registerAt?.path ? { url: p.registerAt.url ?? "", path: p.registerAt.path ?? "" } : null,
    phases: [
      {
        name: "Setup steps",
        duration: "",
        steps: (p.steps ?? []).map((s) => ({ do: s.do, who: normalizeWho(s.who), agent: s.agent === true })),
      },
    ],
    roles: { team: p.roles?.team ?? "", console: p.roles?.console ?? "", customer: p.roles?.customer ?? "", consoleRoles: [] },
    customerExperience: [],
    testing: toList(p.testing),
    blockers: (Array.isArray(p.blockers) ? p.blockers : toList(p.blockers)).map((b) =>
      typeof b === "string" ? splitBlocker(b) : { problem: trimStop(b.problem), fix: b.fix ?? "" },
    ),
    gotchas: [],
    automation: { agentCan: p.agentCan ?? "", humanMust: p.humanMust ?? "" },
    uncertain: toList(p.uncertain),
    sources: toSources(p.sources),
  });
}

/**
 * In-depth research guide (data/research/in-depth, data/curated) → v3 guide.
 * @param {object} d      deep guide in the v2 shape (tiers, prereqs, phases, scopesTable, review…)
 * @param {object} extra  { scope: {level, why}, registerAt, gates: {phaseName: "required"|"optional"}, lastChecked }
 */
export function fromDeep(d, extra = {}) {
  return finalizeGuide({
    schema: SCHEMA_VERSION,
    id: d.id,
    name: d.name,
    category: d.category,
    website: d.website ?? "",
    tagline: d.sub ?? "",
    kind: "in-depth",
    featured: true,
    listNumber: Number.isInteger(d.n) ? d.n : null,
    lastChecked: d.lastChecked || extra.lastChecked,
    confidence: d.confidence,
    path: d.path,
    verdict: d.headline,
    needGuide: d.needGuide ?? "",
    auth: { model: d.authModel, detail: d.authDetail ?? "", userOAuth: d.userOAuth, access: d.access ?? "" },
    effort: {
      researchRating: d.difficulty,
      timeToFirstTest: d.timeToFirstTest ?? "",
      timeToProduction: d.timeToProduction ?? "",
      firstShort: d.firstShort,
      prodShort: d.prodShort,
    },
    approval: {
      gate: d.productionGate ?? "",
      when: d.review?.when ?? "",
      timeline: Array.isArray(d.review?.timeline) ? d.review.timeline : [],
      recurring: d.review?.recurring ?? "",
    },
    scopes: {
      complexity: extra.scope?.level,
      why: extra.scope?.why ?? "",
      summary: d.scopes ?? "",
      table: Array.isArray(d.scopesTable) ? d.scopesTable : [],
    },
    cost: d.cost ?? "",
    tiers: Array.isArray(d.tiers) ? d.tiers : [],
    prerequisites: toList(d.prereqs),
    registerAt: extra.registerAt ?? d.registerAt ?? null,
    phases: (d.phases ?? []).map((ph) => ({
      name: ph.name,
      duration: ph.duration ?? "",
      ...(extra.gates?.[ph.name] ? { gate: extra.gates[ph.name] } : {}),
      steps: (ph.steps ?? []).map((s) => ({ do: s.do, who: normalizeWho(s.who), agent: s.agent === true })),
    })),
    roles: {
      team: d.roles?.team ?? "",
      console: d.roles?.console ?? "",
      customer: d.roles?.customer ?? "",
      consoleRoles: Array.isArray(d.consoleRoles) ? d.consoleRoles : [],
    },
    customerExperience: toList(d.customer),
    testing: toList(d.testing),
    blockers: (d.blockers ?? []).map((b) =>
      typeof b === "string" ? splitBlocker(b) : { problem: trimStop(b.problem), fix: endStop(b.fix ?? "") },
    ),
    gotchas: toList(d.gotchas),
    automation: { agentCan: d.agentCan ?? "", humanMust: d.humanMust ?? "" },
    uncertain: toList(d.uncertain),
    sources: toSources(d.sources),
  });
}

/** Defensive clamp used when a profile comes from a model rather than the curated research. */
export const clampProfileText = (v, max = 1600) => clampText(v, max);
