import path from "node:path";
import { appendLine, evidence, fileDiff, truncate } from "./diffs";
import type { Template } from "./types";

export const PACK_INCLUDE = ".kh/pack-include.txt";

/** `doc:<repo>:<path>` -> its parts (the path may contain `:`). */
export function docParts(signature: string): { repo: string; rel: string } {
  const rest = signature.slice("doc:".length);
  const i = rest.indexOf(":");
  return { repo: i < 0 ? "-" : rest.slice(0, i), rel: i < 0 ? rest : rest.slice(i + 1) };
}

export const startupDocsTemplate: Template = (cluster, ctx) => {
  const { repo, rel } = docParts(cluster.signature);
  const root = ctx.repoPath(repo === "-" ? undefined : repo);
  const title = truncate(`Pre-load ${rel} in the context pack${repo === "-" ? "" : ` (${repo})`}`, 100);
  if (root === undefined) {
    return { type: "finding", title, body: `\`${rel}\` was read at the start of ${cluster.count} runs, but its repo is not in the repo map.\n\n${evidence(cluster)}` };
  }
  const before = ctx.readFile(path.join(root, PACK_INCLUDE));
  if (before?.split(/\r?\n/).includes(rel)) {
    return { type: "finding", title, body: `\`${rel}\` is already in \`${PACK_INCLUDE}\`.\n\n${evidence(cluster)}` };
  }
  return {
    type: "proposal",
    title,
    body: `\`${rel}\` was read within the first calls of ${cluster.count} runs. Add it to \`${PACK_INCLUDE}\` so the context pack includes it.\n\nTarget: ${root}\n\n${evidence(cluster)}`,
    diff: fileDiff(PACK_INCLUDE, before, appendLine(before, rel)),
  };
};
