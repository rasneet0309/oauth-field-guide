/**
 * Inline SVG icons (24px grid, 1.75 stroke, currentColor). Constant markup only, so it is
 * safe to pass through raw(). Decorative by default: callers add text labels.
 */
import { raw } from "./dom.js";

// width/height 1em: an icon is text-sized wherever it lands, even where no CSS rule sizes it
// (without them an SVG fills its container). Contexts like .btn still set their own size.
const svg = (body, extra = "") =>
  `<svg class="icon" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"${extra}>${body}</svg>`;

const PATHS = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 8.7-8.7M16.5 6.5l2.5 2.5M14 9l2 2"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  book: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 8.5V5.5a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
  download: '<path d="M12 3.5v12M7 10.5l5 5 5-5M4.5 20.5h15"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.8 2.8L16.5 9.5"/>',
  warn: '<path d="M10.3 4.2 2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4M12 17h.01"/>',
  error: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
  skip: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5h.01"/>',
  shield: '<path d="M12 3 4.5 6v5.5c0 4.5 3.2 8.2 7.5 9.5 4.3-1.3 7.5-5 7.5-9.5V6z"/><path d="m9 12 2 2 4-4"/>',
  shieldOpen: '<path d="M12 3 4.5 6v5.5c0 4.5 3.2 8.2 7.5 9.5 4.3-1.3 7.5-5 7.5-9.5V6z"/>',
  shieldQuestion: '<path d="M12 3 4.5 6v5.5c0 4.5 3.2 8.2 7.5 9.5 4.3-1.3 7.5-5 7.5-9.5V6z"/><path d="M10 9.6a2.1 2.1 0 1 1 3 1.9c-.6.3-1 .8-1 1.5v.4M12 15.8h.01"/>',
  human: '<circle cx="12" cy="7.5" r="3.5"/><path d="M5 20.5a7 7 0 0 1 14 0"/>',
  agent: '<rect x="4.5" y="7.5" width="15" height="12" rx="3"/><path d="M12 3.5v4M9 13h.01M15 13h.01M9.5 16.5h5"/>',
  external: '<path d="M14 4.5h5.5V10M19.5 4.5 11 13M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
  refresh: '<path d="M20 11.5A8 8 0 0 0 5.6 6.6L4 8.5M4 4v4.5h4.5M4 12.5a8 8 0 0 0 14.4 4.9l1.6-1.9M20 20v-4.5h-4.5"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  file: '<path d="M14 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8z"/><path d="M14 3.5V8h4.5M9 13h6M9 16.5h6"/>',
  mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m4 7 8 6 8-6"/>',
  arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  flip: '<path d="M12 3.5v2M12 9v2M12 13v2M12 18.5v2"/><path d="M8.5 7 3.5 17h5zM15.5 7l5 10h-5z"/>',
  beaker: '<path d="M9 3.5h6M10 3.5v6L4.6 18.6A1.6 1.6 0 0 0 6 21h12a1.6 1.6 0 0 0 1.4-2.4L14 9.5v-6"/><path d="M7.2 15h9.6"/>',
  close: '<path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/>',
  sort: '<path d="M7 4.5v15M3.5 16 7 19.5 10.5 16M17 19.5v-15M13.5 8 17 4.5 20.5 8"/>',
  building: '<path d="M4.5 20.5v-14l7.5-3 7.5 3v14M3 20.5h18M9 9.5h.01M15 9.5h.01M9 13.5h.01M15 13.5h.01M10.5 20.5v-3h3v3"/>',
};

const cache = new Map();
/** @param {keyof typeof PATHS} name */
export function icon(name) {
  if (!cache.has(name)) cache.set(name, raw(svg(PATHS[name] ?? PATHS.info)));
  return cache.get(name);
}

/** Effort glyphs: circle (Easy), square (Moderate), diamond (Complex). Filled, so they read at small sizes. */
const GLYPHS = {
  Easy: '<circle cx="6" cy="6" r="5"/>',
  Moderate: '<rect x="1.2" y="1.2" width="9.6" height="9.6" rx="1"/>',
  Complex: '<path d="M6 0.4 11.6 6 6 11.6 0.4 6z"/>',
  "N/A": '<path d="M1 6h10" stroke="currentColor" stroke-width="2"/>',
};
export function effortGlyph(level) {
  return raw(`<svg class="icon" width="0.75em" height="0.75em" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true" focusable="false">${GLYPHS[level] ?? GLYPHS["N/A"]}</svg>`);
}
