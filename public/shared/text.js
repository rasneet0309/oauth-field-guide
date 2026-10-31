/**
 * Pure string helpers shared by the browser app, the Node server and the scripts.
 * Rule for everything under public/shared: no DOM, no Node APIs, no side effects.
 * (Carried over from v2, where each helper was hardened by two audits.)
 */

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Escape any value for interpolation into HTML text or a quoted attribute value. */
export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/** 32-bit FNV-1a over Unicode code points. Deterministic in every runtime. */
export function hashString(input) {
  let h = 0x811c9dc5;
  for (const ch of String(input ?? "")) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Latin/Greek/Cyrillic combining accents only. Marks that carry meaning in other
// scripts (Devanagari vowel signs, for example) are kept.
const ACCENTS = /[\u0300-\u036f]/g;
const stripAccents = (s) => s.normalize("NFKD").replace(ACCENTS, "").normalize("NFC");
const stripUrlPrefix = (s) => s.replace(/^https?:\/\//, "").replace(/^www\./, "");

export const SLUG_MAX = 60;
const SLUG_RE = /^[\p{L}\p{M}\p{N}]+(?:-[\p{L}\p{M}\p{N}]+)*$/u;

/**
 * URL-safe, human-readable slug that keeps non-Latin scripts ("हिंदी ऐप" → "हिंदी-ऐप").
 * Inputs with no letters or digits get a stable hash-based slug instead of colliding.
 */
export function slugify(input, maxLength = SLUG_MAX) {
  const raw = String(input ?? "");
  const slug = stripUrlPrefix(stripAccents(raw).toLowerCase())
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  const cut = Array.from(slug).slice(0, maxLength).join("").replace(/-+$/, "");
  return cut || `app-${hashString(raw.trim().toLowerCase()).toString(36)}`;
}

/** True when `value` is a slug that slugify() could have produced. */
export function isSlug(value) {
  return typeof value === "string" && Array.from(value).length <= SLUG_MAX && SLUG_RE.test(value);
}

// Second-level labels under country-code domains: example.co.uk, example.com.au, example.co.jp.
const SECOND_LEVEL = /^(?:co|com|org|net|ac|gov|edu|ne|or|go)$/;

/** Registrable domain of a host name: "api.slack.com" → "slack.com", "shop.bbc.co.uk" → "bbc.co.uk". */
export function rootDomain(host) {
  const labels = String(host ?? "")
    .toLowerCase()
    .replace(/\.$/, "")
    .split(".")
    .filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const tld = labels[labels.length - 1];
  const second = labels[labels.length - 2];
  const keep = tld.length === 2 && SECOND_LEVEL.test(second) ? 3 : 2;
  return labels.slice(-keep).join(".");
}

/**
 * Host and path of something that looks like a web address ("https://www.Example.com/a/b/",
 * "example.com/a"), lower-cased, without "www." or a trailing slash. Null for anything else.
 * Only the first word counts, so notes after an address ("docs.nmi.com (gateway)") are ignored.
 */
export function urlParts(value) {
  const first =
    String(value ?? "")
      .trim()
      .split(/\s+/)[0] ?? "";
  const m = /^(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?::\d+)?(\/[^?#]*)?(?:[?#].*)?$/i.exec(first);
  if (!m) return null;
  const path = (m[2] || "").toLowerCase().replace(/\/+$/, "").replace(/^\/+/, "");
  return { host: m[1].toLowerCase(), path };
}

/** Loose key for search matching: lower case, no URL prefix, letters and digits only. */
export function norm(value) {
  return stripUrlPrefix(stripAccents(String(value ?? "")).toLowerCase()).replace(/[^\p{L}\p{M}\p{N}]/gu, "");
}

/** Return the URL if it is an absolute http(s) URL without characters that could break out of an attribute, else "". */
export function safeUrl(value) {
  const s = String(value ?? "").trim();
  if (!/^https?:\/\/[^\s"'<>`\\]+$/i.test(s)) return "";
  try {
    const { protocol } = new URL(s);
    return protocol === "https:" || protocol === "http:" ? s : "";
  } catch {
    return "";
  }
}

/** "zoho-books" → "Zoho Books". Capitalises the first letter of each word in any cased script. */
export function titleCase(value) {
  return String(value ?? "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(^|\s)(\p{Ll})/gu, (_, space, letter) => space + letter.toUpperCase());
}

/** Two-letter monogram for an app tile. Safe for emoji and non-Latin names. */
export function initials(name) {
  const base = String(name ?? "")
    .split(/[:(]/)[0]
    .trim();
  const words = base.split(/[\s.\-/]+/).filter(Boolean);
  const first = (w) => Array.from(w)[0] ?? "";
  if (words.length >= 2) return (first(words[0]) + first(words[1])).toUpperCase();
  const chars = Array.from(words[0] ?? "?");
  return (chars[0] ?? "?").toUpperCase() + (chars[1] ?? "").toLowerCase();
}

/** Shorten a long duration description to its first clause: "1–3 weeks unlisted (package…)" → "1–3 weeks unlisted". */
export function shortTime(value) {
  const s = String(value ?? "").trim();
  if (!s) return "—";
  let t = s.split(/;|\s\(|\s\|\s|\s·\s/)[0].trim();
  if (t.length > 40) t = t.slice(0, 38).replace(/\s+\S*$/, "") + "…";
  return t;
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** Replace lone UTF-16 surrogates (half an emoji) with U+FFFD so encodeURIComponent can't throw. */
export function wellFormed(value) {
  return String(value ?? "").replace(LONE_SURROGATE, "\uFFFD");
}

/**
 * Collapse whitespace and cap the length (in code points) of untrusted text.
 * Only strings and finite numbers count as text: objects, arrays and the like become ""
 * (converting them could throw, e.g. a stored `{"toString": 1}`).
 */
export function clampText(value, max) {
  const text = typeof value === "string" ? value : Number.isFinite(value) ? String(value) : "";
  const s = wellFormed(text).replace(/\s+/g, " ").trim();
  const chars = Array.from(s);
  return chars.length > max ? chars.slice(0, max).join("") : s;
}

/** Decode a URI component without throwing on malformed percent-escapes. */
export function safeDecode(value) {
  const s = String(value ?? "");
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** "2026-10-28" → "28 Oct 2026" (or "28 October 2026" with `month: "long"`). Locale-independent. */
export function formatDate(iso, { month = "short" } = {}) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ""));
  if (!m) return String(iso ?? "");
  const names = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const name = names[Number(m[2]) - 1];
  if (!name) return String(iso);
  return `${Number(m[3])} ${month === "long" ? name : name.slice(0, 3)} ${m[1]}`;
}

/** Today's date as YYYY-MM-DD (UTC). Injectable clock for tests. */
export function isoDate(now = new Date()) {
  return now.toISOString().slice(0, 10);
}
