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
  external: ["obsidian", "electron", ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
  logLevel: "info",
  sourcemap: watch ? "inline" : false,
  loader: { ".css": "text" },
  plugins: [
    patchXterm,
    ...(watch
      ? [{ name: "redeploy", setup(b) { b.onEnd((r) => { if (r.errors.length === 0) { try { deploy(); } catch (e) { console.error(String(e.message ?? e)); } } }); } }]
      : []),
  ],
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("watching…");
} else {
  await esbuild.build(options);
}
