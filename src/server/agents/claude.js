/**
 * The live research agent: Claude with Anthropic's server-side web search, streamed.
 *
 * Runs only when ANTHROPIC_API_KEY is set. It emits the same event protocol as the offline
 * engine, so the UI can't tell them apart except by the stages they declare. Every search
 * query and result list is surfaced in the run log, the answer arrives through a
 * submit_guide tool call, and the server converts and validates it with the library's own
 * code. Anything that goes wrong (HTTP error, timeout, invalid answer) throws LiveAgentError
 * and the caller falls back to the offline engine.
 *
 * API reference: Messages API with stream=true; web search tool web_search_20250305
 * (server tool; results arrive as web_search_tool_result blocks; long turns may stop with
 * stop_reason "pause_turn" and are resumed by sending the assistant content back unchanged).
 */
import { classifyPath, fromProfile } from "../../../public/shared/convert.js";
import { categoryPrior } from "../../../public/shared/engine/patterns.js";
import { finalizeGuide } from "../../../public/shared/guide-model.js";
import { createSSEParser } from "../../../public/shared/sse.js";
import { clampText } from "../../../public/shared/text.js";
import { sanitizeGuide, validateGuide } from "../../../public/shared/validate.js";
import { submitGuideTool, systemPrompt, userPrompt } from "./prompts.js";

export const LIVE_STAGES = Object.freeze([
  { id: "identify", label: "Identify the app" },
  { id: "scan", label: "Probe OAuth metadata" },
  { id: "research", label: "Scan provider docs (live web search)" },
  { id: "draft", label: "Draft the guide" },
  { id: "verify", label: "Validate and merge" },
]);

const MAX_TURNS = 4;

export class LiveAgentError extends Error {
  constructor(message, { status, code = "live_failed" } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * What the person running the generator is told when the live agent fails. Upstream details
 * (HTTP status text, network error codes) stay in the server log.
 */
export function userFacingReason(err) {
  if (!(err instanceof LiveAgentError)) return "The live agent hit an unexpected error.";
  if (/timed out/.test(err.message)) return "The live agent timed out.";
  if (err.code === "unreachable" || err.code === "stream_error") return "The live agent couldn't be reached.";
  if (err.code === "api_error") {
    return err.status === 429 || err.status === 529 || /overloaded/i.test(err.message) ? "The live agent is busy right now." : "The live agent isn't available right now.";
  }
  return err.message;
}

/** Stream one Messages API request; yields parsed SSE event objects. */
export async function* streamMessages({ baseUrl, apiKey, body, signal, fetchImpl = fetch }) {
  let res;
  try {
    res = await fetchImpl(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ ...body, stream: true }),
      signal,
    });
  } catch (err) {
    throw new LiveAgentError(signal?.aborted ? "The live agent timed out." : `Couldn't reach the Anthropic API (${err.cause?.code ?? err.message}).`, { code: "unreachable" });
  }
  if (!res.ok) {
    let detail = "";
    try {
      detail = JSON.parse(await res.text())?.error?.message ?? "";
    } catch {
      /* body wasn't JSON */
    }
    throw new LiveAgentError(`Anthropic API error ${res.status}${detail ? `: ${clampText(detail, 200)}` : ""}`, { status: res.status, code: "api_error" });
  }
  const queue = [];
  const parser = createSSEParser((e) => queue.push(e));
  const decoder = new TextDecoder();
  const drain = function* () {
    while (queue.length) {
      const { data } = queue.shift();
      try {
        yield JSON.parse(data);
      } catch {
        /* ignore non-JSON frames */
      }
    }
  };
  try {
    for await (const chunk of res.body) {
      parser.push(decoder.decode(chunk, { stream: true }));
      yield* drain();
    }
  } catch (err) {
    throw new LiveAgentError(signal?.aborted ? "The live agent timed out." : `The stream broke (${err.message}).`, { code: "stream_error" });
  }
  parser.push(decoder.decode());
  parser.end();
  yield* drain();
}

/**
 * Rebuild one streamed assistant message (content blocks exactly as the API sent them, so a
 * paused turn can be resumed) and report progress along the way.
 */
async function* runTurn({ request, onProgress }) {
  const blocks = [];
  const partial = new Map();
  let stopReason = null;
  for await (const ev of request) {
    switch (ev.type) {
      case "content_block_start": {
        const block = structuredClone(ev.content_block);
        blocks[ev.index] = block;
        if (block.type === "server_tool_use" || block.type === "tool_use") partial.set(ev.index, "");
        if (block.type === "web_search_tool_result") yield onProgress({ kind: "results", block });
        if (block.type === "tool_use" && block.name === "submit_guide") yield onProgress({ kind: "submit_start" });
        break;
      }
      case "content_block_delta": {
        const block = blocks[ev.index];
        if (!block) break;
        const d = ev.delta;
        if (d.type === "text_delta") block.text = (block.text ?? "") + d.text;
        else if (d.type === "input_json_delta") {
          partial.set(ev.index, (partial.get(ev.index) ?? "") + d.partial_json);
          if (block.type === "tool_use") yield onProgress({ kind: "submit_progress", bytes: partial.get(ev.index).length });
        } else if (d.type === "citations_delta") (block.citations ??= []).push(d.citation);
        break;
      }
      case "content_block_stop": {
        const block = blocks[ev.index];
        if (!block) break;
        if (partial.has(ev.index)) {
          const raw = partial.get(ev.index);
          try {
            block.input = raw ? JSON.parse(raw) : (block.input ?? {});
          } catch {
            throw new LiveAgentError("The model's tool call wasn't valid JSON.", { code: "invalid_answer" });
          }
          if (block.type === "server_tool_use") yield onProgress({ kind: "search", query: block.input?.query });
        } else if (block.type === "text" && block.text?.trim()) {
          yield onProgress({ kind: "text", text: block.text });
        }
        break;
      }
      case "message_delta":
        if (ev.delta?.stop_reason) stopReason = ev.delta.stop_reason;
        break;
      case "error":
        throw new LiveAgentError(`Anthropic stream error: ${ev.error?.message ?? "unknown"}`, { code: "api_error" });
      default:
        break; // message_start, message_stop, ping
    }
  }
  return { content: blocks.filter(Boolean), stopReason };
}

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/**
 * @param {object} opts
 * @param {object} opts.app        identify result (not a library match)
 * @param {string} opts.intent
 * @param {object} opts.discovery  probe result or null
 * @param {object} opts.ctx        { live: config.live, patterns, categories, signal, fetchImpl?, now? }
 * @returns {AsyncGenerator<object, object>} yields log/evidence events, returns the guide
 */
export async function* researchLive({ app, intent, discovery, ctx }) {
  const { live, patterns, categories } = ctx;
  const now = ctx.now ? ctx.now() : new Date();
  const today = now.toISOString().slice(0, 10);
  const prior = categoryPrior(patterns, app.category);
  const submitTool = submitGuideTool(categories);
  // The search budget is per run: each follow-up request only gets what's left (at least one,
  // so a paused turn can finish the search it was in the middle of).
  const toolsFor = () =>
    live.maxSearches > 0
      ? [{ type: "web_search_20250305", name: "web_search", max_uses: Math.max(1, live.maxSearches - searches.length) }, submitTool]
      : [submitTool];

  const messages = [{ role: "user", content: userPrompt({ app, intent, discovery, prior, category: app.category }) }];
  const searches = [];
  const seen = new Map();
  let answer = null;
  let nudged = false;
  let writtenKb = 0;
  const log = (stage, text, level = "info") => ({ type: "log", stage, level, text });
  const onProgress = (p) => {
    switch (p.kind) {
      case "search":
        searches.push(p.query);
        return log("research", `Searching the web: “${clampText(p.query, 140)}”`);
      case "results": {
        const c = p.block.content;
        if (!Array.isArray(c)) return log("research", `Search failed (${c?.error_code ?? "unknown error"}).`, "warn");
        for (const r of c) if (r?.url && !seen.has(r.url)) seen.set(r.url, clampText(r.title, 120));
        const hosts = [...new Set(c.map((r) => hostOf(r.url)).filter(Boolean))].slice(0, 4);
        return log("research", `Read ${c.length} results${hosts.length ? ` from ${hosts.join(", ")}` : ""}.`, "success");
      }
      case "text": {
        const first = clampText(p.text.split(/(?<=[.!?])\s/)[0], 200);
        return first ? log("research", `Agent: ${first}`) : null;
      }
      case "submit_start":
        return { type: "stage", id: "research", status: "done", summary: `${searches.length} searches, ${seen.size} sources read` };
      case "submit_progress": {
        const kb = Math.floor(p.bytes / 2048) * 2;
        if (kb <= writtenKb) return null;
        writtenKb = kb;
        return log("draft", `Writing the guide… ${kb} KB`);
      }
      default:
        return null;
    }
  };

  for (let turn = 0; turn < MAX_TURNS && !answer; turn += 1) {
    const body = { model: live.model, max_tokens: live.maxTokens, system: systemPrompt(today), tools: toolsFor(), messages };
    // After a nudge, require the answer: the only allowed tool call is submit_guide.
    if (nudged) body.tool_choice = { type: "tool", name: "submit_guide" };
    const request = streamMessages({ baseUrl: live.baseUrl, apiKey: live.apiKey, body, signal: ctx.signal, fetchImpl: ctx.fetchImpl });
    const gen = runTurn({ request, onProgress });
    let result;
    for (;;) {
      const { value, done } = await gen.next();
      if (done) {
        result = value;
        break;
      }
      if (value) {
        yield value;
        if (value.type === "stage" && value.id === "research" && value.status === "done") yield { type: "stage", id: "draft", status: "running" };
      }
    }
    const submit = result.content.find((b) => b.type === "tool_use" && b.name === "submit_guide");
    if (submit) {
      answer = submit.input;
      break;
    }
    if (result.stopReason === "pause_turn") {
      messages.push({ role: "assistant", content: result.content });
      yield log("research", "Long research turn paused by the API; resuming.");
      continue;
    }
    if (result.stopReason === "end_turn" && !nudged) {
      nudged = true;
      messages.push({ role: "assistant", content: result.content }, { role: "user", content: "Call submit_guide now with what you found." });
      continue;
    }
    throw new LiveAgentError(`The model stopped (${result.stopReason ?? "unknown"}) without submitting a guide.`, { code: "no_answer" });
  }
  if (!answer) throw new LiveAgentError("The model didn't submit a guide.", { code: "no_answer" });

  // Convert with the library's converter, then clamp and validate like any untrusted input.
  const profile = { ...answer, id: app.slug, n: null };
  const converted = fromProfile(profile, {
    headline: { headline: answer.headline, needGuide: answer.needGuide, firstShort: answer.firstShort, prodShort: answer.prodShort },
    path: classifyPath(profile),
    scope: { level: answer.scopeComplexity, why: answer.scopeComplexityWhy },
    lastChecked: today,
    kind: "generated",
  });
  const guide = finalizeGuide(sanitizeGuide({ ...converted, id: app.slug, kind: "generated", lastChecked: today }));
  // Generated guides are capped at Medium confidence until someone verifies them.
  if (guide.confidence === "High") guide.confidence = "Medium";
  const problems = validateGuide(guide);
  if (problems.length) throw new LiveAgentError(`The answer failed validation: ${problems[0]}`, { code: "invalid_answer" });
  return { guide, searches, sourcesRead: [...seen.entries()].map(([url, title]) => ({ url, title })) };
}
