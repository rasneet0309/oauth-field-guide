#!/usr/bin/env node
/**
 * Build the guide library (data/guides/*.json, schema v3) from the research data.
 *
 *   data/research/profiles/*.json   97 researched profiles (the v2 research brief's shape)
 *   data/research/in-depth/*.json   6 in-depth guides from v2
 *   data/research/headlines.json    verdict lines and short times per profile
 *   data/research/overrides.json    hand-reviewed connection-path corrections
 *   data/curated/in-depth/*.json    profiles upgraded to in-depth guides for v3 (same facts, restructured)
 *   data/curated/scope-complexity.json, register-at.json
 *
 * Deterministic: the same inputs always write byte-identical files.
 *   node scripts/import-research.mjs           write data/guides and data/library-meta.json
 *   node scripts/import-research.mjs --check   fail if data/guides is out of date (CI)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyPath, fromDeep, fromProfile } from "../public/shared/convert.js";
import { validateGuide } from "../public/shared/validate.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");
const OUT = path.join(DATA, "guides");

/** The featured row on the dashboard, in this order. Every in-depth guide must be listed. */
export const FEATURED_ORDER = [
  "slack",
  "github",
  "salesforce",
  "notion",
  "stripe",
  "google-workspace",
  "microsoft-365",
  "meta",
  "hubspot",
  "shopify",
];

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const jsonFiles = (dir) =>
  fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();

export function buildLibrary() {
  const meta = readJson(path.join(DATA, "research", "meta.json"));
  const headlines = readJson(path.join(DATA, "research", "headlines.json"));
  const { paths: overrides } = readJson(path.join(DATA, "research", "overrides.json"));
  const scope = readJson(path.join(DATA, "curated", "scope-complexity.json"));
  const registerAt = readJson(path.join(DATA, "curated", "register-at.json"));
  const gates = readJson(path.join(DATA, "curated", "gates.json"));
  const atScale = readJson(path.join(DATA, "curated", "approval-notes.json"));
  const lastChecked = meta.lastChecked;
  const problems = [];

  const curatedDir = path.join(DATA, "curated", "in-depth");
  const curated = new Map(jsonFiles(curatedDir).map((f) => [f.replace(/\.json$/, ""), readJson(path.join(curatedDir, f))]));

  const guides = [];
  for (const file of meta.profileFiles) {
    for (const p of readJson(path.join(DATA, "research", "profiles", `${file}.json`))) {
      if (!scope[p.id]) problems.push(`${p.id}: missing from curated/scope-complexity.json`);
      if (curated.has(p.id)) {
        guides.push(fromDeep(curated.get(p.id), { scope: scope[p.id], gates: gates[p.id], lastChecked }));
        continue;
      }
      if (!headlines[p.id]) problems.push(`${p.id}: no entry in research/headlines.json`);
      guides.push(
        fromProfile(p, {
          headline: headlines[p.id],
          path: overrides[p.id]?.path ?? classifyPath(p),
          scope: scope[p.id],
          atScale: atScale[p.id],
          lastChecked,
        }),
      );
    }
  }
  for (const f of jsonFiles(path.join(DATA, "research", "in-depth"))) {
    const d = readJson(path.join(DATA, "research", "in-depth", f));
    if (!scope[d.id]) problems.push(`${d.id}: missing from curated/scope-complexity.json`);
    guides.push(fromDeep(d, { scope: scope[d.id], registerAt: registerAt[d.id], gates: gates[d.id], lastChecked }));
  }

  // Curated keys must point at real guides and phases, so a renamed phase can't silently lose its gate.
  for (const [id, phases] of Object.entries(gates)) {
    if (id === "$comment") continue;
    const g = guides.find((x) => x.id === id);
    if (!g) problems.push(`gates.json: unknown app id "${id}"`);
    else for (const name of Object.keys(phases)) if (!g.phases.some((ph) => ph.name === name)) problems.push(`gates.json: ${id} has no phase "${name}"`);
  }
  for (const id of Object.keys(atScale)) if (id !== "$comment" && !guides.some((x) => x.id === id)) problems.push(`approval-notes.json: unknown app id "${id}"`);

  for (const id of curated.keys()) if (!guides.some((g) => g.id === id)) problems.push(`curated/in-depth/${id}.json matches no profile`);
  const ids = new Set();
  for (const g of guides) {
    if (ids.has(g.id)) problems.push(`${g.id}: duplicate id`);
    ids.add(g.id);
    if (g.kind === "in-depth" && !FEATURED_ORDER.includes(g.id)) problems.push(`${g.id}: in-depth guide missing from FEATURED_ORDER`);
    problems.push(...validateGuide(g));
  }
  for (const id of FEATURED_ORDER) if (!ids.has(id)) problems.push(`FEATURED_ORDER lists unknown id "${id}"`);
  for (const id of Object.keys(scope)) if (id !== "$comment" && !ids.has(id)) problems.push(`scope-complexity.json: unknown id "${id}"`);
  if (problems.length) {
    throw new Error(`Research data is invalid (${problems.length} problems):\n  - ${problems.join("\n  - ")}`);
  }

  guides.sort((a, b) => a.name.localeCompare(b.name, "en"));
  const libraryMeta = {
    schema: 3,
    lastChecked,
    source: "data/research (OAuth Field Guide v2.1.0 research, checked 2026-10-28) + data/curated",
    counts: {
      total: guides.length,
      inDepth: guides.filter((g) => g.kind === "in-depth").length,
      researched: guides.filter((g) => g.kind === "researched").length,
    },
    featured: FEATURED_ORDER,
    categories: [...new Set(guides.map((g) => g.category))].sort(),
  };
  return { guides, libraryMeta };
}

const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;

function main() {
  const check = process.argv.includes("--check");
  const { guides, libraryMeta } = buildLibrary();
  const expected = new Map(guides.map((g) => [`${g.id}.json`, serialize(g)]));
  expected.set("../library-meta.json", serialize(libraryMeta));

  if (check) {
    const stale = [];
    for (const [name, text] of expected) {
      const file = path.join(OUT, name);
      if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== text) stale.push(path.relative(ROOT, file));
    }
    const extra = fs.existsSync(OUT) ? jsonFiles(OUT).filter((f) => !expected.has(f)) : [];
    if (stale.length || extra.length) {
      console.error(
        `data/guides is out of date. Run: npm run data:import\n${[...stale.map((f) => `  changed: ${f}`), ...extra.map((f) => `  extra:   data/guides/${f}`)].join("\n")}`,
      );
      process.exit(1);
    }
    console.log(`data/guides is up to date (${guides.length} guides).`);
    return;
  }

  fs.mkdirSync(OUT, { recursive: true });
  for (const f of jsonFiles(OUT)) if (!expected.has(f)) fs.rmSync(path.join(OUT, f));
  for (const [name, text] of expected) fs.writeFileSync(path.join(OUT, name), text);
  const { counts } = libraryMeta;
  console.log(`Wrote ${counts.total} guides (${counts.inDepth} in-depth, ${counts.researched} researched) to data/guides.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
