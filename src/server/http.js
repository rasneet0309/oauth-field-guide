/**
 * HTTP plumbing with no framework: security headers, JSON helpers, a bounded JSON body
 * reader, client addresses and a hardened static file server for public/.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** The page's Content-Security-Policy. No inline code anywhere; Trusted Types guard the one HTML sink. */
export const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "require-trusted-types-for 'script'",
  "trusted-types ofg-html",
].join("; ");

export function securityHeaders(res, { hsts = false } = {}) {
  res.setHeader("Content-Security-Policy", CSP);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader(
    "Permissions-Policy",
    "accelerometer=(), browsing-topics=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
  );
  if (hsts) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
}

export function sendJson(res, status, body, headers = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(res.req?.method === "HEAD" ? undefined : text);
}

export function sendError(res, status, code, message, headers = {}) {
  sendJson(res, status, { error: { code, message } }, headers);
}

export function sendText(res, status, text, type = "text/plain; charset=utf-8", headers = {}) {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", ...headers });
  res.end(res.req?.method === "HEAD" ? undefined : text);
}

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Read a small JSON body. Rejects with HttpError on a wrong type, an oversize body or bad JSON. */
export function readJsonBody(req, { limit = 4096 } = {}) {
  return new Promise((resolve, reject) => {
    const type = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    if (type !== "application/json") return reject(new HttpError(415, "unsupported_media_type", "Send Content-Type: application/json."));
    const declared = Number(req.headers["content-length"] ?? 0);
    if (declared > limit) {
      const err = new HttpError(413, "payload_too_large", `Request body is limited to ${limit} bytes.`);
      err.closeConnection = true;
      return reject(err);
    }
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      if (size > limit) return;
      size += c.length;
      if (size > limit) {
        // Stop buffering and let the caller answer 413; it closes the connection afterwards.
        req.pause();
        const err = new HttpError(413, "payload_too_large", `Request body is limited to ${limit} bytes.`);
        err.closeConnection = true;
        reject(err);
      } else chunks.push(c);
    });
    req.on("end", () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "null");
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("not an object");
        resolve(body);
      } catch {
        reject(new HttpError(400, "invalid_json", "The body must be a JSON object."));
      }
    });
    req.on("error", reject);
  });
}

/**
 * The client address used for rate limiting. Behind `hops` trusted proxies the real client is
 * the X-Forwarded-For entry `hops` places from the right; anything further left was written
 * by the client and can't be trusted. IPv6 clients are bucketed by /64, since one subscriber
 * usually holds a whole /64.
 */
export function clientIp(req, hops = 0) {
  let ip = req.socket.remoteAddress ?? "unknown";
  if (hops > 0) {
    const chain = String(req.headers["x-forwarded-for"] ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    if (chain.length >= hops) ip = chain[chain.length - hops];
  }
  // Some proxies append the source port ("203.0.113.9:51234", "[2001:db8::1]:443"); a bucket
  // keyed on the port would reset with every new connection.
  ip = ip
    .trim()
    .replace(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/, "$1")
    .replace(/^\[([^\]]+)\](?::\d+)?$/, "$1")
    .replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, "");
  return ip.includes(":") ? ipv6Slash64(ip) : ip;
}

/**
 * "2001:db8::1" and "2001:db8:0:0:1::" are in the same /64 but abbreviate differently, so
 * expand to eight groups before taking the first four; otherwise one /64 gets several buckets.
 */
function ipv6Slash64(ip) {
  const addr = ip.replace(/^\[|\]$/g, "").split("%")[0].toLowerCase();
  const count = (part) => (part ? part.split(":").reduce((n, g) => n + (g.includes(".") ? 2 : 1), 0) : 0);
  const [head, tail] = addr.split("::");
  const groups = addr.includes("::") ? [...(head ? head.split(":") : []), ...Array(Math.max(0, 8 - count(head) - count(tail))).fill("0"), ...(tail ? tail.split(":") : [])] : addr.split(":");
  const prefix = groups.slice(0, 4).map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16).toString(16) : "?"));
  return `${prefix.join(":")}::/64`;
}

/**
 * Same-origin check for costly requests. Browsers send Sec-Fetch-Site, which no page can forge
 * and no proxy rewrites; it is decisive when present. Older clients fall back to comparing
 * Origin with the Host (or, behind a trusted proxy, X-Forwarded-Host). Clients that send
 * neither (curl, scripts) are allowed; the rate limiter still applies.
 */
export function isSameOrigin(req, { trustProxy = 0 } = {}) {
  const site = req.headers["sec-fetch-site"];
  if (site) return site === "same-origin" || site === "none";
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = (trustProxy && req.headers["x-forwarded-host"]) || req.headers.host;
  try {
    return new URL(origin).host === String(host).split(",")[0].trim();
  } catch {
    return false;
  }
}

/** DNS-rebinding guard: refuse Host headers outside the allow-list (when one is configured). */
export function isAllowedHost(req, allowed) {
  if (!allowed) return true;
  const host = String(req.headers.host ?? "")
    .toLowerCase()
    .replace(/:\d+$/, "");
  return allowed.includes(host);
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

/**
 * Serve a file from `root` if the URL path names one. Returns false when there is no such file
 * (the caller decides between the SPA shell and a 404). Refuses traversal, dotfiles, encoded
 * separators and anything that isn't a regular file.
 */
export function serveStatic(req, res, root, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  if (decoded.includes("\0") || decoded.includes("\\") || /(^|\/)\.[^/]/.test(decoded)) return false;
  const file = path.resolve(root, `.${path.posix.normalize(decoded)}`);
  if (file !== root && !file.startsWith(root + path.sep)) return false;
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;
  const type = TYPES[path.extname(file).toLowerCase()];
  if (!type) return false;

  const etag = `W/"${createHash("sha1").update(`${stat.size}-${stat.mtimeMs}`).digest("base64url").slice(0, 16)}"`;
  const headers = {
    "Content-Type": type,
    ETag: etag,
    // Fonts never change in place; everything else revalidates (no build step, so no hashed names).
    "Cache-Control": file.includes(`${path.sep}fonts${path.sep}`) ? "public, max-age=31536000, immutable" : "no-cache",
  };
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, headers);
    res.end();
    return true;
  }
  res.writeHead(200, { ...headers, "Content-Length": stat.size });
  if (req.method === "HEAD") {
    res.end();
    return true;
  }
  fs.createReadStream(file)
    .on("error", () => res.destroy())
    .pipe(res);
  return true;
}
