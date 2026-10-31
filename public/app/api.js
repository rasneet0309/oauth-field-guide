/**
 * The browser's view of the server API. The static demo build swaps in api-local.js, which
 * runs the same offline engine in the page, behind the same interface.
 */
import { sharePath } from "../shared/guide-model.js";
import { createSSEParser } from "../shared/sse.js";

export class ApiError extends Error {
  constructor(message, { status = 0, code = "error", retryAfter = 0 } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

async function getJson(url, { allow404 = false } = {}) {
  let res;
  try {
    res = await fetch(url, { headers: { accept: "application/json" } });
  } catch {
    throw new ApiError("Can't reach the server. Check that it's running, then try again.", { code: "network" });
  }
  if (allow404 && res.status === 404) return null;
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(body?.error?.message ?? `The server answered ${res.status}.`, { status: res.status, code: body?.error?.code });
  }
  try {
    return await res.json();
  } catch {
    // A proxy's HTML error page, or a truncated body.
    throw new ApiError("The server sent an unexpected response. Try again in a moment.", { status: res.status, code: "bad_response" });
  }
}

export function createHttpApi() {
  return {
    kind: "http",
    config: () => getJson("/api/config"),
    summaries: async () => (await getJson("/api/guides")).items,
    guide: (id) => getJson(`/api/guides/${encodeURIComponent(id)}`, { allow404: true }),
    shared: async (id) => (await getJson(`/api/generated/${encodeURIComponent(id)}`, { allow404: true }))?.guide ?? null,

    /**
     * Start a generation and call onEvent for each streamed event.
     * Resolves when the stream ends; rejects with ApiError on HTTP errors or a dropped connection.
     */
    async generate({ app, intent, fresh = false }, onEvent, signal) {
      let res;
      try {
        res = await fetch("/api/generate", {
          method: "POST",
          headers: { "content-type": "application/json", accept: "text/event-stream" },
          body: JSON.stringify({ app, intent, fresh }),
          signal,
        });
      } catch (err) {
        if (signal?.aborted) throw err;
        throw new ApiError("Can't reach the server. Check that it's running, then try again.", { code: "network" });
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new ApiError(body?.error?.message ?? `The server answered ${res.status}.`, {
          status: res.status,
          code: body?.error?.code,
          retryAfter: Number(res.headers.get("retry-after")) || 0,
        });
      }
      const parser = createSSEParser(({ data }) => {
        let ev;
        try {
          ev = JSON.parse(data);
        } catch {
          return;
        }
        onEvent(ev);
      });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          parser.push(decoder.decode(value, { stream: true }));
        }
      } catch (err) {
        if (signal?.aborted) throw err;
        throw new ApiError("The connection dropped before the run finished. Try again.", { code: "stream" });
      }
      parser.push(decoder.decode());
      parser.end();
    },

    guideUrl: (id) => `${location.origin}/guides/${encodeURIComponent(id)}`,
    shareUrl: (shareId, guide) => `${location.origin}${sharePath(shareId, guide)}`,
  };
}
