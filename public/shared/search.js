/**
 * Library search and lookup (v2's ranking, kept because two audits tuned it).
 * `lib` is { apps, byId(id) } where apps are guides or guide summaries. Pure and isomorphic.
 */
import { aliasFor } from "./families.js";
import { norm, rootDomain, urlParts } from "./text.js";

// Subdomains of a vendor's own developer presence, as listed for an app or pasted by a visitor.
// Marketplace and listing hosts (appexchange., marketplace.) are deliberately absent: the apps
// listed there belong to other vendors.
const VENDOR_SUBDOMAIN =
  /^(?:www|api|app|apps|dev|developer|developers|docs|developer-docs|api-docs|open|core|learn|help|dashboard|console|portal|admin|account|accounts|auth|login|oauth|platform)$/;

const subdomainOf = (host, root) => (host === root ? "" : host.slice(0, -root.length - 1));

/**
 * The library app a pasted web address belongs to, or null. Conservative on purpose: a
 * wrong match hides the "Build a guide" option.
 *  1. Same host, and the address is inside the app's documented path
 *     ("api.slack.com/apps" → Slack; "developers.facebook.com/docs/threads" → Threads).
 *  2. Otherwise the one app that owns the registrable domain ("dashboard.stripe.com" → Stripe),
 *     but only for the bare domain or one of the vendor's own developer subdomains: a path on
 *     the main site (github.com/<owner>/<repo>, slack.com/apps/<listing>) usually belongs to
 *     someone else's product. Apps listed with a path, or with notes in their website field,
 *     never own a whole domain, and ambiguous domains match nothing.
 */
export function urlMatch(lib, value) {
  const input = urlParts(value);
  if (!input) return null;
  let best = null;
  let bestLength = -1;
  for (const app of lib.apps) {
    const site = urlParts(app.website);
    if (!site || site.host !== input.host) continue;
    const inside = !site.path || input.path === site.path || input.path.startsWith(`${site.path}/`);
    if (inside && site.path.length > bestLength) {
      best = app;
      bestLength = site.path.length;
    }
  }
  if (best) return best;
  const root = rootDomain(input.host);
  const inputSub = subdomainOf(input.host, root);
  if (input.path ? !inputSub || !VENDOR_SUBDOMAIN.test(inputSub) : inputSub && !VENDOR_SUBDOMAIN.test(inputSub))
    return null;
  const owners = lib.apps.filter((app) => {
    const website = String(app.website ?? "").trim();
    const site = urlParts(website);
    if (!site || site.path || /\s/.test(website) || rootDomain(site.host) !== root) return false;
    const sub = subdomainOf(site.host, root);
    return sub === "" || VENDOR_SUBDOMAIN.test(sub);
  });
  return owners.length === 1 ? owners[0] : null;
}

/**
 * Library apps matching `query`, best first:
 * exact name/id/website (100) > alias (95) > prefix (80) > substring (60) > tagline (25).
 */
export function searchLibrary(lib, query, limit = Infinity) {
  const q = norm(query);
  if (!q) return [];
  const scored = [];
  for (const app of lib.apps) {
    const name = norm(app.name);
    const id = norm(app.id);
    const web = norm(app.website);
    const sub = norm(app.tagline);
    let score = 0;
    if (name === q || id === q || web === q) score = 100;
    else if (name.startsWith(q) || id.startsWith(q)) score = 80;
    else if (name.includes(q) || id.includes(q) || web.includes(q)) score = 60;
    else if (sub.includes(q)) score = 25;
    if (score) scored.push([score, app]);
  }
  // An alias ("gmail" → Google Workspace) or a pasted vendor address outranks partial
  // matches, even when the app already matched weakly ("google" is a prefix of Google Ads).
  const boost = (app, score) => {
    if (!app) return;
    const hit = scored.find(([, a]) => a.id === app.id);
    if (hit) hit[0] = Math.max(hit[0], score);
    else scored.push([score, app]);
  };
  const aliasId = aliasFor(query);
  boost(aliasId ? lib.byId(aliasId) : undefined, 95);
  boost(urlMatch(lib, query), 98);
  // A bare domain names its vendor: "notion.so" → Notion, "calendly.com" → nothing researched.
  const bare = urlParts(query);
  if (bare && !bare.path) {
    const label = norm(rootDomain(bare.host).split(".")[0]);
    boost(
      lib.apps.find((a) => norm(a.name) === label || norm(a.id) === label),
      97,
    );
  }
  scored.sort(([sa, a], [sb, b]) => sb - sa || a.name.localeCompare(b.name));
  return scored.slice(0, limit).map(([, app]) => app);
}

/** The library app this query names exactly (by alias, name, id, website or a vendor address), or null. */
export function exactMatch(lib, query) {
  const q = norm(query);
  if (!q) return null;
  const aliasId = aliasFor(query);
  if (aliasId && lib.byId(aliasId)) return lib.byId(aliasId);
  return (
    lib.apps.find((a) => norm(a.name) === q || norm(a.id) === q || (a.website && norm(a.website) === q)) ||
    urlMatch(lib, query)
  );
}

/** Closest library apps to an unknown id, for "did you mean" suggestions. */
export function suggestApps(lib, rawId, limit = 3) {
  const q = norm(rawId);
  if (!q) return [];
  const direct = searchLibrary(lib, rawId, limit);
  if (direct.length) return direct;
  // Fall back to shared-prefix similarity so typos like "slak" still find something.
  const scored = lib.apps
    .map((a) => [commonPrefix(norm(a.id), q) + commonPrefix(norm(a.name), q), a])
    .filter(([s]) => s >= 2)
    .sort(([sa, a], [sb, b]) => sb - sa || a.name.localeCompare(b.name));
  return scored.slice(0, limit).map(([, a]) => a);
}

function commonPrefix(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/** Build the `lib` shape the search functions take from a list of guides or summaries. */
export function makeLib(apps) {
  const index = new Map(apps.map((a) => [a.id, a]));
  return { apps, byId: (id) => index.get(id) };
}
