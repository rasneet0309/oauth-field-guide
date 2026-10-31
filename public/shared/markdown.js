/**
 * A v3 guide as Markdown, for "Copy guide", downloads, tickets and wikis. The page and the
 * export render from the same guide object, so they can't drift. Pure and isomorphic.
 */
import { PATHS, approvalDetail, approvalLabel, stepStats } from "./guide-model.js";
import { formatDate, safeUrl } from "./text.js";

const cell = (v) =>
  String(v ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\s*\n\s*/g, " ")
    .trim() || "—";
const line = (v) => String(v ?? "").replace(/\s*\n\s*/g, " ").trim();
const hostOf = (url) => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
};
const link = (url, label) => (safeUrl(url) ? `[${line(label || url).replace(/[[\]]/g, "")}](${url})` : line(label));

function table(head, rows) {
  if (!rows.length) return [];
  return [`| ${head.map(cell).join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`), ""];
}

function list(items, { check = false } = {}) {
  return items.filter(Boolean).map((t) => `- ${check ? "[ ] " : ""}${line(t)}`);
}

const section = (title, body) => (body.filter((l) => l !== "").length ? [`## ${title}`, "", ...body, ""] : []);

/** @param {object} g a finalized v3 guide @param {{ url?: string }} [opts] canonical link to the guide */
export function guideToMarkdown(g, { url = "" } = {}) {
  const stats = stepStats(g);
  const generated = g.kind === "generated";
  const out = [];
  out.push(`# ${line(g.name)}: OAuth setup guide`, "");
  if (generated)
    out.push(
      `> **Generated draft.** Produced by the ${line(g.generation?.engineLabel || "Live Generator")} on ${formatDate(g.lastChecked)}. Confidence: ${g.confidence}. Verify the items under "Verify before you rely on this" before you commit to a timeline.`,
      "",
    );
  out.push(`> ${line(g.verdict)}`, "");
  out.push(
    ...table(
      ["At a glance", "Value"],
      [
        ["Connection path", `${PATHS[g.path]?.label ?? ""}${g.approval?.unconfirmed ? " (unconfirmed)" : ""}`],
        ["Effort", `${g.effort.difficulty}${g.effort.researchRating !== "N/A" ? ` (research rating: ${g.effort.researchRating})` : ""}`],
        ["Time to first test", g.effort.timeToFirstTest || g.effort.firstShort],
        ["Time to production", g.effort.timeToProduction || g.effort.prodShort],
        ["Provider approval", `${approvalLabel(g.approval)}${approvalDetail(g.approval) ? `: ${approvalDetail(g.approval)}` : ""}${g.approval.atScale ? `. At scale: ${g.approval.atScale}` : ""}`],
        ["Scope complexity", `${g.scopes.complexity}${g.scopes.why ? `: ${g.scopes.why}` : ""}`],
        ["Steps", `${stats.total} (${stats.human} need a human, ${stats.agent} an agent can do)`],
        ["Cost", g.cost],
        ["Confidence", `${g.confidence}, last checked ${formatDate(g.lastChecked)}`],
      ],
    ),
  );

  const overview = [];
  if (g.needGuide) overview.push(line(g.needGuide), "");
  overview.push(`**Auth model:** ${line(g.auth.model)}${g.auth.detail ? `. ${line(g.auth.detail)}` : ""}`, "");
  if (g.approval.gate) overview.push(`**Production gate:** ${line(g.approval.gate)}`, "");
  if (g.tiers?.length) {
    overview.push("**Distribution options**", "");
    overview.push(...table(["Option", "Example", "Effort", "Time", "Note"], g.tiers.map((t) => [t.label, t.eg, t.difficulty, t.time, t.note])));
  }
  out.push(...section("Overview", overview));

  out.push(...section("Prerequisites", list(g.prerequisites, { check: true })));

  const setup = [];
  if (g.registerAt) setup.push(`**Where to register:** ${line(g.registerAt.path)}${safeUrl(g.registerAt.url) ? ` (${link(g.registerAt.url, hostOf(g.registerAt.url))})` : ""}`, "");
  let n = 0;
  for (const ph of g.phases) {
    const gate = ph.gate === "required" ? "approval gate" : ph.gate === "optional" ? "optional review" : "";
    const meta = [line(ph.duration), gate].filter(Boolean).join(", ");
    setup.push(`### ${line(ph.name)}${meta ? ` (${meta})` : ""}`, "");
    for (const st of ph.steps) {
      n += 1;
      setup.push(`${n}. [ ] ${line(st.do)} _(${st.who} · ${st.agent ? "agent can do" : "human required"})_`);
    }
    setup.push("");
  }
  out.push(...section("Console setup steps", setup));

  const scopes = [`**Complexity: ${g.scopes.complexity}.** ${line(g.scopes.why)}`, ""];
  if (g.scopes.table?.length) scopes.push(...table(["Use", "Scope", "Tier", "Note"], g.scopes.table.map((r) => [r.use, r.scope, r.tier, r.note])));
  if (g.scopes.summary) scopes.push(line(g.scopes.summary), "");
  out.push(...section("Scopes & permissions", scopes));

  const approval = [`**Provider approval: ${approvalLabel(g.approval)}**${approvalDetail(g.approval) ? ` (${line(approvalDetail(g.approval))})` : ""}.`, ""];
  if (g.approval.when) approval.push(line(g.approval.when), "");
  if (g.approval.timeline?.length)
    approval.push(...table(["Stage", "Official", "Reported"], g.approval.timeline.map((r) => [r.label, r.official, r.reported])));
  if (g.approval.recurring) approval.push(`**Recurring:** ${line(g.approval.recurring)}`, "");
  if (g.roles.customer) approval.push(`**Customer-side approval:** ${line(g.roles.customer)}`, "");
  if (g.customerExperience?.length) approval.push(...list(g.customerExperience), "");
  out.push(...section("Approval & verification", approval));

  const risks = [...g.blockers.map((b) => `- **${line(b.problem)}**${b.fix ? `: ${line(b.fix)}` : ""}`)];
  if (g.gotchas?.length) risks.push("", "**Gotchas**", "", ...list(g.gotchas));
  out.push(...section("Blockers & gotchas", risks));

  const steps = g.phases.flatMap((p) => p.steps);
  const actions = [];
  actions.push("### Needs a human", "");
  if (g.automation.humanMust) actions.push(line(g.automation.humanMust), "");
  actions.push(...list(steps.filter((s) => !s.agent).map((s) => `${s.do} (${s.who})`), { check: true }), "");
  actions.push("### Your agent can handle", "");
  if (g.automation.agentCan) actions.push(line(g.automation.agentCan), "");
  actions.push(...list(steps.filter((s) => s.agent).map((s) => `${s.do} (${s.who})`), { check: true }));
  out.push(...section("Developer action items", actions));

  out.push(...section("Testing", list(g.testing)));

  const roles = [];
  if (g.roles.team) roles.push(`**Your team:** ${line(g.roles.team)}`, "");
  if (g.roles.console) roles.push(`**Developer console:** ${line(g.roles.console)}`, "");
  if (g.roles.consoleRoles?.length) roles.push(...table(["Console role", "Can", "Give it to"], g.roles.consoleRoles.map((r) => [r.role, r.can, r.who])));
  out.push(...section("Team & roles", roles));

  if (generated && g.generation) {
    const gen = [];
    gen.push(`Engine: ${line(g.generation.engineLabel)}. Input: “${line(g.generation.input)}”. Generated ${line(g.generation.generatedAt)}.`, "");
    if (g.generation.evidence?.length) gen.push("**What the agent checked**", "", ...list(g.generation.evidence.map((e) => `${e.label}${e.detail ? `: ${e.detail}` : ""}${e.url && safeUrl(e.url) ? ` (${e.url})` : ""}`)), "");
    if (g.generation.verify?.length) gen.push("**Verify before you rely on this**", "", ...list(g.generation.verify.map((v) => (v.url ? link(v.url, v.label) : v.label)), { check: true }), "");
    if (g.generation.vendorEmail) gen.push("**Email to the vendor**", "", "```text", g.generation.vendorEmail, "```", "");
    out.push(...section("How this guide was generated", gen));
  }

  const evidence = [`Confidence: **${g.confidence}**. Last checked ${formatDate(g.lastChecked)}.`, ""];
  if (g.uncertain?.length) evidence.push("**Not confirmed**", "", ...list(g.uncertain), "");
  if (g.sources?.length) evidence.push("**Sources**", "", ...g.sources.map((s) => `- ${link(s.url, s.label)}`));
  out.push(...section("Evidence", evidence));

  out.push("---", "", `_OAuth Field Guide${url ? ` · ${url}` : ""}. Provider rules change often: re-check anything marked “not confirmed” before you commit to dates._`, "");
  return out.join("\n");
}
