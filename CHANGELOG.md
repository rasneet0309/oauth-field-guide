# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [3.4.0] - 2026-10-30

Review fixes before submission: the Close guide is corrected, a pasted website now works the way the generator says it does, and expired share links can be generated again.

### Fixed

- **The Close guide.** Close reviews an app before other organizations can connect to it ("Make Public", then submit for review), but the guide said there was no mandatory review. It now follows Close's docs: a hand-reviewed path override (self-serve → provider review), a new verdict, production gate and steps, and the two pages it rests on in place of a link the original research run cited but never read. Headline numbers: 36 apps (was 35) need provider approval, 18 (was 17) through a review, 28 (was 29) are self-serve, and the guides cite 367 sources (was 366). The medians are unchanged, because Close publishes no review timeline.
- **A pasted website identifies the app.** `https://www.strava.com` came back "not recognized", and its plan told you to find Strava's website and run the generator again. A website the user types now counts, so the plan starts from it and its verify searches stay on that domain.
- **URL paths and subdomains aren't category evidence.** `https://developers.strava.com/docs` was filed under Productivity & PM because "docs" in the path matched a keyword, and a `help.` subdomain read as Support & Helpdesk. Keywords now match only the name (without words like "docs" and "API") and the registrable domain. "Stripe docs" now opens the Stripe guide, and a domain guessed from a name drops those words too.
- **Vendor-family guides name the right reviewer.** Confluence's guide said "no review by Confluence" and Power BI's that "Power BI reviews or verifies the app". Atlassian and Microsoft own those developer platforms, so the verdict, production gate, prerequisites, roles and verify links now name them.

### Added

- **Expired share links can be generated again.** Share links carry the app and intent (`/g/<id>?app=Zoom&intent=read`), in the copied link, the Markdown export and the recent-guides list. When the share store has forgotten a guide, the page names the app and offers "Generate it again", which runs straight away. A link opened from outside the app still only fills in the form.
- `scripts/github-first-token.mjs`: a dependency-free GitHub device-flow helper for a free setup attempt. It never prints the token.

### Changed

- The README, `docs/PRODUCT.md` and `docs/EVIDENCE.md` say plainly that AI research agents did the research.
- The README has a "Try it on real apps" list: seven library apps with different setup challenges, and inputs for the Live Generator.
- `docs/EVIDENCE.md`: row 8 (Close) is now "Corrected".

### Tests

- 79 unit tests (was 75): a pasted website, keywords in paths and subdomains, vendor reviewer names, share-link encoding and the exported share link.
- 22 browser tests (was 21): an expired share link names its app and generates the guide again in one click.

## [3.3.0] - 2026-10-30

A focused, honest slice for submission: the offline generator no longer states guesses as facts, the README fits on one page, and the research has a sourced spot check.

### Changed

- **Unconfirmed provider approval.** A generated guide with no vendor family behind it marks provider approval "Unconfirmed" (a new optional `approval.unconfirmed` field, accepted by the validator and kept by the sanitiser). Its verdict, production gate, path pill and Markdown export describe what similar apps do instead of stating it as a fact about the app.
- **No usable pattern means planning for a review.** Without a vendor family or a clear category pattern, the offline engine now plans for a provider review instead of assuming self-serve OAuth. Discovery metadata that contradicts a "customer API key" pattern also leads to a planned review.
- **A default category is no evidence.** `guessCategory()` returns nothing when no keyword matches, instead of "Productivity & PM", and the run log no longer calls that a keyword guess.
- **"Not recognized."** A name that matches no researched app, vendor family or category keyword is reported as not recognized and gets a generic plan that starts with "Confirm the app", plus a verify link to find the app's website.
- Unconfirmed self-serve estimates rate effort Moderate and production "1–3 days + any review", because "Easy" means no provider queue.
- The README is one page; the full write-up moved to `docs/PRODUCT.md`. New `docs/EVIDENCE.md` (the research method and a spot check of 11 claims) and `docs/DEPLOY.md` (a free single-instance demo on Render).

### Fixed

- Generated guides for Zoom, Spotify and Dropbox said the provider doesn't review apps, and "asdkjhqwe" got a complete self-serve guide.
- The Markdown export printed "Not required: None" and the guide page "Not required (None)"; a plain "None" now adds nothing.

### Tests

- 75 unit tests (was 70): Zoom, Spotify and Dropbox never state "no review" or "Not required"; a nonsense name is "not recognized"; Confluence, a vendor family, stays confirmed; approval labels and the Markdown fix. The two engine tests that asserted the old self-serve default now assert the review plan.
- 21 browser tests (was 20): a generated guide shows "Unconfirmed".

### Notes

- `docs/AUDIT.md`, `docs/UI.md` and `deploy/k8s/`, named in the v2.1.0 entries below, shipped with the v2.1.0 release and aren't in this repo.
- The previous zip was named `oauth-field-guide-v2_1_0.zip` but held v3.2.0. This release is packaged as `oauth-field-guide-v3.3.0.zip`, matching `package.json`.
- Known issue: the Close guide says there's no mandatory review, but Close reviews an app before other organizations can connect. It's flagged in `docs/EVIDENCE.md` and not yet corrected, so the library's headline numbers are unchanged.

## [3.2.0] - 2026-10-30

### Added

- **Flip cards.** Every app card turns over (its flip button, or Escape to turn back) to show who does the work (human vs agent steps), the biggest blocker, the confidence and an "Open guide" link. The face out of view is `inert`, so keyboards and screen readers only reach what's visible; focus follows the turn; reduced motion makes it instant. The front still sets the card's size, so the grid doesn't jump.
- **Back link on guide pages.** "Back to library" (or "Back to generator") steps back in history when you came from inside the app, restoring the library's filters, scroll position and focus on the card you opened. Arriving from a link elsewhere, it reads "All apps" (or "Live Generator") and goes there. It replaces the breadcrumb; the category moved into the guide's tags.
- History entries record their position, origin, scroll and focused link, in all three routing modes.

### Fixed

- Errors no handler catches are logged as one JSON line with the stack, and the process exits 1 so it restarts cleanly. A port that's already taken logs `listen_failed` with the code and exits 1 (tested).
- The SSE heartbeat no longer writes to a response that has closed.
- The secret-scan baseline excludes itself, so re-scanning never flags its own hashes.

## [3.1.0] - 2026-10-30

Production-readiness audit: UI simplification, a security and bug pass, and deployment tooling.

### Changed

- **Filters on one line.** Effort and approval are glyph-led toggles (press again to clear), path, category and sort are compact selects, and the result count sits by the sort. The row fits from 1024px up and scrolls inside itself below that.
- **Explain with marks, not labels.** The chart's paragraph became a key (median, approval diamond, hatch for "no published timeline") with app counts per path. Cards drop their four label/value pairs, category and kind tag for an icon row (first test, approval, scope) explained by one key above the grid, and lead with time to production over its bar.
- **Method page** is a visual key: path list with app-count bars, effort, approval, scope and human/agent tiles, and step flows for sources and the generator.
- Guide key facts show human vs agent steps as a split bar; the generator shows its steps as a strip instead of a paragraph.
- Health checks answer any `Host`, so Docker and Kubernetes probes work with `ALLOWED_HOSTS` set.
- The person running the generator sees a plain reason when the live agent fails ("busy", "unavailable"); upstream status text stays in the server log.

### Fixed

- Icons in running text had no size and filled the column (the Method page showed giant person and robot icons).
- Tables on phones split words letter by letter; they now keep words whole and scroll inside their frame.
- A generation whose stream closed without a result left stages spinning; it now reports that the run didn't finish.
- A stale navigation that failed could replace the page you had moved on to with an error.
- A failed button action became an unhandled promise rejection with no feedback; it now shows an error toast.
- A non-JSON response (for example a proxy error page) surfaced as a raw parser error.
- The agent log used `<ol role="log">`, which strips list semantics from its items (axe "listitem").
- Dead code: unused imports and variables found by the new lint.

### Added

- `npm run lint` (ESLint 10, correctness rules) and an axe-core WCAG 2.2 AA scan of the main views in both themes.
- CI workflow: lint, tests on Node 20 and 22, demo build, browser tests, secret scan against an audited `detect-secrets` baseline, image build and smoke test.
- `compose.yaml` with a read-only root filesystem, no capabilities and `no-new-privileges`; a `NODE_IMAGE` build argument for digest pinning; OCI labels.
- README: a production deployment guide (host names, proxies, streaming, secrets, health, replicas).

## [3.0.0] - 2026-10-29

APM Integrations: OAuth Field Guide & Live Generator. A new architecture around the v2.1.0 research: a server, a generator for any app, and a dashboard rebuilt around time to production.

### Added

- **Live Generator** (`/generate`, `POST /api/generate`): name any app or paste its URL, watch the agent's stages and log stream in, and get a guide in the library's format with a share link (`/g/<id>`), a verify checklist and a vendor email.
  - **Offline research engine** (default): library match, vendor families, OAuth discovery probe (OpenID Connect Discovery, RFC 8414, RFC 9728 for hosted MCP servers) and category patterns from the research.
  - **Live research agent** (with `ANTHROPIC_API_KEY`): Claude with web search, following the v2 research brief, answering through a `submit_guide` tool; validated with the library's converter, confidence capped at Medium, automatic fallback to the offline engine.
  - Result cache, per-client rate limit (proxy-aware with `TRUST_PROXY` hops, IPv6 by /64), concurrency gate, SSRF-guarded probe, a `Host` allow-list against DNS rebinding (`ALLOWED_HOSTS`), and links that pre-fill the generator wait for a click.
- **Node server** with no runtime dependencies: guides API (JSON and Markdown, with `PUBLIC_URL` for export links behind a proxy), config endpoint, health check, SPA routes with real 404s, strict security headers.
- **Guide schema v3** shared by the browser, server and scripts: effort tiers (Easy/Moderate/Complex), provider approval, scope complexity, time to production in days, human/agent step counts.
- **Four new in-depth guides** restructured from existing research: Salesforce, Stripe, HubSpot and Shopify (10 in total).
- **Scope complexity** for all 103 apps, hand-assigned against a written rubric with a reason each.
- **Approval gates** per phase (required or optional listing) and "at scale" approval notes, curated in `data/curated/gates.json` and `approval-notes.json`.
- Dashboard: "Approval queues, not code, set most launch dates" band; cards with a shared time-to-production scale; filters for effort, provider approval, path and category; sorting by speed and effort.
- Guide view: route to production with approval gates, key facts, human/agent step filter, Developer action items checklists, persistent ticks, copy/share/download.
- Method page explaining every label and both engines.
- Single-file demo build (`npm run build`): a standalone HTML file and the same page as a fragment for page hosts.
- 68 unit and integration tests (including a scripted Anthropic streaming mock) and 14 browser tests, on Node 20.12+ and 22.

### Changed

- Routes are real paths (`/guides/slack`) instead of hashes; the single-file demo keeps hash routes.
- The builder questionnaire from v2 became the generator's offline engine: the agent infers what the four questions used to ask.

### Removed

- v2's Markdown export of every guide, nginx config, Kubernetes manifests and CI workflows are not carried into this repo; v3 runs as one Node process and ships a Dockerfile. They remain in the v2.1.0 release, and the v2 entries below describe that release.

## [2.1.0] - 2026-10-29

> `docs/AUDIT.md`, `docs/UI.md` and `deploy/k8s/`, mentioned in this and older entries, shipped with the v2.1.0 release and aren't in this repo.

UI/UX, accessibility and production-readiness release after a second audit (`docs/AUDIT.md`): WCAG 2.2 AA, loading and failure states, a design-token system, 16 bug fixes from an independent review plus 9 from a review of the release candidate, Kubernetes manifests and a release pipeline.

### Accessibility (WCAG 2.2 AA)

- Focus is never hidden under the sticky top bar or guide tabs (SC 2.4.11).
- Form-control boundaries at 3:1 or more in both themes (SC 1.4.11).
- Every control is at least 24 × 24 px, including the path-mix bar, breadcrumbs and the builder's "Check" links (SC 2.5.8).
- The list layout has correct list semantics.
- Forced colours (Windows High Contrast) keep selected tabs, filters, answers and bars visible.
- Sticky bars stop being sticky on short screens.
- Reduced motion shortens animations instead of cancelling them.
- Search buttons expose `aria-keyshortcuts`.
- The layout follows the browser's font-size setting: sizes in rem, breakpoints in em. At a 24 px default the page switches to the tablet layout instead of overlapping or scrolling sideways.
- Every guide reflows at 320 px; the Microsoft 365 guide used to scroll sideways on phones.

### Changed

- Design tokens for type (rem scale; follows the browser's font-size setting), spacing (Tailwind scale), radii, control heights, layers and motion; every stylesheet uses them. New `states.css` and `preferences.css`; see `docs/UI.md`.
- Timelines, stats and long names wrap instead of ending in an ellipsis.
- The journey is a vertical timeline on phones.
- Keyboard hints show Ctrl K on Windows and Linux, ⌘K on Apple devices.
- Empty results explain why and offer "Clear filters" and "Search apps". Filter chips are plain "Remove filter" buttons.
- The search dialog has a close button for mouse and touch.
- Builder answers update the guide in place without adding a browser-history entry per answer.
- Pasting a vendor's address (for example `https://api.slack.com/apps`) opens its researched guide.
- `npm run build` also writes `dist/artifact/`.

### Added

- Loading placeholders, `aria-busy`, a "Still loading… reload" note when the app can't start, and a no-JavaScript state without dead controls.
- A clearer fatal-error page and error banner.
- Busy and done states on action buttons. A double click no longer runs an action twice.
- Kubernetes Kustomize base in `deploy/k8s/`: Deployment, Service, PodDisruptionBudget, deny-egress NetworkPolicy and an Ingress example.
- `release.yml`: on a version tag, pushes the image to GHCR with an SBOM, SLSA provenance and a GitHub attestation, and attaches the single file to a GitHub Release.
- CI job linting workflows (actionlint) and validating the manifests (kustomize + kubeconform).
- Performance budgets in the build-output tests.
- 57 unit tests and 24 e2e tests (151 and 49 in total), including UI states, WCAG 2.2 checks, all guides at 320 px, a large browser font, forced colours and the Artifact build.
- `docs/UI.md`.

### Fixed

- The icon-only Download button went blank after a download.
- A pending download or copy could land in another guide.
- After one slow answer from the Artifact viewer, downloads stopped working.
- One damaged stored record hid, then erased, all built guides.
- Bad research data could pass the build and crash a guide tab.
- Enter during Japanese, Chinese or Korean input-method composition built a guide.
- "google" opened Google Ads instead of Google Workspace.
- Quick builder answers reset the tab, scroll position and focus.
- Clicking inside the search dialog broke its keyboard handling.
- Copying through the fallback lost keyboard focus.
- Drawer focus and resize problems on phones.
- "Check" links disappeared for names with an apostrophe; `.co.uk` vendors got wrong site searches.
- Markdown export hid `<placeholders>`.
- An out-of-range `SOURCE_DATE_EPOCH` left a half-built `dist/`.
- New checklist ticks could be dropped once old ones piled up.
- Sidebar labels pushed the rail wider than its column; they wrap now.
- The "Ctrl K" hint wrapped onto two lines on phones.

### Security

- The secret scanner now catches `UPPER_SNAKE` names, unquoted values in config files, the token formats of 13 more providers (Google OAuth client secrets, Stripe webhooks, Slack app tokens, SendGrid, npm, Shopify, HubSpot, Notion, Linear, Atlassian, Meta, Twilio, Microsoft) and more credential file names.
- The preview server refuses Windows and macOS name tricks (`/_Headers`, `/_headers.`, `::$DATA`) and no longer treats a leading `//` as a host.
- The scanner also covers Dockerfile `ENV`/`ARG`, compose list entries and `.npmrc` registry tokens, and no longer flags URL or label keys such as `accessTokenUrl`.
- `PUBLIC_SITE_URL` must be https (http only for loopback) with no query or fragment, not even an empty `?` or `#`.
- The release workflow lower-cases image names (GHCR requires it) and both workflows pass actionlint with shellcheck.

## [2.0.0] - 2026-10-29

Production hardening after a security, quality and DevOps audit (`docs/AUDIT.md`). Same content and features; same look, with small visual differences listed under Changed.

### Security

- Strict Content-Security-Policy with Trusted Types, as an HTTP header (nginx, `_headers`) and a `<meta>` tag. The standalone file uses a hash-based CSP. Removed every inline script, inline style and inline event handler.
- Self-hosted fonts: no request to Google Fonts (or any third party) on page load.
- Fixed an attribute-injection sink: a tampered `localStorage` record could inject attributes into a link. Records are now validated on every read.
- All HTML goes through one Trusted-Types-guarded sink; ESLint blocks other sinks.
- External links use `rel="noopener noreferrer"`; `Referrer-Policy: no-referrer`.
- Build-time data is JSON only (v1 executed data files with `vm.runInNewContext`).
- Removed the `window.__ofg` debug global.

### Fixed

- Malformed links (e.g. `#b-%E0%A4%A`) no longer crash the page with `URIError`.
- Corrupt `localStorage` values no longer crash the library, palette or a guide.
- Non-Latin app names (Hindi, Chinese, Korean…) keep their name in built guides instead of all collapsing to "App" on one URL.
- Very long names ending in an emoji no longer crash the builder.
- Unknown `#app-…` links show a not-found page with suggestions instead of silently showing the library.
- Answer codes support more than 10 categories (base 36; v1 links still work).
- Built guides state one consistent review timeline.
- The download button no longer goes missing (or hangs) in the Artifact viewer: 4 s timeout, then a manual-copy fallback.
- Checklist ticks are keyed by step content, so they no longer jump to other steps when answers or data change. Ticks saved by v1 are reset once.
- A role filter that matches no remaining step resets itself.
- The theme toggle works when the browser blocks storage; the plan says when progress can't be saved.
- Sticky tabs no longer overlap the top bar by 1px; breadcrumbs no longer overlap on phones.
- Leaving a long guide opens the library at the top.

### Accessibility

- WCAG 2.1 AA colour contrast in both themes (v1: hundreds of axe contrast failures).
- Correct heading order, WAI-ARIA tabs with arrow keys, combobox palette with focus kept in the dialog, skip link, focus moves to each new page's heading, focus kept on re-rendered controls, labelled icon-only buttons on phones, underlined inline links, an off-screen drawer removed from the tab order.

### Added

- Project structure: ES modules (`lib`, `services`, `ui`, `views`), split CSS, JSON data, esbuild build with `web`, `standalone`, `artifact` and `guides` targets.
- 94 unit tests and 25 Playwright e2e tests, covering CSP, axe-core in both themes, the standalone file and the build output.
- Data validation (`npm run validate:data`); fixed one malformed source URL (Harvest).
- Secret scanning (`npm run scan:secrets`, gitleaks in CI).
- Dockerfile (non-root nginx, read-only), docker compose, nginx config with security and cache headers, `/healthz`, `/version.json`, JSON access logs, 404 page.
- CI: lint, tests on Node 22 and 24, build, e2e, hadolint, container smoke and e2e tests, Trivy, SHA-pinned actions, Dependabot.
- `.env.example`, `.editorconfig`, `.nvmrc`, ESLint and Prettier configs, README, SECURITY, deployment runbook, architecture notes, audit report.

### Changed

- Darker secondary-text, path and monogram colours (contrast).
- The library section "Guides built here" is now "Guides you built". It is stored in this browser only.
- The app version is shown in the sidebar footer.

## [1.0.0] - 2026-10-28

- Single-file prototype submitted with the take-home assignment.
