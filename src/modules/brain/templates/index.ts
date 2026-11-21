import type { DocType } from "../../../core/brain/doctypes";
import adr from "./adr.md";
import glossary from "./glossary.md";
import lesson from "./lesson.md";
import overview from "./overview.md";
import plan from "./plan.md";
import runbook from "./runbook.md";
import status from "./status.md";

/** Template text per doc type; placeholders are filled by `renderTemplate`. */
export const TEMPLATES: Record<DocType, string> = { adr, glossary, plan, status, runbook, lesson, overview };
