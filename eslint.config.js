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
