/**
 * One guide, in the same structure whether it was researched, generated or shared:
 * verdict → route to production → key facts → Overview, Prerequisites, Console setup steps,
 * Scopes & permissions, Approval & verification, Blockers & gotchas, Developer action items,
 * Testing, Team & roles, (How it was generated), Evidence.
 */
import { approvalDetail, approvalLabel, stepStats } from "../../shared/guide-model.js";
import { guideToMarkdown } from "../../shared/markdown.js";
import { formatDate, hashString, safeUrl } from "../../shared/text.js";
import { href } from "../router.js";
import { checks } from "../services/storage.js";
import { copyText, downloadText, runAction, toast } from "../services/feedback.js";
import { embedded } from "../services/host.js";
import { approval, button, callout, effort, monogram, pathPill, scopeMeter, splitBar } from "../ui/components.js";
import { $$, html, raw, render } from "../ui/dom.js";
import { icon } from "../ui/icons.js";

/**
 * Milestones for the route strip. Gates come from the data (phase.gate), never from words in
 * a phase name, so the strip can't contradict the guide's provider-approval fact. "Live" goes
 * after the last phase you can't skip: an optional listing review comes after launch, not before.
 */
export function journeyNodes(g) {
  if (g.phases.length > 1) {
    const nodes = g.phases
      .filter((p) => !/ongoing|varies/i.test(p.duration || ""))
      .map((p) => ({ name: p.name, time: p.duration, gate: p.gate === "required", optional: p.gate === "optional" }));
    const at = nodes.findLastIndex((n) => !n.optional) + 1;
    return [...nodes.slice(0, at), { name: "Live", time: "", live: true }, ...nodes.slice(at)];
  }
  if (g.path === "none") return [{ name: "No connector path", time: "" }];
  if (g.path === "key") {
    return [
      { name: "Customer creates a key", time: g.effort.firstShort },
      { name: "Validate and ship", time: g.effort.prodShort },
      { name: "Live", time: "", live: true },
    ];
  }
  const partner = g.path === "partner";
  const nodes = [
    { name: partner ? "Apply for access" : "Register the app", time: partner ? "" : g.effort.firstShort },
    { name: "Build and test", time: partner ? g.effort.firstShort : g.path === "self" ? g.effort.prodShort : "" },
  ];
  if (g.path === "review") nodes.push({ name: "Provider review", time: g.effort.prodShort, gate: true });
  if (partner) nodes.push({ name: "Partner approval", time: g.effort.prodShort, gate: true });
  return [...nodes, { name: "Live", time: "", live: true }];
}

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

const ext = (url, label) => {
  const u = safeUrl(url);
  return u ? html`<a href="${u}" target="_blank" rel="noopener noreferrer">${label || hostOf(u)}</a>` : html`${label}`;
};

/** The kind of approval in a few words, or "" when the label already says it all. */
const approvalNote = (a) => a.atScale || approvalDetail(a);

const KIND_LABEL = { "in-depth": "In-depth guide", researched: "Researched profile", generated: "Generated draft" };
const INTENT_LABEL = { read: "read data", write: "read and write", send: "send as the user", admin: "admin or bulk access" };

/** Section definitions, in order. Each returns null when it has nothing to show. */
function sections(g, h, keyFor, ticked, prefix) {
  const H3 = raw(`h${h + 2}`);
  const steps = g.phases.flatMap((p) => p.steps);
  const stats = stepStats(g);
  let n = 0;
  let uid = 0;
  const stepRow = (st) => {
    n += 1;
    const key = keyFor("s", st.do);
    return html`<li class="step" data-agent="${String(st.agent)}">
      <input type="checkbox" data-check="${key}" aria-labelledby="${prefix}-st-${n}" ${ticked.has(key) ? raw("checked") : ""} />
      <span class="step-num" aria-hidden="true">${n}</span>
      <div class="step-text">
        <span class="step-body" id="${prefix}-st-${n}">${st.do}</span>
        <span class="step-tags">
          <span class="tag">${st.who}</span>
          ${st.agent
            ? html`<span class="tag tag-agent">${icon("agent")}Agent can do</span>`
            : html`<span class="tag tag-human">${icon("human")}Needs a human</span>`}
        </span>
      </div>
    </li>`;
  };
  const checkItem = (text, kind) => {
    const key = keyFor(kind, text);
    uid += 1;
    return html`<li class="check"><input type="checkbox" id="${prefix}-c${uid}" data-check="${key}" ${ticked.has(key) ? raw("checked") : ""} /><label class="check-text" for="${prefix}-c${uid}">${text}</label></li>`;
  };

  return [
    {
      id: "overview",
      title: "Overview",
      body: html`${g.needGuide ? html`<p class="prose"><strong>Do you need this guide?</strong> ${g.needGuide}</p>` : ""}
        <p class="prose"><strong>Auth model: ${g.auth.model}.</strong> ${g.auth.detail}</p>
        ${g.approval.gate ? html`<p class="prose"><strong>Production gate:</strong> ${g.approval.gate}</p>` : ""}
        ${g.tiers?.length
          ? html`<${H3} class="sub-title">Distribution options</${H3}>
              <div class="table-wrap">
                <table>
                  <thead><tr><th scope="col">Option</th><th scope="col">Example</th><th scope="col">Effort</th><th scope="col">Time</th><th scope="col">Note</th></tr></thead>
                  <tbody>${g.tiers.map((t) => html`<tr><th scope="row">${t.label}</th><td>${t.eg}</td><td>${t.difficulty}</td><td>${t.time}</td><td>${t.note}</td></tr>`)}</tbody>
                </table>
              </div>`
          : ""}
        ${g.cost ? html`<p class="prose"><strong>Cost:</strong> ${g.cost}</p>` : ""}`,
    },
    g.prerequisites.length
      ? { id: "prerequisites", title: "Prerequisites", body: html`<ul class="checklist">${g.prerequisites.map((p) => checkItem(p, "p"))}</ul>` }
      : null,
    {
      id: "setup",
      title: "Console setup steps",
      body: html`${g.registerAt
          ? callout({
              title: "Where to register",
              body: html`<p>${g.registerAt.path}</p>${g.registerAt.url ? html`<p>${ext(g.registerAt.url, html`${hostOf(g.registerAt.url)} ${icon("external")}`)}</p>` : ""}`,
            })
          : ""}
        <div class="steps-toolbar">
          <p class="muted">${stats.total} steps: <strong>${stats.human} need a human</strong>, ${stats.agent} an agent can do.</p>
          <div class="segmented" role="group" aria-label="Show steps">
            <button type="button" data-step-filter="all" aria-pressed="true">All</button>
            <button type="button" data-step-filter="human" aria-pressed="false">Needs a human</button>
            <button type="button" data-step-filter="agent" aria-pressed="false">Agent can do</button>
          </div>
        </div>
        <div class="phases" data-filter="all">
          ${g.phases.map(
            (ph) => html`<div class="phase">
              <div class="phase-head${ph.gate === "required" ? " is-gate" : ph.gate === "optional" ? " is-optional" : ""}">
                <${H3} class="phase-title">${ph.name}</${H3}>${ph.duration ? html`<span class="muted">${ph.duration}</span>` : ""}
              </div>
              <ol class="steps">${ph.steps.map(stepRow)}</ol>
              <p class="steps-empty" hidden>No steps of this kind in this phase.</p>
            </div>`,
          )}
        </div>`,
    },
    {
      id: "scopes",
      title: "Scopes & permissions",
      body: html`<p class="prose"><strong>Scope complexity: ${scopeMeter(g.scopes.complexity)}</strong> ${g.scopes.why}</p>
        ${g.scopes.table?.length
          ? html`<div class="table-wrap">
              <table>
                <thead><tr><th scope="col">Use</th><th scope="col">Scope</th><th scope="col">Tier</th><th scope="col">Note</th></tr></thead>
                <tbody>${g.scopes.table.map((r) => html`<tr><th scope="row">${r.use}</th><td><code>${r.scope}</code></td><td>${r.tier}</td><td>${r.note}</td></tr>`)}</tbody>
              </table>
            </div>`
          : ""}
        ${g.scopes.summary ? html`<p class="prose">${g.scopes.summary}</p>` : ""}`,
    },
    {
      id: "approval",
      title: "Approval & verification",
      body: html`<p class="prose"><strong>Provider approval: ${approvalLabel(g.approval)}</strong>${approvalDetail(g.approval) ? ` (${approvalDetail(g.approval)})` : ""}.${g.approval.atScale ? html` <strong>At scale:</strong> ${g.approval.atScale}.` : ""}</p>
        ${g.approval.when ? html`<p class="prose">${g.approval.when}</p>` : ""}
        ${g.approval.timeline?.length
          ? html`<div class="table-wrap">
              <table>
                <thead><tr><th scope="col">Stage</th><th scope="col">Official</th><th scope="col">Reported by developers</th></tr></thead>
                <tbody>${g.approval.timeline.map((r) => html`<tr><th scope="row">${r.label}</th><td>${r.official || "—"}</td><td>${r.reported || "—"}</td></tr>`)}</tbody>
              </table>
            </div>`
          : ""}
        ${g.approval.recurring ? html`<p class="prose"><strong>After launch:</strong> ${g.approval.recurring}</p>` : ""}
        ${g.roles.customer || g.customerExperience?.length
          ? html`<${H3} class="sub-title">On the customer's side</${H3}>
              ${g.roles.customer ? html`<p class="prose">${g.roles.customer}</p>` : ""}
              ${g.customerExperience?.length ? html`<ul class="bullets">${g.customerExperience.map((c) => html`<li>${c}</li>`)}</ul>` : ""}`
          : ""}`,
    },
    g.blockers.length || g.gotchas?.length
      ? {
          id: "blockers",
          title: "Blockers & gotchas",
          body: html`<ul class="blockers">
              ${g.blockers.map((b) => html`<li class="blocker"><strong>${b.problem}</strong>${b.fix ? html`<span>${b.fix}</span>` : ""}</li>`)}
            </ul>
            ${g.gotchas?.length ? html`<${H3} class="sub-title">Gotchas</${H3}><ul class="bullets">${g.gotchas.map((x) => html`<li>${x}</li>`)}</ul>` : ""}`,
        }
      : null,
    {
      id: "actions",
      title: "Developer action items",
      body: html`<div class="split">
        <div class="split-col">
          <${H3} class="sub-title">${icon("human")}Needs a human</${H3}>
          ${g.automation.humanMust ? html`<p>${g.automation.humanMust}</p>` : ""}
          <ul class="checklist">${steps.filter((s) => !s.agent).map((s) => checkItem(s.do, "s"))}</ul>
          <p class="progress" data-progress="human"></p>
        </div>
        <div class="split-col">
          <${H3} class="sub-title">${icon("agent")}Your agent can handle</${H3}>
          ${g.automation.agentCan ? html`<p>${g.automation.agentCan}</p>` : ""}
          <ul class="checklist">${steps.filter((s) => s.agent).map((s) => checkItem(s.do, "s"))}</ul>
          <p class="progress" data-progress="agent"></p>
        </div>
      </div>`,
    },
    g.testing.length ? { id: "testing", title: "Testing", body: html`<ul class="bullets">${g.testing.map((t) => html`<li>${t}</li>`)}</ul>` } : null,
    {
      id: "roles",
      title: "Team & roles",
      body: html`<dl class="roles">
          ${g.roles.team ? html`<div><dt>Your team</dt><dd>${g.roles.team}</dd></div>` : ""}
          ${g.roles.console ? html`<div><dt>Developer console</dt><dd>${g.roles.console}</dd></div>` : ""}
          ${g.roles.customer ? html`<div><dt>Customer</dt><dd>${g.roles.customer}</dd></div>` : ""}
        </dl>
        ${g.roles.consoleRoles?.length
          ? html`<div class="table-wrap">
              <table>
                <thead><tr><th scope="col">Console role</th><th scope="col">Can</th><th scope="col">Give it to</th></tr></thead>
                <tbody>${g.roles.consoleRoles.map((r) => html`<tr><th scope="row">${r.role}</th><td>${r.can}</td><td>${r.who}</td></tr>`)}</tbody>
              </table>
            </div>`
          : ""}`,
    },
    g.kind === "generated" && g.generation
      ? {
          id: "generation",
          title: "How this guide was generated",
          body: html`<p class="prose">
              ${g.generation.engineLabel} investigated “${g.generation.input}” for an agent that will ${INTENT_LABEL[g.generation.intent] ?? "read and write"}, on ${formatDate(String(g.generation.generatedAt).slice(0, 10))}.
            </p>
            ${g.generation.evidence?.length
              ? html`<${H3} class="sub-title">What the agent checked</${H3}>
                  <ul class="bullets">${g.generation.evidence.map((e) => html`<li><strong>${e.label}</strong>${e.detail ? html`: ${e.detail}` : ""}${e.url ? html` (${ext(e.url, hostOf(e.url))})` : ""}</li>`)}</ul>`
              : ""}
            ${g.generation.verify?.length
              ? html`<${H3} class="sub-title">Verify before you rely on this</${H3}>
                  <ul class="checklist">${g.generation.verify.map((v) => {
                    const key = keyFor("v", v.label);
                    uid += 1;
                    return html`<li class="check"><input type="checkbox" id="${prefix}-c${uid}" data-check="${key}" ${ticked.has(key) ? raw("checked") : ""} /><span class="check-text"><label for="${prefix}-c${uid}">${v.label}</label> ${v.url ? ext(v.url, html`Search ${icon("external")}`) : ""}</span></li>`;
                  })}</ul>`
              : ""}
            ${g.generation.vendorEmail
              ? html`<${H3} class="sub-title">Email to the vendor</${H3}>
                  <p class="prose">If the docs don't answer these questions, send this. It asks exactly what decides the path.</p>
                  <pre class="email">${g.generation.vendorEmail}</pre>
                  <div class="row">${button({ label: "Copy email", iconName: "copy", action: "copy-email" })}</div>`
              : ""}
            ${g.generation.similar?.length
              ? html`<${H3} class="sub-title">Researched apps like this one</${H3}>
                  <ul class="chips">${g.generation.similar.map((s) => html`<li><a class="chip" href="${href(`/guides/${encodeURIComponent(s.id)}`)}">${s.name}</a></li>`)}</ul>`
              : ""}`,
        }
      : null,
    {
      id: "evidence",
      title: "Evidence",
      body: html`<p class="prose">
          Confidence <strong>${g.confidence}</strong>. ${g.kind === "generated" ? "Generated" : "Researched"} ${formatDate(g.lastChecked)}.
          ${g.kind === "generated" ? "" : "Provider rules change often, so re-check anything below before you commit to dates."}
        </p>
        ${g.uncertain?.length ? html`<${H3} class="sub-title">Not confirmed</${H3}><ul class="bullets">${g.uncertain.map((u) => html`<li>${u}</li>`)}</ul>` : ""}
        ${g.sources?.length
          ? html`<${H3} class="sub-title">Sources</${H3}>
              <ol class="sources">${g.sources.map((s) => html`<li>${ext(s.url, s.label || hostOf(s.url))} <span class="host">${hostOf(s.url)}</span></li>`)}</ol>`
          : html`<p class="prose muted">No external sources: this draft is built from research patterns${g.kind === "generated" ? " and the checks listed above" : ""}.</p>`}`,
    },
  ].filter(Boolean);
}

/**
 * @param {HTMLElement} root
 * @param {object} g          a finalized guide
 * @param {object} opts       { api, mode: "library"|"generated"|"shared", shareId?, shareUrl?, level?: 1|2, onRunFresh? }
 */
export function renderGuide(root, g, opts) {
  const { api, mode = "library", shareId = "", level = 1 } = opts;
  const H1 = raw(`h${level}`);
  const H2 = raw(`h${level + 1}`);
  const guideKey = shareId ? `g-${shareId}` : g.kind === "generated" ? `gen-${g.id}` : g.id;
  const ticked = checks.get(guideKey);
  const keyFor = (prefix, text) => `${prefix}${hashString(text).toString(36)}`;
  const stats = stepStats(g);
  // A framed page's own address isn't shareable, so it gets no link (and the export no URL).
  const canonical = embedded ? "" : opts.shareUrl || (mode === "library" ? api.guideUrl(g.id) : shareId ? api.shareUrl(shareId, g) : "");
  const prefix = `${mode}-${g.id}`.replace(/[^a-z0-9-]/gi, "");
  const secs = sections(g, level, keyFor, ticked, prefix);

  render(
    root,
    html`<article class="guide" data-path="${g.path}" aria-labelledby="${prefix}-title">
      ${opts.back
        ? html`<div class="guide-back">
            <a class="btn btn-quiet back-link" href="${href(opts.back.href)}" data-back>${icon("arrowLeft")}<span>${opts.back.label}</span></a>
          </div>`
        : ""}
      <header class="guide-head">
        ${monogram(g.name, { large: true })}
        <div>
          <${H1} class="guide-title" id="${prefix}-title" tabindex="-1">${g.name}</${H1}>
          ${g.tagline ? html`<p class="guide-tagline">${g.tagline}</p>` : ""}
          <div class="guide-meta">
            ${pathPill(g.path, { unconfirmed: g.approval.unconfirmed === true })}
            ${mode === "library" ? html`<span class="tag">${g.category}</span>` : ""}
            <span class="tag${g.kind === "generated" ? "" : " tag-accent"}">${KIND_LABEL[g.kind]}</span>
            <span class="tag">${g.confidence} confidence</span>
            <span class="tag">${g.kind === "generated" ? "Generated" : "Checked"} ${formatDate(g.lastChecked)}</span>
          </div>
        </div>
        <div class="guide-actions" data-needs-js>
          ${button({ label: "Copy guide", iconName: "copy", action: "copy-md" })}
          ${canonical ? button({ label: "Share link", iconName: "link", action: "share" }) : ""}
          ${embedded ? "" : button({ label: "Download .md", iconName: "download", action: "download", quiet: true })}
          ${mode !== "library" && g.generation ? button({ label: "Run fresh", iconName: "refresh", action: "run-fresh", quiet: true }) : ""}
        </div>
      </header>

      ${g.kind === "generated"
        ? html`<div class="gen-banner">${callout({
            kind: g.confidence === "Low" ? "warn" : "info",
            title: `Generated draft, ${g.confidence.toLowerCase()} confidence`,
            body: html`<p>
              ${g.generation?.engineLabel ?? "The generator"} drafted this in the library's format. Facts it couldn't check are
              marked “likely”; confirm the ${g.generation?.verify?.length ?? 0} items under
              <a href="#${prefix}-sec-generation" data-scroll>Verify before you rely on this</a> before you commit to a date.
            </p>`,
          })}</div>`
        : ""}

      <p class="verdict">${g.verdict}</p>

      <section class="journey" aria-labelledby="${prefix}-route">
        <${H2} class="journey-title" id="${prefix}-route">Route to production</${H2}>
        <ol>
          ${journeyNodes(g).map(
            (nd) => html`<li class="${[nd.gate && "is-gate", nd.optional && "is-optional", nd.live && "is-live"].filter(Boolean).join(" ")}">
              <span class="node" aria-hidden="true"></span>
              <span class="j-name">${nd.name}${nd.gate ? html`<span class="visually-hidden"> (approval gate)</span>` : ""}${nd.optional && !/^optional\b/i.test(nd.name) ? html`<span class="visually-hidden"> (optional review)</span>` : ""}</span>
              ${nd.time ? html`<span class="j-time">${nd.time}</span>` : ""}
            </li>`,
          )}
        </ol>
      </section>

      <dl class="keyfacts">
        <div class="keyfact"><dt>Effort</dt><dd>${effort(g.effort.difficulty, { path: g.path })}${g.effort.researchRating !== "N/A" && g.effort.researchRating !== g.effort.difficulty ? html`<span class="sub">Rated ${g.effort.researchRating.toLowerCase()}</span>` : ""}</dd></div>
        <div class="keyfact"><dt>First test</dt><dd>${g.effort.firstShort}</dd></div>
        <div class="keyfact"><dt>Production</dt><dd>${g.effort.prodShort}</dd></div>
        <div class="keyfact"><dt>Provider approval</dt><dd>${approval(g.approval.required, { short: true, atScale: Boolean(g.approval.atScale), unconfirmed: g.approval.unconfirmed === true })}${approvalNote(g.approval) ? html`<span class="sub">${approvalNote(g.approval)}</span>` : ""}</dd></div>
        <div class="keyfact"><dt>Scope complexity</dt><dd>${scopeMeter(g.scopes.complexity)}</dd></div>
        <div class="keyfact"><dt>${stats.total} steps</dt><dd>${splitBar({ human: stats.human, agent: stats.agent })}</dd></div>
      </dl>

      <div class="guide-body">
        <nav class="toc" aria-labelledby="${prefix}-toc">
          <${H2} class="toc-title" id="${prefix}-toc">On this page</${H2}>
          <ol>${secs.map((s) => html`<li><a href="#${prefix}-sec-${s.id}" data-scroll>${s.title}</a></li>`)}</ol>
        </nav>
        <div class="sections">
          ${secs.map(
            (s) => html`<section class="gsection" id="${prefix}-sec-${s.id}" aria-labelledby="${prefix}-h-${s.id}">
              <${H2} class="gsection-title" id="${prefix}-h-${s.id}" tabindex="-1">${s.title}</${H2}>
              ${s.body}
            </section>`,
          )}
        </div>
      </div>
    </article>`,
  );

  /* Behaviour --------------------------------------------------------------------------- */
  const article = root.querySelector("article.guide");
  const markdown = () => guideToMarkdown(g, { url: canonical });
  const updateProgress = () => {
    for (const kind of ["human", "agent"]) {
      const el = article.querySelector(`[data-progress="${kind}"]`);
      if (!el) continue;
      const boxes = $$("input[data-check]", el.parentElement);
      const done = boxes.filter((b) => b.checked).length;
      el.textContent = boxes.length ? `${done} of ${boxes.length} done` : "Nothing in this column.";
    }
  };
  updateProgress();

  const onClick = (e) => {
    const scroll = e.target.closest("a[data-scroll]");
    if (scroll) {
      e.preventDefault();
      const target = document.getElementById(scroll.getAttribute("href").slice(1));
      target?.scrollIntoView({ block: "start" });
      target?.querySelector("h2, h3, h4")?.focus({ preventScroll: true });
      return;
    }
    const filterBtn = e.target.closest("[data-step-filter]");
    if (filterBtn) {
      const value = filterBtn.dataset.stepFilter;
      for (const b of $$("[data-step-filter]", article)) b.setAttribute("aria-pressed", String(b === filterBtn));
      for (const ph of $$(".phase", article)) {
        let visible = 0;
        for (const st of $$(".step", ph)) {
          const show = value === "all" || (value === "agent") === (st.dataset.agent === "true");
          st.hidden = !show;
          if (show) visible += 1;
        }
        ph.querySelector(".steps-empty").hidden = visible > 0;
      }
      return;
    }
    const back = e.target.closest("a[data-back]");
    if (back && opts.router?.canGoBack() && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.button === 0) {
      e.preventDefault();
      opts.router.back();
      return;
    }
    const action = e.target.closest("button[data-action]");
    if (!action) return;
    const name = action.dataset.action;
    if (name === "copy-md")
      runAction(action, async () => {
        const ok = await copyText(markdown());
        toast(ok ? "Copied the guide as Markdown" : embedded ? "Couldn't copy the guide" : "Couldn't copy. Use Download instead.", { error: !ok });
        return ok;
      }, "Copied");
    if (name === "share")
      runAction(action, async () => {
        const ok = await copyText(canonical);
        toast(ok ? "Link copied" : "Couldn't copy the link", { error: !ok });
        return ok;
      }, "Copied");
    if (name === "download")
      runAction(action, () => {
        downloadText(`${g.id}-oauth-guide.md`, markdown());
        toast("Downloaded the guide as Markdown");
      }, "Downloaded");
    if (name === "copy-email")
      runAction(action, async () => {
        const ok = await copyText(g.generation.vendorEmail);
        toast(ok ? "Copied the email" : "Couldn't copy the email", { error: !ok });
        return ok;
      }, "Copied");
    if (name === "run-fresh") opts.onRunFresh?.(g);
  };
  const onChange = (e) => {
    const box = e.target.closest("input[data-check]");
    if (!box) return;
    const key = box.dataset.check;
    if (box.checked) ticked.add(key);
    else ticked.delete(key);
    // The same step appears in the plan and in the action items: keep both in sync.
    for (const other of $$(`input[data-check="${key}"]`, article)) other.checked = box.checked;
    checks.set(guideKey, ticked);
    updateProgress();
  };
  article.addEventListener("click", onClick);
  article.addEventListener("change", onChange);

  // Highlight the section in view in the table of contents.
  const links = new Map($$(".toc a", article).map((a) => [a.getAttribute("href").slice(1), a]));
  const observer =
    "IntersectionObserver" in window
      ? new IntersectionObserver(
          (entries) => {
            for (const en of entries) {
              if (!en.isIntersecting) continue;
              for (const a of links.values()) a.removeAttribute("aria-current");
              links.get(en.target.id)?.setAttribute("aria-current", "true");
            }
          },
          { rootMargin: "-20% 0px -70% 0px" },
        )
      : null;
  for (const s of $$(".gsection", article)) observer?.observe(s);

  return {
    title: `${g.name}: OAuth setup guide`,
    heading: article.querySelector(`#${prefix}-title`),
    dispose() {
      observer?.disconnect();
      article.removeEventListener("click", onClick);
      article.removeEventListener("change", onChange);
    },
  };
}

const BACK_LABEL = { library: "Back to library", generate: "Back to generator", method: "Back to method guide", guide: "Back", shared: "Back" };

/**
 * The Back link for a guide page. Opened from inside the app, it steps back in history (the
 * library comes back with its filters, scroll position and the card you opened in focus).
 * Opened from a link elsewhere, it goes to the page's parent view instead.
 */
export function backTo(router, parent) {
  const from = router?.cameFrom?.();
  return from ? { label: BACK_LABEL[from] ?? "Back", href: parent.href } : parent;
}

/** Route handler for /guides/:id. */
export async function showGuide(root, ctx, id, { renderNotFound, isCurrent = () => true }) {
  const guide = await ctx.api.guide(id);
  if (!isCurrent()) return null; // the visitor moved on while this loaded: draw nothing
  if (!guide) return renderNotFound(root, ctx, { what: "guide", id });
  return renderGuide(root, guide, { api: ctx.api, mode: "library", router: ctx.router, back: backTo(ctx.router, { label: "All apps", href: "/" }) });
}

/** Route handler for /g/:id. */
export async function showShared(root, ctx, id, { renderNotFound, isCurrent = () => true, query = {} }) {
  const guide = await ctx.api.shared(id);
  if (!isCurrent()) return null;
  // Share links carry the app and intent, so a guide this server no longer has can be made again.
  if (!guide) return renderNotFound(root, ctx, { what: "shared", id, app: query.app, intent: query.intent });
  return renderGuide(root, guide, {
    api: ctx.api,
    mode: "shared",
    shareId: id,
    router: ctx.router,
    back: backTo(ctx.router, { label: "Live Generator", href: "/generate" }),
    onRunFresh: (g) => ctx.router.navigate(`/generate?app=${encodeURIComponent(g.generation?.input ?? g.name)}&intent=${g.generation?.intent ?? "write"}&fresh=1`),
  });
}

