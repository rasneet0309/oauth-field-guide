/**
 * The only way HTML enters the page.
 *
 *   html`<p>${untrusted}</p>`  escapes every interpolated value (text and quoted attributes)
 *   raw(markup)               marks trusted constant markup (icons) as safe
 *   render(el, view)          writes through the "ofg-html" Trusted Types policy
 *
 * The CSP requires Trusted Types, so any other innerHTML assignment throws in browsers that
 * enforce them: a regression fails loudly instead of shipping an XSS sink.
 */
const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHTML = (s) => String(s).replace(/[&<>"']/g, (c) => ESCAPES[c]);

class SafeHTML {
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

function toHTML(v) {
  if (v == null || v === false || v === true) return "";
  if (v instanceof SafeHTML) return v.value;
  if (Array.isArray(v)) return v.map(toHTML).join("");
  return escapeHTML(v);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i += 1) out += toHTML(values[i]) + strings[i + 1];
  return new SafeHTML(out);
}

/** Trusted constant markup only (icon SVGs). Never pass data here. */
export const raw = (markup) => new SafeHTML(String(markup));

// Our CSP requires Trusted Types and allows this policy. A host page with its own CSP may not
// allow the name; then createPolicy throws, and plain strings work as long as it doesn't
// require Trusted Types either.
const policy = (() => {
  try {
    return typeof window !== "undefined" && window.trustedTypes?.createPolicy
      ? window.trustedTypes.createPolicy("ofg-html", { createHTML: (s) => s })
      : null;
  } catch {
    return null;
  }
})();

/** Replace an element's content with a SafeHTML view. */
export function render(el, view) {
  if (!(view instanceof SafeHTML)) throw new TypeError("render() takes html`` output");
  el.innerHTML = policy ? policy.createHTML(view.value) : view.value;
}

/** Build one element from a SafeHTML view. */
export function fragment(view) {
  const t = document.createElement("template");
  render(t, view);
  return t.content;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
