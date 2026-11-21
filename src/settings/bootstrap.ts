import type { DataAdapter } from "obsidian";

export const MARKER_NAME = ".kyle-tickets.json";
export const BASE_NAME = "All Issues.base";

export function baseFileContent(folder: string): string {
  return [
    "filters:",
    "  and:",
    `    - file.inFolder("${folder}/Issues")`,
    "views:",
    "  - type: table",
    "    name: All Issues",
    "    order:",
    ...["id", "title", "status", "priority", "project", "due", "tags", "created"].map((c) => `      - ${c}`),
    "    sort:",
    "      - property: created",
    "        direction: DESC",
    "",
  ].join("\n");
}

export function markerContent(prefix: string): string {
  return JSON.stringify({ prefix, version: 1 }, null, 2) + "\n";
}

async function ensureFolder(adapter: DataAdapter, path: string): Promise<void> {
  let cur = "";
  for (const seg of path.split("/")) {
    cur = cur ? `${cur}/${seg}` : seg;
    if (!(await adapter.exists(cur))) await adapter.mkdir(cur);
  }
}

async function ensureFile(adapter: DataAdapter, path: string, content: string): Promise<void> {
  if (!(await adapter.exists(path))) await adapter.write(path, content);
}

/** Idempotent: creates only what is missing; never overwrites. */
export async function bootstrapFolder(adapter: DataAdapter, folder: string, prefix: string): Promise<void> {
  await ensureFolder(adapter, `${folder}/Issues`);
  await ensureFolder(adapter, `${folder}/Projects`);
  await ensureFile(adapter, `${folder}/${BASE_NAME}`, baseFileContent(folder));
  await ensureFile(adapter, `${folder}/${MARKER_NAME}`, markerContent(prefix));
}
