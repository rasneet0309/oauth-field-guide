/**
 * Step 1 of every generator run: work out which app the developer means, whether the
 * research library already covers it, which vendor family it belongs to and which
 * category its patterns should come from. Pure and isomorphic.
 */
import { familyFor, guessCategory, aliasFor } from "../families.js";
import { exactMatch, searchLibrary } from "../search.js";
import { clampText, norm, rootDomain, slugify, titleCase, urlParts, wellFormed } from "../text.js";

export const MAX_INPUT = 120;

/** Words that say which page or interface someone means, not what the app does: never category evidence. */
const GENERIC_WORDS = /\b(api|apis|oauth2?|sdk|developers?|docs?|documentation|reference|portal|console)\b/gi;

/** What the agent will do in the app. Order is part of share links: append only. */
export const INTENTS = Object.freeze({
  read: { label: "Read data", phrase: "read data" },
  write: { label: "Read & write", phrase: "read and update records" },
  send: { label: "Send as the user", phrase: "send messages or post on the user's behalf" },
  admin: { label: "Admin or bulk access", phrase: "use admin-level or bulk access" },
});
export const isIntent = (v) => typeof v === "string" && Object.hasOwn(INTENTS, v);

/** Free text ("Zoho Books", "https://developer.zoom.us/docs") → { name, website, host, root }. (v2 logic.) */
export function parseInput(raw) {
  const s = clampText(wellFormed(raw), MAX_INPUT);
  const looksUrl = /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/\S*)?$/i.test(s) && !/\s/.test(s);
  if (looksUrl) {
    const clean = s
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .replace(/[?#].*$/, "")
      .replace(/\/+$/, "");
    const host = clean.split("/")[0].replace(/:\d+$/, "").toLowerCase();
    const root = rootDomain(host);
    // The registrable label names the vendor: "api.slack.com" → Slack, "shop.bbc.co.uk" → Bbc.
    const base = root.split(".")[0];
    return { name: titleCase(base), website: clampText(clean, MAX_INPUT), host, root };
  }
  return { name: s, website: "", host: "", root: "" };
}

/** Plausible public hostname: letters, digits and hyphens, a dot, a TLD. No IPs, no single labels. */
export function isPlausibleHost(host) {
  const h = String(host ?? "");
  if (h.length > 253 || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h)) return false;
  if (/^\d+(\.\d+){3}$/.test(h)) return false;
  const tld = h.split(".").pop();
  return /^[a-z]{2,24}$/.test(tld) && !["local", "localhost", "internal", "lan", "home", "corp", "test", "invalid", "example"].includes(tld);
}

/**
 * @param {string} raw     what the developer typed
 * @param {object} lib     makeLib(summaries)
 * @param {string[]} categories
 */
export function identifyApp(raw, lib, categories) {
  const parsed = parseInput(raw);
  const query = parsed.website || parsed.name;
  // A bare domain ("notion.so") names its vendor; a path ("slack.com/apps/<listing>") may not.
  const bareDomain = parsed.website && !parsed.website.includes("/");
  // "Stripe API", "Slack OAuth", "HubSpot integration", "Stripe docs" all mean the app itself.
  const stem = parsed.website ? "" : parsed.name.replace(/\s+(api|apis|oauth|oauth2|app|apps|integration|integrations|developer|developers|platform|connector|docs|documentation|sdk)$/i, "").trim();
  const match =
    exactMatch(lib, raw) ||
    (parsed.website ? exactMatch(lib, parsed.website) : null) ||
    (bareDomain ? exactMatch(lib, parsed.name) : null) ||
    (stem && stem !== parsed.name ? exactMatch(lib, stem) : null);
  const name = match?.name ?? (parsed.name || "this app");
  const family = match ? null : familyFor(parsed.name, parsed.website);
  const familyRel = family ? lib.byId(family.rel) : null;

  let root = parsed.root;
  let domainSource = root ? "input" : "";
  if (!root && match?.website) {
    root = rootDomain(String(match.website).split("/")[0]);
    domainSource = "library";
  }
  if (!root && family) {
    root = family.domain;
    domainSource = "family";
  }
  if (!root) {
    const compact = norm(stem || parsed.name).replace(/[^a-z0-9]/g, "");
    if (compact.length >= 2 && compact.length <= 40) {
      root = `${compact}.com`;
      domainSource = "guess";
    }
  }

  let category;
  let categorySource;
  if (match) {
    category = match.category;
    categorySource = "library";
  } else if (familyRel) {
    category = familyRel.category;
    categorySource = "family";
  } else {
    // A keyword in the name or the registrable domain, or nothing. Never the URL path or a
    // subdomain ("/docs", "help.", "developers."): those describe the page, not the app.
    category = guessCategory(categories, parsed.name.replace(GENERIC_WORDS, " "), parsed.root);
    categorySource = category ? "keywords" : "none";
  }

  const similar = match ? [] : searchLibrary(lib, parsed.name, 3).filter((a) => a.id !== match?.id);
  // "github.com/acme/tool" isn't GitHub, but say so: the developer may have meant GitHub.
  const domainOwner =
    !match && parsed.root
      ? (lib.apps.find((a) => {
          const u = urlParts(a.website);
          return u && rootDomain(u.host) === parsed.root;
        }) ?? null)
      : null;
  return {
    raw: String(raw ?? ""),
    query,
    name: name === name.toLowerCase() ? titleCase(name) : name,
    slug: slugify(name),
    website: parsed.website || match?.website || "",
    host: parsed.host,
    root,
    domainSource,
    match: match ?? null,
    alias: aliasFor(raw),
    family,
    familyRel: familyRel ?? null,
    domainOwner,
    category,
    categorySource,
    // Not recognized: no researched guide, no vendor family, no category keyword and no
    // website typed by the user. The generator then drafts a generic plan and says so.
    recognized: Boolean(match || familyRel || category || (domainSource === "input" && isPlausibleHost(root))),
    similar,
  };
}
