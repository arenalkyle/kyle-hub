import type { Cluster } from "../types";
import { commandSequenceTemplate } from "./sequence";
import { outlierTemplate, repeatedErrorTemplate, userCorrectionTemplate } from "./findings";
import { permissionDeniedTemplate } from "./permission";
import { startupDocsTemplate } from "./startupDocs";
import type { Template, TemplateContext, TemplateResult } from "./types";

const TEMPLATES: Record<Cluster["kind"], Template> = {
  permission_denied: permissionDeniedTemplate,
  command_sequence: commandSequenceTemplate,
  startup_docs: startupDocsTemplate,
  repeated_error: repeatedErrorTemplate,
  outlier: outlierTemplate,
  user_correction: userCorrectionTemplate,
};

/** No LLM: each signal kind maps to a template (ADR-0006). */
export const renderTemplate = (cluster: Cluster, ctx: TemplateContext): TemplateResult => TEMPLATES[cluster.kind](cluster, ctx);

export type { Template, TemplateContext, TemplateResult } from "./types";
export { addedLines, appendLine, fileDiff, targetRoot } from "./diffs";
export { MAX_SCRIPT_LINES, scriptText, slugOf } from "./sequence";
export { permissionRule } from "./permission";
