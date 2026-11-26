import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** A path typed into a shell the way a terminal drop does it: quoted on Windows, spaces escaped elsewhere. */
export function quotePath(p: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") return /[\s&()^;,'`]/.test(p) ? `"${p}"` : p;
  return p.replace(/([^\w@%+=:,./-])/g, "\$1");
}

/** Several paths, space separated, with a trailing space so the next one doesn't run on. */
export function quotePaths(paths: readonly string[], platform: NodeJS.Platform = process.platform): string {
  return paths.length === 0 ? "" : `${paths.map((p) => quotePath(p, platform)).join(" ")} `;
}

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/bmp": "bmp" };

/** Where pasted images are saved; Claude (and any CLI) gets the file path. Old files are left to the OS temp cleanup. */
export const PASTE_DIR = path.join(os.tmpdir(), "kyle-hub-paste");

/** Save a pasted image to a temp file and return its path. */
export async function saveImage(blob: Blob, dir = PASTE_DIR, now = new Date()): Promise<string> {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `paste-${stamp}.${EXT[blob.type] ?? "png"}`);
  fs.writeFileSync(file, Buffer.from(await blob.arrayBuffer()));
  return file;
}

/** First image in a clipboard event / drop, if it carries no text. */
export function imageFrom(dt: DataTransfer | null): File | null {
  if (!dt || dt.getData("text/plain")) return null;
  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind === "file" && item.type.startsWith("image/")) return item.getAsFile();
  }
  return null;
}

/** Absolute path of a file dropped from Explorer/Finder (Electron), or null for in-memory files. */
export function osPathOf(file: File): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require("electron") as { webUtils?: { getPathForFile(f: File): string } };
    const p = electron.webUtils?.getPathForFile(file);
    if (p) return p;
  } catch { /* older Electron */ }
  return (file as File & { path?: string }).path || null;
}
