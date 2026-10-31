# Research brief: OAuth-app readiness profiles

## Context
We are building a library of setup guides for developers whose **AI agent** needs end users at **other companies** to connect third-party apps. For each app you're given, find out:

- how a developer gets a production-ready way for *their* users to connect *their own* accounts; ideally this is the OAuth 2.0 authorization-code flow with a developer-registered OAuth app;
- what stands in the way: approvals, partner programs, reviews, security audits, access tiers;
- who has to be involved, on the developer's team and on the customer's side;
- how to test before approval.

Today is **2026-10-28**. Prefer facts that are current in 2025–2026, and say so when a doc looks stale.

## Method rules
- Use WebSearch and WebFetch only. Check official developer docs first, then the provider's help center or changelog. Only after that, go to community sources (Stack Overflow, Reddit, GitHub issues, integration-vendor blogs like nango.dev or workos.com) for timelines and pitfalls.
- Do **not** use browser automation. Do not sign in or create accounts. If WebFetch reports that a domain can't be fetched, don't work around it (no curl, no mirrors). Note it in `uncertain`.
- Budget is roughly 5–9 tool calls per app. Stop when the core facts are confirmed: auth model, where to register, the approval gate, roles, and testing.
- Only state what sources support. Mark inferences with "likely" and lower `confidence`.

## Output
Write **one JSON file** (a JSON array, one object per app, in the order given) to the path in your task. Then validate it:

`python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(len(d),'ok')" <path>`

Fix it until it parses. Your final message should be at most 120 words: the file path, the count, and 2–3 surprising findings. Do not paste the JSON into your final message.

Each object must have exactly these keys:

```json
{
  "n": 1,
  "id": "salesforce",
  "name": "Salesforce",
  "category": "CRM & Sales",
  "website": "salesforce.com",
  "authModel": "OAuth 2.0",
  "authDetail": "One or two sentences: grant types, PKCE, token lifetimes, refresh tokens, per-tenant/instance URLs.",
  "userOAuth": "yes",
  "registerAt": {"url": "https://...", "path": "Exact console navigation, e.g. Setup → App Manager → New External Client App"},
  "access": "Self-serve",
  "productionGate": "What must happen before arbitrary external customers can connect: none / optional marketplace listing / mandatory app review / security review / access-tier upgrade / partner agreement. Be specific.",
  "difficulty": "Moderate",
  "timeToFirstTest": "30–60 min",
  "timeToProduction": "1–3 days (no review) | 4–8 weeks incl. security review | unknown",
  "cost": "Free | partner fee $X | security review fee $X | requires paid plan",
  "roles": {
    "team": "Who on the developer's team must create/own the app and what account or role they need (e.g., must be a System Administrator in a Developer Edition org; use a company-owned account; add 2 owners).",
    "console": "Roles or collaborator features in the provider's developer console and exactly how to add someone; say 'none documented' if none.",
    "customer": "Who at the customer must approve or install (e.g., workspace admin, org owner, super admin) and the admin controls that can block the app."
  },
  "testing": "How to test before approval: sandbox / developer accounts / test tenants, plus limits.",
  "steps": [
    {"do": "Short imperative step with exact UI path or URL and key field values", "who": "Owner", "agent": false}
  ],
  "scopes": "Scope/permission model for typical agent use (read/write records, messages, files), and which scopes trigger review or extra approval.",
  "blockers": ["2–4 concrete common blockers or gotchas, each with the fix"],
  "agentCan": "What an AI agent could do for the developer (draft listing copy and justifications, configure via API/CLI/manifest, write the OAuth code, run test calls).",
  "humanMust": "What needs a human: login/2FA, legal acceptance, KYC/business verification, payment, partner agreement, demo video, sales contact.",
  "confidence": "High",
  "uncertain": "What you couldn't confirm.",
  "sources": ["https://official-doc-1", "https://official-doc-2", "https://community-1"]
}
```

### Allowed values
- `authModel`: one of
  - `"OAuth 2.0"`
  - `"OAuth 2.0 (partner-gated)"`
  - `"OAuth 1.0a"`
  - `"API key / token only"`
  - `"Client credentials only"`
  - `"Bot token"`
  - `"MCP OAuth"`
  - `"No auth (local tool)"`
  - `"Other"`
- `userOAuth`: `"yes"` (any developer can register and serve external users), `"partner-only"` (OAuth exists but needs approval or partnership first), or `"no"`.
- `access`: `"Self-serve"`, `"Application/approval required"`, `"Partner program required"`, or `"Not offered"`.
- `difficulty`: `"Easy"`, `"Moderate"`, `"Hard"`, `"Very hard"`, or `"N/A"`. Rate the effort to reach production for external customers, including any approval wait.
- `steps`: 5–9 steps. `who` is one of Owner, Developer, QA, Security, Legal, Design. `agent: true` means an AI agent could do the step (via API/CLI or by drafting). `false` means a human must do it.
- `sources`: 2–6 URLs you actually used, official first.

### Apps with no user OAuth
These include API-key-only apps, local CLIs, and open-source tools. For them:
- Say so plainly and set `userOAuth: "no"`.
- Make the `steps` describe the correct alternative. For example: the user creates an API key in Settings → API, pastes it into your app, and you store it encrypted and validate it with a test call. Or: run the CLI locally / self-host.
- Still fill in `roles` and `testing` briefly.
- If the vendor *plans* or *offers on request* OAuth, mention it.

Keep each object compact: about 250–400 words total.
