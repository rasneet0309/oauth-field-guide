/**
 * Theme: follows the OS until the visitor picks one; the choice is remembered. The saved
 * choice is applied before first paint by /app/theme-boot.js (a blocking classic script).
 */
import { read, write } from "./storage.js";

const isTheme = (v) => v === "light" || v === "dark";

export function currentTheme() {
  const set = document.documentElement.dataset.theme;
  if (isTheme(set)) return set;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function toggleTheme() {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  write("theme", next);
  return next;
}

export const savedTheme = () => read("theme", isTheme, null);
