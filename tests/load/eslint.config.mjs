import { base } from "../../eslint.config.base.mjs";

export default [
  // concurrent-users.js and recompute.js run inside k6's own JS runtime, not Node — they
  // import from "k6/http" (not a real npm package) and use k6 globals (__VU, __ENV, open).
  // The shared config's import/module resolution rules have no way to make sense of that.
  { ignores: ["*.js"] },
  ...base,
];
