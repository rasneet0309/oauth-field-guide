/** "How to read a guide": the vocabulary, the rubrics and where the data comes from. */

import { PATHS, PATH_ORDER } from "../../shared/guide-model.js";
import { formatDate } from "../../shared/text.js";
import { href } from "../router.js";
import { effort, pathPill, scopeMeter } from "../ui/components.js";
import { html, raw, render } from "../ui/dom.js";
import { icon } from "../ui/icons.js";

/** Which engine this copy of the app runs, in a sentence. */
function engineHere(config) {
  if (config.runsIn === "page")
    return "This demo runs the offline engine inside the page, without the discovery probe, since a web page can't read other sites' metadata. Run the server for the probe and the live research agent.";
  if (config.mode === "live") return "This server runs the live research agent.";
  return config.discoveryProbe ? "This server runs the offline engine." : "This server runs the offline engine with the discovery probe turned off.";
}

/** A row of apps-per-path bars: one scale (the biggest path), so lengths compare. */
function pathCount(count, max) {
  const w = ((count / Math.max(1, max)) * 100).toFixed(1);
  // SVG geometry, not inline styles: the CSP allows no style attributes. Numbers only.
  return html`<span class="count-bar">${raw(`<svg viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true" focusable="false"><rect class="track" width="100" height="6" rx="3"/><rect class="fill" width="${w}" height="6" rx="3"/></svg>`)}<span>${count}</span></span>`;
}

const tile = (glyph, title, body) => html`<li class="key-tile"><span class="key-glyph" aria-hidden="true">${glyph}</span><div><p class="key-title">${title}</p><div class="key-text">${body}</div></div></li>`;
const chips = (items) => html`<ul class="tag-list">${items.map((t) => html`<li><span class="tag">${t}</span></li>`)}</ul>`;

export function renderMethod(root, ctx) {
  const { config, summaries } = ctx;
  const stats = config.library.stats;
  const maxPath = Math.max(...PATH_ORDER.map((p) => stats.byPath[p] ?? 0));
  const examples = (p) =>
    summaries
      .filter((s) => s.path === p)
      .sort((a, b) => (a.featuredRank ?? 99) - (b.featuredRank ?? 99) || a.name.localeCompare(b.name))
      .slice(0, 3);
  const live = config.mode === "live";

  render(
    root,
    html`<article class="method">
      <header class="gen-head">
        <h1 id="method-title" tabindex="-1">How to read a guide</h1>
        <p>Every guide answers the same questions in the same order. This is the key to its marks and labels.</p>
      </header>

      <section class="gsection" aria-labelledby="m-paths">
        <h2 id="m-paths">Connection paths</h2>
        <p class="key-note">The path sets most of the timeline, and it's the only thing colour encodes.</p>
        <ul class="path-key">
          <li class="path-key-head" aria-hidden="true"><span>Path</span><span>Apps</span><span>What it means</span><span>For example</span></li>
          ${PATH_ORDER.map(
            (p) => html`<li data-path="${p}">
              <span class="pk-path">${pathPill(p)}</span>
              <span class="pk-count">${pathCount(stats.byPath[p] ?? 0, maxPath)}<span class="visually-hidden"> apps</span></span>
              <span class="pk-desc">${PATHS[p].desc}</span>
              <span class="pk-ex"><span class="visually-hidden">For example: </span>${examples(p).map((s, i) => html`${i ? ", " : ""}<a href="${href(`/guides/${encodeURIComponent(s.id)}`)}">${s.name}</a>`)}</span>
            </li>`,
          )}
        </ul>
      </section>

      <section class="gsection" aria-labelledby="m-effort">
        <h2 id="m-effort">Effort</h2>
        <p class="key-note">Production for outside customers, approval waits included. Five research ratings fold into three shapes.</p>
        <ul class="key-grid">
          ${tile(effort("Easy", { withLabel: false }), "Easy", "Rated easy. Mostly code, no provider queue.")}
          ${tile(effort("Moderate", { withLabel: false }), "Moderate", "Rated moderate. A review, an admin install or a fiddly console.")}
          ${tile(effort("Complex", { withLabel: false }), "Complex", "Rated hard or very hard. Verification, partner programs or months of waiting.")}
        </ul>
      </section>

      <section class="gsection" aria-labelledby="m-approval">
        <h2 id="m-approval">Who has to approve you</h2>
        <ul class="key-grid is-two">
          ${tile(
            icon("shield"),
            "Provider approval",
            html`The provider reviews, verifies or partners with you once, before any customer can connect. Shown on every card. A generated guide says “Unconfirmed” unless a researched app on the same platform backs the answer.${chips(["Slack Marketplace review", "Google verification", "Meta App Review"])}`,
          )}
          ${tile(
            icon("building"),
            "Customer approval",
            html`An admin at each customer installs or consents to your app. Listed in the guide under Approval & verification.${chips(["Workspace admin install", "Tenant admin consent"])}`,
          )}
        </ul>
      </section>

      <section class="gsection" aria-labelledby="m-scopes">
        <h2 id="m-scopes">Scope complexity</h2>
        <ul class="key-grid">
          ${tile(scopeMeter("Low", { label: false }), "Low", "A few coarse scopes or key-level permissions. Nothing scope-triggered.")}
          ${tile(scopeMeter("Medium", { label: false }), "Medium", "Granular scopes to pick, justify or keep in sync.")}
          ${tile(scopeMeter("High", { label: false }), "High", "A scope agents need is gated by review, verification or scope-specific admin consent.")}
        </ul>
        <p class="key-note">An admin installing the whole app is customer approval, so it doesn't raise this rating.</p>
      </section>

      <section class="gsection" aria-labelledby="m-steps">
        <h2 id="m-steps">Needs a human, or an agent can do it</h2>
        <ul class="key-grid is-two">
          ${tile(icon("human"), "Needs a human", chips(["Sign-in with 2FA", "Legal terms", "Identity checks", "Payments", "Demo videos", "Reviewer replies"]))}
          ${tile(icon("agent"), "Agent can do", chips(["API, CLI or manifest setup", "OAuth code", "Test calls", "Listing drafts", "Privacy text", "Scope justifications"]))}
        </ul>
        <p class="key-note">Every step also names an owner: Owner, Developer, QA, Security, Legal, Design or Ops.</p>
      </section>

      <section class="gsection" aria-labelledby="m-data">
        <h2 id="m-data">Where the data comes from</h2>
        <ol class="flow" aria-label="Sources, in order of trust">
          <li>${icon("book")}<span>Official developer docs</span></li>
          <li>${icon("file")}<span>Help centers and changelogs</span></li>
          <li>${icon("human")}<span>Community reports for real timelines</span></li>
        </ol>
        <ul class="tag-list">
          <li><span class="tag">${stats.total} apps</span></li>
          <li><span class="tag">${stats.inDepth} in-depth guides</span></li>
          <li><span class="tag">Checked ${formatDate(config.library.lastChecked, { month: "long" })}</span></li>
          <li><span class="tag">Inferences marked “likely”</span></li>
        </ul>
      </section>

      <section class="gsection" aria-labelledby="m-gen">
        <h2 id="m-gen">How the Live Generator works</h2>
        <ol class="flow is-decision" aria-label="Generator steps">
          <li>${icon("search")}<span>Your app, by name or website</span></li>
          <li>${icon("book")}<span>In the library? The researched guide, instantly</span></li>
          <li>${icon(live ? "compass" : "key")}<span>${live ? "Live agent: web research in the library's format" : "Offline engine: vendor family, OAuth metadata, research patterns"}</span></li>
          <li>${icon("checkCircle")}<span>Validated draft, confidence capped at medium, with a verify list</span></li>
        </ol>
        <p class="key-note">${engineHere(config)} <a href="${href("/generate")}">Open the Live Generator</a>.</p>
      </section>
    </article>`,
  );
  return { title: "How to read a guide – OAuth Field Guide" };
}
