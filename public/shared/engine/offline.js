/**
 * The offline research engine: the Live Generator's default agent. No model, no API key.
 *
 * For an app the library covers, it returns the researched guide. For any other app it
 * investigates with what it can check (the vendor family, OAuth discovery metadata when the
 * host provides a probe, and patterns across the 103 researched apps), then drafts a guide
 * in the library's exact format and says which parts are estimates.
 *
 * It is an async generator of events; the server streams them over SSE and the static demo
 * renders them directly. Pure and isomorphic: network access comes in through ctx.probe.
 */
import { PATHS, SCHEMA_VERSION, allSteps, finalizeGuide } from "../guide-model.js";
import { validateGuide } from "../validate.js";
import { wellFormed } from "../text.js";
import { INTENTS, identifyApp, isIntent, isPlausibleHost } from "./identify.js";
import { categoryPrior } from "./patterns.js";

export const OFFLINE_STAGES = Object.freeze([
  { id: "identify", label: "Identify the app" },
  { id: "scan", label: "Scan provider OAuth metadata" },
  { id: "scopes", label: "Analyze OAuth scopes" },
  { id: "approval", label: "Evaluate approval criteria" },
  { id: "draft", label: "Draft the guide" },
  { id: "verify", label: "Quality check" },
]);

const ENGINE = { kind: "offline", label: "Offline research engine" };

/* ------------------------------------------------------------------------------------------ */
/* Small helpers                                                                              */
/* ------------------------------------------------------------------------------------------ */

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (!ms) return resolve();
    if (signal?.aborted) return reject(signal.reason ?? new Error("aborted"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener?.(
      "abort",
      () => {
        clearTimeout(t);
        reject(signal.reason ?? new Error("aborted"));
      },
      { once: true },
    );
  });

const stage = (id, status, summary) => ({ type: "stage", id, status, ...(summary ? { summary } : {}) });
const log = (stageId, text, level = "info") => ({ type: "log", stage: stageId, level, text });
const evidence = (item) => ({ type: "evidence", item });
const step = (text, who, agent) => ({ do: text, who, agent: Boolean(agent) });
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Google search restricted to the vendor's domain (v2's "Check" links). */
export function searchUrl(query, root) {
  const q = encodeURIComponent(wellFormed(query + (root ? ` site:${root}` : ""))).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `https://www.google.com/search?q=${q}`;
}

const bump = (level) => ({ Low: "Medium", Medium: "High", High: "High" })[level] ?? level;
const daysLabel = (d) => (d == null ? "unknown" : d < 1 ? "under a day" : d < 14 ? `~${Math.round(d)} days` : `~${Math.round(d / 7)} weeks`);

/* ------------------------------------------------------------------------------------------ */
/* Decisions                                                                                  */
/* ------------------------------------------------------------------------------------------ */

/**
 * Connection path from the vendor family, the discovery probe and the category prior.
 * `basis` says what the path rests on:
 *   "family"   a researched app on the same developer platform (the only confirmed basis);
 *   "pattern"  a clear majority of researched apps in a category the name or website points to;
 *   "assumed"  neither. The plan then assumes a provider review, the slower common case, so a
 *              wrong guess costs some preparation rather than a missed launch date.
 */
export function resolvePath({ family, familyRel, discovery, prior, category }) {
  const reasons = [];
  let path;
  let basis;
  if (familyRel) {
    path = family.oauth === "self" ? (family.review === "yes" ? "review" : "self") : family.oauth;
    basis = "family";
    reasons.push(`It runs on the same developer platform as ${familyRel.name}, which is “${PATHS[familyRel.path].label}”.`);
  } else if (category && prior.clear) {
    path = prior.path;
    basis = "pattern";
    reasons.push(`${prior.count} of ${prior.total} researched ${category} apps are “${PATHS[prior.path].label}”.`);
  } else {
    path = "review";
    basis = "assumed";
    reasons.push(
      !category
        ? "No category to compare with, so there's no research pattern to borrow. The plan assumes a provider review until someone checks."
        : prior.total
          ? `No clear pattern among ${prior.total} researched ${category} apps (${prior.mix.map((m) => `${m.count} ${PATHS[m.path].short.toLowerCase()}`).join(", ")}), so the plan assumes a provider review until someone checks.`
          : `No researched ${category} apps to compare with, so the plan assumes a provider review until someone checks.`,
    );
  }
  const authServer = discovery?.provider || discovery?.mcp;
  if (authServer && (path === "key" || path === "none")) {
    // The pattern said no OAuth; the metadata says otherwise, so the pattern no longer applies.
    path = "review";
    basis = "assumed";
    reasons.push("OAuth discovery metadata shows a live authorization server, so OAuth is likely available to third parties. Whether the provider reviews apps isn't known, so the plan assumes a review.");
  }
  return { path, basis, estimated: true, reasons };
}

/** Scope complexity from the vendor family, discovery scopes or the category prior, then the agent's intent. */
export function resolveScopes({ familyRel, discovery, prior, category, intent, path }) {
  if (path === "none") return { level: "N/A", why: "No connector path, so no scopes apply." };
  const scopes = discovery?.provider?.scopes?.length ? discovery.provider.scopes : discovery?.mcp?.scopes ?? [];
  let level;
  let why;
  if (familyRel) {
    level = familyRel.scopes.complexity;
    why = `Same scope model as ${familyRel.name}: ${familyRel.scopes.why}`;
  } else if (scopes.length) {
    const broad = scopes.filter((s) => /admin|full|all|\*/i.test(s));
    level = scopes.length > 12 || broad.length ? "Medium" : "Low";
    why = `${plural(scopes.length, "scope")} advertised in the discovery metadata${broad.length ? `, including broad ones (${broad.slice(0, 3).join(", ")})` : ""}.`;
  } else {
    level = prior.scope ?? "Medium";
    why = prior.total
      ? `${prior.scopeCount} of ${prior.total} researched ${category} apps have ${level.toLowerCase()} scope complexity.`
      : "No comparable researched apps; assuming a typical granular scope model.";
  }
  if ((intent === "send" || intent === "admin") && level !== "N/A" && level !== "High") {
    level = bump(level);
    why += " Raised one level: acting as the user or asking for admin access draws extra scrutiny from providers and customer admins.";
  }
  return { level, why };
}

/* ------------------------------------------------------------------------------------------ */
/* Drafting (v2's guide builder, extended with discovery facts and intents)                   */
/* ------------------------------------------------------------------------------------------ */

const SCOPE_ADVICE = {
  read: (a) =>
    `Ask only for read-only scopes covering the data your agent reads. Leave write and admin scopes off. Read-only access is the easiest to get approved by ${a} and by customers' security teams.`,
  write: () =>
    "Ask for read scopes, plus write scopes only for the record types your agent changes. Write one line per scope saying which feature needs it, because reviewers and customer admins ask for this.",
  send: (a) =>
    `Ask for the scope that sends or posts, plus the read scopes needed for context. Acting as the user gets the most scrutiny: expect ${a} or customers' admins to ask how you prevent unwanted messages.`,
  admin: () =>
    "Avoid admin or bulk scopes if per-user scopes can do the job. If you need them, expect admin consent at every customer, a longer review and security questionnaires.",
};

function scopeRows(meta) {
  const kind = (s) =>
    /^(openid|profile|email|address|phone)$/.test(s)
      ? "Identity"
      : /offline/.test(s)
        ? "Refresh tokens"
        : /admin|manage|full|all|\*/i.test(s)
          ? "Admin or broad"
          : /write|create|update|delete|send|post|edit|modify/i.test(s)
            ? "Write"
            : /read|view|get|list|search/i.test(s)
              ? "Read"
              : "Other";
  return (meta?.scopes ?? []).slice(0, 14).map((s) => ({ use: kind(s), scope: s, tier: "Advertised", note: "From discovery metadata; check what each grants" }));
}

function authDetail(discovery, path, a) {
  const m = discovery?.provider ?? discovery?.mcp;
  if (!m) {
    if (path === "key") return `${a} likely authenticates with customer-created API keys or tokens (not confirmed).`;
    if (path === "none") return "No supported authentication for third-party apps was found.";
    return `Likely the OAuth 2.0 authorization code flow (not confirmed for ${a}; no discovery metadata was found).`;
  }
  const parts = [
    `Discovery metadata (${m.kind === "openid-configuration" ? "OpenID Connect Discovery" : "RFC 8414"}) at ${m.url}`,
    m.authorizationEndpoint ? `authorization endpoint ${m.authorizationEndpoint}` : "",
    m.tokenEndpoint ? `token endpoint ${m.tokenEndpoint}` : "",
    m.pkceMethods?.length ? `PKCE methods ${m.pkceMethods.join(", ")}` : "PKCE not advertised",
    m.grantTypes?.length ? `grant types ${m.grantTypes.join(", ")}` : "",
    m.registrationEndpoint ? "dynamic client registration supported" : "",
  ].filter(Boolean);
  return `${parts.join("; ")}.`;
}

/** "Verify before you rely on this": searches restricted to the vendor's domain when it is known. */
export function verifyLinks(app, { path, adminInstall, reviewer = app.name }) {
  const A = app.name;
  const root = app.domainSource && app.domainSource !== "guess" ? app.root : "";
  return [
    ...(app.recognized === false ? [{ label: `Find ${A}'s official website and developer docs`, url: searchUrl(`${A} official website developer API`, "") }] : []),
    { label: `Find ${A}'s OAuth app registration page`, url: searchUrl(`${A} OAuth app client id developer`, root) },
    { label: `Check whether ${reviewer} reviews apps before outside customers connect`, url: searchUrl(`${A} app review requirements publish OAuth`, root) },
    { label: `Look up ${A}'s exact OAuth scope names`, url: searchUrl(`${A} OAuth scopes permissions list`, root) },
    ...(adminInstall ? [{ label: `See how ${A} admins approve third-party apps`, url: searchUrl(`${A} admin approve third-party apps`, root) }] : []),
    ...(path === "key" ? [{ label: `Find where ${A} customers create API keys`, url: searchUrl(`${A} API key settings`, root) }] : []),
    { label: `Check which ${A} plans include API access`, url: searchUrl(`${A} API access pricing plan`, root) },
  ];
}

/**
 * Compose a generated guide from resolved facts. Pure; exported for tests.
 * @returns {object} a v3 guide (finalized)
 */
export function draftGuide(f) {
  const A = f.app.name;
  // Who owns the developer platform, and so registers, reviews and approves apps: the vendor for
  // a family product (Atlassian, not Confluence), otherwise the app itself.
  const R = f.family?.vendor || A;
  const slug = f.app.slug;
  const { path, intent, adminInstall, discovery } = f;
  const oauthPath = path === "self" || path === "review" || path === "partner";
  const listing = f.family?.review === "listing";
  const meta = discovery?.provider ?? discovery?.mcp ?? null;
  const pkce = meta?.pkceMethods?.includes("S256");
  const reviewWeeks = intent === "admin" || intent === "send" ? "4–12 weeks" : "2–8 weeks";
  const advice = SCOPE_ADVICE[intent](A);
  const firstSentence = advice.split(". ")[0] + ".";
  // Only a vendor family confirms how the provider treats apps. Anything else is an estimate
  // ("pattern") or a planning assumption ("assumed"), and the guide must say which.
  const confirmed = Boolean(f.familyRel);
  // "assumed" always means a planned review; any other unconfirmed path is a hedged estimate.
  const basis = confirmed ? "family" : path === "review" && f.basis !== "pattern" ? "assumed" : "pattern";
  const recognized = f.app.recognized !== false;
  const cat = f.app.category;
  const pattern = basis === "pattern" && f.prior?.total && cat ? `${f.prior.count} of ${f.prior.total} researched ${cat} apps` : "most similar apps";
  const Pattern = pattern.charAt(0).toUpperCase() + pattern.slice(1);

  const phases = [];
  if (!recognized) {
    phases.push({
      name: "Confirm the app",
      duration: "30 min",
      steps: [
        step(`Find ${A}'s official website and developer docs, and check it's the app you mean. Nothing in this plan is specific to ${A} yet.`, "Developer", true),
        step(
          `Find out how third-party apps connect to ${A}: an OAuth app you register, a partner program, customer API keys, or no API at all. If you find its website, run the generator again with that address.`,
          "Developer",
          true,
        ),
      ],
    });
  }
  if (path === "self" || path === "review") {
    phases.push({
      name: "Find the developer portal",
      duration: "15 min",
      steps: [
        step(
          f.familyRel
            ? `Use the shared developer platform: ${f.family.note}`
            : `Find ${A}'s developer docs and the page for creating an OAuth app. Start with the links under “Verify before you rely on this”, or look for Developers, API or Integrations in ${A}'s footer and settings.`,
          "Developer",
          true,
        ),
        ...(path === "review"
          ? [
              step(
                `Before building, read ${R}'s review or verification rules. Note what they ask for: demo video, test account, security questionnaire, minimum installs, business documents.`,
                "Owner",
                true,
              ),
            ]
          : []),
        step(
          `Sign in with a company-owned ${R} account with MFA on (not a personal login), then open the developer area. It's often under Settings → Developers or Integrations, or on a separate developer site.`,
          "Owner",
          false,
        ),
      ],
    });
    phases.push({
      name: "Register the OAuth app",
      duration: "30–60 min",
      steps: [
        step("Create a new app or OAuth client. Use your product's name and logo, and add your homepage, privacy policy and terms URLs.", "Developer", false),
        step(
          `Add the redirect URIs https://app.yourco.com/oauth/${slug}/callback (production) and https://staging.yourco.com/oauth/${slug}/callback (staging). Add localhost only if the portal accepts it.`,
          "Developer",
          true,
        ),
        step(firstSentence, "Developer", true),
        step("Copy the client ID and secret into your secrets vault straight away. Many portals show the secret only once.", "Security", false),
        ...(adminInstall
          ? [step("Turn on the setting that lets other workspaces install your app. It's often called distribution, public, multi-tenant or “any account”.", "Developer", false)]
          : []),
        step("If the portal supports collaborators, add a second owner from your company.", "Owner", false),
      ],
    });
  } else if (path === "partner") {
    phases.push({
      name: "Apply for access",
      duration: "Days to weeks",
      gate: "required",
      steps: [
        step(`Find ${R}'s partner or developer-access program. Check whether it covers OAuth credentials, a sandbox and a marketplace listing.`, "Owner", true),
        step(
          "Apply with your use case, the data you need, the number of customers you expect and your security setup. If there's no form, send the vendor email below.",
          "Owner",
          false,
        ),
        step("Ask for a sandbox while you wait. Get revenue share, certification and timelines in writing before you sign.", "Legal", false),
      ],
    });
    phases.push({
      name: "Register and configure",
      duration: "1 hour",
      steps: [
        step(`In the app area ${R} gives you, add the redirect URIs https://app.yourco.com/oauth/${slug}/callback plus your staging one.`, "Developer", true),
        step(firstSentence, "Developer", true),
        step("Store the client ID and secret in your secrets vault.", "Security", false),
      ],
    });
  }
  if (oauthPath) {
    phases.push({
      name: "Build the connection",
      duration: "1–3 days",
      steps: [
        step(
          `Implement the authorization code flow with a random state value, plus PKCE${pkce ? " (S256 is advertised in the discovery metadata)" : ` if ${R} supports it`}. Exchange the code on your server${meta?.tokenEndpoint ? ` at ${meta.tokenEndpoint}` : ""}.`,
          "Developer",
          true,
        ),
        adminInstall
          ? step("Store one encrypted token set per customer workspace. Delete it when you receive the uninstall or revoke event.", "Developer", true)
          : step(`Store access and refresh tokens per user, encrypted. Refresh one request at a time, and save the new refresh token if ${R} rotates it.`, "Developer", true),
        step(`When a call fails with 401 or invalid_grant, mark the connection as broken and show a “Reconnect ${A}” button instead of retrying.`, "Developer", true),
      ],
    });
    phases.push({
      name: "Test",
      duration: "1 day",
      steps: [
        step(`Connect from a second ${A} account that your team doesn't administer. Test approve, deny, revoke and reconnect.`, "QA", false),
        ...(adminInstall ? [step("Test as a member without admin rights. Write down what they see and how they ask their admin.", "QA", false)] : []),
      ],
    });
  }
  if (path === "review") {
    phases.push({
      name: "Get approved",
      duration: reviewWeeks,
      gate: "required",
      steps: [
        step(
          `Write the privacy policy section for ${A} data (what you read, store, for how long, and how users delete it) and one line justifying each scope.`,
          "Legal",
          true,
        ),
        step(
          "Record a demo video that shows connect → consent → each scope in use → disconnect. Create a reviewer account with sample data and no 2FA wall.",
          "QA",
          false,
        ),
        step("Submit for review. Reply on the same email thread and expect at least one round of changes.", "Owner", false),
        step("Keep a staging app for future changes, because new scopes usually mean another review.", "Developer", true),
      ],
    });
  }
  if (path === "partner") {
    phases.push({
      name: "Certify and launch",
      duration: "1–4 weeks",
      steps: [
        step("Complete any certification or listing review using a reviewer account with sample data.", "QA", false),
        step("Write a one-page customer guide: what the agent accesses, who approves it, how to disconnect.", "Ops", true),
      ],
    });
  } else if (path === "self" || path === "review") {
    phases.push({
      name: "Launch",
      duration: "1 day",
      steps: [
        step(`Write a one-page customer guide: what the agent accesses, who ${adminInstall ? "installs it" : "approves it"}, how to disconnect.`, "Ops", true),
        ...(path === "self" && listing
          ? [step("Optional: submit a marketplace listing later so customers can find you. They don't need it to connect.", "Owner", false)]
          : []),
      ],
    });
  }
  if (path === "key") {
    phases.push({
      name: "Confirm how keys work",
      duration: "15 min",
      steps: [
        step(`Find where ${A} customers create API keys. Note which plans and roles can create them, and whether a key can be limited to read-only.`, "Developer", true),
        step("Check whether calls also need a subdomain, region, account ID or base URL.", "Developer", true),
      ],
    });
    phases.push({
      name: "Build the connect form",
      duration: "1 day",
      steps: [
        step(`Add a “Connect ${A}” form where the customer pastes the key, plus the subdomain or region if needed. Say exactly where to find it.`, "Developer", true),
        step("Store the key encrypted, never log it, and show only its last 4 characters.", "Security", true),
        step("Validate it immediately with one read-only call, such as the current user, and show a clear success or error message.", "Developer", true),
        step("If a later call returns 401 or 403, mark the connection as broken and ask for a new key. Let customers delete their key at any time.", "Developer", true),
      ],
    });
    phases.push({
      name: "Test and launch",
      duration: "Half a day",
      steps: [
        step("Test with a key from a non-admin user and from a free or trial plan.", "QA", false),
        step("Write customer instructions: who can create the key, which access to choose, how to revoke it.", "Ops", true),
      ],
    });
  }
  if (path === "none") {
    phases.push({
      name: "Confirm there's no API",
      duration: "30 min",
      steps: [
        step(`Check ${A}'s docs and help center for an API, webhooks, an MCP server or Zapier/Make integrations.`, "Developer", true),
        step(`If none exists, email ${A} to ask whether API or partner access is planned (a draft is below).`, "Owner", false),
      ],
    });
    phases.push({
      name: "Pick a fallback",
      duration: "Varies",
      steps: [
        step("Use what exists: CSV export and import, email forwarding, webhooks or an automation integration.", "Owner", false),
        step("Avoid scraping or automating logins. It usually breaks the terms of service and fails without warning.", "Legal", false),
      ],
    });
  }
  const mcp = discovery?.mcp;
  if (mcp?.registrationEndpoint) {
    phases.push({
      name: `Alternative: ${A}'s hosted MCP server`,
      duration: "Hours",
      steps: [
        step(
          `Point your agent's MCP client at ${A}'s MCP server (${mcp.resource || mcp.issuer}). Its authorization server supports dynamic client registration (RFC 7591), so the client registers itself: no developer-console app is needed.`,
          "Developer",
          true,
        ),
        step("Connect with a test account and list the tools it exposes. MCP servers often cover less than the REST API.", "QA", false),
        step(
          `Check that ${A} allows its MCP server to be used by a backend agent that serves many customers. Some vendors limit theirs to interactive clients or a single account.`,
          "Owner",
          false,
        ),
      ],
    });
  }

  const steps = phases.flatMap((p) => p.steps);
  const needGuide = !recognized
    ? `Yes, as a starting point. Confirm what ${A} offers first; until then, plan for the slower common path, OAuth with a provider review.`
    : {
        self: confirmed
          ? `Short one: ${steps.length} steps, and most of the time goes into the OAuth code, not approvals.`
          : `Probably a short one (${steps.length} steps), unless ${A} reviews apps. Check that first.`,
        review: basis === "assumed" ? "Yes. Start the review prep early: if there is a review, it sets your launch date." : "Yes. Start the review prep early, because it sets your launch date.",
        partner: `Yes. Send the application today; everything else waits on ${R}'s answer.`,
        key: `No OAuth guide needed. ${steps.length} steps to collect, store and validate keys safely.`,
        none: `No. There's nothing to set up until ${R} offers access.`,
      }[path];

  // Confirmed by a vendor family: the family's facts, stated as likely.
  const FAMILY_VERDICT = {
    self: `self-serve OAuth. Register an app in ${R}'s developer portal and ship, with no review by ${R}${adminInstall ? ", though each customer's admin installs it for their workspace" : ""}.`,
    review: `OAuth with an approval step. You build and test on your own, but ${R} reviews or verifies the app before outside customers can connect. Plan ${reviewWeeks}.`,
    partner: `partner-gated. Apply to ${R} first: you won't get OAuth credentials until they approve you.`,
    key: `no OAuth app needed. Each customer creates an API key or token in ${A} and pastes it into your product.`,
    none: `no way for third-party apps to connect was found. Use exports, webhooks or an existing integration, and ask ${R} about API access.`,
  };
  // Estimated from a category pattern: what similar apps do, never stated as a fact about this one.
  const PATTERN_VERDICT = {
    self: `self-serve OAuth: ${pattern} let developers register an app and ship without a provider review. That isn't confirmed for ${A}, so check it before you commit to a launch date${adminInstall ? ". Each customer's admin likely installs the app for their workspace" : ""}.`,
    review: `OAuth with an approval step: ${pattern} have a provider review. Plan ${reviewWeeks} for ${A}'s review; whether there is one isn't confirmed.`,
    partner: `partner-gated: ${pattern} need a partner agreement before you get OAuth credentials. Apply to ${A} first; this isn't confirmed for ${A}.`,
    key: `no OAuth app needed: ${pattern} use customer API keys or tokens. Check that ${A} works this way before you build the connect form.`,
    none: FAMILY_VERDICT.none,
  };
  let verdict;
  if (basis === "assumed")
    verdict = recognized
      ? `Plan for OAuth with a provider review. Whether ${A} reviews apps isn't confirmed, so the plan takes the slower path: build and test on your own, then allow ${reviewWeeks} for ${A}'s review before outside customers connect.`
      : `Not recognized. ${A} doesn't match a researched app, a vendor family or a category, so this is a generic plan: confirm how third-party apps connect to ${A}, and plan for a provider review (${reviewWeeks}) until you know otherwise.`;
  else verdict = `${recognized ? "" : "Not recognized. "}Likely ${(basis === "family" ? FAMILY_VERDICT : PATTERN_VERDICT)[path]}`;

  const times = confirmed
    ? [f.familyRel.effort.firstShort, f.familyRel.effort.prodShort, f.familyRel.effort.researchRating]
    : {
        // A review isn't ruled out, so neither "Easy" (no provider queue) nor a bare 1–3 days.
        self: ["30–90 min", "1–3 days + any review", "Moderate"],
        review: ["1–2 hours", reviewWeeks, intent === "admin" ? "Very hard" : "Hard"],
        partner: ["After approval", "4–12+ weeks", "Hard"],
        key: ["15–30 min", "Same day–2 days", "Easy"],
        none: ["—", "—", "N/A"],
      }[path];

  const prereqs = oauthPath
    ? [
        `A company-owned ${R} account with MFA.`,
        "A homepage, privacy policy and terms on your domain.",
        "An HTTPS callback URL and a secrets vault.",
        `A second ${A} account for testing.`,
        ...(path === "partner" ? ["A one-paragraph use case for the application."] : []),
      ]
    : path === "key"
      ? [`Knowing which ${A} plans include API access.`, "Encrypted storage for customer keys."]
      : [];

  const roles = oauthPath
    ? {
        team: `An owner holds the ${R} developer account and gets ${R}'s emails. A developer registers and builds the app. Security keeps the secret. Legal writes the privacy policy and terms. QA tests with a second account${path === "review" ? " and records the demo" : ""}.`,
        console: `If ${R}'s portal supports collaborators, add at least two company owners. If it doesn't, use a shared company account with MFA and store the recovery codes safely.`,
        customer: adminInstall
          ? `An admin at each customer likely installs or approves the app for the workspace; members may only be able to request it.`
          : `Each user approves the connection on ${R}'s consent screen. Enterprise admins may block or pre-approve apps.`,
        consoleRoles: [],
      }
    : path === "key"
      ? {
          team: "A developer builds the connect form and validation, Security owns key storage, and Support writes the instructions.",
          console: `None. Nothing is registered with ${A}.`,
          customer: "Someone allowed to create API keys, often an admin, creates a key and pastes it into your product.",
          consoleRoles: [],
        }
      : { team: `An owner contacts ${A}, and Legal checks any fallback against the terms.`, console: "None.", customer: "", consoleRoles: [] };

  const testing = oauthPath
    ? [
        `Use a second ${A} account that your team doesn't administer as the “customer”.`,
        `Check whether ${R} offers a sandbox or developer account.`,
        "Test approve, deny, revoke and reconnect.",
        ...(adminInstall ? ["Test as a non-admin to see the request or blocked path."] : []),
        ...(path === "review" || path === "partner" ? ["Keep a reviewer account with sample data and no 2FA wall."] : []),
      ]
    : path === "key"
      ? ["Create test keys on a trial account, and check what a non-admin's key can and can't do."]
      : [];

  const gate = confirmed
    ? {
        self: `${R} isn't expected to review your app before customers connect${listing ? "; a marketplace listing is optional" : ""}. Customers' admins may still need to approve it.`,
        review: `${R} likely reviews or verifies your app before people outside your company can connect. Plan ${reviewWeeks} and at least one resubmission.`,
        partner: `You likely need ${R}'s approval or a partner agreement before you get OAuth credentials.`,
        key: `No approval from ${R}. Each customer needs a plan with API access and permission to create keys.`,
        none: "There's no supported way for third-party apps to connect.",
      }[path]
    : {
        self: `Not confirmed. ${Pattern} let developers ship without a provider review, but ${A}'s rules weren't checked: look for a review, verification or production-access step before you set a date. Customers' admins may still need to approve the app.`,
        review:
          basis === "assumed"
            ? `Not confirmed. Plan as if ${A} reviews or verifies your app before people outside your company can connect: ${reviewWeeks} and at least one resubmission. If ${A} turns out not to review apps, you launch sooner.`
            : `Not confirmed. ${Pattern} have a provider review, so plan ${reviewWeeks} and at least one resubmission before people outside your company can connect to ${A}.`,
        partner: `Not confirmed. You likely need ${A}'s approval or a partner agreement before you get OAuth credentials.`,
        key: `Not confirmed. ${Pattern} use customer API keys, which need no approval from the provider; each customer needs a plan with API access and permission to create keys.`,
        none: "Not confirmed. No supported way for third-party apps to connect was found.",
      }[path];
  // Shown after "Unconfirmed", so it says what the plan assumes rather than what is true.
  const unconfirmedKind = {
    self: "Similar apps need none",
    review: "Plan for a provider review",
    partner: "Plan for partner approval",
    key: "Similar apps use customer keys",
    none: "No connector path found",
  }[path];

  const blockers = [];
  if (oauthPath) {
    blockers.push({
      problem: "Redirect URI mismatch",
      fix: "Register the exact production URL, including the path and any trailing slash, and send the same value in the token request.",
    });
    blockers.push({ problem: "Refresh tokens stop working", fix: "Refresh one request at a time per connection and always save the newest refresh token." });
  }
  if (oauthPath && adminInstall) blockers.push({ problem: "Members can't install", fix: "Show an “Ask your admin” message that links to your customer admin guide." });
  if (path === "review") {
    blockers.push({ problem: "Review rejected for missing evidence", fix: "Show the whole flow and every scope in the video, and give reviewers a working test account." });
    blockers.push({ problem: "Scopes broader than needed", fix: "Drop anything the shipped feature doesn't use, and ask for more later." });
  }
  if (path === "partner") blockers.push({ problem: "Application gets no reply", fix: "Follow up after 5 business days, ask for a named contact, and keep building against a sandbox." });
  if (oauthPath && intent === "send") blockers.push({ problem: "Sending as the user gets flagged", fix: "Show users what will be sent, respect rate limits, and send only on an explicit action." });
  if (oauthPath && meta && !pkce) blockers.push({ problem: "PKCE isn't advertised in the discovery metadata", fix: "Keep the client secret server-side and test whether the token endpoint accepts code_verifier anyway." });
  if (path === "key") {
    blockers.push({ problem: "Customer can't find or create a key", fix: "Link to the exact settings page, and say which role or plan is needed." });
    blockers.push({ problem: "Key has more access than needed", fix: "Ask for a read-only or scoped key, and explain how to revoke it." });
    blockers.push({ problem: "Wrong region or subdomain", fix: "Ask for the account URL in the form and validate it with a test call." });
  }

  const tiers = [];
  if (oauthPath) {
    tiers.push({
      label: PATHS[path].label,
      eg: "Your agent's customers connect their own accounts",
      difficulty: times[2] ?? "N/A",
      time: times[1] ?? "—",
      note:
        path === "self"
          ? confirmed
            ? "Estimated from similar apps; no provider review expected."
            : "Estimated from similar apps; a provider review isn't ruled out."
          : basis === "assumed"
            ? "Assumes an approval wait, which isn't confirmed."
            : "Estimated from similar apps; includes an approval wait.",
    });
  }
  if (mcp?.registrationEndpoint) {
    tiers.push({
      label: "Vendor-hosted MCP server",
      eg: "Agent connects through MCP",
      difficulty: "Easy",
      time: "Hours",
      note: "Dynamic client registration is advertised, so there's no console app to create. Check the vendor's terms for backend use.",
    });
  }

  const scopeTable = scopeRows(meta);
  const sources = [discovery?.provider, discovery?.mcp]
    .filter(Boolean)
    .map((m) => ({ url: m.url, label: `${m.kind === "openid-configuration" ? "OpenID Connect Discovery" : "OAuth authorization server metadata"} (${new URL(m.url).hostname})` }));

  const verify = verifyLinks(f.app, { path, adminInstall, reviewer: R });

  const vendorEmail =
    path === "partner" || path === "none" || !f.familyRel
      ? `Subject: OAuth access for a third-party integration with ${A}

Hi ${A} team,

We're building an AI assistant that lets our customers connect their own ${A} accounts. Our agent will ${INTENTS[intent].phrase} for each connected ${adminInstall ? "workspace" : "user"}.

Could you help with three questions?
1. Can third-party developers register an OAuth app (client ID and secret) themselves, or do we need to apply or join a partner program first?
2. Is there a review, security assessment or marketplace approval before customers outside our company can connect?
3. Is there a sandbox or test account, and how long does it typically take to go from application to production?

Thanks,
[Your name], [Company]`
      : "";

  return finalizeGuide({
    schema: SCHEMA_VERSION,
    id: slug,
    name: A,
    category: f.app.category || "Uncategorized",
    website: f.app.website || (f.app.domainSource === "guess" ? "" : f.app.root),
    tagline: "",
    kind: "generated",
    featured: false,
    listNumber: null,
    lastChecked: f.now.toISOString().slice(0, 10),
    confidence: f.confidence,
    path,
    verdict,
    needGuide,
    auth: {
      model: path === "key" ? "API key / token only" : path === "none" ? "Other" : path === "partner" ? "OAuth 2.0 (partner-gated)" : "OAuth 2.0",
      detail: authDetail(discovery, path, A),
      userOAuth: path === "self" || path === "review" ? "yes" : path === "partner" ? "partner-only" : "no",
      access: { self: "Self-serve", review: "Application/approval required", partner: "Partner program required" }[path] ?? "Not offered",
    },
    effort: { researchRating: times[2] ?? "N/A", timeToFirstTest: times[0], timeToProduction: times[1], firstShort: times[0], prodShort: times[1] },
    approval: { gate, when: "", timeline: [], recurring: "", ...(confirmed ? {} : { kind: unconfirmedKind, unconfirmed: true }) },
    scopes: { complexity: f.scope.level, why: f.scope.why, summary: oauthPath ? advice : "", table: scopeTable },
    cost: oauthPath ? "Usually free to register; API access may need a paid plan." : path === "key" ? "Depends on the customer's plan." : "",
    tiers,
    prerequisites: prereqs,
    registerAt: null,
    phases,
    roles,
    customerExperience: [],
    testing,
    blockers,
    gotchas: [],
    automation: {
      agentCan: oauthPath
        ? "Find and summarize the developer docs, draft the app description, privacy text and scope justifications, write the OAuth and refresh code, script tests, and draft the customer guide."
        : path === "key"
          ? "Write the connect form, encrypted storage, validation call and error handling, and draft customer instructions."
          : "Search the docs and draft the vendor email.",
      humanMust: oauthPath
        ? `Sign in to ${R}, create the app, copy secrets, accept the terms${path === "review" ? ", record the demo, submit the review" : ""}${path === "partner" ? ", apply and sign the partner agreement" : ""}, and test consent with real accounts.`
        : path === "key"
          ? "Customers create their own keys, and your QA tests with real accounts."
          : "Contact the vendor and choose a fallback.",
    },
    uncertain: [
      !recognized
        ? `${A} wasn't recognized: it doesn't match a researched app, a vendor family or a category, so the path, times and scopes are a generic plan.`
        : basis === "family"
          ? `The connection path is estimated from ${f.familyRel.name}, which shares ${A}'s developer platform; nobody has researched ${A} itself.`
          : basis === "pattern"
            ? `The connection path is estimated from similar ${cat ? `${cat} ` : ""}apps; nobody has researched ${A} itself.`
            : `The connection path is a planning assumption: no researched pattern fits ${A}, so the plan assumes a provider review. Nobody has researched ${A} itself.`,
      ...(confirmed
        ? []
        : [
            `Whether ${A} reviews apps before outside customers connect isn't confirmed.${path === "self" ? ` If it does, add ${reviewWeeks}.` : path === "review" ? " If it doesn't, you launch sooner." : ""}`,
          ]),
      `Console labels, exact scope names and review timelines for ${A} weren't researched.`,
      ...(f.app.domainSource === "guess" ? [`The website ${f.app.root} was guessed from the name. Paste ${A}'s real address for a better scan.`] : []),
    ],
    sources,
    generation: {
      engine: ENGINE.kind,
      engineLabel: ENGINE.label,
      model: null,
      input: f.app.raw,
      intent,
      generatedAt: f.now.toISOString(),
      evidence: f.evidence,
      verify,
      vendorEmail,
      similar: f.similar,
    },
  });
}

/* ------------------------------------------------------------------------------------------ */
/* The run: stages shared with the live engine, then the offline-only stages                  */
/* ------------------------------------------------------------------------------------------ */

/** Pacing, evidence collection and timing for one run. */
export function createRun(ctx) {
  const pace = Number.isFinite(ctx.pace) ? ctx.pace : 1;
  const found = [];
  return {
    started: Date.now(),
    now: ctx.now ? ctx.now() : new Date(),
    found,
    wait: (ms) => sleep(Math.round(ms * pace), ctx.signal),
    note(item) {
      found.push(item);
      return evidence(item);
    },
  };
}

/**
 * Stage "identify". Returns { app, guide } where guide is the researched guide when the
 * library already covers the app (the run should then stop generating).
 */
export async function* identifyStage({ input, ctx, run }) {
  const { lib, getGuide, categories } = ctx;
  yield stage("identify", "running");
  yield log("identify", `Parsing “${String(input)}”…`);
  await run.wait(350);
  const app = identifyApp(input, lib, categories);
  // The library index holds summaries; the family's full guide carries its scopes, times and roles.
  if (app.familyRel) app.familyRel = getGuide(app.familyRel.id) ?? null;
  if (!app.familyRel) app.family = null;
  if (app.match) {
    const guide = getGuide(app.match.id);
    yield log("identify", `Found ${guide.name} in the research library (${guide.kind === "in-depth" ? "in-depth guide" : "researched profile"}, checked ${guide.lastChecked}, ${plural(guide.sources.length, "source")}).`, "success");
    yield run.note({ kind: "library", label: `Researched guide: ${guide.name}`, detail: `${guide.confidence} confidence, checked ${guide.lastChecked}` });
    yield stage("identify", "done", `${guide.name} · in the library`);
    await run.wait(250);
    return { app, guide };
  }
  yield log("identify", `No exact match among ${lib.apps.length} researched apps.`);
  if (app.domainOwner) {
    yield log("identify", `${app.root} belongs to ${app.domainOwner.name}, which is in the library. A page on its site is usually another product; open the ${app.domainOwner.name} guide if you meant ${app.domainOwner.name}.`, "warn");
  }
  if (app.similar.length) yield log("identify", `Closest researched apps: ${app.similar.map((s) => s.name).join(", ")}.`);
  if (app.familyRel) {
    yield log("identify", `Vendor family: ${app.familyRel.name}'s developer platform (${app.family.domain}).`, "success");
    yield run.note({ kind: "family", label: `Shares ${app.familyRel.name}'s developer platform`, detail: app.family.note });
  }
  if (app.category) {
    const categoryHow = { family: `from ${app.familyRel?.name}`, keywords: "from a keyword in the name or website", library: "from the library" }[app.categorySource];
    yield log("identify", `Category: ${app.category} (${categoryHow}).`);
  }
  if (!app.recognized) {
    yield log("identify", `Not recognized: no researched app, vendor family or category keyword matches “${app.name}”. The draft will be a generic plan.`, "warn");
  } else if (!app.category) {
    yield log("identify", `No researched app, vendor family or category keyword matches ${app.name}, so the draft works from the website you gave.`);
  }
  if (app.root) {
    const guessed = app.domainSource === "guess";
    yield log("identify", `Domain: ${app.root}${guessed ? " (guessed from the name; paste the real URL for a better scan)" : ""}.`, guessed ? "warn" : "info");
  }
  yield stage("identify", app.recognized ? "done" : "warn", `${app.name} · ${app.recognized ? (app.category ?? app.root) : "not recognized"}`);
  await run.wait(300);
  return { app, guide: null };
}

/** Stage "scan": the OAuth discovery probe, when the host provides one. Returns the probe result or null. */
export async function* scanStage({ app, ctx, run, stageId = "scan" }) {
  const { probe, signal } = ctx;
  yield stage(stageId, "running");
  let discovery = null;
  if (ctx.discovery) {
    discovery = ctx.discovery;
    yield log(stageId, "Reusing the OAuth metadata probe from earlier in this run.");
  } else if (!probe) {
    yield log(stageId, ctx.probeOffNote ?? "This build can't make network requests, so the agent relies on research patterns.", "warn");
    yield stage(stageId, "skipped", ctx.probeOffNote ? "Probing turned off" : "No network in this build");
    return null;
  } else if (!app.root || !isPlausibleHost(app.root)) {
    yield log(stageId, "No usable website to probe. Add the app's URL to check its OAuth metadata.", "warn");
    yield stage(stageId, "skipped", "No website to probe");
    return null;
  } else {
    yield log(stageId, `Probing ${app.root} for OAuth metadata: OpenID Connect Discovery, RFC 8414 authorization server metadata and RFC 9728 protected resource metadata (MCP)…`);
    try {
      discovery = await probe({ root: app.root, host: app.host, signal });
    } catch (err) {
      if (signal?.aborted) throw err;
      yield log(stageId, `Probe failed: ${err?.message ?? err}`, "warn");
    }
    const checked = discovery?.checked ?? [];
    const answered = checked.filter((c) => ["found", "missing", "invalid"].includes(c.outcome));
    if (checked.length && !answered.length) {
      yield log(stageId, `Couldn't reach ${app.root} or its auth subdomains (${plural(checked.length, "request")} failed). This server may not have outbound internet access.`, "warn");
      yield stage(stageId, "warn", "Provider unreachable");
      await run.wait(300);
      return discovery;
    }
    for (const c of checked) {
      const msg = { found: "found", missing: "not found", error: "unreachable", blocked: "blocked (non-public address)", timeout: "timed out", invalid: "not valid metadata", skipped: "skipped (time budget)" }[c.outcome] ?? c.outcome;
      yield log(stageId, `${c.url} → ${msg}${c.status ? ` (HTTP ${c.status})` : ""}`, c.outcome === "found" ? "success" : "info");
    }
  }
  for (const m of [discovery?.provider, discovery?.mcp].filter(Boolean)) {
    const facts = [
      m.pkceMethods?.includes("S256") ? "PKCE S256" : "no PKCE advertised",
      m.registrationEndpoint ? "dynamic client registration" : "no dynamic registration",
      m.scopes?.length ? plural(m.scopes.length, "scope") : "no scopes listed",
    ];
    yield run.note({ kind: "discovery", label: `${m === discovery.mcp ? "MCP authorization server" : "OAuth authorization server"} metadata`, detail: facts.join(", "), url: m.url });
  }
  const hit = discovery?.provider || discovery?.mcp;
  if (hit && app.domainSource === "guess") yield log(stageId, `${app.root} was guessed from the name, so confirm this metadata belongs to ${app.name} before trusting it.`, "warn");
  yield stage(stageId, hit ? "done" : "warn", hit ? "OAuth metadata found" : "No OAuth metadata published");
  await run.wait(300);
  return discovery;
}

/** Finish a run that found the app in the library: skip the remaining stages and return the researched guide. */
export function* libraryResult(guide, stages, run) {
  for (const s of stages.slice(1)) yield stage(s.id, "skipped", "Using the researched guide");
  yield { type: "guide", guide, matched: true };
  yield { type: "done", ms: Date.now() - run.started };
}

/**
 * @param {object} opts
 * @param {string} opts.input        app name or URL
 * @param {string} [opts.intent]     read | write | send | admin
 * @param {object} opts.ctx          { lib, getGuide(id), patterns, categories, probe?, discovery?, pace?, signal?, now? }
 */
export async function* runOfflineAgent({ input, intent: rawIntent, ctx }) {
  const intent = isIntent(rawIntent) ? rawIntent : "write";
  const { patterns } = ctx;
  const run = createRun(ctx);

  yield { type: "run", engine: ENGINE, stages: OFFLINE_STAGES, input: { app: String(input), intent } };

  /* 1. Identify */
  const { app, guide: researched } = yield* identifyStage({ input, ctx, run });
  if (researched) {
    yield* libraryResult(researched, OFFLINE_STAGES, run);
    return;
  }

  /* 2. Scan OAuth metadata */
  const discovery = yield* scanStage({ app, ctx, run });

  /* 3. Scopes */
  yield stage("scopes", "running");
  const prior = categoryPrior(patterns, app.category);
  const pathDecision = resolvePath({ family: app.family, familyRel: app.familyRel, discovery, prior, category: app.category });
  const scope = resolveScopes({ familyRel: app.familyRel, discovery, prior, category: app.category, intent, path: pathDecision.path });
  yield log("scopes", `Agent intent: ${INTENTS[intent].label.toLowerCase()}.`);
  const advertised = discovery?.provider?.scopes?.length ? discovery.provider.scopes : discovery?.mcp?.scopes ?? [];
  if (advertised.length) yield log("scopes", `Advertised scopes: ${advertised.slice(0, 8).join(", ")}${advertised.length > 8 ? ` and ${advertised.length - 8} more` : ""}.`);
  yield log("scopes", `Scope complexity: ${scope.level}. ${scope.why}`, "success");
  yield run.note({ kind: "scopes", label: `Scope complexity ${scope.level}`, detail: scope.why });
  yield stage("scopes", "done", `Scope complexity: ${scope.level}`);
  await run.wait(350);

  /* 4. Approval */
  yield stage("approval", "running");
  for (const r of pathDecision.reasons) yield log("approval", r);
  if (!app.familyRel && prior.total) {
    yield run.note({
      kind: "pattern",
      label: `Category pattern: ${app.category}`,
      detail: prior.clear
        ? `${prior.count} of ${prior.total} researched apps are ${PATHS[prior.path].label}${prior.examples.length ? ` (e.g. ${prior.examples.map((e) => e.name).join(", ")})` : ""}`
        : `No clear pattern: ${prior.mix.map((m) => `${m.count} ${PATHS[m.path].label}`).join(", ")}`,
    });
  }
  const adminInstall = intent === "admin" || (app.familyRel ? /\b(admin|owner)/i.test(app.familyRel.roles?.customer ?? "") : prior.adminInstallLikely);
  if (adminInstall) {
    yield log(
      "approval",
      app.familyRel
        ? `Customer side: ${app.familyRel.name} gives customer admins control over app installs, so ${app.name} likely does too.`
        : `Customer side: ${prior.adminInstallCount} of ${prior.oauthCount} researched ${app.category} OAuth apps give customer admins or owners control over installs, so plan for admin approval.`,
    );
  }
  const median = patterns.byPath[pathDecision.path]?.medianProdDays;
  const how = { family: "likely", pattern: "likely, not confirmed", assumed: "assumed, not confirmed" }[pathDecision.basis];
  yield log("approval", `Connection path: ${PATHS[pathDecision.path].label} (${how}). Researched apps on this path reach production in ${daysLabel(median)} (median).`, "success");
  if (pathDecision.basis !== "family") {
    yield log("approval", `Provider approval: unconfirmed. No researched app shares ${app.name}'s developer platform, so nothing here confirms whether ${app.name} reviews apps.`, "warn");
  }
  const outcome = {
    family: `${PATHS[pathDecision.path].label} (likely)`,
    pattern: `Unconfirmed · likely ${{ self: "self-serve", review: "review", partner: "partner-gated", key: "API key", none: "no path" }[pathDecision.path]}`,
    assumed: "Unconfirmed · plan for a review",
  }[pathDecision.basis];
  yield stage("approval", pathDecision.basis === "family" ? "done" : "warn", outcome);
  await run.wait(350);

  /* 5. Draft */
  yield stage("draft", "running");
  // Discovery on a guessed domain might be someone else's server, so it doesn't raise confidence.
  const metadataFound = Boolean(discovery?.provider || discovery?.mcp) && app.domainSource !== "guess";
  const confidence = app.familyRel || metadataFound ? "Medium" : "Low";
  const guide = draftGuide({
    app,
    intent,
    path: pathDecision.path,
    basis: pathDecision.basis,
    prior,
    adminInstall,
    discovery,
    scope,
    family: app.family,
    familyRel: app.familyRel,
    confidence,
    evidence: run.found,
    similar: (prior.examples ?? [])
      .concat(app.similar.map((s) => ({ id: s.id, name: s.name })))
      .filter((v, i, a) => a.findIndex((x) => x.id === v.id) === i)
      .slice(0, 4),
    now: run.now,
  });
  const steps = allSteps(guide);
  const agentSteps = steps.filter((s) => s.agent).length;
  yield log("draft", `Drafted ${plural(guide.phases.length, "phase")} and ${plural(steps.length, "step")}: ${agentSteps} an agent can do, ${steps.length - agentSteps} need a human.`, "success");
  yield stage("draft", "done", plural(steps.length, "step"));
  await run.wait(300);

  /* 6. Quality check */
  yield stage("verify", "running");
  const problems = validateGuide(guide);
  if (problems.length) {
    yield log("verify", `Schema check failed: ${problems[0]}`, "error");
    yield stage("verify", "error", "Draft failed validation");
    yield { type: "error", code: "invalid_draft", message: "The draft failed validation." };
    return;
  }
  yield log("verify", "Schema check passed. Every step has an owner and a human/agent tag.", "success");
  yield log("verify", `Confidence: ${confidence}. ${plural(guide.generation.verify.length, "item")} to verify before you rely on it.`);
  guide.generation.durationMs = Date.now() - run.started;
  yield stage("verify", "done", `${confidence} confidence`);
  yield { type: "guide", guide, matched: false };
  yield { type: "done", ms: Date.now() - run.started };
}
