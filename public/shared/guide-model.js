/**
 * Domain vocabulary for OAuth Field Guide v3 and the derived fields every guide carries:
 * connection path, effort tier, provider approval, scope complexity and time to production.
 *
 * Pure and isomorphic: imported by the browser app, the Node server, the generator engines
 * and the data scripts, so a card, a guide page and a Markdown export can never disagree.
 */

export const SCHEMA_VERSION = 3;

/** How a developer's end users get connected. The order is "least to most friction", then non-OAuth. */
export const PATHS = Object.freeze({
  self: {
    label: "Self-serve OAuth",
    short: "Self-serve",
    desc: "Register an OAuth app yourself and ship. The provider does not review you.",
  },
  review: {
    label: "OAuth + provider review",
    short: "Review",
    desc: "Build and test yourself, but a provider review or verification gates production.",
  },
  partner: {
    label: "Partner-gated OAuth",
    short: "Partner",
    desc: "No production OAuth credentials until the provider accepts you as a partner.",
  },
  key: {
    label: "Customer API key",
    short: "API key",
    desc: "No OAuth app. Each customer creates an API key or token and pastes it into your product.",
  },
  none: {
    label: "No connector path",
    short: "None",
    desc: "Local tool, no public API, or nothing documented for third-party apps.",
  },
});
export const PATH_ORDER = Object.freeze(["self", "review", "partner", "key", "none"]);
export const OAUTH_PATHS = Object.freeze(["self", "review", "partner"]);
export const isPath = (p) => typeof p === "string" && Object.hasOwn(PATHS, p);

/** The research rates effort on five levels; cards show three (the product brief asked for Easy/Moderate/Complex). */
export const RESEARCH_RATINGS = Object.freeze(["Easy", "Moderate", "Hard", "Very hard", "N/A"]);
export const DIFFICULTY_TIERS = Object.freeze(["Easy", "Moderate", "Complex", "N/A"]);

export function difficultyTier(rating) {
  if (rating === "Easy" || rating === "Moderate") return rating;
  if (rating === "Hard" || rating === "Very hard" || rating === "Complex") return "Complex";
  return "N/A";
}

export const SCOPE_LEVELS = Object.freeze(["Low", "Medium", "High", "N/A"]);
export const CONFIDENCE_LEVELS = Object.freeze(["High", "Medium", "Low"]);
export const WHO = Object.freeze(["Owner", "Developer", "QA", "Security", "Legal", "Design", "Ops"]);
export const normalizeWho = (w) => (WHO.includes(w) ? w : "Developer");
export const GUIDE_KINDS = Object.freeze(["in-depth", "researched", "generated"]);

/**
 * Provider approval: does the provider (not the customer) have to approve the app, or you,
 * before arbitrary outside customers can connect? Customer-side admin approval is reported
 * separately in roles.customer because it is a different queue with a different owner.
 */
export function approvalFor(path, gateText = "") {
  switch (path) {
    case "review":
      return { required: true, kind: "Provider review" };
    case "partner":
      return { required: true, kind: "Partner approval" };
    case "self":
      return {
        required: false,
        // "Optional" only counts next to a listing word, so "(support email optional)" doesn't.
        kind: /(listing|marketplace|app store|directory)[^.]{0,60}\boptional\b|\boptional\b[^.]{0,60}(listing|marketplace|app store|directory)|only (?:for|if|when|needed for)[^.]{0,40}(listing|marketplace|store|directory)/i.test(gateText)
          ? "None (listing optional)"
          : "None",
      };
    case "key":
      return { required: false, kind: "None (customer key)" };
    default:
      return { required: null, kind: "No connector path" };
  }
}

/**
 * "Required", "Not required" or "N/A". A generated guide with no vendor family behind it sets
 * `approval.unconfirmed`: its `required` is then the engine's estimate, not a checked fact,
 * so the label is "Unconfirmed" whatever the estimate says.
 */
export const approvalLabel = (approval) =>
  approval?.unconfirmed === true ? "Unconfirmed" : approval?.required === true ? "Required" : approval?.required === false ? "Not required" : "N/A";

/** The part of approval.kind worth printing after the label: "None" adds nothing, "None (customer key)" → "Customer key". */
export function approvalDetail(approval) {
  const kind = String(approval?.kind ?? "").trim();
  if (!kind || kind === "None" || kind === "No connector path") return "";
  const m = /^None \((.+)\)$/.exec(kind);
  return m ? m[1].charAt(0).toUpperCase() + m[1].slice(1) : kind;
}

/**
 * Rough number of days to production, for "fastest first" sorting. Takes the upper bound of
 * the first range ("1–3 weeks" → 21). Text that says the timeline is unknown sorts last
 * (999) unless it gives a "likely" range, so a partner program with a same-day API-key
 * fallback ("Keys same day; OAuth unknown") never sorts as instant.
 */
export function prodDays(text) {
  const s = String(text ?? "").toLowerCase();
  const RANGE = /(\d+)\s*[–-]?\s*(\d+)?\s*\+?\s*(business days|working days|days|day|weeks|week|wks|months|month)\b/;
  const toDays = (m) => {
    const n = Number(m[2] || m[1]);
    if (m[3].startsWith("w")) return n * 7;
    if (m[3].startsWith("month")) return n * 30;
    return n;
  };
  if (/unknown/.test(s)) {
    const likely = /likely\b([^;)]*)/.exec(s);
    const m = likely ? RANGE.exec(likely[1]) : null;
    return m ? toDays(m) : 999;
  }
  const m = RANGE.exec(s);
  if (m) return toDays(m);
  if (/same day|minutes|under 1 day|hours/.test(s)) return 0.5;
  if (/several weeks/.test(s)) return 28;
  return 999;
}

/** Shorten a long duration to its first clause: "1–3 weeks unlisted (package…)" → "1–3 weeks unlisted". */
export function shortTime(value) {
  const s = String(value ?? "").trim();
  if (!s) return "—";
  let t = s.split(/;|\s\(|\s\|\s|\s·\s/)[0].trim();
  if (t.length > 40) t = t.slice(0, 38).replace(/\s+\S*$/, "") + "…";
  return t;
}

/**
 * The path of a generated guide's share link. It carries the app and intent the guide was
 * generated for, so a link that outlives the server's share store can offer to generate it again.
 */
export function sharePath(id, guide) {
  const q = new URLSearchParams();
  const app = guide?.generation?.input;
  if (typeof app === "string" && app.trim()) q.set("app", app.trim().slice(0, 120));
  if (typeof guide?.generation?.intent === "string") q.set("intent", guide.generation.intent);
  const query = q.toString();
  return `/g/${encodeURIComponent(id)}${query ? `?${query}` : ""}`;
}

/** Every step of a guide, flattened across phases. */
export const allSteps = (g) => (Array.isArray(g?.phases) ? g.phases : []).flatMap((p) => p?.steps ?? []);

/** How much of the plan a human must do versus what an agent can do (the brief's core question). */
export function stepStats(g) {
  const steps = allSteps(g);
  const agent = steps.filter((s) => s.agent === true).length;
  return { total: steps.length, agent, human: steps.length - agent };
}

/** The compact record cards and the list API use. Derived only, never stored. */
export function toSummary(g) {
  return {
    id: g.id,
    name: g.name,
    category: g.category,
    website: g.website,
    tagline: g.tagline,
    kind: g.kind,
    featured: Boolean(g.featured),
    path: g.path,
    pathLabel: PATHS[g.path]?.label ?? "",
    verdict: g.verdict,
    difficulty: g.effort?.difficulty ?? "N/A",
    researchRating: g.effort?.researchRating ?? "N/A",
    approvalRequired: g.approval?.required ?? null,
    approvalKind: g.approval?.kind ?? "",
    approvalAtScale: Boolean(g.approval?.atScale),
    firstShort: g.effort?.firstShort ?? "—",
    prodShort: g.effort?.prodShort ?? "—",
    prodDays: g.effort?.prodDays ?? 999,
    scopeComplexity: g.scopes?.complexity ?? "N/A",
    confidence: g.confidence,
    lastChecked: g.lastChecked,
    steps: stepStats(g),
    blocker: g.blockers?.[0]?.problem ?? "",
  };
}

/**
 * Fill the derived fields of a guide from its facts. Idempotent. Used by the data import,
 * both generator engines and the server before a guide is stored or sent.
 */
export function finalizeGuide(g) {
  const path = isPath(g.path) ? g.path : "none";
  const effort = { ...(g.effort ?? {}) };
  effort.researchRating = RESEARCH_RATINGS.includes(effort.researchRating) ? effort.researchRating : "N/A";
  // No connector path means there is nothing to rate or ship: N/A, sorted last.
  effort.difficulty = path === "none" ? "N/A" : difficultyTier(effort.difficulty ?? effort.researchRating);
  effort.firstShort = effort.firstShort || shortTime(effort.timeToFirstTest);
  effort.prodShort = effort.prodShort || shortTime(effort.timeToProduction);
  effort.prodDays = path === "none" ? 999 : prodDays(effort.prodShort);
  const approval = { ...(g.approval ?? {}) };
  const derived = approvalFor(path, `${approval.gate ?? ""} ${approval.when ?? ""}`);
  approval.required = derived.required;
  approval.kind = approval.kind || derived.kind;
  const scopes = { ...(g.scopes ?? {}) };
  if (!SCOPE_LEVELS.includes(scopes.complexity)) scopes.complexity = path === "none" ? "N/A" : "Medium";
  return { schema: SCHEMA_VERSION, ...g, path, effort, approval, scopes };
}
