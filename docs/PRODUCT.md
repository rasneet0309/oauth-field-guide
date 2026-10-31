# OAuth Field Guide & Live Generator: product notes

**APM Integrations take-home · v3.4.0** · The one-page summary is the [README](../README.md); this is the full write-up. The spot check of the research is in [EVIDENCE.md](EVIDENCE.md).

Before your AI agent can act in Slack, Salesforce or Stripe for a customer, that customer has to connect their account, usually over OAuth. Before *that*, someone on your team has to find out what the provider demands: which console to register in, which scopes trigger a review, whether a partner program stands in the way, and whether "production" is an afternoon away or a quarter away.

This product answers those questions before anyone writes code. It has two parts:

- **A researched library of 103 apps.** Each guide gives effort, time to first test, time to production, whether the provider must approve you, scope complexity, prerequisites, exact console steps, blockers, and a split of **which steps need a human and which an agent can do**. Ten apps have in-depth guides with phased plans, scope tables and review timelines.
- **A Live Generator for every other app.** Type a name or a URL. An agent checks the library, investigates the provider and streams what it is doing, then renders a guide in the same format, marked with how sure it is and what to verify. Each generated guide gets a share link.

```bash
npm start            # http://127.0.0.1:3000 (Node 20.12+; no npm install needed to run)
```

No server handy? From the repo root, `npm install && npm run build` writes `dist/oauth-field-guide-demo.html`, the whole app and library in one file that opens from disk, and `dist/artifact/index.html`, the same page for hosts that wrap it in their own frame (views get plain `#guide-slack`-style names the host can keep in its address bar, and Download and Share, which a frame can't do, are hidden).

---

## Contents

1. [The problem](#1-the-problem)
2. [Who it's for](#2-who-its-for)
3. [What it does](#3-what-it-does)
4. [Key product and UX decisions](#4-key-product-and-ux-decisions)
5. [Evidence: where the data comes from and how far to trust it](#5-evidence-where-the-data-comes-from-and-how-far-to-trust-it)
6. [Scope](#6-scope)
7. [How I'd measure success](#7-how-id-measure-success)
8. [Setup, configuration and tests](#8-setup-configuration-and-tests)
9. [Architecture and API](#9-architecture-and-api)
10. [Technical limitations](#10-technical-limitations)
11. [Scalability constraints and the path to scale](#11-scalability-constraints-and-the-path-to-scale)
12. [What I'd do next](#12-what-id-do-next)

---

## 1. The problem

A developer adding an integration to an agent hits a discovery phase that has nothing to do with code:

- **The facts are scattered.** Registration lives in one console, scopes in another doc, review rules in a partner portal, real timelines in forum threads.
- **The consoles are unfamiliar.** Every provider names things differently (an "External Client App", a "public connection", a "GitHub App, not an OAuth App").
- **Approval workflows are opaque.** App reviews, domain and business verification, security assessments and partner agreements each have their own queue, owner and evidence requirements.

The research behind this library makes the cost concrete. Across 103 apps:

| Connection path | Apps | With a published or reported timeline | Median time to production |
|---|---|---|---|
| Self-serve OAuth | 28 | 27 | about 3 days |
| Customer API key (no OAuth app) | 33 | 28 | about 3 days |
| OAuth + provider review | 18 | 15 | about 4 weeks |
| Partner-gated OAuth | 18 | 3 | about 8 weeks (from only 3 apps) |
| No connector path | 6 | — | — |

Partner programs are the least predictable path: 15 of 18 publish no timeline at all, which is itself useful to know before you commit to a date.

**36 of the 103 apps need the provider to approve you before outside customers can connect.** For those, the queue, not the code, sets the launch date. That is the insight the product is built around: tell people about the wait first, then the steps.

## 2. Who it's for

**Primary user: the engineer or tech lead scoping integrations at a company that ships an AI agent.** They know OAuth; they don't know each provider's rules.

**Secondary users:** the PM or founder sequencing the integration roadmap, and the security and legal people who have to produce privacy policies, demo videos and questionnaires for reviews.

Jobs to be done:

- *When I'm choosing which integrations to build next,* I want the real time to production and the blockers for each, *so I can commit to dates and sequence the work.*
- *When I start an integration,* I want the exact console steps and the prerequisites, *so I don't discover a missing verified domain or company-owned account halfway through.*
- *When I plan the work,* I want to know which steps need a human (sign-ins, legal terms, verification, demo videos) and which my agent or I can automate, *so I can staff it.*
- *When an app isn't covered anywhere,* I want a credible first draft in minutes that tells me what it couldn't confirm, *so I know what to ask the vendor.*

## 3. What it does

| Surface | What you get |
|---|---|
| **Library** (`/`) | The value proposition, search (with aliases: "gmail" finds Google Workspace, "notion.so" finds Notion), a "where the time goes" chart, and one line of filters (effort, provider approval, connection path, category, sort). Cards lead with marks instead of labels: the effort shape, the path colour, time to production on a bar shared by every card, then first test, approval and scope complexity as icons, explained once by a key above the grid. Each card flips (button, or Escape to turn back) to show who does the work, the biggest blocker and the confidence. |
| **Guide** (`/guides/:id`) | A Back link (to the library, with your filters, scroll position and card restored; or to all apps when you arrived from elsewhere), then the verdict first, then the route to production with approval gates marked, six key facts, and the sections Overview, Prerequisites, Console setup steps, Scopes & permissions, Approval & verification, Blockers & gotchas, Developer action items, Testing, Team & roles and Evidence. Steps can be filtered to "Needs a human" or "Agent can do"; checklists remember ticks. Copy as Markdown, share link, download `.md`. |
| **Live Generator** (`/generate`) | App name or URL plus what the agent will do (read, read & write, send as the user, admin). A live run panel shows each stage and a streaming log, then the guide renders in the library's format. Library apps return instantly; repeat runs are cached; every generated guide gets a `/g/<id>` share link. A link that pre-fills the generator (`/generate?app=…`) waits for a click instead of running on load, so nobody can spend a visitor's quota with a link. |
| **Method** (`/method`) | What every label means: paths, effort tiers, provider vs customer approval, the scope complexity rubric, the human/agent tags, and how both generator engines work. |

### The two generator engines

| | Offline research engine (default) | Live research agent (`ANTHROPIC_API_KEY` set) |
|---|---|---|
| Library check | Name, alias or vendor URL → the researched guide, no generation | Same |
| Investigation | Vendor family ("Confluence" runs on Jira's Atlassian console), **OAuth discovery probe** (OpenID Connect Discovery, RFC 8414, and RFC 9728, which also finds a vendor's hosted MCP server and whether it supports dynamic client registration), and patterns across similar researched apps | The same discovery probe, then Claude with Anthropic's web search tool, following the same research brief the library was built with |
| Output | A guide with every estimate marked "likely", provider approval marked **Unconfirmed** unless a vendor family backs it, a verify checklist with search links, and an email to the vendor that asks exactly what decides the path | The model answers through a `submit_guide` tool in the library's research schema; the server converts and validates it with the library's own code |
| Confidence | Low, or Medium with a vendor family or metadata on a domain the user gave | Capped at Medium until someone verifies it |
| Failure handling | — | API error, timeout or an invalid answer → falls back to the offline engine in the same stream |

## 4. Key product and UX decisions

1. **Lead with the wait, not the steps.** Every card and guide answers "how long, and who has to approve it" before anything else, because that is the question developers can't answer today ("1 hour or 3 weeks?"). The guide opens with a one-sentence verdict and a route-to-production strip where approval gates are drawn as diamonds.
2. **One time scale for every app.** Card bars sit on the same log scale (1 hour to 6 months), so scanning the grid compares waits without reading numbers. The dashboard's "Approval queues, not code, set most launch dates" band uses the same scale to make the core insight visible in one glance.
3. **Separate provider approval from customer approval.** "Approval required" on a card means *the provider* must review, verify or partner with you. Customer-side admin consent is a different queue with a different owner, so it gets its own place in the guide instead of muddying the badge.
4. **Three effort tiers, shape-coded.** The brief asked for Easy / Moderate / Complex. The research rated five levels, so Hard and Very hard fold into Complex and the guide keeps the original rating. Effort is encoded by shape (circle, square, diamond) and colour is reserved for the connection path, so nothing depends on colour alone.
5. **Human vs agent on every step.** Each step names an owner and says whether it needs a person or an agent can do it. The plan can be filtered either way, and "Developer action items" splits the two into checklists. 359 of the library's 710 steps are agent-doable; the rest are exactly the sign-ins, legal acceptances, verifications and reviewer replies that set the schedule.
6. **Library first, generation second.** The generator never re-invents a researched guide: it is faster, free and more accurate to return the research. Generation is for the long tail.
7. **An honest agent.** The run log shows only checks that actually ran; the offline engine never claims to have read docs. Apart from the discovery probe (a few seconds at most), its checks take milliseconds, so the log is paced for reading (configurable, and disclosed on the Method page). Generated guides never say High confidence, always say what to verify, and come with a vendor email for the questions only the vendor can answer. Without a vendor family, provider approval reads "Unconfirmed"; when no research pattern fits, the plan assumes a provider review (a wrong guess then costs some preparation, not a launch date); and a name that matches nothing is called "not recognized" and gets a generic plan.
8. **One format for everything.** Researched, generated and shared guides render through the same view and export through the same Markdown function, and the live agent's answer goes through the same converter as the research data. People learn one layout, and the formats can't drift.
9. **Shareable by default.** Stable URLs for library guides, `/g/<id>` links for generated ones, and Markdown export for tickets and wikis, because the output of this discovery work is usually a planning conversation with someone else.
10. **Show, don't label.** Each view explains itself with the marks it already draws: the chart and the card grid each carry one key (median dot, approval diamond, hatch for "no published timeline", shield, scope bars), so cards don't repeat "Provider approval" and "Scope complexity" a hundred times. Only cards are boxed; the chart and the filters sit flat so they don't compete with the grid. The filters fit one line on screens 1024px and wider and scroll inside their own row below that, never wrapping.
11. **No framework, no build step, strict security.** Plain ES modules served as-is, a dependency-free Node server, a CSP with no inline code and Trusted Types guarding the single HTML sink. The prototype starts with one command and has a small attack surface.

## 5. Evidence: where the data comes from and how far to trust it

**Source.** AI research agents did the research for OAuth Field Guide v2.1.0 (`data/research/`) on 28 Oct 2026, under a written brief (`docs/research/BRIEF.md`): web search and page fetches only, no sign-ins, official developer docs first, then help centres and changelogs, then community sources (Stack Overflow, GitHub issues, integration vendors' engineering blogs) for real timelines and pitfalls. Inferences are marked "likely", each record lists what couldn't be confirmed, and the 103 guides cite 367 sources.

**Confidence today:** 29 High, 56 Medium, 18 Low. Treat Low guides as hypotheses. A spot check of 11 claims on 30 Oct 2026 (Slack's review rules, the generator's old errors, three Low-confidence guides) is in [EVIDENCE.md](EVIDENCE.md); it found one Low-confidence guide wrong (Close), which is now corrected.

**What's strong.** The ten in-depth guides (Slack, GitHub, Salesforce, Notion, Stripe, Google Workspace, Microsoft 365, Meta, HubSpot, Shopify) separate *official* timelines from *reported* ones, for example Slack's functional review: "up to 10 weeks" officially, "2–3 months is typical" in practice.

**What's weak.**
- Partner programs rarely publish timelines: 24 apps with a connection path have no time to production, 15 of them partner programs. They sort last in "fastest first" rather than pretending to be quick.
- Some vendor pages didn't render for the researchers (each case is listed under the guide's "Not confirmed").
- Provider rules move fast. Recent examples in this data: Slack moved its Marketplace minimum back to 10 active workspaces (from 5) in July 2026, Salesforce stopped new Connected Apps without a Support request in Spring '26, and HubSpot stopped allowing new legacy public apps on 23 June 2026.

**What v3 added on top of the research, and how.**
- **Four in-depth upgrades** (Salesforce, Stripe, HubSpot, Shopify) restructure each app's existing research profile into phases, tiers and tables. No new facts were added; the tier difficulty ratings are editorial. Source files: `data/curated/in-depth/`.
- **Scope complexity** for all 103 apps, hand-assigned against a written rubric with a one-line justification each (`data/curated/scope-complexity.json`). Admin consent counts only when specific scopes trigger it; an admin installing the whole app is customer approval, shown separately.
- **Approval gates** on the route to production: which phase is the provider's queue, and whether it is required or an optional listing (`data/curated/gates.json`), plus "at scale" notes where approval only starts past a threshold, such as Discord's 100 servers (`data/curated/approval-notes.json`).
- **Derived fields** (effort tier, provider approval, sortable days) are computed by code from the research, in one shared module, never typed by hand.

**Generated guides** are drafts by design: they show the evidence the agent gathered, cap confidence, mark provider approval Unconfirmed unless a vendor family backs it, and carry a verify checklist.

## 6. Scope

**In:** the 103-app library with 10 in-depth guides; search, filters and sorting; the guide view with checklists; the Live Generator with the offline engine, the discovery probe and the optional live agent; streamed agent logs; cached, shareable generated guides; Markdown export; light and dark themes; keyboard and screen-reader support; a single-file demo build; tests.

**Deliberately out (for a prototype):** user accounts and team workspaces; editing guides in the UI; scheduled re-verification of the research; provider logos (trademarks); analytics; a feedback loop on generated guides. Each is in [What I'd do next](#12-what-id-do-next).

## 7. How I'd measure success

| Question | Metric |
|---|---|
| Do people get the answer fast? | Time from landing to seeing an app's approval and time facts (target under 30 seconds); share of sessions that open a guide or run the generator |
| Is the guide used for planning, not just read? | Copy / share / download rate per guide view; checklist ticks per guide |
| Is the generator useful and trusted? | Library-hit rate (high is good: we researched the right apps); verify-link click rate; share rate of generated guides; "was this accurate?" votes (next) |
| Is the library accurate? | Audit sample: % of generated or Low-confidence guides confirmed when researched; days since last check per guide |
| Business outcome | Integrations shipped within the guide's predicted window; support tickets about OAuth setup per integration |

## 8. Setup, configuration and tests

**Run it**

```bash
nvm use                 # Node 22 (any Node 20.12+ works)
npm start               # http://127.0.0.1:3000, offline engine
npm run dev             # same, restarting on file changes
```

**Turn on the live research agent** (optional; the Anthropic API is paid, so the submitted build leaves it off)

```bash
cp .env.example .env    # then set ANTHROPIC_API_KEY=...
npm start               # the generator header now shows "Live research agent"
```

Each live run makes up to `LIVE_MAX_SEARCHES` web searches (default 5; Anthropic bills $10 per 1,000 searches plus tokens) and is rate limited per client.

**Configuration** (all optional; see `.env.example`)

| Variable | Default | Effect |
|---|---|---|
| `PORT`, `HOST` | `3000`, `127.0.0.1` | Where the server listens (`0.0.0.0` in containers) |
| `ANTHROPIC_API_KEY` | empty | Enables the live research agent |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | Model for the live agent |
| `LIVE_MAX_SEARCHES`, `LIVE_TIMEOUT_MS`, `LIVE_MAX_TOKENS` | `5`, `150000`, `8000` | Live agent cost and time limits |
| `DISCOVERY_PROBE` | `on` | Fetch OAuth discovery metadata from the provider's domain |
| `AGENT_PACE` | `1` | Pacing of the offline engine's log (`0` = instant) |
| `GENERATE_RATE_LIMIT`, `GENERATE_RATE_WINDOW_MS` | `10`, 10 min | Fresh generations per client per window (library and cache hits are free) |
| `GENERATE_MAX_CONCURRENT` | `4` | Simultaneous generations |
| `DATA_DIR`, `SHARE_STORE_MAX` | `.data`, `2000` | Where shared guides are stored, and how many are kept |
| `TRUST_PROXY` | `false` | Number of reverse proxies in front (`true` = 1). Rate limits then key on the X-Forwarded-For entry your proxy wrote, never on what the client sent |
| `ALLOWED_HOSTS` | `localhost`, `127.0.0.1`, `[::1]` when `HOST` is loopback; otherwise any | Comma-separated `Host` values to answer (others get 421, a DNS-rebinding guard). Set it when you deploy on a public name |
| `HSTS` | `false` | Send Strict-Transport-Security when served over HTTPS |
| `PUBLIC_URL` | from the request | The address people use (`https://…`), for links in Markdown exports behind a proxy |

**Tests and checks**

```bash
npm install             # dev tools only: ESLint, esbuild (demo build), Playwright and axe-core (browser tests)
npm run lint            # ESLint for correctness: undefined names, unused code, == vs ===
npm test                # 79 unit and integration tests: data, engine, SSRF guard, server, live agent
npm run test:e2e        # 22 browser tests, including an axe WCAG 2.2 AA scan in both themes
                        # (first run: npx playwright install chromium)
npm run data:check      # data/guides matches the research import
npm run check           # all of the above plus the demo build
```

The server and both test suites run on Node 20.12 and later (checked on 20.12.2, 22.23, 24.22 and 26.13); ESLint 10 needs Node 20.19+, 22.13+ or 24+, which CI uses. The live agent is tested against a scripted stand-in for the Anthropic streaming API (`tests/fixtures/anthropic-mock.js`): searches, results, a paused turn resumed with the content sent back unchanged, an API error, a model that never answers, and an answer that fails validation.

**Updating the research.** Edit `data/research/` or `data/curated/`, run `npm run data:import`, then `npm test`. The import refuses invalid data and lists every problem.

### Deploying a single instance

For the free demo link, follow [DEPLOY.md](DEPLOY.md). The rest of this section is for running it in a container.

The server is one Node process with no runtime dependencies. The image holds only what it runs (`src/`, `public/`, `data/guides`), runs as the unprivileged `node` user and keeps shared guides on a `/data` volume.

```bash
docker build -t oauth-field-guide .
docker run -p 3000:3000 -v ofg-data:/data \
  -e ALLOWED_HOSTS=guides.example.com -e TRUST_PROXY=1 -e PUBLIC_URL=https://guides.example.com -e HSTS=true \
  oauth-field-guide
docker compose up --build   # the same, read-only root filesystem and no capabilities (compose.yaml)
```

| Concern | What to set or know |
|---|---|
| Host names | `ALLOWED_HOSTS` = your public name(s). Requests for any other `Host` get 421. `/api/health` answers any host, so container and orchestrator probes by IP keep working |
| Reverse proxy | `TRUST_PROXY` = number of proxies in front, so rate limits use the client address your proxy recorded. Terminate TLS there and set `HSTS=true` |
| Streaming | `POST /api/generate` is Server-Sent Events. The server sends `X-Accel-Buffering: no` and a heartbeat every 15 s; set proxy read timeouts above `LIVE_TIMEOUT_MS` (150 s) |
| Secrets | `ANTHROPIC_API_KEY` comes from the environment or your secret manager only. No `.env` file is copied into the image, and the key is never sent to browsers or written to logs |
| Health and logs | `GET /api/health` returns `{ status, version, uptimeSec }`. Logs are JSON lines on stdout/stderr, with no request bodies or query strings |
| Failures | A port that's taken logs `listen_failed` and exits 1. An error no handler caught logs `uncaught_exception` or `unhandled_rejection` with its stack and exits 1, so the orchestrator restarts a clean instance. SIGTERM closes the server and exits 0 within 3 s |
| Replicas | Run one instance until the share store and rate limiter move to shared storage (see [Scalability](#11-scalability-constraints-and-the-path-to-scale)) |
| Base image | Pin by digest: `--build-arg NODE_IMAGE=node:22-alpine@sha256:<digest>` |

CI (`.github/workflows/ci.yml`) lints, tests on Node 20, 22 and 24, builds the demo, runs the browser tests, scans for secrets against an audited baseline (`.secrets.baseline`, four known false positives: two example placeholders and two test fixtures), then builds the image and smoke-tests health, the Host guard and the non-root user.

## 9. Architecture and API

```text
.
├── src/                          server (Node, no runtime dependencies)
│   ├── app.js                    entry: routes, static files, SPA shell, start-up
│   └── server/
│       ├── config.js             environment → validated config; public config view
│       ├── library.js            loads + validates data/guides, filters, sorts, stats
│       ├── generate.js           POST /api/generate: engines, SSE, cache, share store, fallback
│       ├── agents/claude.js      live agent: streaming Messages API + web search, turn resume
│       ├── agents/prompts.js     research brief as a system prompt; submit_guide tool schema
│       ├── discovery.js          OIDC / RFC 8414 / RFC 9728 discovery probe
│       ├── net-guard.js          SSRF guard: public addresses only, checked at connect time
│       ├── store.js              generated guides on disk (+ memory fallback), result cache
│       ├── rate-limit.js         per-client limiter and concurrency gate
│       └── http.js               security headers (CSP), JSON helpers, static file server
├── public/                       browser app, served as-is (no build step)
│   ├── index.html                shell; theme boot; no inline code
│   ├── app/                      main.js (boot), router.js, api.js / api-local.js (server or in-page engine)
│   │   ├── views/                library, guide, generator, method, not-found
│   │   ├── ui/                   dom.js (the one HTML sink), components.js, icons.js
│   │   └── services/             storage, feedback (toasts, clipboard), theme, host
│   ├── shared/                   isomorphic modules used by the browser AND the server:
│   │   ├── guide-model.js        vocabulary + derived fields (effort tier, approval, days)
│   │   ├── convert.js            research records → guides (library import and live agent)
│   │   ├── validate.js           schema validation and sanitising of untrusted guides
│   │   ├── markdown.js           guide → Markdown export
│   │   ├── search.js, text.js    search ranking and text helpers (from v2)
│   │   ├── sse.js                Server-Sent Events parser and formatter
│   │   └── engine/               offline engine: identify, patterns, stages, drafting
│   ├── styles/                   design tokens and component CSS (light and dark)
│   └── fonts/                    Geist and Geist Mono (OFL), self-hosted
├── data/
│   ├── guides/*.json             THE LIBRARY: 103 guides, schema v3 (generated, committed)
│   ├── library-meta.json         research date, featured order, categories
│   ├── research/                 v2.1.0 research inputs (profiles, in-depth guides, headlines)
│   └── curated/                  v3 curation: in-depth upgrades, scope complexity, register links,
│                                 approval gates, at-scale approval notes
├── scripts/                      import-research.mjs (research → guides), build-static.mjs (demo),
│                                 run-tests.mjs (same test command on every Node from 20),
│                                 github-first-token.mjs (device-flow helper for the setup attempt)
├── tests/                        unit/ (node:test), e2e/ (Playwright + axe), fixtures/ (Anthropic mock)
├── docs/                         PRODUCT.md (this file), ARCHITECTURE.md, EVIDENCE.md, DEPLOY.md,
│                                 research/BRIEF.md
├── .github/workflows/ci.yml      lint, tests on Node 20, 22 and 24, secret scan, image build and smoke test
├── Dockerfile, compose.yaml      non-root image; hardened local run
├── eslint.config.js              correctness lint
└── .secrets.baseline             audited secret-scan baseline (false positives only)
```

The same pure modules in `public/shared/` run in the browser, on the server and in the scripts, so the card, the guide page, the Markdown export and the generator agree by construction. See [ARCHITECTURE.md](ARCHITECTURE.md) for the event protocol, the security model and the data pipeline.

**API**

| Method and path | Returns |
|---|---|
| `GET /api/health` | `{ status, version, uptimeSec }` |
| `GET /api/config` | Mode (offline/live), model, limits, library stats. Never the API key |
| `GET /api/guides?q=&difficulty=&approval=&path=&category=&scope=&sort=` | `{ total, items }` of guide summaries |
| `GET /api/guides/:id` · `/api/guides/:id.md` | A guide as JSON or Markdown; 404 with "did you mean" suggestions |
| `POST /api/generate` `{ app, intent?, fresh? }` | `text/event-stream`: `run`, `stage`, `log`, `evidence`, `guide`, `error`, `done` |
| `GET /api/generated/:id` · `/api/generated/:id.md` | A shared generated guide |

Example:

```bash
curl -N -X POST localhost:3000/api/generate \
  -H 'content-type: application/json' \
  -d '{"app":"https://developer.zoom.us","intent":"read"}'
```

## 10. Technical limitations

- **The offline engine is heuristic.** For apps outside the library it borrows the vendor family's facts, or the category's pattern when a keyword in the name points to a category with a clear majority; otherwise it plans for a provider review. Pattern estimates can still point the wrong way (Dropbox looks self-serve from its category but requires production approval), which is why provider approval reads "Unconfirmed" without a vendor family and every draft has a verify list.
- **The discovery probe needs outbound internet.** Behind a proxy or in a locked-down network it reports "provider unreachable" and the engine carries on without it. Domains guessed from a bare name ("Calendly" → calendly.com) never raise confidence, because the metadata might belong to someone else.
- **The live agent was verified against a protocol-accurate mock, not the real API**, because this build had no API key. Without a key, live generation runs the offline engine. Before relying on the live agent, run one real generation and compare it with a researched guide.
- **Shared guides are files on one machine.** Fine for a prototype; see the next section for production.
- **The single-file demo is the offline engine only.** It has no discovery probe (a page can't fetch other sites' metadata), no live agent and no stored `/g/` links; its generator still drafts guides from vendor families and research patterns.
- **No authentication.** Anyone who can reach the server can run generations, within the rate limit. Put it behind SSO, or add per-user quotas, before exposing live mode publicly.
- **Research ages.** The library reflects 28 Oct 2026. Re-verify Low-confidence and in-depth guides first.

## 11. Scalability constraints and the path to scale

| Constraint today | Why it's fine now | At scale |
|---|---|---|
| Library loaded into memory at start-up | 103 guides are about 760 KB of JSON; even 10,000 would fit | Same model; publish the library as versioned JSON to a CDN and hot-reload |
| Shared guides as files on disk, oldest evicted past 2,000 | Single instance, no setup | Postgres or object storage, per-tenant access control, retention policy |
| Result cache and rate limiter in memory | Single instance | Redis (or the edge) so limits hold across replicas |
| Live runs hold an HTTP stream for up to 2.5 minutes, 4 at a time | Low traffic | A job queue with resumable event streams (run id + `Last-Event-ID`), so a dropped connection doesn't lose a paid run |
| Live agent cost: roughly 5 searches plus tokens per run | Library hits and cache hits are free | Generate once, then promote good drafts into the library after review; per-tenant budgets |
| Research is a one-off snapshot | It was checked on 28 Oct 2026 | A re-verification pipeline: the live agent re-researches each library app on a schedule, a human reviews diffs, and guides show "last verified" per section |

The server keeps no state between requests other than the share store and the cache, so it scales horizontally once those two move to shared storage.

## 12. What I'd do next

1. **Close the loop on accuracy:** "Was this right?" on every generated guide, and a review queue that promotes good drafts into the library.
2. **Re-verification pipeline** (above), with change alerts when a provider's rules move, for teams watching specific apps.
3. **Team workspace:** saved integration plans with owners and dates, built from the human/agent split.
4. **Agent hand-off:** export the "Agent can do" steps as a task list an AI coding agent can execute (manifest drafting, OAuth code, test calls).
5. **Coverage:** grow from 103 to the top 500 apps that agent builders request, using generator search logs to choose.

---

Built on OAuth Field Guide v2.1.0's research and audited text and search helpers. Fonts: Geist and Geist Mono by Vercel (SIL Open Font License 1.1, `public/fonts/OFL-Geist.txt`). Project code: proprietary (`UNLICENSED`).
