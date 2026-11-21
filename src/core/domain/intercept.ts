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

/** True when `path` is a project file directly inside `<folder>/Projects/`. */
export function isProjectPath(path: string, folder: string): boolean {
  const root = folder.replace(/^\/+|\/+$/g, "");
  if (root === "") return false;
  const prefix = `${root}/Projects/`;
  return path.startsWith(prefix) && path.endsWith(".md") && !path.slice(prefix.length).includes("/");
}

export type InterceptTarget = "issue" | "project";

/** Pure decision: which custom view (if any) should replace a `markdown` view state for this file? */
export function interceptTarget(i: InterceptInput): InterceptTarget | null {
  if (i.forcedMarkdown) return null;
  if (isIssuePath(i.path, i.folder)) return "issue";
  if (isProjectPath(i.path, i.folder)) return "project";
  return null;
}

/** Pure decision: should a `markdown` view state for this file become the issue view? */
export function shouldIntercept(i: InterceptInput): boolean {
  return interceptTarget(i) === "issue";
}
