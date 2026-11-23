import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

const OTHER = ["tickets", "term", "brain", "commandCenter", "command-center"];

/** Modules may import only core: forbid reaching into any other module folder. */
const crossModule = (self) => ({
  files: [`src/modules/${self}/**/*.{ts,tsx}`],
  rules: {
    "no-restricted-imports": ["error", {
      patterns: OTHER.filter((m) => m !== self).map((m) => ({
        group: [`**/modules/${m}`, `**/modules/${m}/**`, `**/${m}`, `**/${m}/**`],
        message: `Module "${self}" may not import module "${m}"; go through core services/events (ADR-0002).`,
      })),
    }],
  },
});

export default tseslint.config(
  { linterOptions: { reportUnusedDisableDirectives: "off" } },
  { ignores: [".claude/**", "main.js", "node_modules/**", "dist/**", "**/*.mjs", "bin/**", "src/modules/term/helper/**", "src/modules/term/hooks/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/exhaustive-deps": "warn",
      "prefer-const": "off",
      "no-regex-spaces": "off",
      "@typescript-eslint/no-this-alias": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-expressions": "off",
      "@typescript-eslint/no-require-imports": "off",
      "no-empty": "off",
      "no-control-regex": "off",
      "no-useless-escape": "off",
      "no-prototype-builtins": "off",
      "no-case-declarations": "off",
    },
  },
  {
    files: ["src/core/**/*.{ts,tsx}"],
    ignores: ["src/core/domain/**"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{ group: ["**/modules/**"], message: "core may not import modules." }],
      }],
    },
  },
  {
    files: ["src/core/domain/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [
          { name: "obsidian", message: "core/domain is pure: no obsidian imports." },
          { name: "react", message: "core/domain is pure: no React." },
          { name: "react-dom", message: "core/domain is pure: no React." },
        ],
        patterns: [{ group: ["**/modules/**"], message: "core may not import modules." }],
      }],
    },
  },
  {
    files: ["cli/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [
          { name: "obsidian", message: "kh CLI is Obsidian-free (ADR-0003)." },
          { name: "react", message: "kh CLI is Obsidian-free (ADR-0003)." },
          { name: "react-dom", message: "kh CLI is Obsidian-free (ADR-0003)." },
        ],
      }],
    },
  },
  ...["tickets", "term", "brain", "commandCenter"].map(crossModule),
);
