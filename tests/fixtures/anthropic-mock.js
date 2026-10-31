/**
 * A scripted stand-in for the Anthropic Messages API (POST /v1/messages, stream=true), used
 * to test the live agent without a key or network. Event shapes follow the streaming and
 * web search tool docs: message_start, content_block_start/delta/stop (text, server_tool_use,
 * web_search_tool_result, tool_use), message_delta with stop_reason, message_stop.
 */
import http from "node:http";

export const SUBMITTED_PROFILE = {
  name: "Calendly",
  category: "Productivity & PM",
  website: "developer.calendly.com",
  authModel: "OAuth 2.0",
  authDetail: "Authorization code flow with refresh tokens; access tokens last 2 hours. PKCE is supported for public clients.",
  userOAuth: "yes",
  registerAt: { url: "https://developer.calendly.com/create-a-developer-account", path: "Developer portal → Accounts → Create a new app" },
  access: "Self-serve",
  productionGate: "None for direct OAuth use; an App Directory listing is optional and reviewed.",
  difficulty: "Easy",
  timeToFirstTest: "30–60 min",
  timeToProduction: "1–3 days (no review)",
  firstShort: "30–60 min",
  prodShort: "1–3 days",
  headline: "Self-serve OAuth: register an app in Calendly's developer portal and ship without a review.",
  needGuide: "Short one: register, set the redirect URI and build the flow.",
  cost: "Free to register; some API features need a paid Calendly plan.",
  roles: {
    team: "A developer with a Calendly account registers the app; use a company-owned account.",
    console: "None documented.",
    customer: "Each user authorizes their own account; organization admins can see connected apps.",
  },
  testing: "Use a second Calendly account on a free plan. Webhooks need a paid plan.",
  steps: [
    { do: "Create a developer account at developer.calendly.com", who: "Owner", agent: false },
    { do: "Create an OAuth app with the production redirect URI", who: "Developer", agent: false },
    { do: "Implement authorization code + PKCE and token refresh", who: "Developer", agent: true },
    { do: "Store tokens per user, encrypted", who: "Security", agent: true },
    { do: "Test approve, deny and revoke from a second account", who: "QA", agent: false },
  ],
  scopes: "Coarse scopes; access follows the authorizing user's permissions.",
  scopeComplexity: "Low",
  scopeComplexityWhy: "Few coarse scopes and no scope-triggered review.",
  blockers: ["Redirect URI mismatch: register the exact URL including the path.", "Webhooks need a paid plan: check the customer's plan first."],
  agentCan: "Write the OAuth code, script tests and draft the customer guide.",
  humanMust: "Create the developer account and the app, and test consent with real accounts.",
  confidence: "High",
  uncertain: "Exact token lifetimes for refresh tokens.",
  sources: ["https://developer.calendly.com/getting-started", "https://developer.calendly.com/api-docs"],
};

const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;

/** Split a JSON string into small partial_json chunks, like the real stream does. */
function jsonDeltas(index, value, size = 37) {
  const text = JSON.stringify(value);
  const out = [];
  for (let i = 0; i < text.length; i += size) {
    out.push(ev("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: text.slice(i, i + size) } }));
  }
  return out;
}

const searchTurn = (query, base = 0) => [
  ev("content_block_start", { index: base, content_block: { type: "text", text: "" } }),
  ev("content_block_delta", { index: base, delta: { type: "text_delta", text: "I'll check Calendly's developer docs first. " } }),
  ev("content_block_delta", { index: base, delta: { type: "text_delta", text: "Then the app directory rules." } }),
  ev("content_block_stop", { index: base }),
  ev("content_block_start", { index: base + 1, content_block: { type: "server_tool_use", id: `srvtoolu_${base}`, name: "web_search", input: {} } }),
  ...jsonDeltas(base + 1, { query }),
  ev("content_block_stop", { index: base + 1 }),
  ev("content_block_start", {
    index: base + 2,
    content_block: {
      type: "web_search_tool_result",
      tool_use_id: `srvtoolu_${base}`,
      content: [
        { type: "web_search_result", url: "https://developer.calendly.com/getting-started", title: "Getting started", encrypted_content: "ENC1", page_age: "2026" },
        { type: "web_search_result", url: "https://developer.calendly.com/api-docs", title: "API docs", encrypted_content: "ENC2" },
      ],
    },
  }),
  ev("content_block_stop", { index: base + 2 }),
];

const submitTurn = (base, profile) => [
  ev("content_block_start", { index: base, content_block: { type: "tool_use", id: "toolu_submit", name: "submit_guide", input: {} } }),
  ...jsonDeltas(base, profile),
  ev("content_block_stop", { index: base }),
];

/**
 * @param {"ok"|"pause"|"error"|"no-submit"} scenario
 * @returns {Promise<{ url: string, requests: object[], close(): Promise<void> }>}
 */
export async function startAnthropicMock(scenario = "ok", { profile = SUBMITTED_PROFILE } = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const parsed = JSON.parse(body || "{}");
      requests.push({ headers: req.headers, body: parsed });
      if (req.url !== "/v1/messages" || req.method !== "POST") {
        res.writeHead(404).end();
        return;
      }
      if (scenario === "error") {
        res.writeHead(529, { "content-type": "application/json" });
        res.end(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }));
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      const frames = [ev("message_start", { message: { id: `msg_${requests.length}`, type: "message", role: "assistant", content: [] } })];
      const turn = requests.length;
      if (scenario === "pause" && turn === 1) {
        frames.push(...searchTurn("calendly oauth app developer"), ev("message_delta", { delta: { stop_reason: "pause_turn" } }));
      } else if (scenario === "no-submit") {
        frames.push(...searchTurn("calendly oauth"), ev("message_delta", { delta: { stop_reason: "end_turn" } }));
      } else {
        frames.push(...searchTurn("calendly oauth scopes review"), ev("ping", {}), ...submitTurn(3, profile), ev("message_delta", { delta: { stop_reason: "tool_use" } }));
      }
      frames.push(ev("message_stop", {}));
      // Write in uneven chunks so the client's SSE parser sees split frames.
      const text = frames.join("");
      let i = 0;
      const tick = () => {
        if (i >= text.length) return res.end();
        res.write(text.slice(i, i + 173));
        i += 173;
        setImmediate(tick);
      };
      tick();
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise((r) => server.close(r)),
  };
}
