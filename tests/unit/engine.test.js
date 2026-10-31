import assert from "node:assert/strict";
import { test } from "node:test";
import { identifyApp, isPlausibleHost, parseInput } from "../../public/shared/engine/identify.js";
import { draftGuide, resolvePath, runOfflineAgent } from "../../public/shared/engine/offline.js";
import { categoryPrior, libraryPatterns } from "../../public/shared/engine/patterns.js";
import { approvalLabel, toSummary } from "../../public/shared/guide-model.js";
import { guideToMarkdown } from "../../public/shared/markdown.js";
import { makeLib } from "../../public/shared/search.js";
import { validateGuide } from "../../public/shared/validate.js";
import { loadGuides } from "../helpers.js";

const guides = loadGuides();
const byId = new Map(guides.map((g) => [g.id, g]));
const lib = makeLib(guides.map(toSummary));
const patterns = libraryPatterns(guides);
const categories = [...new Set(guides.map((g) => g.category))].sort();
const ctx = (extra = {}) => ({ lib, getGuide: (id) => byId.get(id), patterns, categories, pace: 0, now: () => new Date("2026-10-29T10:00:00Z"), ...extra });

async function run(input, intent = "write", extra = {}) {
  const events = [];
  for await (const ev of runOfflineAgent({ input, intent, ctx: ctx(extra) })) events.push(ev);
  return { events, guide: events.find((e) => e.type === "guide") };
}

test("parseInput turns URLs into a vendor name, website and registrable domain", () => {
  assert.deepEqual(parseInput("https://developer.zoom.us/docs/?x=1"), { name: "Zoom", website: "developer.zoom.us/docs", host: "developer.zoom.us", root: "zoom.us" });
  assert.deepEqual(parseInput("  Zoho Books "), { name: "Zoho Books", website: "", host: "", root: "" });
  assert.equal(parseInput("shop.bbc.co.uk").root, "bbc.co.uk");
});

test("isPlausibleHost rejects IPs, single labels and internal TLDs", () => {
  assert.ok(isPlausibleHost("zoom.us"));
  for (const h of ["127.0.0.1", "localhost", "intranet", "printer.local", "svc.internal", "a.test", "x..y"]) assert.ok(!isPlausibleHost(h), h);
});

test("identifyApp matches names, aliases, vendor URLs and bare domains to the library", () => {
  assert.equal(identifyApp("slack", lib, categories).match?.id, "slack");
  assert.equal(identifyApp("Gmail", lib, categories).match?.id, "google-workspace");
  assert.equal(identifyApp("https://api.slack.com/apps", lib, categories).match?.id, "slack");
  assert.equal(identifyApp("notion.so", lib, categories).match?.id, "notion");
  const repo = identifyApp("github.com/acme/tool", lib, categories);
  assert.equal(repo.match, null, "a page on github.com is another product");
  assert.equal(repo.domainOwner?.id, "github");
});

test("common product names and 'X API' resolve to the researched guide", () => {
  const id = (q) => identifyApp(q, lib, categories).match?.id;
  assert.equal(id("Facebook Ads"), "meta-ads");
  assert.equal(id("Instagram Ads"), "meta-ads");
  assert.equal(id("WhatsApp Business API"), "whatsapp-business");
  assert.equal(id("Stripe API"), "stripe");
  assert.equal(id("Slack OAuth"), "slack");
  assert.equal(id("Stripe docs"), "stripe");
  assert.equal(identifyApp("Metabase", lib, categories).family, null, "'Meta…' names aren't all Meta");
});

test("adminGated reads sentences and ignores negations", async () => {
  const { adminGated } = await import("../../public/shared/engine/patterns.js");
  assert.equal(adminGated("A workspace admin must install the app."), true);
  assert.equal(adminGated("The seller clicks Authorize; no workspace admin layer."), false);
  assert.equal(adminGated("Admin controls blocking apps are not documented."), false);
});

test("identifyApp finds vendor families and guesses a domain when only a name is given", () => {
  const confluence = identifyApp("Confluence", lib, categories);
  assert.equal(confluence.match, null);
  assert.equal(confluence.family?.rel, "jira");
  const calendly = identifyApp("Calendly", lib, categories);
  assert.equal(calendly.root, "calendly.com");
  assert.equal(calendly.domainSource, "guess");
});

test("a library app short-circuits the run: no generation, every later stage skipped", async () => {
  const { events, guide } = await run("Stripe");
  assert.equal(guide.matched, true);
  assert.equal(guide.guide.id, "stripe");
  assert.equal(events.filter((e) => e.type === "stage" && e.status === "skipped").length, 5);
});

test("an unknown app gets a valid generated guide with evidence, a verify list and unconfirmed approval", async () => {
  const { events, guide } = await run("Calendly", "read");
  assert.equal(events[0].type, "run");
  assert.deepEqual(events[0].stages.map((s) => s.id), ["identify", "scan", "scopes", "approval", "draft", "verify"]);
  assert.equal(events.at(-1).type, "done");
  const g = guide.guide;
  assert.equal(guide.matched, false);
  assert.equal(g.kind, "generated");
  assert.deepEqual(validateGuide(g), []);
  assert.equal(g.confidence, "Low", "no family, no probe: low confidence");
  // A clear Productivity & PM pattern (a real keyword) makes self-serve likely, but not a fact.
  assert.equal(g.path, "self");
  assert.equal(g.approval.unconfirmed, true);
  assert.equal(approvalLabel(g.approval), "Unconfirmed");
  assert.match(g.verdict, /^Likely self-serve OAuth: \d+ of \d+ researched Productivity & PM apps/);
  assert.match(g.verdict, /isn't confirmed for Calendly/);
  assert.notEqual(g.effort.difficulty, "Easy", "Easy means no provider queue, which nobody checked");
  assert.ok(g.generation.verify.length >= 4);
  assert.ok(g.generation.verify.some((v) => /reviews apps/.test(v.label)));
  assert.ok(g.generation.verify.every((v) => v.url.startsWith("https://www.google.com/search?q=")));
  assert.ok(!g.generation.verify[0].url.includes("site%3A"), "no site: filter on a guessed domain");
});

test("the offline engine is deterministic for the same input and clock", async () => {
  const a = (await run("Acme Billing", "send")).guide.guide;
  const b = (await run("Acme Billing", "send")).guide.guide;
  delete a.generation.durationMs;
  delete b.generation.durationMs;
  assert.deepEqual(a, b);
});

test("a vendor family lends its path, times and scope model, and raises confidence", async () => {
  const g = (await run("Confluence")).guide.guide;
  assert.equal(g.path, "self");
  assert.equal(g.confidence, "Medium");
  assert.equal(g.scopes.complexity, byId.get("jira").scopes.complexity);
  assert.equal(g.effort.prodShort, byId.get("jira").effort.prodShort);
});

/** Sentences that would state, as a fact about the app, that it has no provider review. */
const NO_REVIEW_CLAIM = /\bno review\b|not required|isn't expected to review|with no review by|no provider approval/i;
const stageEnd = (events, id) => events.filter((e) => e.type === "stage" && e.id === id).at(-1);

test("Zoom: no clear Communications pattern, so the plan is a provider review marked Unconfirmed", async () => {
  const { events, guide } = await run("Zoom");
  const g = guide.guide;
  assert.deepEqual(validateGuide(g), []);
  assert.equal(g.path, "review");
  assert.equal(g.approval.unconfirmed, true);
  assert.equal(approvalLabel(g.approval), "Unconfirmed");
  assert.equal(g.approval.kind, "Plan for a provider review");
  assert.match(g.verdict, /^Plan for OAuth with a provider review\. Whether Zoom reviews apps isn't confirmed/);
  assert.notEqual(g.effort.prodShort, "1–3 days");
  assert.equal(g.confidence, "Low");
  const md = guideToMarkdown(g);
  assert.doesNotMatch(md, NO_REVIEW_CLAIM);
  assert.match(md, /\| Provider approval \| Unconfirmed: Plan for a provider review \|/);
  assert.equal(stageEnd(events, "identify").summary, "Zoom · Communications & Messaging", "a real keyword, so recognized");
  assert.deepEqual([stageEnd(events, "approval").status, stageEnd(events, "approval").summary], ["warn", "Unconfirmed · plan for a review"]);
});

test("Spotify and Dropbox never state 'no review' or 'Not required' as fact", async () => {
  for (const name of ["Spotify", "Dropbox"]) {
    const g = (await run(name)).guide.guide;
    assert.deepEqual(validateGuide(g), [], name);
    assert.equal(approvalLabel(g.approval), "Unconfirmed", name);
    assert.doesNotMatch(`${g.verdict}\n${g.approval.gate}\n${guideToMarkdown(g)}`, NO_REVIEW_CLAIM, name);
  }
  // Spotify matches no keyword, so it borrows no category; Dropbox's keyword gives a hedged estimate.
  assert.equal((await run("Spotify")).guide.guide.path, "review");
  assert.match((await run("Dropbox")).guide.guide.verdict, /isn't confirmed for Dropbox/);
});

test("a name that matches nothing is 'not recognized' and gets a generic plan", async () => {
  const app = identifyApp("asdkjhqwe", lib, categories);
  assert.deepEqual([app.category, app.categorySource, app.recognized], [null, "none", false], "no default category");

  const { events, guide } = await run("asdkjhqwe");
  const g = guide.guide;
  assert.deepEqual(validateGuide(g), []);
  assert.deepEqual([stageEnd(events, "identify").status, stageEnd(events, "identify").summary], ["warn", "Asdkjhqwe · not recognized"]);
  assert.ok(events.some((e) => e.type === "log" && /^Not recognized/.test(e.text)));
  assert.match(g.verdict, /^Not recognized\. Asdkjhqwe doesn't match a researched app, a vendor family or a category, so this is a generic plan/);
  assert.equal(g.category, "Uncategorized");
  assert.equal(g.path, "review");
  assert.equal(approvalLabel(g.approval), "Unconfirmed");
  assert.equal(g.confidence, "Low");
  assert.equal(g.phases[0].name, "Confirm the app");
  assert.match(g.generation.verify[0].label, /official website/);
  assert.match(g.uncertain[0], /wasn't recognized/);
  assert.doesNotMatch(guideToMarkdown(g), NO_REVIEW_CLAIM);
});

test("a pasted website identifies the app, so the plan never asks for its website (https://www.strava.com)", async () => {
  const app = identifyApp("https://www.strava.com", lib, categories);
  assert.deepEqual([app.recognized, app.domainSource, app.root, app.category], [true, "input", "strava.com", null]);

  const { events, guide } = await run("https://www.strava.com");
  const g = guide.guide;
  assert.deepEqual(validateGuide(g), []);
  assert.deepEqual([stageEnd(events, "identify").status, stageEnd(events, "identify").summary], ["done", "Strava · strava.com"]);
  assert.doesNotMatch(g.verdict, /not recognized/i);
  assert.match(g.verdict, /^Plan for OAuth with a provider review/);
  assert.notEqual(g.phases[0].name, "Confirm the app");
  assert.ok(!g.phases.flatMap((p) => p.steps).some((s) => /website|run the generator again/i.test(s.do)), "no step sends you to find the website you gave");
  assert.ok(g.generation.verify.some((v) => v.url.includes("site%3Astrava.com")), "verify searches stay on the domain you gave");
  assert.equal(approvalLabel(g.approval), "Unconfirmed");
});

test("category keywords read the name and registrable domain, never a URL path or subdomain", async () => {
  const category = (q) => identifyApp(q, lib, categories).category;
  assert.equal(category("https://developers.strava.com/docs"), null, "'docs' in the path isn't Productivity & PM");
  assert.equal(category("https://help.strava.com"), null, "a help. subdomain isn't Support & Helpdesk");
  assert.equal(category("Strava docs"), null, "nor is the word 'docs' in a typed name");
  assert.equal(category("https://zoom.us/docs"), "Communications & Messaging", "the domain itself still counts");
  assert.equal(category("Acme Billing"), "Finance & Fintech", "and so does the name");

  const g = (await run("https://developers.strava.com/docs")).guide.guide;
  assert.doesNotMatch(`${g.verdict} ${g.approval.gate} ${g.uncertain.join(" ")}`, /Productivity & PM/);
  assert.equal(g.path, "review");
});

test("a vendor family keeps provider approval confirmed (Confluence)", async () => {
  const { events, guide } = await run("Confluence");
  const g = guide.guide;
  assert.equal(g.approval.unconfirmed, undefined);
  assert.equal(approvalLabel(g.approval), "Not required");
  assert.equal(g.approval.kind, "None (listing optional)");
  assert.match(g.verdict, /^Likely self-serve OAuth\. Register an app/);
  assert.deepEqual([stageEnd(events, "approval").status, stageEnd(events, "approval").summary], ["done", "Self-serve OAuth (likely)"]);
  assert.match(guideToMarkdown(g), /\| Provider approval \| Not required: Listing optional \|/);
});

test("family guides name the vendor that reviews apps, not the product", async () => {
  const confluence = (await run("Confluence")).guide.guide;
  assert.match(confluence.verdict, /Register an app in Atlassian's developer portal and ship, with no review by Atlassian/);
  assert.match(confluence.approval.gate, /^Atlassian isn't expected to review your app/);
  assert.doesNotMatch(`${confluence.verdict} ${confluence.approval.gate}`, /by Confluence|Confluence's developer portal|Confluence isn't expected/);

  const powerBi = (await run("Power BI")).guide.guide;
  assert.match(powerBi.verdict, /but Microsoft reviews or verifies the app/);
  assert.match(powerBi.approval.gate, /^Microsoft likely reviews or verifies your app/);
  assert.ok(powerBi.prerequisites.includes("A company-owned Microsoft account with MFA."));
  assert.ok(powerBi.generation.verify.some((v) => v.label === "Check whether Microsoft reviews apps before outside customers connect"));
});

test("without a usable category pattern the engine plans for a provider review and says so", () => {
  const prior = categoryPrior(patterns, "Communications & Messaging");
  assert.equal(prior.clear, false);
  const decision = resolvePath({ family: null, familyRel: null, discovery: null, prior, category: "Communications & Messaging" });
  assert.equal(decision.path, "review");
  assert.equal(decision.basis, "assumed");
  assert.match(decision.reasons[0], /No clear pattern.*assumes a provider review/);

  // No category is no evidence, even next to a clear prior: nothing to borrow.
  const productivity = categoryPrior(patterns, "Productivity & PM");
  assert.equal(productivity.clear, true);
  const none = resolvePath({ family: null, familyRel: null, discovery: null, prior: productivity, category: null });
  assert.equal(none.path, "review");
  assert.match(none.reasons[0], /No category to compare with/);

  // A clear pattern from a real keyword is used, as an estimate.
  const used = resolvePath({ family: null, familyRel: null, discovery: null, prior: productivity, category: "Productivity & PM" });
  assert.deepEqual([used.path, used.basis], ["self", "pattern"]);
});

test("discovery metadata enriches the draft: endpoints, PKCE, scopes and the MCP alternative", async () => {
  const probe = async ({ root }) => ({
    checked: [{ url: `https://${root}/.well-known/openid-configuration`, outcome: "found", status: 200 }],
    provider: {
      url: `https://${root}/.well-known/openid-configuration`,
      kind: "openid-configuration",
      issuer: `https://${root}`,
      authorizationEndpoint: `https://${root}/oauth/authorize`,
      tokenEndpoint: `https://${root}/oauth/token`,
      registrationEndpoint: "",
      scopes: ["openid", "read", "write", "admin"],
      pkceMethods: ["S256"],
      grantTypes: ["authorization_code", "refresh_token"],
    },
    mcp: {
      url: `https://mcp.${root}/.well-known/oauth-authorization-server`,
      kind: "oauth-authorization-server",
      issuer: `https://mcp.${root}`,
      resource: `https://mcp.${root}/mcp`,
      authorizationEndpoint: `https://mcp.${root}/authorize`,
      tokenEndpoint: `https://mcp.${root}/token`,
      registrationEndpoint: `https://mcp.${root}/register`,
      scopes: [],
      pkceMethods: ["S256"],
      grantTypes: ["authorization_code"],
    },
  });
  const { events, guide } = await run("https://acme-tools.io", "write", { probe });
  const g = guide.guide;
  assert.deepEqual(validateGuide(g), []);
  assert.equal(g.confidence, "Medium", "metadata on the given domain raises confidence");
  assert.match(g.auth.detail, /PKCE methods S256/);
  assert.ok(g.scopes.table.some((r) => r.scope === "admin" && r.use === "Admin or broad"));
  assert.ok(g.phases.some((p) => p.name.includes("hosted MCP server")));
  assert.ok(g.sources.length === 2);
  assert.ok(events.some((e) => e.type === "evidence" && e.item.kind === "discovery"));
});

test("an unreachable provider is reported as unreachable, not as 'no metadata'", async () => {
  const probe = async ({ root }) => ({ checked: [1, 2, 3].map((i) => ({ url: `https://x${i}.${root}/`, outcome: "error" })), provider: null, mcp: null });
  const { events } = await run("https://acme-tools.io", "write", { probe });
  const scan = events.filter((e) => e.type === "stage" && e.id === "scan").at(-1);
  assert.equal(scan.status, "warn");
  assert.equal(scan.summary, "Provider unreachable");
});

test("draftGuide covers every connection path with a valid guide", () => {
  const app = identifyApp("Example Tool", lib, categories);
  for (const path of ["self", "review", "partner", "key", "none"]) {
    const g = draftGuide({
      app,
      intent: "write",
      path,
      adminInstall: path !== "key",
      discovery: null,
      scope: { level: path === "none" ? "N/A" : "Medium", why: "test" },
      family: null,
      familyRel: null,
      confidence: "Low",
      evidence: [],
      similar: [],
      now: new Date("2026-10-29T00:00:00Z"),
    });
    assert.deepEqual(validateGuide(g), [], path);
    assert.equal(g.path, path);
  }
});
