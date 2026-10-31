/**
 * Runtime configuration from environment variables (and an optional .env file, loaded by
 * src/app.js). Every value is validated here once; the rest of the server reads `config`.
 * The Anthropic API key is the only secret, and it never leaves the server.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const bool = (v, fallback) => {
  if (v == null || v === "") return fallback;
  if (/^(1|true|on|yes)$/i.test(v)) return true;
  if (/^(0|false|off|no)$/i.test(v)) return false;
  throw new Error(`Expected a boolean, got "${v}"`);
};
const int = (v, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  if (v == null || v === "") return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`Expected an integer in [${min}, ${max}], got "${v}"`);
  return n;
};
const num = (v, fallback, { min = 0, max = 10 } = {}) => {
  if (v == null || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`Expected a number in [${min}, ${max}], got "${v}"`);
  return n;
};

function hostList(value, bindHost) {
  if (value && value.trim()) return value.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  return /^(127\.\d+\.\d+\.\d+|localhost|::1)$/.test(bindHost) ? ["localhost", "127.0.0.1", "[::1]"] : null;
}

/** @param {Record<string, string | undefined>} env */
export function loadConfig(env = process.env) {
  const problems = [];
  const read = (name, fn) => {
    try {
      return fn(env[name]);
    } catch (err) {
      problems.push(`${name}: ${err.message}`);
      return undefined;
    }
  };
  const apiKey = (env.ANTHROPIC_API_KEY ?? "").trim();
  const baseUrl = (env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com").replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s/]+/.test(baseUrl)) problems.push("ANTHROPIC_BASE_URL: must be an http(s) URL");
  const model = (env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5").trim();
  if (!/^[a-z0-9][a-z0-9.\-_:@]{2,80}$/i.test(model)) problems.push("ANTHROPIC_MODEL: unexpected characters");

  const config = {
    env: env.NODE_ENV === "production" ? "production" : "development",
    host: env.HOST || "127.0.0.1",
    port: read("PORT", (v) => int(v, 3000, { min: 0, max: 65535 })),
    // Number of reverse proxies in front of the server (true = 1). The client address is the
    // X-Forwarded-For entry that many hops from the right, never the client-controlled left end.
    trustProxy: read("TRUST_PROXY", (v) => (/^\d+$/.test(v ?? "") ? int(v, 0, { min: 0, max: 10 }) : bool(v, false) ? 1 : 0)),
    // Host headers the server answers to (DNS-rebinding protection). Default: loopback names when
    // bound to loopback, otherwise any host (set ALLOWED_HOSTS in production).
    allowedHosts: hostList(env.ALLOWED_HOSTS, env.HOST || "127.0.0.1"),
    dataDir: path.resolve(ROOT, env.DATA_DIR || ".data"),
    hsts: read("HSTS", (v) => bool(v, false)),
    // The address people use (e.g. https://guides.example.com) for links in Markdown exports.
    // Default: built from the request, which behind a TLS-terminating proxy says http://.
    publicUrl: read("PUBLIC_URL", (v) => {
      if (!v) return "";
      const u = new URL(v);
      if (!/^https?:$/.test(u.protocol)) throw new Error("must be an http(s) URL");
      return u.origin;
    }),
    live: {
      enabled: apiKey.length > 0 && read("LIVE_MODE", (v) => bool(v, true)) !== false,
      apiKey,
      baseUrl,
      model,
      maxSearches: read("LIVE_MAX_SEARCHES", (v) => int(v, 5, { min: 0, max: 20 })),
      timeoutMs: read("LIVE_TIMEOUT_MS", (v) => int(v, 150_000, { min: 10_000, max: 600_000 })),
      maxTokens: read("LIVE_MAX_TOKENS", (v) => int(v, 8_000, { min: 1_000, max: 64_000 })),
    },
    probe: {
      enabled: read("DISCOVERY_PROBE", (v) => bool(v, true)),
      timeoutMs: read("DISCOVERY_TIMEOUT_MS", (v) => int(v, 3_000, { min: 500, max: 15_000 })),
      budgetMs: read("DISCOVERY_BUDGET_MS", (v) => int(v, 7_000, { min: 1_000, max: 30_000 })),
    },
    agentPace: read("AGENT_PACE", (v) => num(v, 1, { min: 0, max: 5 })),
    rateLimit: {
      max: read("GENERATE_RATE_LIMIT", (v) => int(v, 10, { min: 1, max: 10_000 })),
      windowMs: read("GENERATE_RATE_WINDOW_MS", (v) => int(v, 10 * 60_000, { min: 1_000, max: 24 * 3_600_000 })),
      maxConcurrent: read("GENERATE_MAX_CONCURRENT", (v) => int(v, 4, { min: 1, max: 100 })),
    },
    cacheTtlMs: read("GENERATE_CACHE_TTL_MS", (v) => int(v, 24 * 3_600_000, { min: 0, max: 30 * 24 * 3_600_000 })),
    storeMax: read("SHARE_STORE_MAX", (v) => int(v, 2_000, { min: 10, max: 1_000_000 })),
  };
  if (problems.length) throw new Error(`Invalid configuration:\n  - ${problems.join("\n  - ")}`);
  return config;
}

/** What the browser may know about the configuration. Never includes the API key. */
export function publicConfig(config) {
  return {
    mode: config.live.enabled ? "live" : "offline",
    live: config.live.enabled ? { model: config.live.model, webSearch: config.live.maxSearches > 0, maxSearches: config.live.maxSearches } : null,
    discoveryProbe: config.probe.enabled,
    limits: { maxInputLength: 120, generatePerWindow: config.rateLimit.max, windowMinutes: Math.round(config.rateLimit.windowMs / 60_000) },
  };
}
