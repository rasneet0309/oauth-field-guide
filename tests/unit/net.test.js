import assert from "node:assert/strict";
import { test } from "node:test";
import { candidateUrls, guardedFetchJson, probeDiscovery, readResourceMetadata, readServerMetadata, wellKnownFor } from "../../src/server/discovery.js";
import { guardedLookup, isPublicAddress } from "../../src/server/net-guard.js";

test("isPublicAddress allows only public unicast addresses", () => {
  for (const ip of ["8.8.8.8", "1.1.1.1", "151.101.1.69", "2606:4700:4700::1111", "2a00:1450:4001:82a::200e"]) assert.ok(isPublicAddress(ip), ip);
  for (const ip of [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "198.18.0.1",
    "::1",
    "::",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "64:ff9b::a00:1",
    "2001:db8::1",
    "ff02::1",
    "not-an-ip",
  ]) {
    assert.ok(!isPublicAddress(ip), ip);
  }
});

test("guardedLookup refuses names that resolve to loopback", async () => {
  await assert.rejects(
    new Promise((resolve, reject) => guardedLookup("localhost", { all: true }, (err, addrs) => (err ? reject(err) : resolve(addrs)))),
    (err) => err.code === "EBLOCKED",
  );
});

test("guardedFetchJson refuses non-https, odd ports, credentials and implausible hosts before connecting", async () => {
  for (const url of ["http://example.com/.well-known/x", "https://example.com:8443/x", "https://user:pw@example.com/x", "https://127.0.0.1/x", "https://localhost/x", "notaurl"]) {
    await assert.rejects(guardedFetchJson(url), (err) => ["blocked", "invalid"].includes(err.outcome), url);
  }
});

test("readServerMetadata keeps only well-formed https endpoints and printable scope tokens", () => {
  const meta = readServerMetadata(
    {
      issuer: "https://auth.example.com",
      authorization_endpoint: "https://auth.example.com/authorize",
      token_endpoint: "javascript:alert(1)",
      registration_endpoint: "https://auth.example.com/register",
      scopes_supported: ["read", "write", "<script>", "a b", 42],
      code_challenge_methods_supported: ["S256"],
    },
    "https://auth.example.com/.well-known/openid-configuration",
    "openid-configuration",
  );
  assert.equal(meta.tokenEndpoint, "");
  assert.deepEqual(meta.scopes, ["read", "write", "<script>"]);
  assert.deepEqual(meta.pkceMethods, ["S256"]);
  assert.equal(readServerMetadata({ issuer: "https://x.example" }, "u", "k"), null, "an issuer alone isn't metadata");
  assert.equal(readServerMetadata([], "u", "k"), null);
});

test("RFC 8414 path insertion and candidate URLs", () => {
  assert.equal(wellKnownFor("https://auth.example.com", "oauth-authorization-server"), "https://auth.example.com/.well-known/oauth-authorization-server");
  assert.equal(wellKnownFor("https://example.com/tenant/1/", "oauth-authorization-server"), "https://example.com/.well-known/oauth-authorization-server/tenant/1");
  const urls = candidateUrls("example.com", "developer.example.com");
  assert.ok(urls.length <= 8);
  assert.equal(urls[0], "https://example.com/.well-known/openid-configuration");
  assert.ok(urls.includes("https://mcp.example.com/.well-known/oauth-protected-resource"));
  assert.ok(urls.includes("https://developer.example.com/.well-known/openid-configuration"));
});

test("probeDiscovery classifies provider and MCP metadata and follows protected-resource metadata one hop", async () => {
  const docs = {
    "https://example.com/.well-known/openid-configuration": {
      issuer: "https://example.com",
      authorization_endpoint: "https://example.com/oauth/authorize",
      token_endpoint: "https://example.com/oauth/token",
      scopes_supported: ["openid", "read"],
    },
    "https://mcp.example.com/.well-known/oauth-protected-resource": {
      resource: "https://mcp.example.com/mcp",
      authorization_servers: ["https://auth.example.com"],
    },
    "https://auth.example.com/.well-known/oauth-authorization-server": {
      issuer: "https://auth.example.com",
      authorization_endpoint: "https://auth.example.com/authorize",
      token_endpoint: "https://auth.example.com/token",
      registration_endpoint: "https://auth.example.com/register",
      code_challenge_methods_supported: ["S256"],
    },
  };
  const fetchJson = async (url) => {
    if (docs[url]) return { status: 200, json: docs[url] };
    throw Object.assign(new Error("404"), { outcome: "missing", status: 404 });
  };
  const result = await probeDiscovery({ root: "example.com", fetchJson });
  assert.equal(result.provider.issuer, "https://example.com");
  assert.equal(result.mcp.registrationEndpoint, "https://auth.example.com/register");
  assert.equal(result.mcp.resource, "https://mcp.example.com/mcp");
  assert.ok(result.checked.some((c) => c.outcome === "missing" && c.status === 404));
  assert.equal(readResourceMetadata({ authorization_servers: ["http://insecure"] }, "u"), null);
});

test("probeDiscovery stops at its time budget", async () => {
  const fetchJson = (url, { signal }) =>
    new Promise((_, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { outcome: "timeout" }))));
  const started = Date.now();
  const result = await probeDiscovery({ root: "slow.example", fetchJson, budgetMs: 300 });
  assert.ok(Date.now() - started < 2000);
  assert.ok(result.checked.every((c) => ["timeout", "skipped"].includes(c.outcome)));
  assert.equal(result.provider, null);
});

test("a malformed authorization-server address doesn't throw away the probe", async () => {
  const docs = {
    "https://example.com/.well-known/openid-configuration": {
      issuer: "https://example.com",
      authorization_endpoint: "https://example.com/authorize",
      token_endpoint: "https://example.com/token",
    },
    "https://mcp.example.com/.well-known/oauth-protected-resource": { authorization_servers: ["https://auth[.example.com"] },
  };
  const fetchJson = async (url) => {
    if (docs[url]) return { status: 200, json: docs[url] };
    throw Object.assign(new Error("404"), { outcome: "missing", status: 404 });
  };
  const result = await probeDiscovery({ root: "example.com", fetchJson });
  assert.equal(result.provider.issuer, "https://example.com");
  assert.equal(result.mcp, null);
});
