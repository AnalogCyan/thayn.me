import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["public/**"] },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.node,
    },
    rules: {
      "no-unused-vars": "warn",
      "no-console": "off",
      // new in eslint 10, both flag existing defensive code
      "no-useless-assignment": "warn",
      "preserve-caught-error": "warn",
    },
  },
  {
    // The syndication state machine writes a dirty flag from ~30 branches and
    // reads it once. Later unconditional writes make some earlier ones
    // redundant, but they are correct and self-documenting, and proving each
    // removal safe is not worth touching a live publishing path.
    files: ["netlify/post-deploy/**/*.js"],
    rules: { "no-useless-assignment": "off" },
  },
  {
    files: ["**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: globals.node,
    },
  },
  {
    files: ["src/**/*.js"],
    languageOptions: {
      globals: globals.browser,
    },
  },
];
