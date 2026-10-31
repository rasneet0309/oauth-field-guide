/**
 * Library (dashboard): the value proposition, search, "where the time goes", filters and
 * the app cards. Filtering and search run in the browser over the 103 summaries.
 */
import { DIFFICULTY_TIERS, PATHS, PATH_ORDER } from "../../shared/guide-model.js";
import { searchLibrary } from "../../shared/search.js";
import { href } from "../router.js";
import { appCard, cardLegend, mark, routeBar } from "../ui/components.js";
import { $, html, raw, render } from "../ui/dom.js";
import { effortGlyph, icon } from "../ui/icons.js";

/** Filters survive navigation within the session. */
const state = { q: "", difficulty: "", approval: "", path: "", category: "", sort: "featured" };

const SORTS = [
  ["featured", "Featured"],
  ["fastest", "Fastest"],
  ["easiest", "Easiest"],
  ["hardest", "Hardest"],
  ["name", "A to Z"],
];

export function daysText(d) {
  if (d == null || !(d < 999)) return "unknown";
  if (d < 1) return "under a day";
  if (d < 14) return `about ${Math.round(d)} days`;
  if (d < 60) return `about ${Math.round(d / 7)} weeks`;
  return `about ${Math.round(d / 30)} months`;
}

const rank = (s, dir) => (s.difficulty === "N/A" ? 99 : dir * DIFFICULTY_TIERS.indexOf(s.difficulty));

function apply(summaries, lib) {
  let items = state.q ? searchLibrary(lib, state.q) : [...summaries];
  if (state.difficulty) items = items.filter((s) => s.difficulty === state.difficulty);
  if (state.approval === "required") items = items.filter((s) => s.approvalRequired === true);
  if (state.approval === "none") items = items.filter((s) => s.approvalRequired === false);
  if (state.path) items = items.filter((s) => s.path === state.path);
  if (state.category) items = items.filter((s) => s.category === state.category);
  const by = {
    fastest: (a, b) => a.prodDays - b.prodDays || a.name.localeCompare(b.name),
    easiest: (a, b) => rank(a, 1) - rank(b, 1) || a.prodDays - b.prodDays,
    hardest: (a, b) => rank(a, -1) - rank(b, -1) || b.prodDays - a.prodDays,
    name: (a, b) => a.name.localeCompare(b.name),
    featured: (a, b) => (a.featuredRank ?? 99) - (b.featuredRank ?? 99) || a.name.localeCompare(b.name),
  }[state.sort];
  // A text search keeps its relevance order unless the visitor picked a sort.
  if (by && !(state.q && state.sort === "featured")) items.sort(by);
  return items;
}

const filtersActive = () => Boolean(state.q || state.difficulty || state.approval || state.path || state.category);

function timeband(config) {
  const { stats } = config.library;
  const rows = ["self", "key", "review", "partner"].map((p) => {
    const count = stats.byPath[p];
    const known = stats.withTimeline?.[p] ?? count;
    return { path: p, count, unknown: count - known, days: stats.medianProdDays[p] };
  });
  return html`<section class="timeband" aria-labelledby="tb-title">
    <div class="timeband-head">
      <div>
        <h2 id="tb-title">Approval queues, not code, set most launch dates</h2>
        <p class="timeband-sub">Median time to production by connection path, on the scale every card uses.</p>
      </div>
      <ul class="legend" aria-label="Chart key">
        <li>${mark("median")}Median</li>
        <li>${mark("gate")}Provider approval</li>
        <li>${mark("hatch")}No published timeline</li>
      </ul>
    </div>
    <div class="timeband-rows">
      ${rows.map(
        (r) => html`<div class="timeband-row" data-path="${r.path}">
          <span class="tb-path"><i class="dot" aria-hidden="true"></i>${PATHS[r.path].label}</span>
          <span class="tb-count">
            <span><span class="tb-n">${r.count}</span> apps</span>
            ${r.unknown ? html`<span class="tb-unknown" title="${r.unknown} of ${r.count} publish no timeline">${mark("hatch")}${r.unknown}<span class="visually-hidden"> with no published timeline</span></span>` : ""}
          </span>
          ${routeBar({ days: r.days ?? 999, path: r.path, gated: r.path === "review" || r.path === "partner" })}
          <span class="value">${daysText(r.days)}</span>
        </div>`,
      )}
      <div class="timeband-row timeband-scale" aria-hidden="true">
        <span></span><span></span>
        <div class="route-scale"><span>1 hour</span><span>1 day</span><span>1 week</span><span>1 month</span><span>6 months</span></div>
        <span></span>
      </div>
    </div>
  </section>`;
}

/** Toggle buttons for one filter. Pressing the active one clears it, so there's no "All" button. */
function toggles(name, label, options) {
  return html`<div class="segmented" role="group" aria-label="${label}">
    ${options.map(
      ([value, text, glyph]) =>
        html`<button type="button" data-filter="${name}" data-value="${value}" aria-pressed="${String(state[name] === value)}">${glyph}<span>${text}</span></button>`,
    )}
  </div>`;
}

function select(name, label, options, { glyph = "" } = {}) {
  return html`<span class="select-wrap${glyph ? " has-glyph" : ""}" data-select="${name}">
    ${glyph}
    <select class="select" data-filter-select="${name}" aria-label="${label}">
      ${options.map(([value, text]) => html`<option value="${value}" ${state[name] === value ? raw("selected") : ""}>${text}</option>`)}
    </select>
  </span>`;
}

/** One line: filters on the left, result count and sort on the right. Scrolls sideways when narrow. */
function filters(config) {
  return html`<div class="filters" data-needs-js>
    <div class="filters-row" role="group" aria-label="Filter and sort apps">
      ${toggles("difficulty", "Effort", [
        ["Easy", "Easy", effortGlyph("Easy")],
        ["Moderate", "Moderate", effortGlyph("Moderate")],
        ["Complex", "Complex", effortGlyph("Complex")],
      ])}
      ${toggles("approval", "Provider approval", [
        ["required", "Approval", icon("shield")],
        ["none", "No approval", icon("shieldOpen")],
      ])}
      ${select("path", "Connection path", [["", "All paths"], ...PATH_ORDER.map((p) => [p, PATHS[p].label])])}
      ${select("category", "Category", [["", "All categories"], ...config.library.categories.map((c) => [c, c])])}
      <button type="button" class="btn btn-quiet btn-clear" data-action="clear-filters" hidden>${icon("close")}<span>Clear</span></button>
      <span class="filters-end">
        <span id="results-count" class="results-count" role="status"></span>
        ${select("sort", "Sort", SORTS, { glyph: icon("sort") })}
      </span>
    </div>
  </div>`;
}

function results(items, total, featuredIds) {
  if (!items.length) {
    const q = state.q.trim();
    return html`<div class="empty">
      <h2>${q ? html`No researched app matches “${q}”` : "No apps match these filters"}</h2>
      <p>
        ${q
          ? "The library covers 103 apps. The Live Generator can investigate any other app and draft a guide in the same format, marked with how confident it is."
          : "Loosen a filter, or clear them all to see every app."}
      </p>
      <div class="row">
        ${q ? html`<a class="btn btn-primary" href="${href(`/generate?app=${encodeURIComponent(q)}`)}">${icon("compass")}<span>Generate a guide for ${q}</span></a>` : ""}
        <button type="button" class="btn" data-action="clear-filters">Clear filters</button>
      </div>
    </div>`;
  }
  if (!filtersActive() && state.sort === "featured") {
    const featured = featuredIds.map((id) => items.find((s) => s.id === id)).filter(Boolean);
    const rest = items.filter((s) => !featuredIds.includes(s.id));
    return html`<section aria-labelledby="featured-title">
        <div class="section-head">
          <div class="section-title"><h2 id="featured-title">In-depth guides</h2><span class="count-chip" aria-label="${featured.length} apps">${featured.length}</span></div>
          ${cardLegend()}
        </div>
        <ul class="grid featured">${featured.map((s) => appCard(s, { featured: true }))}</ul>
      </section>
      <section aria-labelledby="all-title">
        <div class="section-head">
          <div class="section-title"><h2 id="all-title">Researched profiles</h2><span class="count-chip" aria-label="${rest.length} apps">${rest.length}</span></div>
        </div>
        <ul class="grid">${rest.map((s) => appCard(s))}</ul>
      </section>`;
  }
  return html`<section aria-label="Matching apps">
    <div class="section-head is-compact">${cardLegend()}</div>
    <ul class="grid">${items.map((s) => appCard(s))}</ul>
  </section>`;
}

/**
 * Flip a card to the face it isn't showing. The hidden face goes inert (out of the tab order
 * and the accessibility tree) and focus moves to the same control on the face now in view.
 */
function flip(card, toBack) {
  card.dataset.flipped = String(toBack);
  const front = card.querySelector(".card-front");
  const back = card.querySelector(".card-back");
  front.inert = toBack;
  back.inert = !toBack;
  front.querySelector("[data-flip]")?.setAttribute("aria-expanded", String(toBack));
  (toBack ? back : front).querySelector("[data-flip]")?.focus({ preventScroll: true });
}

export function renderLibrary(root, ctx) {
  const { config, summaries, lib } = ctx;
  const total = summaries.length;
  render(
    root,
    html`<section class="hero" aria-labelledby="lib-title">
        <h1 id="lib-title" tabindex="-1">De-risk your OAuth integrations before writing code</h1>
        <p class="hero-lead">Time to production, approval gates and human-only steps for ${total} apps, plus a generator for any other.</p>
        <form class="searchbar" role="search" data-form="search">
          <div class="search-field">
            ${icon("search")}
            <label class="visually-hidden" for="q">Search ${total} apps</label>
            <input
              id="q"
              class="input"
              type="search"
              name="q"
              placeholder="Search ${total} apps, e.g. Slack, Salesforce or gmail"
              autocomplete="off"
              spellcheck="false"
              maxlength="120"
              value="${state.q}"
              aria-describedby="results-count"
              aria-keyshortcuts="/ Control+K Meta+K"
            />
            <kbd class="kbd-hint" aria-hidden="true">/</kbd>
          </div>
          <a class="btn btn-lg" href="${href("/generate")}" data-generate-link>${icon("compass")}<span>Generate a guide</span></a>
        </form>
      </section>
      ${timeband(config)} ${filters(config)}
      <div id="lib-results"></div>`,
  );

  const resultsEl = $("#lib-results", root);
  const countEl = $("#results-count", root);
  const genLink = $("[data-generate-link]", root);
  const update = () => {
    const items = apply(summaries, lib);
    render(resultsEl, results(items, total, config.library.featured));
    countEl.textContent = filtersActive() ? `${items.length} of ${total} apps` : `${total} apps`;
    for (const b of root.querySelectorAll('[data-action="clear-filters"]')) if (b.closest(".filters")) b.hidden = !filtersActive();
    for (const b of root.querySelectorAll("[data-filter]")) b.setAttribute("aria-pressed", String(state[b.dataset.filter] === b.dataset.value));
    // A select that is filtering looks pressed, like the toggles.
    for (const w of root.querySelectorAll(".select-wrap[data-select]")) if (w.dataset.select !== "sort") w.toggleAttribute("data-active", Boolean(state[w.dataset.select]));
    const q = state.q.trim();
    genLink.setAttribute("href", href(q ? `/generate?app=${encodeURIComponent(q)}` : "/generate"));
  };

  let timer;
  const onInput = (e) => {
    if (e.target.id !== "q") return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.q = e.target.value;
      update();
    }, 60);
  };
  const onClick = (e) => {
    const flipper = e.target.closest("[data-flip]");
    if (flipper) {
      const card = flipper.closest(".flip");
      flip(card, card.dataset.flipped !== "true");
      return;
    }
    const f = e.target.closest("[data-filter]");
    if (f) {
      state[f.dataset.filter] = state[f.dataset.filter] === f.dataset.value ? "" : f.dataset.value;
      update();
      return;
    }
    if (e.target.closest('[data-action="clear-filters"]')) {
      Object.assign(state, { q: "", difficulty: "", approval: "", path: "", category: "" });
      $("#q", root).value = "";
      for (const s of root.querySelectorAll("[data-filter-select]")) if (s.dataset.filterSelect !== "sort") s.value = "";
      update();
      $("#q", root).focus();
    }
  };
  const onChange = (e) => {
    const s = e.target.closest("[data-filter-select]");
    if (!s) return;
    state[s.dataset.filterSelect] = s.value;
    update();
  };
  const onSubmit = (e) => {
    if (!e.target.matches('[data-form="search"]')) return;
    e.preventDefault();
    // Use what's in the box now, not the debounced value, then open the top result.
    clearTimeout(timer);
    state.q = $("#q", root).value;
    update();
    const first = resultsEl.querySelector(".card-link");
    if (first && state.q.trim()) first.click();
  };
  // Escape on a card's back turns it over again.
  const onKeydown = (e) => {
    if (e.key !== "Escape") return;
    const card = e.target.closest?.('.flip[data-flipped="true"]');
    if (card) flip(card, false);
  };
  root.addEventListener("input", onInput);
  root.addEventListener("click", onClick);
  root.addEventListener("keydown", onKeydown);
  root.addEventListener("change", onChange);
  root.addEventListener("submit", onSubmit);
  update();

  return {
    title: "OAuth Field Guide",
    dispose() {
      clearTimeout(timer);
      root.removeEventListener("input", onInput);
      root.removeEventListener("click", onClick);
      root.removeEventListener("keydown", onKeydown);
      root.removeEventListener("change", onChange);
      root.removeEventListener("submit", onSubmit);
    },
    focusSearch() {
      $("#q", root)?.focus();
    },
  };
}
