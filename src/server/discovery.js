/**
 * OAuth discovery probe: the one piece of live, standards-based evidence the offline engine
 * can gather about an app nobody has researched. It looks for
 *   - OpenID Connect Discovery 1.0      /.well-known/openid-configuration
 *   - RFC 8414 authorization server     /.well-known/oauth-authorization-server
 *   - RFC 9728 protected resource       /.well-known/oauth-protected-resource (MCP servers)
 * on the vendor's domain and its usual auth, API and MCP subdomains.
 *
 * Safety: https only, port 443, public addresses only (net-guard.js), at most 9 requests (8
 * candidates plus one hop to an MCP authorization server), each following at most two
 * re-checked redirects, 3 s each, 7 s overall, 256 KB per response; every value read from a
 * response is shape-checked before anyone sees it.
 */
import https from "node:https";
import { isPlausibleHost } from "../../public/shared/engine/identify.js";
import { guardedLookup } from "./net-guard.js";

const MAX_BYTES = 256 * 1024;
const MAX_URLS = 8;
const CONCURRENCY = 4;
const USER_AGENT = "OAuthFieldGuide/3.0 (OAuth discovery probe)";

class ProbeError extends Error {
  constructor(outcome, message, status) {
    super(message);
    this.outcome = outcome;
    this.status = status;
  }
}

/** GET a URL as JSON through the SSRF guard. Resolves { status, json } or rejects with ProbeError. */
export function guardedFetchJson(url, { timeoutMs = 3000, signal, redirects = 2, lookup = guardedLookup } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(url);
    } catch {
      return reject(new ProbeError("invalid", "bad URL"));
    }
    if (u.protocol !== "https:" || (u.port && u.port !== "443") || u.username || u.password || !isPlausibleHost(u.hostname)) {
      return reject(new ProbeError("blocked", "only public https hosts are probed"));
    }
    const req = https.request(
      u,
      { method: "GET", lookup, timeout: timeoutMs, signal, headers: { accept: "application/json", "user-agent": USER_AGENT } },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          if (redirects <= 0) return reject(new ProbeError("missing", "too many redirects", status));
          let next;
          try {
            next = new URL(res.headers.location, u).toString();
          } catch {
            return reject(new ProbeError("invalid", "bad redirect", status));
          }
          return guardedFetchJson(next, { timeoutMs, signal, redirects: redirects - 1, lookup }).then(resolve, reject);
        }
        if (status !== 200) {
          res.resume();
          return reject(new ProbeError("missing", `HTTP ${status}`, status));
        }
        let size = 0;
        const chunks = [];
        res.on("data", (c) => {
          size += c.length;
          if (size > MAX_BYTES) {
            req.destroy();
            reject(new ProbeError("invalid", "response too large", status));
          } else chunks.push(c);
        });
        res.on("end", () => {
          try {
            const json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            resolve({ status, json });
          } catch {
            reject(new ProbeError("invalid", "not JSON", status));
          }
        });
        res.on("error", (err) => reject(new ProbeError("error", err.message, status)));
      },
    );
    req.on("timeout", () => req.destroy(new ProbeError("timeout", "timed out")));
    req.on("error", (err) =>
      reject(err instanceof ProbeError ? err : new ProbeError(err.code === "EBLOCKED" ? "blocked" : signal?.aborted ? "timeout" : "error", err.message)),
    );
    req.end();
  });
}

const httpsUrl = (v) => {
  if (typeof v !== "string" || v.length >= 400 || !/^https:\/\/[^\s"'<>`\\]+$/i.test(v)) return "";
  try {
    return new URL(v).protocol === "https:" ? v : "";
  } catch {
    return "";
  }
};
const tokens = (v, max = 60) =>
  Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.length > 0 && x.length < 120 && /^[\x21-\x7e]+$/.test(x)).slice(0, max) : [];

/** Shape-check authorization server metadata (OIDC Discovery or RFC 8414). Null if it isn't one. */
export function readServerMetadata(json, url, kind) {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const issuer = httpsUrl(json.issuer);
  const authorizationEndpoint = httpsUrl(json.authorization_endpoint);
  const tokenEndpoint = httpsUrl(json.token_endpoint);
  if (!issuer || (!authorizationEndpoint && !tokenEndpoint)) return null;
  return {
    url,
    kind,
    issuer,
    authorizationEndpoint,
    tokenEndpoint,
    registrationEndpoint: httpsUrl(json.registration_endpoint),
    scopes: tokens(json.scopes_supported),
    pkceMethods: tokens(json.code_challenge_methods_supported, 8),
    grantTypes: tokens(json.grant_types_supported, 12),
    responseTypes: tokens(json.response_types_supported, 12),
    tokenAuthMethods: tokens(json.token_endpoint_auth_methods_supported, 12),
  };
}

/** Shape-check RFC 9728 protected resource metadata. */
export function readResourceMetadata(json, url) {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const servers = (Array.isArray(json.authorization_servers) ? json.authorization_servers : []).map(httpsUrl).filter(Boolean).slice(0, 3);
  if (!servers.length) return null;
  return { url, resource: httpsUrl(json.resource), authorizationServers: servers, scopes: tokens(json.scopes_supported) };
}

/** RFC 8414 §3.1: insert the well-known segment between the host and the issuer's path. */
export function wellKnownFor(issuer, suffix) {
  const u = new URL(issuer);
  const p = u.pathname.replace(/\/+$/, "");
  return `${u.origin}/.well-known/${suffix}${p}`;
}

/** The URLs to try for a vendor domain, most informative first. */
export function candidateUrls(root, host) {
  const list = [
    `https://${root}/.well-known/openid-configuration`,
    `https://${root}/.well-known/oauth-authorization-server`,
    `https://mcp.${root}/.well-known/oauth-protected-resource`,
    `https://mcp.${root}/.well-known/oauth-authorization-server`,
  ];
  if (host && host !== root && isPlausibleHost(host)) list.push(`https://${host}/.well-known/openid-configuration`);
  list.push(`https://accounts.${root}/.well-known/openid-configuration`, `https://login.${root}/.well-known/openid-configuration`, `https://auth.${root}/.well-known/openid-configuration`);
  return [...new Set(list)].slice(0, MAX_URLS);
}

/**
 * @param {{ root: string, host?: string, signal?: AbortSignal, timeoutMs?: number, budgetMs?: number, fetchJson?: Function }} opts
 */
export async function probeDiscovery({ root, host = "", signal, timeoutMs = 3000, budgetMs = 7000, fetchJson = guardedFetchJson }) {
  const started = Date.now();
  if (!isPlausibleHost(root)) return { checked: [], provider: null, mcp: null, durationMs: 0 };
  const budget = new AbortController();
  const timer = setTimeout(() => budget.abort(new Error("probe budget exhausted")), budgetMs);
  const onAbort = () => budget.abort(signal.reason);
  signal?.addEventListener?.("abort", onAbort, { once: true });

  const checked = [];
  let provider = null;
  let mcp = null;
  let resource = null;
  const isMcpHost = (url) => new URL(url).hostname.startsWith("mcp.");

  const visit = async (url) => {
    if (budget.signal.aborted) return checked.push({ url, outcome: "skipped" });
    try {
      const { status, json } = await fetchJson(url, { timeoutMs, signal: budget.signal });
      if (url.endsWith("oauth-protected-resource")) {
        const prm = readResourceMetadata(json, url);
        checked.push({ url, outcome: prm ? "found" : "invalid", status });
        if (prm && !resource) resource = prm;
        return;
      }
      const meta = readServerMetadata(json, url, url.includes("openid-configuration") ? "openid-configuration" : "oauth-authorization-server");
      checked.push({ url, outcome: meta ? "found" : "invalid", status });
      if (!meta) return;
      if (isMcpHost(url)) mcp ??= meta;
      else provider ??= meta;
    } catch (err) {
      checked.push({ url, outcome: err.outcome ?? "error", ...(err.status ? { status: err.status } : {}) });
    }
  };

  try {
    const urls = candidateUrls(root, host);
    for (let i = 0; i < urls.length; i += CONCURRENCY) {
      await Promise.all(urls.slice(i, i + CONCURRENCY).map(visit));
      if (budget.signal.aborted) break;
    }
    // An MCP server's protected-resource metadata names its authorization server: follow one hop.
    if (resource && !mcp && !budget.signal.aborted) {
      let asUrl = "";
      try {
        asUrl = wellKnownFor(resource.authorizationServers[0], "oauth-authorization-server");
      } catch {
        checked.push({ url: resource.authorizationServers[0], outcome: "invalid" });
      }
      if (asUrl && isPlausibleHost(new URL(asUrl).hostname)) {
        try {
          const { status, json } = await fetchJson(asUrl, { timeoutMs, signal: budget.signal });
          const meta = readServerMetadata(json, asUrl, "oauth-authorization-server");
          checked.push({ url: asUrl, outcome: meta ? "found" : "invalid", status });
          if (meta) mcp = meta;
        } catch (err) {
          checked.push({ url: asUrl, outcome: err.outcome ?? "error", ...(err.status ? { status: err.status } : {}) });
        }
      }
    }
    if (mcp && resource) mcp = { ...mcp, resource: resource.resource, scopes: mcp.scopes.length ? mcp.scopes : resource.scopes };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.("abort", onAbort);
  }
  if (signal?.aborted) throw signal.reason ?? new Error("aborted");
  return { checked, provider, mcp, durationMs: Date.now() - started };
}
