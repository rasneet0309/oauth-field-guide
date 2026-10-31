/**
 * Client-side routes. The server build uses real paths (/guides/slack, shareable and
 * crawlable); the single-file demo uses hash paths (#/guides/slack) because it has no server.
 * When the demo runs inside a host frame whose address bar only keeps a plain #name, the
 * "named" mode shows #guide-slack, #generate and #method instead, so the host's own link
 * opens the same view. Links still use #/… paths; the router swaps in the name on arrival.
 *
 *   /                 library          /guides/:id   guide
 *   /generate?app=…   live generator   /g/:shareId   shared generated guide
 *   /method           how to read a guide
 */
let mode = "path";

export function setRouterMode(m) {
  mode = m === "hash" || m === "named" ? m : "path";
}

/** The href for an app path in the current mode. */
export const href = (path) => (mode === "path" ? path : `#${path}`);

/** Named hashes: "" is the library; null means "not a route" (an in-page anchor). */
export function fromName(name) {
  if (name === "" || name === "library") return "/";
  if (name === "method" || name === "generate") return `/${name}`;
  const m = /^guide-([a-z0-9-]+)$/.exec(name);
  return m ? `/guides/${m[1]}` : null;
}

/** The plain #name for a path, or null when it has none (it keeps its #/… form). */
export function toName(pathname) {
  if (pathname === "/") return "";
  if (pathname === "/method" || pathname === "/generate") return pathname.slice(1);
  const m = /^\/guides\/([a-z0-9-]+)$/.exec(pathname);
  return m ? `guide-${m[1]}` : null;
}

const safeDecode = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** Pure: path + query string → { name, params, query }. Never throws. */
export function parseRoute(pathname, search = "") {
  const query = Object.fromEntries(new URLSearchParams(search));
  const p = String(pathname || "/").replace(/\/+$/, "") || "/";
  let m;
  if (p === "/" || p === "/guides") return { name: "library", params: {}, query };
  if ((m = /^\/guides\/([^/]+)$/.exec(p))) return { name: "guide", params: { id: safeDecode(m[1]) }, query };
  if (p === "/generate") return { name: "generate", params: {}, query };
  if ((m = /^\/g\/([^/]+)$/.exec(p))) return { name: "shared", params: { id: safeDecode(m[1]) }, query };
  if (p === "/method") return { name: "method", params: {}, query };
  return { name: "notFound", params: { path: p }, query };
}

/*
 * History entries the app creates carry state:
 *   idx       how many in-app entries lie behind this one, so Back can tell "back within the
 *             app" (history.back) from "came in by a link" (go to the parent view instead)
 *   from      the view this entry was opened from, for the Back button's label
 *   scrollY,  where the visitor was on this entry when they left it, and the link they used,
 *   focusHref so returning restores both
 *   ofgRoute  named mode only: the full route (with ?app=…) behind a plain #name
 */
const entry = () => (history.state && typeof history.state === "object" ? history.state : {});
const routeOf = (state) => (typeof state?.ofgRoute === "string" ? state.ofgRoute : null);
const splitRoute = (to) => {
  const [pathname, search = ""] = String(to).split("?");
  return { pathname, search };
};

/** The address for a route in named mode: "#name", the bare page URL for the library, or #/… */
function namedUrl(to) {
  const name = toName(splitRoute(to).pathname);
  if (name === null) return `#${to}`;
  return name ? `#${name}` : location.href.split("#")[0];
}

/** The address for a route in the current mode. */
const urlFor = (to) => (mode === "path" ? to : mode === "hash" ? `#${to}` : namedUrl(to));

function currentLocation() {
  if (mode === "path") return { pathname: location.pathname, search: location.search.replace(/^\?/, "") };
  const h = location.hash.replace(/^#/, "");
  if (mode === "named" && !h.startsWith("/")) {
    const saved = routeOf(history.state);
    // An in-page anchor (#main) isn't a view: the entry keeps the view it had.
    const pathname = fromName(h) ?? (saved ? splitRoute(saved).pathname : "/");
    return saved && splitRoute(saved).pathname === pathname ? splitRoute(saved) : { pathname, search: "" };
  }
  const [pathname, search = ""] = (h || "/").split("?");
  return { pathname: pathname.startsWith("/") ? pathname : "/", search };
}

/** Is this hash a route (rather than an in-page anchor)? */
const isRouteHash = (hash) => hash === "" || hash.startsWith("#/") || (mode === "named" && fromName(hash.slice(1)) !== null);

/** In named mode, a #/… address (typed, or an old link) is swapped for its #name in place. */
function nameTheHash(loc) {
  if (mode !== "named" || !location.hash.startsWith("#/")) return;
  const to = loc.search ? `${loc.pathname}?${loc.search}` : loc.pathname;
  history.replaceState({ ...entry(), ofgRoute: to }, "", namedUrl(to));
}

const plainClick = (e) => !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

/**
 * @param {(route: object, info: { traversal: boolean, state: object }) => void} onRoute
 *   traversal is true when the browser moved through history (Back, Forward), so the view can
 *   restore the scroll position and focus saved in `state`.
 */
export function createRouter(onRoute) {
  let last = "";
  const emit = (force = false, traversal = false) => {
    const loc = currentLocation();
    nameTheHash(loc);
    const key = `${loc.pathname}?${loc.search}`;
    if (!force && key === last) return;
    last = key;
    onRoute(parseRoute(loc.pathname, loc.search), { traversal, state: entry() });
  };

  window.addEventListener("popstate", () => emit(false, true));
  if (mode !== "path") {
    window.addEventListener("hashchange", () => {
      // In-page section anchors ("#…-sec-…") aren't routes.
      if (!isRouteHash(location.hash)) return;
      emit(false, true);
    });
  }
  // Route in-app links here so every entry gets its state, and a link to the current view adds
  // no history entry. Path mode routes "/…" links; the hash modes route "#/…" links.
  document.addEventListener("click", (e) => {
    if (!plainClick(e)) return;
    const a = e.target.closest?.("a[href]");
    if (!a || a.target || a.hasAttribute("download")) return;
    const to = a.getAttribute("href");
    if (mode === "path") {
      if (!to.startsWith("/") || to.startsWith("//") || /^\/(api|fonts|styles|app|shared)\//.test(to)) return;
      e.preventDefault();
      navigate(to);
    } else if (to.startsWith("#/")) {
      e.preventDefault();
      navigate(to.slice(1));
    }
  });

  /** Save where the visitor is on the entry they're leaving. */
  function leave() {
    const link = document.activeElement?.closest?.("a[href]");
    history.replaceState({ ...entry(), scrollY: Math.round(window.scrollY), focusHref: link?.getAttribute("href") ?? null }, "");
  }

  function navigate(to, { replace = false } = {}) {
    const cur = currentLocation();
    const next = splitRoute(to);
    const named = mode === "named" ? { ofgRoute: to } : {};
    if (replace) {
      history.replaceState({ ...entry(), ...named }, "", urlFor(to));
    } else if (cur.pathname !== next.pathname || cur.search !== next.search) {
      const from = parseRoute(cur.pathname, cur.search).name;
      const idx = (entry().idx ?? 0) + 1;
      leave();
      history.pushState({ ...named, idx, from }, "", urlFor(to));
    }
    emit(replace);
  }

  /** Change the URL without re-rendering (e.g. after a run, so a reload reproduces it). */
  function replaceQuiet(to) {
    history.replaceState({ ...entry(), ...(mode === "named" ? { ofgRoute: to } : {}) }, "", urlFor(to));
    const loc = currentLocation();
    last = `${loc.pathname}?${loc.search}`;
  }

  return {
    start() {
      // Number the entry the visitor arrived on (a reload keeps the number it had).
      history.replaceState({ ...entry(), idx: entry().idx ?? 0 }, "");
      emit(true);
    },
    navigate,
    replaceQuiet,
    /** True when Back would stay inside the app. */
    canGoBack: () => (entry().idx ?? 0) > 0,
    /** The view the current entry was opened from (library, guide, generate, …), or null. */
    cameFrom: () => ((entry().idx ?? 0) > 0 ? (entry().from ?? null) : null),
    back: () => history.back(),
  };
}
