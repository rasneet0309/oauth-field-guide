/**
 * Storage for generated guides, so a run can be shared as /g/<id>.
 *
 * Prototype-grade on purpose: one JSON file per guide in DATA_DIR/generated, an in-memory
 * index, oldest-first eviction past SHARE_STORE_MAX, and a 24-hour result cache keyed by
 * (engine, app, intent). If the directory isn't writable (a read-only container), it keeps
 * guides in memory and says so in the log. A production version would use a database or
 * object storage with per-tenant access control (see docs/PRODUCT.md → Scalability).
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const SHARE_ID_RE = /^[A-Za-z0-9_-]{12}$/;
const newId = () => randomBytes(9).toString("base64url"); // 12 chars, 72 bits: unguessable links

export function createStore({ dir, max = 2000, cacheTtlMs = 24 * 3_600_000, log = () => {} }) {
  const folder = path.join(dir, "generated");
  /** @type {Map<string, { createdAt: number, guide?: object }>} */
  const index = new Map();
  /** @type {Map<string, { id: string, at: number }>} */
  const cache = new Map();
  let disk = true;

  try {
    fs.mkdirSync(folder, { recursive: true });
    fs.accessSync(folder, fs.constants.W_OK);
    for (const f of fs.readdirSync(folder)) {
      const id = f.replace(/\.json$/, "");
      if (!f.endsWith(".json") || !SHARE_ID_RE.test(id)) continue;
      index.set(id, { createdAt: fs.statSync(path.join(folder, f)).mtimeMs });
    }
  } catch (err) {
    disk = false;
    log("warn", "share_store_memory_only", { reason: err.code ?? err.message });
  }

  function evict() {
    if (index.size <= max) return;
    const oldest = [...index.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt).slice(0, index.size - max);
    for (const [id] of oldest) {
      index.delete(id);
      if (disk) fs.rm(path.join(folder, `${id}.json`), { force: true }, () => {});
    }
  }

  return {
    persistent: () => disk,
    size: () => index.size,

    /** Store a finalized generated guide; returns its share id. */
    async save(guide) {
      let id = newId();
      while (index.has(id)) id = newId();
      const record = { id, createdAt: Date.now(), guide };
      if (disk) {
        try {
          await fs.promises.writeFile(path.join(folder, `${id}.json`), JSON.stringify(record), { flag: "wx" });
          index.set(id, { createdAt: record.createdAt });
        } catch (err) {
          disk = false;
          log("warn", "share_store_memory_only", { reason: err.code ?? err.message });
        }
      }
      if (!disk) index.set(id, { createdAt: record.createdAt, guide });
      evict();
      return id;
    },

    /** The stored guide for a share id, or null. Never throws on bad input or a damaged file. */
    async get(id) {
      if (!SHARE_ID_RE.test(String(id ?? "")) || !index.has(id)) return null;
      const entry = index.get(id);
      if (entry.guide) return entry.guide;
      try {
        const record = JSON.parse(await fs.promises.readFile(path.join(folder, `${id}.json`), "utf8"));
        return record?.guide && typeof record.guide === "object" ? record.guide : null;
      } catch {
        return null;
      }
    },

    /** A recent share id for the same request, so repeat runs are instant and free. */
    cached(key) {
      const hit = cache.get(key);
      if (!hit) return null;
      if (Date.now() - hit.at > cacheTtlMs || !index.has(hit.id)) {
        cache.delete(key);
        return null;
      }
      return hit.id;
    },
    remember(key, id) {
      cache.set(key, { id, at: Date.now() });
      if (cache.size > max) cache.delete(cache.keys().next().value);
    },
  };
}
