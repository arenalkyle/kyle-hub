/** Note graph for the 3D brain: pure, shared by tests and the brain module. */
export type BrainNodeKind = "note" | "folder";
export type BrainEdgeKind = "link" | "tree";

export interface BrainGraph {
  /** Vault-relative note paths; node index = array index. Folder nodes end in `/`; the vault root is `/`. */
  paths: string[];
  /** Undirected edges as index pairs (a < b), deduplicated; self links dropped. */
  edges: [number, number][];
  /** Edge count per node. */
  degree: number[];
  /** Node kind per node (all `note` unless built with `withFolders`). */
  kinds: BrainNodeKind[];
  /** Edge kind per edge: `link` (wikilink or frontmatter reference) or `tree` (note to folder, folder to parent). */
  edgeKinds: BrainEdgeKind[];
}

/** The vault root's folder node. */
export const ROOT_FOLDER = "/";

/** `resolvedLinks` is the metadata cache map (source path to target path to count). Non-note targets are ignored. */
export function buildGraph(notePaths: readonly string[], resolvedLinks: Readonly<Record<string, Readonly<Record<string, number>>>>): BrainGraph {
  const paths = [...new Set(notePaths)].sort();
  const index = new Map(paths.map((p, i) => [p, i] as const));
  const seen = new Set<number>();
  const edges: [number, number][] = [];
  const degree = new Array<number>(paths.length).fill(0);
  for (const [src, targets] of Object.entries(resolvedLinks)) {
    const a = index.get(src);
    if (a === undefined) continue;
    for (const dst of Object.keys(targets)) {
      const b = index.get(dst);
      if (b === undefined || b === a) continue;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const key = lo * paths.length + hi;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push([lo, hi]);
      degree[lo]!++;
      degree[hi]!++;
    }
  }
  return { paths, edges, degree, kinds: paths.map(() => "note"), edgeKinds: edges.map(() => "link") };
}

/** Folder node path of a note or folder node: `a/b/c.md` → `a/b/`, `a/b/` → `a/`, top level → `/`. */
export function parentFolder(path: string): string {
  const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
  const i = trimmed.lastIndexOf("/");
  return i < 0 ? ROOT_FOLDER : trimmed.slice(0, i + 1);
}

/**
 * Adds one node per folder (plus the root `/`) after the note nodes, with `tree` edges note → folder and
 * folder → parent folder, so every note is connected and folders form visible clusters.
 */
export function withFolders(graph: BrainGraph): BrainGraph {
  const notes = graph.paths.filter((_, i) => graph.kinds[i] === "note");
  if (notes.length === 0) return graph;
  const folders = new Set<string>([ROOT_FOLDER]);
  for (const p of notes) {
    for (let f = parentFolder(p); f !== ROOT_FOLDER; f = parentFolder(f)) folders.add(f);
  }
  const folderList = [...folders].sort();
  const paths = [...graph.paths, ...folderList];
  const index = new Map(paths.map((p, i) => [p, i] as const));
  const edges = [...graph.edges];
  const edgeKinds = [...graph.edgeKinds];
  const degree = [...graph.degree, ...folderList.map(() => 0)];
  const add = (a: number, b: number): void => {
    edges.push([Math.min(a, b), Math.max(a, b)]);
    edgeKinds.push("tree");
    degree[a]!++;
    degree[b]!++;
  };
  graph.paths.forEach((p, i) => {
    if (graph.kinds[i] === "note") add(i, index.get(parentFolder(p))!);
  });
  for (const f of folderList) if (f !== ROOT_FOLDER) add(index.get(f)!, index.get(parentFolder(f))!);
  return { paths, edges, degree, kinds: [...graph.kinds, ...folderList.map((): BrainNodeKind => "folder")], edgeKinds };
}

/** True when node `path` (note or folder) sits inside folder node `folder` (the root contains everything). */
export function inFolder(path: string, folder: string): boolean {
  return folder === ROOT_FOLDER || path.startsWith(folder);
}

/** Display name: note basename without `.md`, folder name without the slash, `Vault` for the root. */
export function nodeLabel(path: string): string {
  if (path === ROOT_FOLDER) return "Vault";
  const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
  const base = trimmed.slice(trimmed.lastIndexOf("/") + 1);
  return base.endsWith(".md") ? base.slice(0, -3) : base;
}

/** Note text for a hover card: frontmatter removed, markdown noise flattened, whitespace collapsed, capped. */
export function noteSnippet(text: string, max = 220): string {
  let body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (body.startsWith("---")) {
    const end = body.indexOf("\n---", 3);
    if (end >= 0) body = body.slice(body.indexOf("\n", end + 4) + 1 || body.length);
  }
  const flat = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[\[[^\]]*\]\]/g, " ")
    .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > max ? `${flat.slice(0, max).trimEnd()}…` : flat;
}

/**
 * Frontmatter references as extra links: every string (or string-array item) value whose text resolves to a note,
 * e.g. a ticket's `project: Test Project` or `parent: LOCK-9`. `resolve` maps a link text to a note path.
 * Keys that only name the note itself are skipped.
 */
export function frontmatterRefs(
  frontmatter: Readonly<Record<string, unknown>> | undefined,
  source: string,
  resolve: (linkText: string) => string | undefined,
): string[] {
  if (!frontmatter) return [];
  const out = new Set<string>();
  for (const [key, value] of Object.entries(frontmatter)) {
    if (SELF_KEYS.has(key.toLowerCase())) continue;
    for (const v of Array.isArray(value) ? value : [value]) {
      if (typeof v !== "string") continue;
      const text = v.replace(/^\[\[|\]\]$/g, "").split("|")[0]!.trim();
      if (text.length === 0 || text.length > 200) continue;
      const hit = resolve(text);
      if (hit && hit !== source) out.add(hit);
    }
  }
  return [...out];
}

const SELF_KEYS = new Set(["id", "title", "aliases", "alias", "tags", "tag", "status", "type", "created", "updated", "cssclasses"]);
