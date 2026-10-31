/**
 * POST /api/generate: run the Live Generator and stream its events as Server-Sent Events.
 *
 *   request   { "app": "Linear" | "https://developer.zoom.us", "intent": "read|write|send|admin", "fresh": false }
 *   response  text/event-stream of run, stage, log, evidence, guide, error and done events
 *
 * Order of decisions, cheapest first: a library hit or a cached result streams immediately and
 * costs nothing; anything else passes the rate limiter and the concurrency gate, then runs the
 * live agent (with ANTHROPIC_API_KEY) or the offline engine. A failed live run falls back to
 * the offline engine in the same stream. Generated guides are stored for /g/<id> share links.
 */
import { identifyApp, isIntent } from "../../public/shared/engine/identify.js";
import { OFFLINE_STAGES, createRun, identifyStage, libraryResult, runOfflineAgent, scanStage, verifyLinks } from "../../public/shared/engine/offline.js";
import { formatSSE } from "../../public/shared/sse.js";
import { allSteps } from "../../public/shared/guide-model.js";
import { clampText } from "../../public/shared/text.js";
import { LIVE_STAGES, researchLive, userFacingReason } from "./agents/claude.js";
import { probeDiscovery } from "./discovery.js";
import { HttpError, clientIp, isSameOrigin, readJsonBody, sendError } from "./http.js";
import { createGate, createRateLimiter } from "./rate-limit.js";

const ago = (ms) => (ms < 90_000 ? "a minute ago" : ms < 5_400_000 ? `${Math.round(ms / 60_000)} minutes ago` : `${Math.round(ms / 3_600_000)} hours ago`);

export function createGenerator({ config, library, store, log, fetchImpl, probe: probeOverride }) {
  const limiter = createRateLimiter(config.rateLimit);
  const gate = createGate(config.rateLimit.maxConcurrent);
  const probe =
    probeOverride ??
    (config.probe.enabled ? (opts) => probeDiscovery({ ...opts, timeoutMs: config.probe.timeoutMs, budgetMs: config.probe.budgetMs }) : undefined);
  const live = config.live;
  const liveEngine = { kind: "live", label: `Live research agent (${live.model})`, model: live.model };

  /** The engines behind one request. Yields protocol events. */
  async function* runEngines({ input, intent, signal }) {
    const ctx = {
      lib: library.lib,
      getGuide: library.get,
      patterns: library.patterns,
      categories: library.categories,
      probe,
      probeOffNote: "OAuth discovery probing is turned off on this server (DISCOVERY_PROBE=off), so the agent relies on research patterns.",
      pace: config.agentPace,
      signal,
    };
    if (!live.enabled) {
      yield* runOfflineAgent({ input, intent, ctx });
      return;
    }
    const run = createRun(ctx);
    yield { type: "run", engine: liveEngine, stages: LIVE_STAGES, input: { app: input, intent } };
    const { app, guide: researched } = yield* identifyStage({ input, ctx, run });
    if (researched) {
      yield* libraryResult(researched, LIVE_STAGES, run);
      return;
    }
    const discovery = yield* scanStage({ app, ctx, run });
    yield { type: "stage", id: "research", status: "running" };
    if (live.maxSearches === 0) yield { type: "log", stage: "research", level: "warn", text: "Web search is turned off (LIVE_MAX_SEARCHES=0), so the model works from its own knowledge." };
    let result;
    try {
      const liveSignal = AbortSignal.any([signal, AbortSignal.timeout(live.timeoutMs)]);
      result = yield* researchLive({ app, intent, discovery, ctx: { live, patterns: library.patterns, categories: library.categories, signal: liveSignal, fetchImpl } });
    } catch (err) {
      if (signal.aborted) throw err;
      const reason = userFacingReason(err);
      log("warn", "live_agent_failed", { code: err.code ?? "error", status: err.status, message: err.message });
      yield { type: "log", stage: "research", level: "warn", text: `${reason} Falling back to the offline engine.` };
      yield { type: "stage", id: "research", status: "error", summary: "Live agent failed" };
      // Reuse the probe result only if a probe actually ran.
      yield* runOfflineAgent({ input, intent, ctx: discovery ? { ...ctx, discovery } : ctx });
      return;
    }
    const { guide, searches, sourcesRead } = result;
    yield { type: "stage", id: "draft", status: "done", summary: `${allSteps(guide).length} steps` };
    yield { type: "stage", id: "verify", status: "running" };
    guide.generation = {
      engine: "live",
      engineLabel: liveEngine.label,
      model: live.model,
      input,
      intent,
      generatedAt: run.now.toISOString(),
      evidence: [
        ...run.found,
        ...searches.map((q) => ({ kind: "web-search", label: "Web search", detail: clampText(q, 160) })),
        ...sourcesRead.slice(0, 8).map((s) => ({ kind: "source", label: s.title || "Search result", url: s.url })),
      ],
      verify: verifyLinks(app, { path: guide.path, adminInstall: /\b(admin|owner)/i.test(guide.roles.customer) }),
      vendorEmail: "",
      similar: app.similar.slice(0, 3).map((s) => ({ id: s.id, name: s.name })),
      durationMs: Date.now() - run.started,
    };
    yield { type: "log", stage: "verify", level: "success", text: `Converted with the library's converter and validated: ${allSteps(guide).length} steps, ${guide.sources.length} sources.` };
    yield { type: "log", stage: "verify", level: "info", text: `Confidence: ${guide.confidence}. Generated guides are capped at Medium until someone verifies them.` };
    yield { type: "stage", id: "verify", status: "done", summary: `${guide.confidence} confidence` };
    yield { type: "guide", guide, matched: false };
    yield { type: "done", ms: Date.now() - run.started };
  }

  /** Replay a stored result as a short run, so the UI path is identical. */
  async function* replayCached({ input, intent, id, guide, savedAt }) {
    const stages = guide.generation?.engine === "live" ? LIVE_STAGES : OFFLINE_STAGES;
    yield { type: "run", engine: { kind: "cache", label: "Cached result" }, stages, input: { app: input, intent } };
    yield { type: "log", stage: stages[0].id, level: "success", text: `Served from cache: this app was investigated ${ago(Date.now() - savedAt)}. Use “Run fresh” to investigate again.` };
    for (const s of stages) yield { type: "stage", id: s.id, status: "skipped", summary: "From cache" };
    yield { type: "guide", guide, matched: false, shareId: id, cached: true };
    yield { type: "done", ms: 0 };
  }

  return {
    engine: () => (live.enabled ? liveEngine : { kind: "offline", label: "Offline research engine" }),

    async handle(req, res) {
      if (!isSameOrigin(req, { trustProxy: config.trustProxy })) return sendError(res, 403, "cross_origin", "Cross-site requests can't start a generation.");
      let body;
      try {
        body = await readJsonBody(req);
      } catch (err) {
        if (!(err instanceof HttpError)) throw err;
        if (err.closeConnection) {
          res.on("finish", () => req.destroy());
          return sendError(res, err.status, err.code, err.message, { Connection: "close" });
        }
        return sendError(res, err.status, err.code, err.message);
      }
      const input = clampText(body.app, 120);
      if (!input) return sendError(res, 400, "missing_app", "Tell the generator which app: a name or a website.");
      const intent = isIntent(body.intent) ? body.intent : "write";
      const fresh = body.fresh === true;

      // Library hits and cached results are free, so decide those before rate limiting.
      const app = identifyApp(input, library.lib, library.categories);
      // The key is the exact request (normalised input, not just the app's name), so a name-only
      // run and a run with the real URL never share a result.
      const cacheKey = [live.enabled ? "live" : "offline", intent, input.toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, "")].join("|");
      const cachedId = !app.match && !fresh ? store.cached(cacheKey) : null;
      const cachedGuide = cachedId ? await store.get(cachedId) : null;
      let gated = false;
      if (!app.match && !cachedGuide) {
        // Check capacity first, so a "busy" answer doesn't use up the client's quota.
        if (!gate.tryEnter()) return sendError(res, 503, "busy", "The generator is busy. Try again in a few seconds.", { "Retry-After": "5" });
        const limit = limiter.take(clientIp(req, config.trustProxy));
        if (!limit.ok) {
          gate.leave();
          return sendError(res, 429, "rate_limited", `You've hit the generation limit. Try again in ${limit.retryAfterSec} seconds.`, {
            "Retry-After": String(limit.retryAfterSec),
          });
        }
        gated = true;
      }

      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no",
      });
      const abort = new AbortController();
      const onClose = () => {
        if (!res.writableFinished) abort.abort(new Error("client disconnected"));
      };
      res.on("close", onClose);
      const heartbeat = setInterval(() => {
        if (!res.writableEnded && !res.destroyed) res.write(": keep-alive\n\n");
      }, 15_000);
      const send = (ev) => {
        if (!res.writableEnded && !res.destroyed) res.write(formatSSE(ev.type, ev));
      };
      const started = Date.now();
      let outcome = "ok";
      try {
        const events = cachedGuide
          ? replayCached({ input, intent, id: cachedId, guide: cachedGuide, savedAt: Date.parse(cachedGuide.generation?.generatedAt) || Date.now() })
          : runEngines({ input, intent, signal: abort.signal });
        for await (const ev of events) {
          if (abort.signal.aborted) break;
          if (ev.type === "guide" && !ev.matched && !ev.shareId) {
            const id = await store.save(ev.guide);
            // A live run that fell back to the offline engine is shareable but not cached, so
            // the next request tries the live agent again instead of replaying the fallback.
            if (!live.enabled || ev.guide.generation?.engine === "live") store.remember(cacheKey, id);
            ev.shareId = id;
          }
          if (ev.type === "error") outcome = "error";
          send(ev);
        }
      } catch (err) {
        if (!abort.signal.aborted) {
          outcome = "error";
          log("error", "generate_failed", { message: err.message, stack: err.stack });
          send({ type: "error", code: "internal", message: "The run failed unexpectedly. Try again." });
        } else outcome = "aborted";
      } finally {
        clearInterval(heartbeat);
        res.off("close", onClose);
        if (gated) gate.leave();
        res.end();
        log("info", "generate", { app: input, intent, matched: Boolean(app.match), cached: Boolean(cachedGuide), outcome, ms: Date.now() - started });
      }
    },
  };
}
