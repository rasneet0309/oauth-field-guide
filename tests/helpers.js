/** Test helpers: start the real server on a random port with an isolated data directory. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/server/config.js";
import { createSSEParser } from "../public/shared/sse.js";

export async function startServer({ env = {}, fetchImpl, probe } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ofg-test-"));
  const config = loadConfig({ AGENT_PACE: "0", DATA_DIR: dataDir, DISCOVERY_PROBE: "off", ...env });
  const { server, store } = createApp({ config, log: () => {}, fetchImpl, probe });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    store,
    dataDir,
    async close() {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

/** POST /api/generate and collect every streamed event. */
export async function generate(base, body, headers = {}) {
  const res = await fetch(`${base}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await res.text();
  const events = [];
  if (res.headers.get("content-type")?.startsWith("text/event-stream")) {
    const parser = createSSEParser((e) => events.push(JSON.parse(e.data)));
    parser.push(text);
    parser.end();
  }
  return { status: res.status, headers: res.headers, text, events };
}

export const loadGuides = () => {
  const dir = path.join(import.meta.dirname, "..", "data", "guides");
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
};
