import type { TicketType } from "../../../../core/domain/fields";
import type { Cluster } from "../types";

export interface TemplateContext {
  /** The Claude config dir (`~/.claude`). */
  claudeHome: string;
  /** Absolute path of a repo-map key, when known. */
  repoPath(key: string | undefined): string | undefined;
  /** File text, or undefined when the file does not exist or cannot be read. */
  readFile(absPath: string): string | undefined;
}

export interface TemplateResult {
  type: Extract<TicketType, "proposal" | "finding">;
  title: string;
  /** Markdown: summary, `Target: <root>` (proposals) and evidence. The diff block is appended by the retro run. */
  body: string;
  /** Unified diff with `a/`/`b/` paths relative to the target root. */
  diff?: string;
}

export type Template = (cluster: Cluster, ctx: TemplateContext) => TemplateResult;
