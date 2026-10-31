/** Not-found views that offer a way forward: close matches and the generator. */
import { INTENTS, MAX_INPUT, isIntent } from "../../shared/engine/identify.js";
import { suggestApps } from "../../shared/search.js";
import { href } from "../router.js";
import { html, render } from "../ui/dom.js";
import { icon } from "../ui/icons.js";

export function renderNotFound(root, ctx, { what = "page", id = "", app = "", intent = "" } = {}) {
  const suggestions = what === "guide" ? suggestApps(ctx.lib, id, 3) : [];
  // An expired share link names the app it was for (untrusted text: clamped here, escaped by html``).
  const again = what === "shared" && typeof app === "string" && app.trim() ? { app: app.trim().slice(0, MAX_INPUT), intent: isIntent(intent) ? intent : "write" } : null;
  const title = { guide: "There's no researched guide by that name", shared: "This shared guide isn't available" }[what] ?? "Page not found";
  const message =
    what === "guide"
      ? `Nothing in the library is called “${id}”. Pick a close match, or ask the Live Generator to investigate it.`
      : what === "shared"
        ? again
          ? `This server no longer has this guide: shared guides are cleared when the store fills up, and on some hosts whenever the server restarts. It was for “${again.app}” (${INTENTS[again.intent].label.toLowerCase()}); generate it again with one click.`
          : "The link may be mistyped, or the guide expired from this server's share store. Generate it again; it takes about a minute."
        : "That address doesn't match anything here.";
  render(
    root,
    html`<div class="empty">
      <h1 id="nf-title" tabindex="-1">${title}</h1>
      <p>${message}</p>
      ${suggestions.length
        ? html`<ul class="chips" aria-label="Close matches">${suggestions.map((s) => html`<li><a class="chip" href="${href(`/guides/${encodeURIComponent(s.id)}`)}">${s.name}</a></li>`)}</ul>`
        : ""}
      <div class="row">
        ${what === "guide"
          ? html`<a class="btn btn-primary" href="${href(`/generate?app=${encodeURIComponent(id)}`)}">${icon("compass")}<span>Generate a guide for ${id}</span></a>`
          : what === "shared"
            ? again
              ? html`<a class="btn btn-primary" href="${href(`/generate?app=${encodeURIComponent(again.app)}&intent=${again.intent}`)}" data-regenerate>${icon("refresh")}<span>Generate it again</span></a>`
              : html`<a class="btn btn-primary" href="${href("/generate")}">${icon("compass")}<span>Open the Live Generator</span></a>`
            : ""}
        <a class="btn" href="${href("/")}">Browse the library</a>
      </div>
    </div>`,
  );
  return { title: `${title} – OAuth Field Guide` };
}

export function renderFatal(root, message) {
  render(
    root,
    html`<div class="empty" role="alert">
      <h1 tabindex="-1">The guide couldn't load</h1>
      <p>${message}</p>
      <div class="row"><button type="button" class="btn btn-primary" data-action="reload">${icon("refresh")}<span>Reload</span></button></div>
    </div>`,
  );
  root.querySelector('[data-action="reload"]').addEventListener("click", () => location.reload());
}
