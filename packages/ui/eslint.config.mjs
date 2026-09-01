import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

/**
 * React/browser code, like apps/web — the Node base in eslint.config.base.mjs would
 * fail every DOM/JSX reference in this package. No react-refresh here: that plugin
 * enforces Vite's fast-refresh contract, which only matters for an app entry, not a
 * component library nothing HMRs directly.
 */
export default defineConfig([
  globalIgnores(["dist"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
]);
