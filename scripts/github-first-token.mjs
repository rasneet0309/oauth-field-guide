#!/usr/bin/env node
/**
 * Free setup attempt: get a first GitHub user access token with the device flow, the part an
 * agent can run once a human has registered the app. Used for the setup attempt in
 * docs/EVIDENCE.md. No dependencies; Node 20.12+.
 *
 *   1. A human registers a GitHub App: Settings → Developer settings → GitHub Apps → New GitHub
 *      App, ticks "Enable Device Flow" and copies the Client ID. No client secret is needed.
 *   2. node scripts/github-first-token.mjs <client-id>
 *   3. The human opens https://github.com/login/device, enters the code and authorizes.
 *
 * Prints timings and the signed-in login. The token is never printed or written anywhere: it
 * lives in memory until the process exits. Revoke it afterwards under Settings → Applications →
 * Authorized GitHub Apps, or delete the test app.
 */
const WEB = process.env.GITHUB_WEB_URL || "https://github.com";
const API = process.env.GITHUB_API_URL || "https://api.github.com";
const clientId = String(process.argv[2] || process.env.GITHUB_CLIENT_ID || "").trim();
if (!/^[A-Za-z0-9._-]{8,64}$/.test(clientId)) {
  console.error("Usage: node scripts/github-first-token.mjs <client-id>   (the app's Client ID, not its secret)");
  process.exit(2);
}

const started = Date.now();
const clock = () => new Date().toTimeString().slice(0, 8);
const sleep = (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));
const fail = (message) => {
  console.error(message);
  process.exit(1);
};

/** POST with query parameters, as GitHub's device flow expects; returns the JSON body. */
async function post(path, params) {
  const res = await fetch(`${WEB}${path}?${new URLSearchParams(params)}`, { method: "POST", headers: { Accept: "application/json" } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok && !body.error) fail(`${path} answered HTTP ${res.status}.`);
  return body;
}
const reason = (r) => `${r.error}${r.error_description ? ` (${r.error_description})` : ""}`;

const code = await post("/login/device/code", { client_id: clientId });
if (code.error) fail(`GitHub refused the device code request: ${reason(code)}. Is "Enable Device Flow" ticked?`);
const minutes = Math.max(1, Math.round((Number(code.expires_in) || 900) / 60));
console.log(`[${clock()}] Open ${code.verification_uri} and enter ${code.user_code}. The code is valid for ${minutes} minute${minutes === 1 ? "" : "s"}.`);

let interval = Number(code.interval) || 5;
const deadline = Date.now() + (Number(code.expires_in) || 900) * 1000;
let token = null;
let expiresIn = null;
while (!token) {
  if (Date.now() > deadline) fail("The code expired before anyone authorized it. Run the script again.");
  await sleep(interval);
  const r = await post("/login/oauth/access_token", { client_id: clientId, device_code: code.device_code, grant_type: "urn:ietf:params:oauth:grant-type:device_code" });
  if (r.access_token) {
    token = r.access_token;
    expiresIn = Number(r.expires_in) || null;
  } else if (r.error === "slow_down") interval = Number(r.interval) || interval + 5;
  else if (r.error !== "authorization_pending") fail(`Stopped: ${reason(r)}.`);
}
const waited = Math.round((Date.now() - started) / 1000);

const me = await fetch(`${API}/user`, {
  headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "User-Agent": "oauth-field-guide-setup-attempt", "X-GitHub-Api-Version": "2022-11-28" },
});
const user = await me.json().catch(() => ({}));
// Say what kind of token it is without printing any of it.
const kind = token.startsWith("ghu_") ? "a GitHub App user token" : token.startsWith("gho_") ? "an OAuth App token" : "a token";
console.log(`[${clock()}] Got ${kind} ${waited} s after requesting the code${expiresIn ? `; it expires in ${Math.round(expiresIn / 3600)} h` : ""}.`);
console.log(me.ok ? `GET /user answered ${me.status}: signed in as ${user.login}.` : `GET /user answered HTTP ${me.status}.`);
console.log("Revoke it when you're done: GitHub → Settings → Applications → Authorized GitHub Apps, or delete the test app.");
