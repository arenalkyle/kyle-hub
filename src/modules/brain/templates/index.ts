import type { DocType } from "../../../core/brain/doctypes";
import adr from "./adr.md";
import glossary from "./glossary.md";
import lesson from "./lesson.md";
import overview from "./overview.md";
import plan from "./plan.md";
import runbook from "./runbook.md";
import status from "./status.md";
import ticket from "./ticket.md";
import reminder from "./reminder.md";
import proposal from "./proposal.md";

/** Template text per doc type; placeholders are filled by `renderTemplate`. */
export const TEMPLATES: Record<DocType, string> = { adr, glossary, plan, status, runbook, lesson, overview, ticket, reminder, proposal };
