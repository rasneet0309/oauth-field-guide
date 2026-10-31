/**
 * Feedback: screen-reader announcements, toasts, clipboard and downloads, and the busy/done
 * states of action buttons (a double click never runs an action twice).
 */
import { html, render } from "../ui/dom.js";
import { icon } from "../ui/icons.js";

let liveRegion;
export function announce(text) {
  liveRegion ??= document.getElementById("announcer");
  if (!liveRegion) return;
  liveRegion.textContent = "";
  // A fresh text node in the next frame makes repeated messages announce again.
  requestAnimationFrame(() => {
    liveRegion.textContent = text;
  });
}

export function toast(text, { error = false } = {}) {
  const region = document.getElementById("toasts");
  if (!region) return;
  const el = document.createElement("div");
  el.className = `toast${error ? " is-error" : ""}`;
  render(el, html`${icon(error ? "error" : "checkCircle")}<span>${text}</span>`);
  region.append(el);
  announce(text);
  setTimeout(() => el.remove(), 2600);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for browsers that block the async clipboard (e.g. some embedded views).
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.className = "visually-hidden";
    const active = document.activeElement;
    document.body.append(area);
    area.select();
    let ok;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    area.remove();
    active?.focus?.();
    return ok;
  }
}

export function downloadText(filename, text, type = "text/markdown;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Run an action from a button: aria-busy while it runs, a short "done" label after, and
 * repeat clicks ignored meanwhile. The label is restored exactly.
 */
export async function runAction(button, action, doneLabel) {
  if (button.getAttribute("aria-busy") === "true" || button.dataset.state === "done") return;
  button.setAttribute("aria-busy", "true");
  let ok;
  try {
    ok = (await action()) !== false;
  } catch (err) {
    // A failed action must not become an unhandled rejection with no feedback.
    ok = false;
    console.error(err);
    toast("That didn't work. Try again.", { error: true });
  } finally {
    button.removeAttribute("aria-busy");
  }
  if (!ok || !doneLabel) return;
  const label = button.querySelector(".btn-label");
  const before = label?.textContent;
  button.dataset.state = "done";
  if (label) label.textContent = doneLabel;
  setTimeout(() => {
    if (!button.isConnected) return;
    delete button.dataset.state;
    if (label) label.textContent = before;
  }, 1600);
}
