import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { loadConfig } from "../../src/server/config.js";
import { clientIp, isAllowedHost, isSameOrigin } from "../../src/server/http.js";
import { generate, startServer } from "../helpers.js";

let srv;
before(async () => {
  srv = await startServer({ env: { GENERATE_RATE_LIMIT: "3" } });
});
after(() => srv.close());

const get = (path, init) => fetch(`${srv.base}${path}`, init);

test("health and config; the config never exposes secrets", async () => {
  const health = await (await get("/api/health")).json();
  assert.equal(health.status, "ok");
  const res = await get("/api/config");
  const config = await res.json();
  assert.equal(config.mode, "offline");
  assert.equal(config.library.total, 103);
  assert.equal(config.library.stats.inDepth, 10);
  assert.ok(!JSON.stringify(config).toLowerCase().includes("apikey"));
});

test("GET /api/guides filters and sorts", async () => {
  const all = await (await get("/api/guides")).json();
  assert.equal(all.total, 103);
  const complex = await (await get("/api/guides?difficulty=Complex&approval=required&sort=fastest")).json();
  assert.ok(complex.total > 0 && complex.total < 103);
  assert.ok(complex.items.every((s) => s.difficulty === "Complex" && s.approvalRequired === true));
  const days = complex.items.map((s) => s.prodDays);
  assert.deepEqual(days, [...days].sort((a, b) => a - b));
  const search = await (await get("/api/guides?q=gmail")).json();
  assert.equal(search.items[0].id, "google-workspace");
  const ignored = await (await get("/api/guides?difficulty=<script>")).json();
  assert.equal(ignored.total, 103, "unknown filter values are ignored");
});

test("GET /api/guides/:id returns JSON, Markdown, or a 404 with suggestions", async () => {
  const slack = await (await get("/api/guides/slack")).json();
  assert.equal(slack.name, "Slack");
  const md = await get("/api/guides/slack.md");
  assert.match(md.headers.get("content-type"), /text\/markdown/);
  assert.match(await md.text(), /^# Slack: OAuth setup guide/);
  const missing = await get("/api/guides/slak");
  assert.equal(missing.status, 404);
  const body = await missing.json();
  assert.ok(body.suggestions.some((s) => s.id === "slack"));
});

test("pages get the strict security headers", async () => {
  const res = await get("/guides/slack");
  assert.equal(res.status, 200);
  const csp = res.headers.get("content-security-policy");
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /require-trusted-types-for 'script'/);
  assert.ok(!csp.includes("unsafe-inline"));
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("referrer-policy"), "no-referrer");
  assert.equal(res.headers.get("x-frame-options"), "DENY");
});

test("the SPA shell answers 404 for unknown guides, share ids and paths", async () => {
  assert.equal((await get("/guides/does-not-exist")).status, 404);
  assert.equal((await get("/g/AAAAAAAAAAAA")).status, 404);
  assert.equal((await get("/nope")).status, 404);
  assert.equal((await get("/generate")).status, 200);
  assert.equal((await get("/method")).status, 200);
});

test("static files: no traversal, no dotfiles, no source outside public/", async () => {
  assert.equal((await get("/app/main.js")).status, 200);
  assert.equal((await get("/shared/sse.js")).headers.get("content-type"), "text/javascript; charset=utf-8");
  for (const path of ["/../package.json", "/%2e%2e/package.json", "/..%2fpackage.json", "/.env", "/.gitignore", "/app/%00.js", "/src/app.js", "/data/guides/slack.json"]) {
    const res = await get(path);
    assert.notEqual(res.status, 200, path);
    assert.ok(!(await res.text()).includes('"name": "apm-oauth-field-guide"'), path);
  }
  const font = await get("/fonts/geist-latin-wght.woff2");
  assert.match(font.headers.get("cache-control"), /immutable/);
  const etag = (await get("/app/main.js")).headers.get("etag");
  assert.equal((await get("/app/main.js", { headers: { "if-none-match": etag } })).status, 304);
});

test("API method and media-type errors are explicit", async () => {
  const wrongMethod = await get("/api/generate");
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get("allow"), "POST");
  const unsupported = await fetch(`${srv.base}/api/generate`, { method: "POST", headers: { "content-type": "text/plain" }, body: "app=x" });
  assert.equal(unsupported.status, 415);
  assert.equal((await generate(srv.base, "{not json")).status, 400);
  assert.equal((await generate(srv.base, { app: "   " })).status, 400);
  assert.equal((await generate(srv.base, { app: "x".repeat(5000) })).status, 413);
});

test("cross-site requests can't start a generation", async () => {
  const res = await generate(srv.base, { app: "Calendly" }, { origin: "https://evil.example", "sec-fetch-site": "cross-site" });
  assert.equal(res.status, 403);
});

test("a library app streams the researched guide without a share id", async () => {
  const { status, headers, events } = await generate(srv.base, { app: "notion.so" });
  assert.equal(status, 200);
  assert.match(headers.get("content-type"), /text\/event-stream/);
  const guide = events.find((e) => e.type === "guide");
  assert.equal(guide.matched, true);
  assert.equal(guide.guide.id, "notion");
  assert.equal(guide.shareId, undefined);
  assert.equal(events.at(-1).type, "done");
});

test("a generated guide is stored, shareable, cached and exportable", async () => {
  const first = await generate(srv.base, { app: "Calendly", intent: "read" });
  const ev = first.events.find((e) => e.type === "guide");
  assert.equal(ev.matched, false);
  assert.match(ev.shareId, /^[A-Za-z0-9_-]{12}$/);

  const shared = await (await get(`/api/generated/${ev.shareId}`)).json();
  assert.equal(shared.guide.name, "Calendly");
  assert.equal((await get(`/g/${ev.shareId}`)).status, 200);
  const md = await (await get(`/api/generated/${ev.shareId}.md`)).text();
  assert.match(md, /Generated draft/);
  // The exported link carries the app and intent, so it can regenerate after the share store forgets it.
  assert.ok(md.includes(`/g/${ev.shareId}?app=Calendly&intent=read`));
  assert.equal((await get(`/g/AAAAAAAAAAAA?app=Calendly&intent=read`)).status, 404, "a forgotten share is still a 404");

  const again = await generate(srv.base, { app: "Calendly", intent: "read" });
  const cached = again.events.find((e) => e.type === "guide");
  assert.equal(cached.cached, true);
  assert.equal(cached.shareId, ev.shareId);
  assert.equal(again.events[0].engine.kind, "cache");
});

test("generations are rate limited per client; library hits and cache hits are free", async () => {
  // Limit is 3 per window; one was used above. Two more fresh runs, then 429.
  assert.equal((await generate(srv.base, { app: "Zzz One" })).status, 200);
  assert.equal((await generate(srv.base, { app: "Zzz Two" })).status, 200);
  const limited = await generate(srv.base, { app: "Zzz Three" });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
  assert.equal((await generate(srv.base, { app: "Slack" })).status, 200, "library hits don't count");
  assert.equal((await generate(srv.base, { app: "Calendly", intent: "read" })).status, 200, "cache hits don't count");
});

test("an oversized chunked body gets a 413, not a dropped connection", async () => {
  const body = new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode(`{"app":"${"x".repeat(6000)}"}`));
      c.close();
    },
  });
  const res = await fetch(`${srv.base}/api/generate`, { method: "POST", headers: { "content-type": "application/json" }, body, duplex: "half" });
  assert.equal(res.status, 413);
});

test("clientIp trusts only the proxy's own X-Forwarded-For entry and buckets IPv6 by /64", () => {
  const req = (xff, remote = "10.0.0.5") => ({ headers: { "x-forwarded-for": xff }, socket: { remoteAddress: remote } });
  assert.equal(clientIp(req("1.2.3.4"), 0), "10.0.0.5", "no trusted proxy: the socket address");
  assert.equal(clientIp(req("6.6.6.6, 203.0.113.9"), 1), "203.0.113.9", "the client-written left end is ignored");
  assert.equal(clientIp(req("spoof, 198.51.100.7, 10.0.0.2"), 2), "198.51.100.7");
  assert.equal(clientIp(req("", "2001:db8:1:2:3:4:5:6"), 0), "2001:db8:1:2::/64");
  assert.equal(clientIp(req("", "::ffff:192.0.2.1"), 0), "192.0.2.1");
  // Every address in one /64 lands in one bucket, however it is abbreviated.
  for (const ip of ["2001:db8::1", "2001:db8:0:0:1::", "2001:0DB8:0000:0000:ffff::1", "2001:db8::1:2:3:4"]) {
    assert.equal(clientIp(req("", ip), 0), "2001:db8:0:0::/64", ip);
  }
  assert.equal(clientIp(req("", "::1"), 0), "0:0:0:0::/64");
  // A port appended by the proxy doesn't make a new bucket per connection.
  assert.equal(clientIp(req("203.0.113.9:51234"), 1), "203.0.113.9");
  assert.equal(clientIp(req("[2001:db8::1]:443"), 1), "2001:db8:0:0::/64");
});

test("isSameOrigin prefers Sec-Fetch-Site; isAllowedHost blocks DNS-rebinding hosts", () => {
  const r = (headers) => ({ headers });
  assert.equal(isSameOrigin(r({ "sec-fetch-site": "same-origin", origin: "https://x", host: "internal:3000" })), true, "a proxy that rewrites Host doesn't matter");
  assert.equal(isSameOrigin(r({ "sec-fetch-site": "cross-site" })), false);
  assert.equal(isSameOrigin(r({ origin: "https://public.example", host: "127.0.0.1:3000", "x-forwarded-host": "public.example" }), { trustProxy: 1 }), true);
  assert.equal(isSameOrigin(r({ origin: "https://evil.example", host: "app.example" })), false);
  assert.equal(isAllowedHost(r({ host: "localhost:3000" }), ["localhost", "127.0.0.1"]), true);
  assert.equal(isAllowedHost(r({ host: "attacker.example:3000" }), ["localhost", "127.0.0.1"]), false);
  assert.equal(isAllowedHost(r({ host: "anything" }), null), true);
});

test("a loopback server refuses unknown Host headers (DNS rebinding)", async () => {
  // fetch() always derives Host from the URL, so use node:http to send a forged one.
  const status = (host) =>
    new Promise((resolve, reject) => {
      const { hostname, port } = new URL(srv.base);
      http.get({ hostname, port, path: "/api/config", headers: { host } }, (res) => (res.resume(), resolve(res.statusCode))).on("error", reject);
    });
  assert.equal(await status("rebind.attacker.example"), 421);
  assert.equal(await status(`localhost:${new URL(srv.base).port}`), 200);
});

test("with ALLOWED_HOSTS set, container health probes by IP still pass", async () => {
  const s = await startServer({ env: { ALLOWED_HOSTS: "guides.example.com" } });
  try {
    const { hostname, port } = new URL(s.base);
    const status = (path, host) =>
      new Promise((resolve, reject) => {
        http.get({ hostname, port, path, headers: { host } }, (res) => (res.resume(), resolve(res.statusCode))).on("error", reject);
      });
    assert.equal(await status("/api/health", `127.0.0.1:${port}`), 200);
    assert.equal(await status("/", `127.0.0.1:${port}`), 421);
    assert.equal(await status("/api/healthz", `127.0.0.1:${port}`), 421, "only the health route is exempt");
    assert.equal(await status("/", "guides.example.com"), 200);
  } finally {
    await s.close();
  }
});

test("a busy generator answers 503 without spending the caller's rate limit", { timeout: 20_000 }, async () => {
  let release;
  const blocked = new Promise((resolve) => (release = resolve));
  let entered;
  const inside = new Promise((resolve) => (entered = resolve));
  const probe = async () => {
    entered();
    await blocked;
    return { checked: [], provider: null, mcp: null };
  };
  const busy = await startServer({ env: { GENERATE_RATE_LIMIT: "2", GENERATE_MAX_CONCURRENT: "1", DISCOVERY_PROBE: "on" }, probe });
  try {
    const first = generate(busy.base, { app: "gate-alpha.io" });
    await inside;
    for (const app of ["Gate Beta", "Gate Gamma", "Gate Delta"]) assert.equal((await generate(busy.base, { app })).status, 503, app);
    release();
    assert.equal((await first).status, 200);
    assert.equal((await generate(busy.base, { app: "Gate Epsilon" })).status, 200, "the 503s didn't use up the limit");
    assert.equal((await generate(busy.base, { app: "Gate Zeta" })).status, 429);
  } finally {
    release();
    await busy.close();
  }
});

test("the cache is keyed by intent and a normalized input", async () => {
  const s = await startServer();
  try {
    const shareOf = async (body) => (await generate(s.base, body)).events.find((e) => e.type === "guide");
    const a = await shareOf({ app: "calendly.com", intent: "read" });
    const b = await shareOf({ app: "https://www.Calendly.com/", intent: "read" });
    assert.equal(b.cached, true);
    assert.equal(b.shareId, a.shareId);
    const c = await shareOf({ app: "calendly.com", intent: "write" });
    assert.ok(!c.cached, "a different intent is a different guide");
    assert.notEqual(c.shareId, a.shareId);
  } finally {
    await s.close();
  }
});

test("PUBLIC_URL sets the link in Markdown exports; a bad value stops start-up", async () => {
  const s = await startServer({ env: { PUBLIC_URL: "https://guides.example.com/ignored/path" } });
  try {
    const md = await (await fetch(`${s.base}/api/guides/slack.md`)).text();
    assert.ok(md.includes("https://guides.example.com/guides/slack"));
  } finally {
    await s.close();
  }
  assert.throws(() => loadConfig({ PUBLIC_URL: "javascript:alert(1)" }), /PUBLIC_URL/);
});

test("start-up fails loudly and exits non-zero when the port is taken", { timeout: 20_000 }, async () => {
  const blocker = http.createServer();
  await new Promise((resolve) => {
    blocker.listen(0, "127.0.0.1", resolve);
  });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ofg-port-"));
  try {
    const child = spawn(process.execPath, ["src/app.js"], {
      cwd: path.join(import.meta.dirname, "..", ".."),
      env: { ...process.env, PORT: String(blocker.address().port), HOST: "127.0.0.1", DATA_DIR: dataDir, ANTHROPIC_API_KEY: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    const code = await new Promise((resolve) => {
      child.on("exit", resolve);
    });
    assert.equal(code, 1);
    const line = output.split("\n").find((l) => l.includes('"listen_failed"'));
    assert.ok(line, `no listen_failed log line in: ${output}`);
    assert.equal(JSON.parse(line).code, "EADDRINUSE");
  } finally {
    blocker.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
