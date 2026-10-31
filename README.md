# OAuth Field Guide & Live Generator

How long until your AI agent can act in a customer's Slack, Salesforce or Stripe account, and who has to approve it first? This prototype answers that for 103 researched apps, and drafts a guide in the same format for any other app, marking what it couldn't confirm.

**Demo:** https://YOUR-SERVICE.onrender.com · **Code:** https://github.com/YOUR-NAME/oauth-field-guide · v3.4.0

## The finding: the approval queue sets the launch date

36 of the 103 apps need the provider to approve you before outside customers can connect: 18 through a review, 18 through a partner program. The code takes days; the queue takes weeks.

| Connection path | Apps | Median time to production |
|---|---|---|
| Self-serve OAuth | 28 | about 3 days |
| Customer API key, no OAuth app | 33 | about 3 days |
| OAuth + provider review | 18 | about 4 weeks |
| Partner-gated OAuth | 18 | about 8 weeks (only 3 of 18 publish any timeline) |
| No connector path | 6 | n/a |

So every card and guide leads with the wait and who approves it, then gives the steps. 39 of the 103 apps don't use an OAuth app at all, and their guides say so.

## Try it on real apps

Search the library for these; each has a different setup challenge.

| App | What stands in the way |
|---|---|
| Slack | You can test today, but a commercial agent needs the Marketplace, which takes months |
| Google Workspace | The scopes you ask for decide whether production takes days or 3+ months |
| Meta | Three human queues: Business Verification, App Review per permission, a yearly renewal |
| Salesforce | Self-serve, but each customer's admin installs your package |
| Zendesk | You can't create the global OAuth client yourself; Zendesk reviews and converts it |
| Discord | No review to start; verification once the bot nears 100 servers |
| Firecrawl | No OAuth app: each customer pastes an API key |

Then give the Live Generator an app the library doesn't have. Try `Confluence` (it borrows Atlassian's researched platform), `https://gitlab.com` (the server reads GitLab's published OAuth metadata), `https://www.strava.com` (no pattern fits, so it plans for a review), or any app you like. A website gives the agent a real domain to check.

## Where Composio fits

Composio's managed OAuth apps are the quick start: they're the default where they exist, and they're enough while Composio's name on the consent screen, its default scopes and a rate limit shared with every other Composio user suit you. You need your own OAuth app for your own name on the consent screen, custom scopes or your own rate limits, and for toolkits that have no managed app ([Composio docs](https://docs.composio.dev/docs/authentication/custom-app-vs-managed-app)). Registering your own app is where the provider's approval queue starts, and that's what these guides map.

## Run it

```bash
npm start            # http://127.0.0.1:3000 (Node 20.12+; nothing to install)
npm install          # dev tools for the checks below
npm test             # 79 unit and integration tests
npm run test:e2e     # 22 browser tests (first time: npx playwright install chromium)
npm run lint
```

**Live generation runs the offline engine,** and nothing here needs a paid account to run, test or deploy. The engine uses vendor families, OAuth discovery metadata and patterns across the researched apps; no model is called. The code also has a live research agent (Claude with web search) that switches on with `ANTHROPIC_API_KEY`. That's a paid API, so it's off here, and the agent has only been tested against a mocked API. To put the demo online for free, see [docs/DEPLOY.md](docs/DEPLOY.md).

## Key decisions

1. **Lead with the wait.** Cards and guides answer "how long, and who approves it" before anything else, and the route to production draws approval gates as diamonds.
2. **Provider approval is separate from customer approval.** "Approval" means the provider reviews or partners with you; a customer's admin installing the app is a different queue with a different owner, shown in its own section.
3. **Human or agent, on every step.** Each step names an owner and says whether an agent can do it: 359 of 710 steps can be. The rest (sign-ins, legal terms, verification, reviewer replies) set the schedule.
4. **Library first.** The generator returns a researched guide instantly when one exists, and drafts only for the long tail, in the same format, with a verify list and an email for the vendor.
5. **Unconfirmed means unconfirmed.** A generated guide's provider approval reads "Unconfirmed" unless a researched app on the same developer platform backs it. When no research pattern fits, the plan assumes a provider review, so a wrong guess costs some preparation, not a launch date. Names it doesn't recognize get a generic plan, labelled as one.
6. **Small and strict.** No framework, build step or runtime dependency; a CSP with no inline code and Trusted Types; a discovery probe that can't reach private addresses; rate-limited generation.

## Evidence

AI research agents did the research. They worked to a written brief ([docs/research/BRIEF.md](docs/research/BRIEF.md)): web search and page fetches only, official docs first, no sign-ins or accounts, and inferences marked "likely". The 103 guides cite 367 sources; confidence is 29 High, 56 Medium and 18 Low. A spot check of 11 claims ([docs/EVIDENCE.md](docs/EVIDENCE.md)) confirmed Slack's review timelines, install minimum and rate limits, and documents the generator errors fixed in v3.3.0. It also found one Low-confidence guide wrong: Close reviews an app before other organizations can connect to it. That guide is now corrected from Close's docs.

## Limitations

- Generated guides are estimates. A category pattern can point the wrong way (Dropbox looks self-serve from its category but requires production approval), which is why its approval reads "Unconfirmed".
- The live research agent has never run against the real API.
- The library is a snapshot from 28 Oct 2026. Treat the 18 Low-confidence guides as hypotheses: the spot check found one of three wrong.
- On the free host, the demo sleeps after 15 idle minutes (about a minute to wake), and its share store is wiped whenever it restarts. A share link that outlives its guide names the app and generates it again in one click; library guide links always work.
- There's no sign-in: anyone with the link can run generations, within the rate limit.

## What I'd do next

1. Re-check the other Low-confidence guides in a browser, which the research rules didn't allow.
2. Run the live agent on ten researched apps and compare its drafts with the research.
3. Add "Was this right?" to generated guides, feeding a review queue that promotes good drafts into the library, and re-verify the library on a schedule.
4. For production: shared storage for share links, the cache and rate limits; sign-in with per-user quotas; more than one instance; proxy-aware rate limiting.

More detail: [docs/PRODUCT.md](docs/PRODUCT.md) (the full product write-up), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [CHANGELOG.md](CHANGELOG.md).
