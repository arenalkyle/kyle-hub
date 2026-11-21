export interface AcceptanceItem {
  /** Position among top-level checklist items (0-based). */
  index: number;
  text: string;
  checked: boolean;
}

export interface AcceptanceSummary {
  total: number;
  checked: number;
  items: AcceptanceItem[];
}

const HEADING = /^##[ \t]+Acceptance criteria[ \t]*\r?$/i;
const SECTION_END = /^#{1,2}[ \t]/;
/** Top-level only: no leading indentation, so nested bullets are ignored. */
const ITEM = /^[-*][ \t]+\[( |x|X)\][ \t]+(.*?)[ \t]*\r?$/;

interface Located {
  line: number;
  checked: boolean;
  text: string;
}

function locate(description: string): Located[] {
  const lines = description.split("\n");
  const start = lines.findIndex((l) => HEADING.test(l));
  if (start < 0) return [];
  const out: Located[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i]!;
    if (SECTION_END.test(l)) break;
    const m = ITEM.exec(l);
    if (m) out.push({ line: i, checked: m[1] !== " ", text: m[2]! });
  }
  return out;
}

/** Reads the `## Acceptance criteria` checklist from a ticket description. */
export function parseAcceptance(description: string): AcceptanceSummary {
  const items = locate(description).map((l, index) => ({ index, text: l.text, checked: l.checked }));
  return { total: items.length, checked: items.filter((i) => i.checked).length, items };
}

/** Returns the description with checklist item `index` ticked (or unticked). Throws when out of range. */
export function tickAcceptance(description: string, index: number, checked = true): string {
  const item = locate(description)[index];
  if (!item) throw new RangeError(`No acceptance criterion at index ${index}.`);
  const lines = description.split("\n");
  lines[item.line] = lines[item.line]!.replace(/\[( |x|X)\]/, checked ? "[x]" : "[ ]");
  return lines.join("\n");
}
