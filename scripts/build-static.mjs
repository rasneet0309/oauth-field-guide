#!/usr/bin/env node
/**
 * Build the single-file demo: the whole app, the 103-guide library and the offline engine in
 * one HTML file that runs with no server (open it from disk, attach it to an email, publish
 * it as a page). The live agent, discovery probe and stored share links need the server.
 *
 *   dist/oauth-field-guide-demo.html   standalone document
 *   dist/artifact/index.html           the same page as a fragment (no <html>/<head>/<body>),
 *                                      for hosts that wrap pages in their own skeleton
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const DIST = path.join(ROOT, "dist");
const read = (...p) => fs.readFileSync(path.join(...p), "utf8");

const pkg = JSON.parse(read(ROOT, "package.json"));
const meta = JSON.parse(read(ROOT, "data", "library-meta.json"));
const guides = fs
  .readdirSync(path.join(ROOT, "data", "guides"))
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => JSON.parse(read(ROOT, "data", "guides", f)));

/** JSON that can sit inside <script type="application/json"> without ending it early. */
const embedJson = (value) =>
  JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

// 1. JavaScript: one IIFE; the dynamic import of api-local.js is bundled in.
const bundle = await esbuild.build({
  entryPoints: [path.join(PUBLIC, "app", "main.js")],
  bundle: true,
  format: "iife",
  target: ["es2022", "chrome111", "firefox115", "safari16.4"],
  minify: true,
  legalComments: "none",
  write: false,
});
const js = bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const boot = read(PUBLIC, "app", "theme-boot.js");

// 2. CSS: every stylesheet in index.html order, fonts inlined as data URIs.
const html = read(PUBLIC, "index.html");
const sheets = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
let css = sheets.map((href) => read(PUBLIC, href.replace(/^\//, ""))).join("\n");
css = css.replace(/url\("\/fonts\/([^"]+)"\)/g, (_, file) => {
  const data = fs.readFileSync(path.join(PUBLIC, "fonts", file)).toString("base64");
  return `url("data:font/woff2;base64,${data}")`;
});

// 3. The page body from index.html, with server-only links made relative to the hash router.
const body = html
  .slice(html.indexOf("<body>") + "<body>".length, html.indexOf("</body>"))
  .trim();
const data = embedJson({ version: pkg.version, meta: { lastChecked: meta.lastChecked, featured: meta.featured }, guides });

const description = `<meta name="description" content="Setup effort, approval waits, prerequisites, blockers and human-versus-agent steps for connecting 103 apps to your AI agent over OAuth." />
<meta name="color-scheme" content="light dark" />`;
const assets = `<style>${css}</style>
<script>${boot}</script>`;
const tail = `<script type="application/json" id="ofg-data">${data}</script>
<script>${js}</script>`;

fs.mkdirSync(path.join(DIST, "artifact"), { recursive: true });
const standalone = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>OAuth Field Guide</title>
${description}
${assets}
</head>
<body>
${body}
${tail}
</body>
</html>
`;
// The host supplies charset and an edge-to-edge viewport; the page keeps a safe-area gutter
// (layout.css) and hides actions a framed page can't perform (app/services/host.js).
const fragment = `<title>OAuth Field Guide</title>
<meta name="claude:viewport-fit-sides" content="cover" />
<meta name="ofg-host" content="embedded" />
${description}
${assets}
${body}
${tail}
`;
fs.writeFileSync(path.join(DIST, "oauth-field-guide-demo.html"), standalone);
fs.writeFileSync(path.join(DIST, "artifact", "index.html"), fragment);

const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(0)} KB`;
console.log(`dist/oauth-field-guide-demo.html  ${kb(standalone)}  (${guides.length} guides, JS ${kb(js)}, CSS ${kb(css)})`);
console.log("dist/artifact/index.html          fragment for page hosts");
