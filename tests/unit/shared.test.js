import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyPath, fromProfile, sentences, sourceLabel, splitBlocker } from "../../public/shared/convert.js";
import { approvalDetail, approvalFor, approvalLabel, difficultyTier, finalizeGuide, prodDays, sharePath, stepStats, toSummary } from "../../public/shared/guide-model.js";
import { guideToMarkdown } from "../../public/shared/markdown.js";
import { fromName, parseRoute, toName } from "../../public/app/router.js";
import { createSSEParser, formatSSE } from "../../public/shared/sse.js";
import { sanitizeGuide, validateGuide } from "../../public/shared/validate.js";
import { loadGuides } from "../helpers.js";

test("difficultyTier maps the five research ratings onto Easy/Moderate/Complex", () => {
  assert.equal(difficultyTier("Easy"), "Easy");
  assert.equal(difficultyTier("Moderate"), "Moderate");
  assert.equal(difficultyTier("Hard"), "Complex");
  assert.equal(difficultyTier("Very hard"), "Complex");
  assert.equal(difficultyTier("N/A"), "N/A");
  assert.equal(difficultyTier(undefined), "N/A");
});

test("approvalFor separates provider approval from listing-only reviews", () => {
  assert.deepEqual(approvalFor("review"), { required: true, kind: "Provider review" });
  assert.deepEqual(approvalFor("partner"), { required: true, kind: "Partner approval" });
  assert.equal(approvalFor("self", "A marketplace listing is optional.").kind, "None (listing optional)");
  assert.equal(approvalFor("self", "No review.").kind, "None");
  assert.equal(approvalFor("self", "Needs a privacy policy URL (support email optional).").kind, "None", "'optional' must be about a listing");
  assert.deepEqual(approvalFor("key"), { required: false, kind: "None (customer key)" });
  assert.equal(approvalFor("none").required, null);
});

test("approval labels: 'Unconfirmed' wins over the estimate, and a plain 'None' adds no detail", () => {
  assert.equal(approvalLabel({ required: true }), "Required");
  assert.equal(approvalLabel({ required: false }), "Not required");
  assert.equal(approvalLabel({ required: null }), "N/A");
  assert.equal(approvalLabel({ required: false, unconfirmed: true }), "Unconfirmed");
  assert.equal(approvalLabel({ required: true, unconfirmed: true }), "Unconfirmed");
  assert.equal(approvalDetail({ kind: "None" }), "");
  assert.equal(approvalDetail({ kind: "None (customer key)" }), "Customer key");
  assert.equal(approvalDetail({ kind: "Provider review" }), "Provider review");

  const g = loadGuides().find((x) => x.id === "helpscout");
  assert.equal(g.approval.kind, "None");
  const md = guideToMarkdown(g);
  assert.match(md, /\| Provider approval \| Not required \|/);
  assert.match(md, /\*\*Provider approval: Not required\*\*\./);
  assert.doesNotMatch(md, /Not required: None|\(None\)/);

  // The optional flag must be a boolean, and survives sanitising.
  assert.ok(validateGuide({ ...g, approval: { ...g.approval, unconfirmed: "yes" } }).some((m) => m.includes("approval.unconfirmed")));
  assert.deepEqual(validateGuide({ ...g, approval: { ...g.approval, unconfirmed: true } }), []);
  assert.equal(sanitizeGuide({ ...g, approval: { ...g.approval, unconfirmed: true } }).approval.unconfirmed, true);
  assert.equal(sanitizeGuide(g).approval.unconfirmed, undefined);
});

test("share links carry the app and intent, encoded, so an expired link can regenerate the guide", () => {
  assert.equal(sharePath("AbC_123-xyz0", { generation: { input: "Acme Billing", intent: "send" } }), "/g/AbC_123-xyz0?app=Acme+Billing&intent=send");
  assert.equal(sharePath("AbC_123-xyz0", { generation: { input: "https://x.io/?a=1&b=<2>", intent: "read" } }), "/g/AbC_123-xyz0?app=https%3A%2F%2Fx.io%2F%3Fa%3D1%26b%3D%3C2%3E&intent=read");
  assert.equal(sharePath("AbC_123-xyz0", {}), "/g/AbC_123-xyz0", "older guides without generation info keep the bare link");
  assert.deepEqual(parseRoute("/g/AbC_123-xyz0", "app=Acme+Billing&intent=send").query, { app: "Acme Billing", intent: "send" });
});

test("prodDays takes the upper bound and never sorts unknown or partner-only timelines as instant", () => {
  assert.equal(prodDays("1–3 weeks incl. review"), 21);
  assert.equal(prodDays("2–5 months (Marketplace)"), 150);
  assert.equal(prodDays("1–3 days"), 3);
  assert.equal(prodDays("Same day"), 0.5);
  assert.equal(prodDays("Keys same day; OAuth unknown"), 999);
  assert.equal(prodDays("Unknown (partner approval)"), 999);
  assert.equal(prodDays("1–3 days token; OAuth unknown"), 999);
  assert.equal(prodDays("Unknown (likely 2–6 weeks)"), 42, "a likely range still sorts");
  assert.equal(prodDays("Several weeks incl. review"), 28);
  assert.equal(prodDays(""), 999);
});

test("splitBlocker only splits on clear separators and keeps the rest whole", () => {
  assert.deepEqual(splitBlocker("Redirect URIs must match exactly: register every environment."), {
    problem: "Redirect URIs must match exactly",
    fix: "Register every environment.",
  });
  assert.deepEqual(splitBlocker("Refresh tokens are single-use, so concurrent refreshes fail. Fix: lock per connection."), {
    problem: "Refresh tokens are single-use, so concurrent refreshes fail",
    fix: "Lock per connection.",
  });
  assert.deepEqual(splitBlocker("Bots cannot list private channels unless they are members."), {
    problem: "Bots cannot list private channels unless they are members",
    fix: "",
  });
});

test("sentences doesn't break after common abbreviations", () => {
  assert.deepEqual(sentences("Use a sandbox, e.g. Slack's. Then test. Done"), ["Use a sandbox, e.g. Slack's.", "Then test.", "Done"]);
  assert.deepEqual(sentences(""), []);
});

test("sourceLabel and classifyPath", () => {
  assert.equal(sourceLabel("https://www.example.com/docs/oauth/"), "example.com/docs/oauth");
  assert.equal(classifyPath({ authModel: "OAuth 2.0", userOAuth: "yes", access: "Self-serve" }), "self");
  assert.equal(classifyPath({ authModel: "OAuth 2.0", userOAuth: "yes", access: "Application/approval required" }), "review");
  assert.equal(classifyPath({ authModel: "OAuth 2.0", userOAuth: "partner-only" }), "partner");
  assert.equal(classifyPath({ authModel: "API key / token only", userOAuth: "no" }), "key");
  assert.equal(classifyPath({ authModel: "No auth (local tool)", userOAuth: "no" }), "none");
});

const minimalProfile = {
  id: "acme",
  name: "Acme",
  category: "CRM & Sales",
  website: "acme.example",
  authModel: "OAuth 2.0",
  authDetail: "Auth code.",
  userOAuth: "yes",
  access: "Self-serve",
  productionGate: "None.",
  difficulty: "Easy",
  timeToFirstTest: "30 min",
  timeToProduction: "1–3 days",
  cost: "Free",
  roles: { team: "A developer.", console: "None.", customer: "Each user." },
  testing: "Use a second account. Then revoke.",
  steps: [
    { do: "Register", who: "Developer", agent: false },
    { do: "Write code", who: "Robot", agent: true },
  ],
  scopes: "read, write",
  blockers: ["Mismatch: register exactly."],
  agentCan: "Code.",
  humanMust: "Sign in.",
  confidence: "Medium",
  uncertain: "Lifetimes.",
  sources: ["https://acme.example/docs", "javascript:alert(1)"],
};

test("fromProfile produces a valid, finalized v3 guide and drops unsafe sources", () => {
  const g = fromProfile(minimalProfile, { headline: { headline: "Easy.", firstShort: "30 min", prodShort: "1–3 days" }, lastChecked: "2026-10-28", scope: { level: "Low", why: "Two scopes." } });
  assert.deepEqual(validateGuide(g), []);
  assert.equal(g.path, "self");
  assert.equal(g.effort.difficulty, "Easy");
  assert.equal(g.approval.required, false);
  assert.equal(g.phases[0].steps[1].who, "Developer", "unknown roles fall back to Developer");
  assert.deepEqual(g.sources.map((s) => s.url), ["https://acme.example/docs"]);
  assert.deepEqual(stepStats(g), { total: 2, agent: 1, human: 1 });
  assert.equal(toSummary(g).approvalRequired, false);
});

test("validateGuide reports every problem", () => {
  const problems = validateGuide({ schema: 3, id: "Bad Id", phases: [] });
  assert.ok(problems.length > 5);
  assert.ok(problems.some((p) => p.includes("id must be a slug")));
  assert.ok(problems.some((p) => p.includes("phases must be a non-empty list")));
});

test("sanitizeGuide clamps untrusted input to the schema", () => {
  const g = sanitizeGuide({
    id: "../../etc",
    name: "x".repeat(500),
    path: "evil",
    confidence: "Certain",
    phases: [{ name: "P", steps: [{ do: "<img src=x onerror=alert(1)>", who: "Hacker", agent: "yes" }] }],
    sources: [{ url: "javascript:alert(1)" }, { url: "https://ok.example/a", label: "ok" }],
    blockers: ["a: b", { problem: "", fix: "x" }],
  });
  assert.equal(g.id, "generated");
  assert.equal(Array.from(g.name).length, 80);
  assert.equal(g.path, "none");
  assert.equal(g.confidence, "Low");
  assert.deepEqual(g.phases[0].steps[0], { do: "<img src=x onerror=alert(1)>", who: "Developer", agent: false });
  assert.deepEqual(g.sources, [{ url: "https://ok.example/a", label: "ok" }]);
  assert.equal(g.blockers.length, 1);
});

test("finalizeGuide is idempotent", () => {
  const g = loadGuides().find((x) => x.id === "slack");
  assert.deepEqual(finalizeGuide(finalizeGuide(g)), finalizeGuide(g));
});

test("guideToMarkdown covers every section and escapes table cells", () => {
  const g = loadGuides().find((x) => x.id === "slack");
  const md = guideToMarkdown({ ...g, scopes: { ...g.scopes, table: [{ use: "a|b", scope: "x", tier: "y", note: "" }] } }, { url: "https://x.test/guides/slack" });
  for (const heading of ["## Overview", "## Prerequisites", "## Console setup steps", "## Scopes & permissions", "## Approval & verification", "## Blockers & gotchas", "## Developer action items", "## Testing", "## Team & roles", "## Evidence"]) {
    assert.ok(md.includes(heading), `missing ${heading}`);
  }
  assert.ok(md.includes("a\\|b"));
  assert.ok(md.includes("human required") && md.includes("agent can do"));
});

test("SSE parser handles split chunks, CRLF, comments and multi-line data", () => {
  const got = [];
  const p = createSSEParser((e) => got.push(e));
  const text = `: hello\r\n${formatSSE("log", { a: 1 })}event: x\ndata: line1\ndata: line2\n\n`;
  for (const ch of text) p.push(ch);
  p.end();
  assert.deepEqual(got, [
    { event: "log", data: '{"a":1}' },
    { event: "x", data: "line1\nline2" },
  ]);
});

test("routes: paths parse safely, and framed pages get plain #names that round-trip", () => {
  assert.deepEqual(parseRoute("/guides/slack/"), { name: "guide", params: { id: "slack" }, query: {} });
  assert.equal(parseRoute("/generate", "app=Zoom&intent=read").query.app, "Zoom");
  assert.equal(parseRoute("/guides/%E0%A4%A").params.id, "%E0%A4%A", "a bad escape doesn't throw");
  assert.equal(parseRoute("/nope").name, "notFound");
  for (const path of ["/", "/method", "/generate", "/guides/google-workspace"]) assert.equal(fromName(toName(path)), path, path);
  assert.equal(toName("/guides/slack"), "guide-slack");
  assert.equal(toName("/g/AbC_123-xyz0"), null, "share ids keep their #/ form");
  assert.equal(fromName("library-slack-sec-overview"), null, "in-page anchors aren't routes");
  assert.equal(fromName("main"), null);
});
