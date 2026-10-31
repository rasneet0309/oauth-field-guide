/**
 * Lint for correctness, not style: undefined names, unused code, accidental type coercion,
 * reassigned constants. Formatting is left to the editor (.editorconfig).
 */
import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["node_modules/", "dist/", ".data/", "coverage/", "test-results/"] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2024, sourceType: "module" },
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "prefer-const": "error",
      "no-var": "error",
      "array-callback-return": "error",
      "no-self-compare": "error",
      "no-template-curly-in-string": "error",
      "no-unreachable-loop": "error",
      "no-unmodified-loop-condition": "error",
    },
  },
  // Browser code; public/shared runs in the browser and in Node.
  { files: ["public/**/*.js"], languageOptions: { globals: { ...globals.browser } } },
  { files: ["public/app/theme-boot.js"], languageOptions: { sourceType: "script" } },
  { files: ["public/shared/**/*.js", "src/**/*.js", "scripts/**/*.mjs", "tests/**/*.js", "eslint.config.js"], languageOptions: { globals: { ...globals.node } } },
  // Browser tests pass callbacks to page.evaluate(), which run in the page.
  { files: ["tests/e2e/**/*.js"], languageOptions: { globals: { ...globals.browser, ...globals.node } } },
];
