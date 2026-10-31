/**
 * Small view helpers shared by the library, guide and generator views. Pure functions that
 * return html`` views; no state, no listeners.
 */
import { PATHS, approvalLabel } from "../../shared/guide-model.js";
import { hashString, initials } from "../../shared/text.js";
import { href } from "../router.js";
import { html, raw } from "./dom.js";
import { effortGlyph, icon } from "./icons.js";

/** One of 12 hue buckets (.hue-0 … .hue-11 in components.css), stable per name. */
export const hueFor = (name) => hashString(name) % 12;

export function monogram(name, { large = false } = {}) {
  return html`<span class="mono-tile hue-${hueFor(name)}${large ? " lg" : ""}" aria-hidden="true">${initials(name)}</span>`;
}

/** The connection path. `unconfirmed`: a generated estimate, so the pill says so instead of reading as a fact. */
export const pathPill = (path, { unconfirmed = false } = {}) =>
  html`<span class="path-pill" data-path="${path}">${PATHS[path]?.label ?? "Unknown path"}${unconfirmed ? " (unconfirmed)" : ""}</span>`;

/** Effort tier with its shape. "N/A" reads "No path" for apps with no connector, else "Not rated". */
export function effort(level, { withLabel = true, path = "" } = {}) {
  const text = level === "N/A" ? (path === "none" ? "No path" : "Not rated") : level;
  return html`<span class="effort">${effortGlyph(level)}${withLabel ? html`<span>${text}</span>` : ""}</span>`;
}

/**
 * Provider approval. `atScale`: none to start, but the provider gates growth (e.g. verification
 * at 100 servers). `compact` is the card wording, read next to the shield. `unconfirmed`: the
 * value is a generated estimate nobody has checked, so it reads "Unconfirmed" whatever it says.
 */
export function approval(required, { short = false, atScale = false, compact = false, unconfirmed = false } = {}) {
  if (unconfirmed) {
    const text = compact || short ? approvalLabel({ required, unconfirmed }) : "Provider approval unconfirmed";
    return html`<span class="approval" data-required="unconfirmed">${icon("shieldQuestion")}<span>${text}</span></span>`;
  }
  const label = required === false && atScale ? "Not to start" : approvalLabel({ required });
  const long = required === true ? "Approval required" : required === false ? (atScale ? "Approval only at scale" : "No provider approval") : "No connector path";
  const brief = required === true ? "Approval" : required === false ? (atScale ? "At scale" : "No approval") : "No path";
  return html`<span class="approval" data-required="${String(required)}"${atScale ? raw(' data-at-scale="true"') : ""}>${icon(required ? "shield" : "shieldOpen")}<span>${compact ? brief : short ? label : long}</span></span>`;
}

export function scopeMeter(level, { label = true } = {}) {
  return html`<span class="meter" data-level="${level}"><span class="meter-bars" aria-hidden="true"><i></i><i></i><i></i></span>${label ? html`<span>${level}</span>` : ""}</span>`;
}

/* ---------------------------------------------------------------------------------------- */
/* Route bar: time to production on one log scale (1 hour … 6 months) shared by every card, */
/* so the waits are comparable at a glance.                                                 */
/* ---------------------------------------------------------------------------------------- */
const MIN_DAYS = 1 / 24;
const MAX_DAYS = 180;
export const routePos = (days) =>
  Math.min(1, Math.max(0.02, (Math.log(days) - Math.log(MIN_DAYS)) / (Math.log(MAX_DAYS) - Math.log(MIN_DAYS))));
const TICKS = [1, 7, 30, 90];
const pct = (x) => `${(x * 100).toFixed(2)}%`;

export function routeBar({ days, path, gated, scale = false }) {
  const unknown = !(days < 999) && path !== "none";
  const end = path === "none" ? 0 : unknown ? 1 : routePos(days);
  const ticks = TICKS.map((d) => `<line class="tick" x1="${pct(routePos(d))}" x2="${pct(routePos(d))}" y1="1" y2="9"/>`).join("");
  const fill = end > 0 ? `<rect class="fill${unknown ? " unknown" : ""}" x="0" y="3" width="${pct(end)}" height="4" rx="2"/>` : "";
  // A nested <svg> puts its origin at the end of the fill, so the marker is drawn around (0, 0).
  const marker =
    end > 0 && !unknown
      ? `<svg x="${pct(end)}" y="5" overflow="visible">${gated ? '<path class="gate" d="M0 -4.5 4.5 0 0 4.5 -4.5 0z"/>' : '<circle class="end" r="3"/>'}</svg>`
      : "";
  // Constant markup with numbers we computed; no data strings inside.
  const svg = raw(
    `<svg aria-hidden="true" focusable="false"><rect class="track" x="0" y="3" width="100%" height="4" rx="2"/>${ticks}${fill}${marker}</svg>`,
  );
  return html`<div class="route" data-path="${path}">${svg}${scale ? html`<div class="route-scale" aria-hidden="true"><span>1 hour</span><span>1 day</span><span>1 week</span><span>1 month</span><span>6 months</span></div>` : ""}</div>`;
}

/* ---------------------------------------------------------------------------------------- */

/* ---------------------------------------------------------------------------------------- */
/* Legend marks: the same shapes the route bars and cards draw, so a key can show, not tell.  */
/* ---------------------------------------------------------------------------------------- */
const MARKS = {
  median: '<circle cx="6" cy="6" r="3.6" class="mark-end"/>',
  gate: '<path d="M6 1.2 10.8 6 6 10.8 1.2 6z" class="mark-gate"/>',
  hatch: '<rect x="0.5" y="0.5" width="11" height="11" rx="2.5" fill="url(#hatch)" class="mark-hatch"/>',
};
export const mark = (kind) =>
  raw(`<svg class="icon mark" width="0.85em" height="0.85em" viewBox="0 0 12 12" aria-hidden="true" focusable="false">${MARKS[kind] ?? ""}</svg>`);

/** The key to a card's icon row, shown once above the grid instead of labels on every card. */
export function cardLegend() {
  return html`<ul class="legend" aria-label="Card key">
    <li>${icon("beaker")}First test</li>
    <li>${icon("shield")}Provider approval</li>
    <li>${scopeMeter("High", { label: false })}Scope complexity</li>
    <li>${mark("gate")}Approval gate on the time bar</li>
  </ul>`;
}

/**
 * A library card that flips. The front is the at-a-glance summary (the whole face opens the
 * guide); the back shows who does the work and the biggest blocker. Only the face in view is
 * interactive: the other is `inert`, so keyboards and screen readers never reach hidden content.
 * `s` is a guide summary from /api/guides.
 */
export function appCard(s, { featured = false } = {}) {
  const gated = s.approvalRequired === true;
  const guideHref = href(`/guides/${encodeURIComponent(s.id)}`);
  const backId = `card-back-${s.id}`;
  return html`<li class="flip" data-flipped="false">
    <article class="card" data-path="${s.path}">
      <div class="card-face card-front">
        <div class="card-head">
          ${monogram(s.name, { large: featured })}
          <div class="card-title">
            <h3><a class="card-link" href="${guideHref}">${s.name}</a></h3>
            ${pathPill(s.path)}
          </div>
          ${effort(s.difficulty, { path: s.path })}
        </div>
        <p class="card-verdict">${s.verdict}</p>
        <div class="card-time">
          <p class="card-prod"><span class="visually-hidden">Time to production: </span>${s.prodShort}</p>
          ${routeBar({ days: s.prodDays, path: s.path, gated })}
        </div>
        <div class="card-foot">
          <ul class="card-facts">
            <li title="First test">${icon("beaker")}<span class="visually-hidden">First test: </span><span>${s.firstShort}</span></li>
            <li title="Provider approval"><span class="visually-hidden">Provider approval: </span>${approval(s.approvalRequired, { compact: true, atScale: s.approvalAtScale })}</li>
            <li title="Scope complexity"><span class="visually-hidden">Scope complexity: </span>${scopeMeter(s.scopeComplexity)}</li>
          </ul>
          <button type="button" class="flip-btn" data-flip aria-expanded="false" aria-controls="${backId}" title="Show details">
            ${icon("flip")}<span class="visually-hidden">Show details for ${s.name}</span>
          </button>
        </div>
      </div>
      <div class="card-face card-back" id="${backId}" inert>
        <div class="back-head">
          ${monogram(s.name)}
          <p class="back-title">${s.name}</p>
          <button type="button" class="flip-btn" data-flip title="Show summary">${icon("flip")}<span class="visually-hidden">Show summary for ${s.name}</span></button>
        </div>
        ${s.steps?.total ? splitBar({ human: s.steps.human, agent: s.steps.agent, words: true }) : html`<span></span>`}
        ${s.blocker ? html`<div class="back-block"><p class="back-label">${icon("warn")}Watch out for</p><p class="back-text">${s.blocker}</p></div>` : html`<span></span>`}
        <div class="back-foot">
          <span class="tag">${s.confidence} confidence</span>
          <a class="btn back-open" href="${guideHref}"><span>Open guide</span>${icon("arrowRight")}</a>
        </div>
      </div>
    </article>
  </li>`;
}

/**
 * Who does the work: a two-part bar (human, agent) with counts. Reads at a glance where a
 * sentence would need parsing.
 */
export function splitBar({ human, agent, words = false }) {
  const total = Math.max(1, human + agent);
  const h = ((human / total) * 100).toFixed(2);
  // SVG geometry, not inline styles: the CSP allows no style attributes. Numbers only.
  const bar = raw(
    `<svg class="split-track" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true" focusable="false"><rect class="is-human" width="${h}" height="6"/><rect class="is-agent" x="${h}" width="${(100 - h).toFixed(2)}" height="6"/></svg>`,
  );
  return html`<span class="split-bar" role="img" aria-label="${human} steps need a human, ${agent} an agent can do">
    ${bar}
    <span class="split-key" aria-hidden="true"><span>${icon("human")}${human}${words ? " human" : ""}</span><span>${icon("agent")}${agent}${words ? " agent" : ""}</span></span>
  </span>`;
}

export function callout({ kind = "info", title = "", body }) {
  const ico = { info: "info", warn: "warn", error: "error" }[kind] ?? "info";
  return html`<div class="callout${kind === "info" ? "" : ` is-${kind}`}" role="${kind === "error" ? "alert" : "note"}">
    ${icon(ico)}
    <div class="callout-body">${title ? html`<p class="callout-title">${title}</p>` : ""}${body}</div>
  </div>`;
}

export function button({ label, iconName, action, primary = false, quiet = false, extra = "", attrs = raw("") }) {
  return html`<button type="button" class="btn${primary ? " btn-primary" : ""}${quiet ? " btn-quiet" : ""}${extra ? ` ${extra}` : ""}" data-action="${action}" ${attrs}>${iconName ? icon(iconName) : ""}<span class="btn-label">${label}</span></button>`;
}
