/**
 * In-page API for the single-file demo (npm run build → dist/oauth-field-guide-demo.html).
 * Same interface as api.js, backed by the embedded library and the offline engine running
 * in the browser. There is no server, so: no discovery probe, no live agent, and share
 * links re-run the generator from the URL (the offline engine is deterministic).
 */
import { runOfflineAgent } from "../shared/engine/offline.js";
import { libraryPatterns, libraryStats } from "../shared/engine/patterns.js";
import { toSummary } from "../shared/guide-model.js";
import { makeLib } from "../shared/search.js";

export function createLocalApi(data) {
  const guides = data.guides;
  const byId = new Map(guides.map((g) => [g.id, g]));
  const featured = data.meta.featured;
  const summaries = guides.map((g) => ({ ...toSummary(g), featuredRank: featured.includes(g.id) ? featured.indexOf(g.id) : null }));
  const lib = makeLib(summaries);
  const patterns = libraryPatterns(guides);
  const categories = [...new Set(guides.map((g) => g.category))].sort();
  const generated = new Map();
  const base = `${location.href.split("#")[0]}#`;

  return {
    kind: "local",
    config: async () => ({
      name: "OAuth Field Guide",
      version: data.version,
      mode: "offline",
      runsIn: "page",
      live: null,
      discoveryProbe: false,
      limits: { maxInputLength: 120 },
      engine: { kind: "offline", label: "Offline research engine (in this page)" },
      shareStore: "none",
      library: { lastChecked: data.meta.lastChecked, featured, categories, stats: libraryStats(guides, patterns), total: guides.length },
    }),
    summaries: async () => summaries,
    guide: async (id) => byId.get(id) ?? null,
    shared: async (id) => generated.get(id) ?? null,
    async generate({ app, intent }, onEvent, signal) {
      const ctx = {
        lib,
        getGuide: (id) => byId.get(id),
        patterns,
        categories,
        pace: 1,
        signal,
        probeOffNote: "This single-file demo has no server, so it can't probe the provider's OAuth metadata. Run the server for that.",
      };
      for await (const ev of runOfflineAgent({ input: app, intent, ctx })) {
        if (signal?.aborted) return;
        if (ev.type === "guide" && !ev.matched) {
          // No server to store it: the "share link" is the generator URL, which reproduces it.
          const id = `local-${ev.guide.id}-${intent}`;
          generated.set(id, ev.guide);
          ev.shareLink = `${base}/generate?app=${encodeURIComponent(app)}&intent=${intent}`;
        }
        onEvent(ev);
      }
    },
    guideUrl: (id) => `${base}/guides/${encodeURIComponent(id)}`,
    shareUrl: () => "",
  };
}
