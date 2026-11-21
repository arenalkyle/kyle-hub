import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vitest/config";

/** Mirrors esbuild's `.md: text` loader so brain templates import the same way in tests. */
const mdAsText: Plugin = {
  name: "md-as-text",
  enforce: "pre",
  load(id) {
    if (!id.endsWith(".md")) return null;
    return { code: `export default ${JSON.stringify(readFileSync(id, "utf8"))};`, map: null };
  },
};

export default defineConfig({
  plugins: [mdAsText],
  test: { include: ["test/**/*.test.ts", "src/**/*.test.ts", "cli/**/*.test.ts"] },
});
