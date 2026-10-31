import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { validateGuide } from "../../public/shared/validate.js";
import { FEATURED_ORDER, buildLibrary } from "../../scripts/import-research.mjs";
import { loadGuides } from "../helpers.js";

const guides = loadGuides();
const byId = new Map(guides.map((g) => [g.id, g]));

test("the library has 103 valid guides: 10 in-depth and 93 researched", () => {
  assert.equal(guides.length, 103);
  assert.equal(guides.filter((g) => g.kind === "in-depth").length, 10);
  for (const g of guides) assert.deepEqual(validateGuide(g), [], g.id);
});

test("data/guides is in sync with the research import (npm run data:import)", () => {
  const { guides: built, libraryMeta } = buildLibrary();
  const root = path.join(import.meta.dirname, "..", "..", "data");
  for (const g of built) {
    assert.equal(fs.readFileSync(path.join(root, "guides", `${g.id}.json`), "utf8"), `${JSON.stringify(g, null, 2)}\n`, `${g.id} is stale`);
  }
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, "library-meta.json"), "utf8")), libraryMeta);
});

test("the featured guides are the brief's examples plus diverse approval paths", () => {
  for (const id of ["slack", "github", "salesforce", "notion", "stripe"]) assert.ok(FEATURED_ORDER.includes(id), id);
  const paths = new Set(FEATURED_ORDER.map((id) => byId.get(id).path));
  assert.ok(paths.has("self") && paths.has("review"), "featured set covers self-serve and reviewed apps");
  for (const id of FEATURED_ORDER) assert.equal(byId.get(id).kind, "in-depth", id);
});

test("hand-reviewed facts survive the import", () => {
  assert.equal(byId.get("shopify").path, "review", "override from research/overrides.json");
  assert.equal(byId.get("snowflake").path, "key", "override from research/overrides.json");
  assert.equal(byId.get("google-workspace").scopes.complexity, "High");
  assert.equal(byId.get("notion").scopes.complexity, "Low");
  assert.equal(byId.get("slack").approval.required, true);
  assert.equal(byId.get("github").approval.required, false);
  assert.equal(byId.get("stripe").effort.prodShort, "1–3 weeks incl. review");
});

test("every step says who does it and whether an agent can", () => {
  for (const g of guides) {
    for (const st of g.phases.flatMap((p) => p.steps)) {
      assert.equal(typeof st.agent, "boolean", g.id);
      assert.ok(st.who, g.id);
    }
  }
});

test("researched guides cite at least one https source", () => {
  for (const g of guides) {
    assert.ok(g.sources.length > 0, g.id);
    assert.ok(g.sources.every((s) => /^https?:\/\//.test(s.url)), g.id);
  }
});

test("approval gates come from data and agree with the provider-approval fact", () => {
  const gates = (id) => Object.fromEntries(byId.get(id).phases.filter((p) => p.gate).map((p) => [p.name, p.gate]));
  assert.deepEqual(gates("salesforce"), { "Optional: AgentExchange listing": "optional" });
  assert.deepEqual(gates("slack"), { "Marketplace review": "required" });
  assert.deepEqual(gates("github"), {});
  for (const g of guides) {
    if (g.phases.some((p) => p.gate === "required")) assert.equal(g.approval.required, true, `${g.id} has a required gate but no provider approval`);
  }
});

test("no-connector apps aren't rated or sorted as fast; unknown timelines sort last", () => {
  for (const g of guides.filter((x) => x.path === "none")) {
    assert.equal(g.effort.difficulty, "N/A", g.id);
    assert.equal(g.effort.prodDays, 999, g.id);
  }
  for (const id of ["ecwid", "apify", "binance"]) assert.equal(byId.get(id).effort.prodDays, 999, id);
  assert.match(byId.get("discord").approval.atScale, /100 servers/);
});
