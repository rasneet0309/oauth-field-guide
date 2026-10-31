/**
 * Live Generator: name any app, watch the agent work, get a guide in the library's format.
 * The run is a stream of events (run, stage, log, evidence, guide, error, done) from
 * POST /api/generate, or from the in-page engine in the single-file demo.
 */
import { INTENTS, isIntent } from "../../shared/engine/identify.js";
import { sharePath, stepStats } from "../../shared/guide-model.js";
import { href } from "../router.js";
import { announce } from "../services/feedback.js";
import { recent } from "../services/storage.js";
import { callout } from "../ui/components.js";
import { $, html, raw, render } from "../ui/dom.js";
import { icon } from "../ui/icons.js";
import { renderGuide } from "./guide.js";

const EXAMPLES = [
  ["Linear", "Already researched: instant"],
  ["Confluence", "Shares Jira's developer platform"],
  ["developer.zoom.us", "A URL works too"],
  ["Calendly", "Not in the library"],
  ["Acme Billing", "An app nobody has heard of"],
];

const STATUS_ICON = { done: "checkCircle", warn: "warn", error: "error", skipped: "skip" };

function stageIcon(status) {
  if (status === "running") return html`<span class="spinner" aria-hidden="true"></span>`;
  if (STATUS_ICON[status]) return icon(STATUS_ICON[status]);
  return html`<span class="pending" aria-hidden="true"></span>`;
}

const STATUS_TEXT = { pending: "Waiting", running: "In progress", done: "Done", warn: "Done with warnings", error: "Failed", skipped: "Skipped" };

function engineBadge(config) {
  if (config.mode === "live") {
    return html`<span class="engine" data-mode="live"><span class="engine-dot" aria-hidden="true"></span>Live research agent: ${config.live.model}${config.live.webSearch ? " with web search" : ""}</span>`;
  }
  return html`<span class="engine" data-mode="offline"><span class="engine-dot" aria-hidden="true"></span>Offline engine: research patterns${config.discoveryProbe ? " and live OAuth discovery checks" : ""}</span>`;
}

/** What the agent will do, as a row of steps rather than a paragraph. */
function pipeline(config) {
  const steps =
    config.mode === "live"
      ? [["book", "Library match"], ["key", "OAuth metadata"], ["compass", "Web research"], ["checkCircle", "Validated draft"]]
      : [
          ["book", "Library match"],
          ["link", "Vendor family"],
          ...(config.discoveryProbe ? [["key", "OAuth metadata"]] : []),
          ["sort", "Research patterns"],
          ["checkCircle", "Checked draft"],
        ];
  return html`<ol class="flow is-compact" aria-label="What the agent does">${steps.map(([ic, label]) => html`<li>${icon(ic)}<span>${label}</span></li>`)}</ol>`;
}

function recentList() {
  const items = recent.list();
  if (!items.length) return html``;
  return html`<section class="recent" aria-labelledby="recent-title">
    <h2 id="recent-title">Your recent guides</h2>
    <ul class="chips">${items.map((r) => html`<li><a class="chip" href="${href(sharePath(r.id, { generation: { input: r.app, intent: r.intent } }))}">${r.name}</a></li>`)}</ul>
  </section>`;
}

export function renderGenerator(root, ctx, route) {
  const { api, config, router } = ctx;
  const q = route.query ?? {};
  const intent0 = isIntent(q.intent) ? q.intent : "write";
  const maxLen = config.limits?.maxInputLength ?? 120;

  render(
    root,
    html`<header class="gen-head">
        <h1 id="gen-title" tabindex="-1">Live Generator</h1>
        <p>Name any app and get a guide in the library's format, with every estimate marked.</p>
        ${pipeline(config)}
      </header>
      <form class="gen-form" data-form="generate" novalidate>
        <div class="gen-row">
          <div class="field">
            <label class="field-label" for="gen-app">App name or website</label>
            <input id="gen-app" class="input" name="app" type="text" required maxlength="${maxLen}" autocomplete="off" spellcheck="false" placeholder="e.g. Airtable, Linear or https://developer.zoom.us" value="${q.app ?? ""}" aria-describedby="gen-hint" />
            <span class="field-hint" id="gen-hint">A website is more precise than a name.</span>
          </div>
          <button type="submit" class="btn btn-primary btn-lg" data-submit>${icon("compass")}<span class="btn-label">Generate guide</span></button>
        </div>
        <fieldset class="field">
          <legend class="field-label">What will your agent do in this app?</legend>
          <div class="segmented">
            ${Object.entries(INTENTS).map(
              ([value, it]) =>
                html`<label><input type="radio" name="intent" value="${value}" ${value === intent0 ? raw("checked") : ""} />${it.label}</label>`,
            )}
          </div>
        </fieldset>
        <div class="gen-foot">
          ${engineBadge(config)}
          <div class="examples">
            <span id="examples-label">Try</span>
            <ul class="chips" aria-labelledby="examples-label">
              ${EXAMPLES.map(([name, why]) => html`<li><button type="button" class="chip" data-example="${name}" title="${why}">${name}</button></li>`)}
            </ul>
          </div>
        </div>
      </form>
      <div id="gen-error" class="run-error" hidden></div>
      <div id="gen-run" hidden></div>
      <div id="gen-result" class="result" hidden></div>
      <div id="gen-recent">${recentList()}</div>`,
  );

  const form = $('[data-form="generate"]', root);
  const input = $("#gen-app", root);
  const submit = $("[data-submit]", form);
  const runEl = $("#gen-run", root);
  const resultEl = $("#gen-result", root);
  const errorEl = $("#gen-error", root);
  /** The run on screen: { ac, timer, done }. Replacing it silences the old one completely. */
  let current = null;
  let resultView = null;

  const showError = (title, message, { retry = true } = {}) => {
    errorEl.hidden = false;
    render(
      errorEl,
      callout({
        kind: "error",
        title,
        body: html`<p>${message}</p>${retry ? html`<div class="row"><button type="button" class="btn" data-action="retry">${icon("refresh")}<span>Try again</span></button></div>` : ""}`,
      }),
    );
  };

  function stopCurrent() {
    if (!current) return;
    current.ac.abort();
    clearInterval(current.timer);
    current.done = true;
    current = null;
  }

  function startRun({ app, intent, fresh = false }) {
    stopCurrent();
    resultView?.dispose?.();
    resultView = null;
    errorEl.hidden = true;
    resultEl.hidden = true;
    render(resultEl, html``);
    router.replaceQuiet(`/generate?app=${encodeURIComponent(app)}&intent=${intent}`);

    const run = { ac: new AbortController(), timer: null, done: false };
    const { ac } = run;
    current = run;
    const started = performance.now();
    const stamp = () => {
      const s = (performance.now() - started) / 1000;
      return `${String(Math.floor(s / 60)).padStart(2, "0")}:${(s % 60).toFixed(1).padStart(4, "0")}`;
    };

    runEl.hidden = false;
    render(
      runEl,
      html`<section class="run" aria-labelledby="run-title">
        <div class="run-head">
          <h2 class="run-title" id="run-title" tabindex="-1"><span>Investigating ${app}</span><span class="muted" id="run-engine"></span></h2>
          <div class="row">
            <span class="run-clock" id="run-clock" aria-hidden="true">00:00.0</span>
            <button type="button" class="btn btn-quiet" data-action="cancel">${icon("stop")}<span>Stop</span></button>
          </div>
        </div>
        <ol class="stages" id="run-stages" aria-label="Agent steps"></ol>
        <div class="log" id="run-log" role="log" aria-live="off" aria-label="Agent log" tabindex="0"><ol class="log-list"></ol></div>
      </section>`,
    );
    const stagesEl = $("#run-stages", runEl);
    const logEl = $("#run-log", runEl);
    const logList = $(".log-list", logEl);
    const clockEl = $("#run-clock", runEl);
    const engineEl = $("#run-engine", runEl);
    const cancelBtn = $('[data-action="cancel"]', runEl);
    const stages = new Map();
    run.timer = setInterval(() => (clockEl.textContent = stamp()), 100);
    submit.setAttribute("aria-busy", "true");
    submit.disabled = true;

    const addLog = (text, level = "info", kind = "log") => {
      const li = document.createElement("li");
      li.dataset.level = level;
      li.dataset.kind = kind;
      render(li, html`<time>${stamp()}</time><span class="msg">${text}</span>`);
      const atBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
      logList.append(li);
      if (atBottom) logEl.scrollTop = logEl.scrollHeight;
    };
    const drawStages = () => {
      render(
        stagesEl,
        html`${[...stages.values()].map(
          (s) => html`<li class="stage" data-status="${s.status}">
            <span class="stage-icon">${stageIcon(s.status)}</span>
            <span><span class="stage-label">${s.label}</span><span class="visually-hidden">: ${STATUS_TEXT[s.status] ?? s.status}</span>${s.summary ? html`<span class="stage-summary">${s.summary}</span>` : ""}</span>
          </li>`,
        )}`,
      );
    };

    // Only the run on screen may touch the shared controls; a replaced run just stops.
    const finish = () => {
      if (run.done) return;
      run.done = true;
      clearInterval(run.timer);
      clockEl.textContent = stamp();
      cancelBtn.hidden = true;
      if (current === run) {
        current = null;
        submit.removeAttribute("aria-busy");
        submit.disabled = false;
      }
    };

    // A run ends with a guide or an error. A stream that closes without either was cut off.
    let settled = false;
    const failRunningStages = () => {
      for (const s of stages.values()) if (s.status === "running") s.status = "error";
      drawStages();
    };

    const onEvent = (ev) => {
      if (ac.signal.aborted) return;
      switch (ev.type) {
        case "run":
          stages.clear();
          for (const s of ev.stages) stages.set(s.id, { ...s, status: "pending", summary: "" });
          engineEl.textContent = ev.engine.label;
          drawStages();
          if (ev.engine.kind === "offline" && logList.children.length) addLog("Switched to the offline engine.", "warn", "stage");
          break;
        case "stage": {
          const s = stages.get(ev.id);
          if (!s) break;
          s.status = ev.status;
          s.summary = ev.summary ?? s.summary;
          drawStages();
          if (ev.status === "running") {
            addLog(`${s.label}…`, "info", "stage");
            announce(`${s.label}…`);
          }
          break;
        }
        case "log":
          addLog(ev.text, ev.level);
          break;
        case "guide":
          settled = true;
          showResult(ev, { app, intent });
          break;
        case "error":
          settled = true;
          failRunningStages();
          addLog(ev.message, "error");
          showError("The run failed", ev.message);
          break;
        default:
          break;
      }
    };

    api
      .generate({ app, intent, fresh }, onEvent, ac.signal)
      .then(() => {
        if (ac.signal.aborted || settled) return;
        failRunningStages();
        addLog("The connection closed before the guide arrived.", "error");
        showError("The run didn't finish", "The connection closed before the guide arrived. Try again.");
      })
      .catch((err) => {
        if (ac.signal.aborted) return;
        failRunningStages();
        const wait = err.retryAfter ? ` (about ${err.retryAfter} s)` : "";
        const title = err.status === 429 ? "Generation limit reached" : err.status === 503 ? "The generator is busy" : "The run didn't finish";
        addLog(err.message, "error");
        showError(title, `${err.message}${err.status === 429 ? wait : ""}`);
      })
      .finally(finish);

    // Stop: bound to this run's own button, so an old run can never be stopped twice.
    cancelBtn.addEventListener("click", () => {
      if (run.done) return;
      ac.abort();
      for (const s of stages.values()) if (s.status === "running" || s.status === "pending") s.status = "skipped";
      drawStages();
      addLog("Stopped.", "warn");
      announce("Stopped");
      finish();
      submit.focus(); // the Stop button is gone; keep keyboard users in the form
    });
    return run;
  }

  function showResult(ev, { app, intent }) {
    const g = ev.guide;
    resultEl.hidden = false;
    const note = ev.matched
      ? callout({
          title: `${g.name} is already in the research library`,
          body: html`<p>No generation needed: this is the researched guide, checked ${g.lastChecked}. <a href="${href(`/guides/${encodeURIComponent(g.id)}`)}">Open it as its own page</a>.</p>`,
        })
      : ev.cached
        ? callout({ title: "Served from cache", body: html`<p>This app and intent were investigated recently, so you got the stored result instantly. Use “Run fresh” on the guide to investigate again.</p>` })
        : html``;
    render(resultEl, html`<div class="result-note">${note}</div><div id="gen-guide"></div>`);
    resultView = renderGuide($("#gen-guide", resultEl), g, {
      api,
      mode: ev.matched ? "library" : "generated",
      shareId: ev.shareId ?? "",
      shareUrl: ev.shareLink ?? "",
      level: 2,
      onRunFresh: () => startRun({ app, intent, fresh: true }),
    });
    if (ev.shareId && !ev.matched) {
      recent.add({ id: ev.shareId, name: g.name, at: Date.now(), app: g.generation?.input, intent: g.generation?.intent });
      render($("#gen-recent", root), recentList());
    }
    const s = stepStats(g);
    announce(`Guide ready: ${g.name}, ${s.total} steps, ${s.human} need a human.`);
    resultEl.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    resultView.heading?.focus({ preventScroll: true });
  }

  const read = () => ({
    app: input.value.trim(),
    intent: form.querySelector('input[name="intent"]:checked')?.value ?? "write",
  });

  const onSubmit = (e) => {
    if (!e.target.matches('[data-form="generate"]')) return;
    e.preventDefault();
    const { app, intent } = read();
    if (!app) {
      input.setAttribute("aria-invalid", "true");
      showError("Name an app first", "Type an app name or paste its website, then generate.", { retry: false });
      input.focus();
      return;
    }
    input.removeAttribute("aria-invalid");
    startRun({ app, intent });
  };
  const onClick = (e) => {
    const ex = e.target.closest("[data-example]");
    if (ex) {
      input.value = ex.dataset.example;
      startRun(read());
      return;
    }
    if (e.target.closest('[data-action="retry"]')) {
      const r = read();
      if (!r.app) return;
      startRun(r);
      $("#run-title", runEl)?.focus(); // the Try again button is gone; start at the new run
    }
  };
  root.addEventListener("submit", onSubmit);
  root.addEventListener("click", onClick);

  // Arriving with ?app= from inside the app ("Generate a guide for X", "Run fresh") starts the
  // run. A page load from an outside link only fills the form: a link elsewhere must not be
  // able to spend this server's quota or API budget (and "fresh" never applies on a page load).
  // The single-file demo has no server cost, so it runs straight away.
  if (q.app) {
    const app = String(q.app).slice(0, maxLen);
    if (!route.initial || api.kind === "local") queueMicrotask(() => startRun({ app, intent: intent0, fresh: !route.initial && q.fresh === "1" }));
    else {
      errorEl.hidden = false;
      render(errorEl, callout({ title: `Ready to investigate ${app}`, body: html`<p>Select Generate guide to start the run.</p>` }));
    }
  }

  return {
    title: "Live Generator – OAuth Field Guide",
    dispose() {
      stopCurrent();
      resultView?.dispose?.();
      root.removeEventListener("submit", onSubmit);
      root.removeEventListener("click", onClick);
    },
  };
}
