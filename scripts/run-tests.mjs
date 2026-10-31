#!/usr/bin/env node
/**
 * Run every *.test.js file in a directory with node:test. Passing explicit file paths works
 * the same on Node 20 (no glob support) and Node 22+ (where a bare directory is rejected).
 *   node scripts/run-tests.mjs tests/unit
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2] ?? "tests/unit";
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".test.js"))
  .sort()
  .map((f) => path.join(dir, f));
if (!files.length) {
  console.error(`No *.test.js files in ${dir}`);
  process.exit(1);
}
const { status } = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exit(status ?? 1);
