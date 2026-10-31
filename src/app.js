#!/usr/bin/env node
/**
 * OAuth Field Guide v3: server entry point.
 *
 * One dependency-free Node process that
 *   - serves the dashboard from public/ (ES modules, no build step) under a strict CSP,
 *   - exposes the guide library, the public configuration and Markdown exports as JSON/text,
 *   - runs the Live Generator (POST /api/generate, streamed as Server-Sent Events),
 *   - stores generated guides for share links (/g/<id>).
 *
 *   npm start              http://127.0.0.1:3000
 *   PORT=8080 npm start
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sharePath } from "../public/shared/guide-model.js";
import { guideToMarkdown } from "../public/shared/markdown.js";
import { suggestApps } from "../public/shared/search.js";
import { ROOT, loadConfig, publicConfig } from "./server/config.js";
import { createGenerator } from "./server/generate.js";
import { isAllowedHost, securityHeaders, sendError, sendJson, sendText, serveStatic } from "./server/http.js";
import { loadLibrary } from "./server/library.js";
import { SHARE_ID_RE, createStore } from "./server/store.js";

const PUBLIC = path.join(ROOT, "public");
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;

/** One JSON line per event on stdout/stderr; no request bodies, no secrets. */
export function createLogger({ silent = false } = {}) {
  return (level, event, fields = {}) => {
    if (silent) return;
    const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...fields });
    (level === "error" || level === "warn" ? process.stderr : process.stdout).write(`${line}\n`);
  };
}

/** SPA routes: the shell is served for these, with 404 status when the thing named doesn't exist. */
const SPA = [/^\/$/, /^\/guides\/?$/, /^\/guides\/[^/]+$/, /^\/generate$/, /^\/g\/[^/]+$/, /^\/method$/];

/**
 * Build the server without listening, so tests can start it on a random port.
 * @param {{ config?: object, log?: Function, fetchImpl?: Function, probe?: Function }} [opts]
 */
export function createApp({ config = loadConfig(), log = createLogger(), fetchImpl, probe } = {}) {
  const library = loadLibrary();
  const store = createStore({ dir: config.dataDir, max: config.storeMax, cacheTtlMs: config.cacheTtlMs, log });
  const generator = createGenerator({ config, library, store, log, fetchImpl, probe });
  const shell = fs.readFileSync(path.join(PUBLIC, "index.html"));
  const started = Date.now();

  const sendShell = (res, status = 200) => {
    res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
    res.end(res.req.method === "HEAD" ? undefined : shell);
  };

  const routes = [
    ["GET", /^\/api\/health$/, (req, res) => sendJson(res, 200, { status: "ok", version: VERSION, uptimeSec: Math.round((Date.now() - started) / 1000) })],
    [
      "GET",
      /^\/api\/config$/,
      (req, res) =>
        sendJson(res, 200, {
          name: "OAuth Field Guide",
          version: VERSION,
          ...publicConfig(config),
          engine: generator.engine(),
          shareStore: store.persistent() ? "disk" : "memory",
          library: { ...library.meta, total: library.guides.length },
        }),
    ],
    [
      "GET",
      /^\/api\/guides$/,
      (req, res, m, url) => {
        const p = Object.fromEntries(url.searchParams);
        const items = library.query(p);
        sendJson(res, 200, { total: items.length, items }, { "Cache-Control": "public, max-age=60" });
      },
    ],
    [
      "GET",
      /^\/api\/guides\/([^/]+?)(\.md)?$/,
      (req, res, m, url) => {
        const guide = library.get(m[1]);
        if (!guide) {
          const suggestions = suggestApps(library.lib, m[1], 3).map((s) => ({ id: s.id, name: s.name }));
          return sendJson(res, 404, { error: { code: "not_found", message: `No guide called "${m[1]}".` }, suggestions });
        }
        if (m[2]) return sendText(res, 200, guideToMarkdown(guide, { url: `${config.publicUrl || url.origin}/guides/${guide.id}` }), "text/markdown; charset=utf-8");
        sendJson(res, 200, guide, { "Cache-Control": "public, max-age=60" });
      },
    ],
    [
      "GET",
      /^\/api\/generated\/([^/]+?)(\.md)?$/,
      async (req, res, m, url) => {
        const guide = SHARE_ID_RE.test(m[1]) ? await store.get(m[1]) : null;
        if (!guide) return sendError(res, 404, "not_found", "This shared guide doesn't exist or has expired.");
        if (m[2]) return sendText(res, 200, guideToMarkdown(guide, { url: `${config.publicUrl || url.origin}${sharePath(m[1], guide)}` }), "text/markdown; charset=utf-8");
        sendJson(res, 200, { id: m[1], guide });
      },
    ],
    ["POST", /^\/api\/generate$/, (req, res) => generator.handle(req, res)],
  ];

  const server = http.createServer(async (req, res) => {
    const t0 = Date.now();
    securityHeaders(res, { hsts: config.hsts });
    res.on("finish", () => {
      if (!req.url.startsWith("/api/generate")) log("info", "request", { method: req.method, path: req.url.split("?")[0].slice(0, 200), status: res.statusCode, ms: Date.now() - t0 });
    });
    try {
      // Container and orchestrator probes address the server by IP, so the health check answers
      // any Host; it returns nothing a rebinding attack could use.
      const isHealthCheck = /^\/api\/health(\?|$)/.test(req.url);
      if (!isHealthCheck && !isAllowedHost(req, config.allowedHosts)) return sendError(res, 421, "misdirected_request", "Unknown host.");
      let url;
      try {
        url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      } catch {
        return sendError(res, 400, "bad_request", "Malformed URL.");
      }
      const method = req.method === "HEAD" ? "GET" : req.method;
      const pathname = url.pathname;

      if (pathname.startsWith("/api/")) {
        const matching = routes.filter(([, re]) => re.test(pathname));
        const route = matching.find(([m]) => m === method);
        if (!route) {
          if (matching.length) return sendError(res, 405, "method_not_allowed", "Method not allowed.", { Allow: matching.map(([m]) => m).join(", ") });
          return sendError(res, 404, "not_found", "No such API endpoint.");
        }
        return await route[2](req, res, pathname.match(route[1]), url);
      }

      if (method !== "GET") return sendError(res, 405, "method_not_allowed", "Method not allowed.", { Allow: "GET, HEAD" });
      if (serveStatic(req, res, PUBLIC, pathname)) return;

      // The single-page app's routes; unknown guides and expired share links still get the
      // shell (it renders a helpful not-found view) but with a 404 status.
      if (SPA.some((re) => re.test(pathname))) {
        const guideId = /^\/guides\/([^/]+)$/.exec(pathname)?.[1];
        const shareId = /^\/g\/([^/]+)$/.exec(pathname)?.[1];
        let found = true;
        if (guideId) found = library.has(decodeURIComponentSafe(guideId));
        if (shareId) found = Boolean(await store.get(shareId));
        return sendShell(res, found ? 200 : 404);
      }
      return sendShell(res, 404);
    } catch (err) {
      log("error", "unhandled", { message: err.message, stack: err.stack });
      if (!res.headersSent) sendError(res, 500, "internal", "Something went wrong.");
      else res.destroy();
    }
  });
  // Receiving a request (headers and body) must finish quickly; this doesn't limit how long a
  // response streams, so long SSE runs are unaffected.
  server.headersTimeout = 15_000;
  server.requestTimeout = 20_000;
  return { server, library, store, config };
}

function decodeURIComponentSafe(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/* ---------------------------------------------------------------------------------------- */

function loadDotEnv() {
  const file = path.join(ROOT, ".env");
  if (fs.existsSync(file) && typeof process.loadEnvFile === "function") process.loadEnvFile(file);
}

async function main() {
  loadDotEnv();
  const log = createLogger();
  let app;
  try {
    app = createApp({ log });
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
  const { server, config, library, store } = app;
  server.on("error", (err) => {
    // Most often EADDRINUSE or EACCES on the port: say so plainly and stop.
    log("error", "listen_failed", { code: err.code, message: err.message, port: config.port, host: config.host });
    process.exit(1);
  });
  server.listen(config.port, config.host, () => {
    const { port } = server.address();
    log("info", "listening", {
      url: `http://${config.host === "0.0.0.0" ? "localhost" : config.host}:${port}`,
      version: VERSION,
      mode: config.live.enabled ? `live (${config.live.model})` : "offline",
      guides: library.guides.length,
      shareStore: store.persistent() ? "disk" : "memory",
    });
  });
  const shutdown = (signal, code = 0) => {
    log(code ? "error" : "info", "shutdown", { signal });
    server.close(() => process.exit(code));
    server.closeAllConnections?.();
    setTimeout(() => process.exit(code), 3000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  // A bug that escapes every handler leaves the process in an unknown state: log it as one JSON
  // line (stack included) and exit non-zero so the orchestrator restarts a clean instance.
  process.on("uncaughtException", (err) => {
    log("error", "uncaught_exception", { message: err?.message, stack: err?.stack });
    shutdown("uncaughtException", 1);
  });
  process.on("unhandledRejection", (reason) => {
    log("error", "unhandled_rejection", { message: reason?.message ?? String(reason), stack: reason?.stack });
    shutdown("unhandledRejection", 1);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
