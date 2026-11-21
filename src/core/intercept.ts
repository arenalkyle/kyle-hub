export interface InterceptInput {
  /** Vault path of the file being opened. */
  path: string;
  /** Tickets root folder from settings (e.g. `Tickets`). */
  folder: string;
  /** The leaf was explicitly switched to the Markdown editor for this path. */
  forcedMarkdown: boolean;
}

/** True when `path` is a ticket file directly inside `<folder>/Issues/`. */
export function isIssuePath(path: string, folder: string): boolean {
  const root = folder.replace(/^\/+|\/+$/g, "");
  if (root === "") return false;
  const prefix = `${root}/Issues/`;
  return path.startsWith(prefix) && path.endsWith(".md") && !path.slice(prefix.length).includes("/");
}

/** Pure decision: should a `markdown` view state for this file become the issue view? */
export function shouldIntercept(i: InterceptInput): boolean {
  return !i.forcedMarkdown && isIssuePath(i.path, i.folder);
}
