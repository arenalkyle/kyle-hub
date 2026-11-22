/** Note graph for the 3D brain: pure, shared by tests and the brain module. */
export interface BrainGraph {
  /** Vault-relative note paths; node index = array index. */
  paths: string[];
  /** Undirected edges as index pairs (a < b), deduplicated; self links dropped. */
  edges: [number, number][];
  /** Edge count per node. */
  degree: number[];
}

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
  return { paths, edges, degree };
}
