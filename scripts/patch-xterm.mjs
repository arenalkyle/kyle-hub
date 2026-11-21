import { readFile } from "node:fs/promises";

/**
 * @xterm/addon-webgl builds its glyph-atlas font as `${style} ${weight} ${size}px ${family}`,
 * where `style` is "" for upright text, so the string starts with a space. Chromium 150+
 * (Obsidian 1.15 / Electron 43) rejects canvas `ctx.font` values with leading whitespace,
 * leaving the atlas at its default 10px sans-serif: tiny, proportional, "spread out" glyphs.
 */
const ATLAS_FONT = /\.font=`\$\{(\w+)\} \$\{(\w+)\} /g;

/** @param {string} src */
export function patchWebglAtlasFont(src) {
  let n = 0;
  const out = src.replace(ATLAS_FONT, (_m, style, weight) => {
    n++;
    return `.font=\`\${[${style},${weight}].filter(Boolean).join(" ")} `;
  });
  if (n === 0) throw new Error("patch-xterm: atlas font template not found in @xterm/addon-webgl (upgrade changed it?)");
  return out;
}

/** @type {import('esbuild').Plugin} */
export const patchXterm = {
  name: "patch-xterm",
  setup(b) {
    b.onLoad({ filter: /[\\/]@xterm[\\/]addon-webgl[\\/]lib[\\/].*\.m?js$/ }, async (args) => ({
      contents: patchWebglAtlasFont(await readFile(args.path, "utf8")),
      loader: "js",
    }));
  },
};
