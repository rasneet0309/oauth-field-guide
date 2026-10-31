/**
 * Bootstrap: pick the API (server or in-page), load the configuration and the library
 * index, then hand each route to its view. Views return { title, dispose } so a route
 * change never leaks listeners, timers or a running generation.
 */
import { makeLib } from "../shared/search.js";
import { createHttpApi } from "./api.js";
import { createRouter, href, setRouterMode } from "./router.js";
import { embedded as framed } from "./services/host.js";
import { toggleTheme, currentTheme } from "./services/theme.js";
import { $, $$, html, render } from "./ui/dom.js";
import { icon } from "./ui/icons.js";
import { renderGenerator } from "./views/generator.js";
import { showGuide, showShared } from "./views/guide.js";
import { renderLibrary } from "./views/library.js";
import { renderMethod } from "./views/method.js";
import { renderFatal, renderNotFound } from "./views/not-found.js";

async function pickApi() {
  // The single-file demo embeds the library and runs the offline engine in the page.
  const embedded = document.getElementById("ofg-data");
  if (embedded) {
    const { createLocalApi } = await import("./api-local.js");
    setRouterMode(framed ? "named" : "hash");
    return createLocalApi(JSON.parse(embedded.textContent));
  }
  setRouterMode("path");
  return createHttpApi();
}

function updateThemeButton() {
  const btn = $("#theme-toggle");
  if (!btn) return;
  const dark = currentTheme() === "dark";
  render(btn, html`${icon(dark ? "sun" : "moon")}<span class="visually-hidden">${dark ? "Switch to light theme" : "Switch to dark theme"}</span>`);
  btn.setAttribute("aria-pressed", String(dark));
}

async function main() {
  const main = $("#main");
  // The skip link moves focus without changing the address: a #main hash would replace the
  // view's name in a host frame's address bar.
  $(".skip-link")?.addEventListener("click", (e) => {
    e.preventDefault();
    main.focus();
  });
  let api;
  let config;
  let summaries;
  try {
    api = await pickApi();
    [config, summaries] = await Promise.all([api.config(), api.summaries()]);
  } catch (err) {
    renderFatal(main, err?.message ?? "Something went wrong while loading.");
    main.setAttribute("aria-busy", "false");
    return;
  }

  // Header links follow the routing mode (paths on the server, hashes in the demo file).
  for (const a of $$("[data-route]")) a.setAttribute("href", href(a.dataset.route));
  $("#version").textContent = `v${config.version}`;
  $("#data-date").textContent = config.library.lastChecked;

  const ctx = { api, config, summaries, lib: makeLib(summaries), router: null };
  let view = null;
  let token = 0;
  let navigations = 0;

  // The app restores scroll itself (views re-render after Back, so the browser's guess is wrong).
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";

  const show = async (route, { traversal = false, state = {} } = {}) => {
    const mine = ++token;
    const isCurrent = () => mine === token;
    route = { ...route, initial: navigations === 0 };
    view?.dispose?.();
    view = null;
    main.setAttribute("aria-busy", "true");
    for (const a of $$(".nav a")) {
      const current =
        (a.dataset.route === "/" && (route.name === "library" || route.name === "guide")) ||
        (a.dataset.route === "/generate" && (route.name === "generate" || route.name === "shared")) ||
        (a.dataset.route === "/method" && route.name === "method");
      if (current) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    }
    let next;
    try {
      switch (route.name) {
        case "library":
          next = renderLibrary(main, ctx);
          break;
        case "guide":
          next = await showGuide(main, ctx, route.params.id, { renderNotFound, isCurrent });
          break;
        case "shared":
          next = await showShared(main, ctx, route.params.id, { renderNotFound, isCurrent, query: route.query });
          break;
        case "generate":
          next = renderGenerator(main, ctx, route);
          break;
        case "method":
          next = renderMethod(main, ctx);
          break;
        default:
          next = renderNotFound(main, ctx, { what: "page" });
      }
    } catch (err) {
      if (!isCurrent()) return; // a stale navigation failed; the newer view stays on screen
      renderFatal(main, err?.message ?? "This page failed to render.");
      next = { title: "Error – OAuth Field Guide" };
    }
    if (!isCurrent()) {
      next?.dispose?.();
      return;
    }
    view = next;
    document.title = next?.title ?? "OAuth Field Guide";
    main.setAttribute("aria-busy", "false");
    const first = navigations++ === 0;
    if (traversal && typeof state.scrollY === "number") {
      // Back or Forward: put the visitor where they were, on the link they followed.
      window.scrollTo(0, state.scrollY);
      const link = state.focusHref ? main.querySelector(`a[href="${CSS.escape(state.focusHref)}"]`) : null;
      (link ?? next?.heading ?? main.querySelector("h1"))?.focus({ preventScroll: true });
      return;
    }
    window.scrollTo(0, 0);
    // After a navigation (not on first load), move focus to the new page's heading so
    // keyboard and screen-reader users start reading there.
    if (!first) (next?.heading ?? main.querySelector("h1"))?.focus({ preventScroll: true });
  };

  const router = createRouter(show);
  ctx.router = router;
  document.documentElement.classList.add("app-ready");

  document.addEventListener("keydown", (e) => {
    const typing = e.target.closest?.("input, textarea, select, [contenteditable]");
    const palette = (e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey);
    if (!(palette || (e.key === "/" && !typing))) return;
    e.preventDefault();
    if (view?.focusSearch) view.focusSearch();
    else {
      router.navigate("/");
      requestAnimationFrame(() => view?.focusSearch?.());
    }
  });

  $("#theme-toggle")?.addEventListener("click", () => {
    toggleTheme();
    updateThemeButton();
  });
  updateThemeButton();
  router.start();
}

main();
