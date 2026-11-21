import path from "node:path";
import { evidence, fileDiff, targetRoot, truncate } from "./diffs";
import type { Template } from "./types";

/** `perm:<tool>:<masked pattern>` -> `Tool(pattern)` with masked parts as wildcards. */
export function permissionRule(signature: string): string {
  const rest = signature.slice("perm:".length);
  const i = rest.indexOf(":");
  const tool = i < 0 ? rest : rest.slice(0, i);
  const pattern = i < 0 ? "" : rest.slice(i + 1);
  const p = pattern.replace(/<[a-z]+>/g, "*").replace(/\*(?:\s*\*)+/g, "*").trim();
  return p === "" || p === tool ? tool : `${tool}(${p})`;
}

const indentOf = (text: string): string | number => /^([ \t]+)"/m.exec(text)?.[1] ?? 2;

/** The settings file text with `rule` in `permissions.allow`; undefined when unreadable or already allowed. */
export function withAllowRule(before: string | undefined, rule: string): string | undefined {
  let doc: Record<string, unknown> = {};
  if (before !== undefined && before.trim() !== "") {
    try {
      const parsed: unknown = JSON.parse(before);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
      doc = parsed as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }
  const perms = typeof doc.permissions === "object" && doc.permissions !== null && !Array.isArray(doc.permissions) ? (doc.permissions as Record<string, unknown>) : {};
  const allow = Array.isArray(perms.allow) ? (perms.allow as unknown[]) : [];
  if (allow.includes(rule)) return undefined;
  doc.permissions = { ...perms, allow: [...allow, rule] };
  return `${JSON.stringify(doc, null, before !== undefined ? indentOf(before) : 2)}\n`;
}

export const permissionDeniedTemplate: Template = (cluster, ctx) => {
  const rule = permissionRule(cluster.signature);
  const { root, repo } = targetRoot(cluster, ctx);
  const rel = repo !== undefined ? ".claude/settings.json" : "settings.json";
  const before = ctx.readFile(path.join(root, rel));
  const after = withAllowRule(before, rule);
  const title = truncate(`Allow ${rule} without prompting`, 100);
  if (after === undefined) {
    return {
      type: "finding",
      title,
      body: `Permission denied ${cluster.count}x, but \`${rel}\` could not be changed automatically (unreadable JSON, or the rule is already there).\n\nRule: \`${rule}\`\n\n${evidence(cluster)}`,
    };
  }
  return {
    type: "proposal",
    title,
    body: `Add \`${rule}\` to \`permissions.allow\` in \`${rel}\`. It was denied ${cluster.count}x across ${cluster.sessions.length} sessions.\n\nTarget: ${root}\n\n${evidence(cluster)}`,
    diff: fileDiff(rel, before, after),
  };
};
