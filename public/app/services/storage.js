/**
 * localStorage that never throws and validates what it reads. Storage is a per-browser
 * convenience (theme, checklist ticks, recent generations); nothing depends on it working.
 */
const PREFIX = "ofg3:";

function store() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function read(key, validate, fallback) {
  try {
    const raw = store()?.getItem(PREFIX + key);
    if (raw == null) return fallback;
    const value = JSON.parse(raw);
    return validate(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

/** @returns {boolean} whether the value was saved */
export function write(key, value) {
  try {
    store()?.setItem(PREFIX + key, JSON.stringify(value));
    return Boolean(store());
  } catch {
    return false;
  }
}

export function remove(key) {
  try {
    store()?.removeItem(PREFIX + key);
  } catch {
    /* storage blocked */
  }
}

const isStringList = (v, max) => Array.isArray(v) && v.length <= max && v.every((x) => typeof x === "string" && x.length < 64);

/** Ticked checklist items for one guide, keyed by content hash so ticks follow their step. */
export const checks = {
  get: (guideKey) => new Set(read(`check:${guideKey}`, (v) => isStringList(v, 500), [])),
  set: (guideKey, set) => write(`check:${guideKey}`, [...set].slice(-500)),
};

const RECENT_MAX = 8;
const isRecent = (v) =>
  Array.isArray(v) &&
  v.length <= RECENT_MAX &&
  v.every(
    (r) =>
      r &&
      /^[A-Za-z0-9_-]{12}$/.test(r.id) &&
      typeof r.name === "string" &&
      r.name.length <= 160 &&
      typeof r.at === "number" &&
      (r.app === undefined || (typeof r.app === "string" && r.app.length <= 120)) &&
      (r.intent === undefined || /^[a-z]{1,12}$/.test(r.intent)),
  );

/** The visitor's recent generated guides (share ids), newest first. */
export const recent = {
  list: () => read("recent", isRecent, []),
  add(entry) {
    const clean = { id: entry.id, name: String(entry.name).slice(0, 120), at: entry.at };
    if (typeof entry.app === "string" && entry.app) clean.app = entry.app.slice(0, 120);
    if (typeof entry.intent === "string" && /^[a-z]{1,12}$/.test(entry.intent)) clean.intent = entry.intent;
    const next = [clean, ...recent.list().filter((r) => r.id !== clean.id)].slice(0, RECENT_MAX);
    write("recent", next);
    return next;
  },
};
