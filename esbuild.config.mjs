import esbuild from "esbuild";
import { builtinModules } from "node:module";
import { deploy } from "./scripts/deploy.mjs";
import { patchXterm } from "./scripts/patch-xterm.mjs";

const watch = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "es2022",
  outfile: "main.js",
  external: [
    "obsidian",
    "electron",
    // Obsidian ships these CodeMirror/Lezer packages; lang-markdown is not among them and gets bundled.
    "@codemirror/state",
    "@codemirror/view",
    "@codemirror/language",
    "@codemirror/commands",
    "@codemirror/autocomplete",
    "@codemirror/search",
    "@codemirror/lint",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtinModules,
    ...builtinModules.map((m) => `node:${m}`),
  ],
  logLevel: "info",
  sourcemap: watch ? "inline" : false,
  loader: { ".css": "text" },
  // React picks its build from NODE_ENV at runtime; Obsidian leaves it unset, so pin production.
  define: watch ? {} : { "process.env.NODE_ENV": "\"production\"" },
  plugins: [
    patchXterm,
    ...(watch
      ? [{
          name: "redeploy",
          setup(b) {
            b.onEnd((r) => {
              if (r.errors.length > 0) return;
              try { deploy(); } catch (e) { console.error(String(e.message ?? e)); }
            });
          },
        }]
      : []),
  ],
};

// node-pty is never bundled (kyle-term ADR-0001): it lives in helper/pty-host.js, shipped next to main.js by deploy.
/** @type {import('esbuild').BuildOptions} */
const cliOptions = {
  entryPoints: ["src/modules/tickets/cli/kt.ts"],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node18",
  outfile: "src/modules/tickets/cli/kt.js",
  banner: { js: "#!/usr/bin/env node" },
  logLevel: "info",
};

await esbuild.build(cliOptions);

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("watching...");
} else {
  await esbuild.build(options);
}
