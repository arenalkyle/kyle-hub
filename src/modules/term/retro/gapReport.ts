import fs from "node:fs";
import path from "node:path";
import { GAPS_VERSION, type EmptySearchGap, type GapsReport, type GradedNote, type LargeFolder } from "../../../core/domain/gaps";
import { parseGradingConfig, type GradingConfig } from "../../../core/domain/grading";
import { GAPS_DIR, GRADING_FILE } from "../../../core/gaps/gather";

const GRADES: ReadonlySet<string> = new Set(["A", "B", "C", "D", "F"]);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const rows = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isObj) : []);

/**
 * Validates the fields the Retro detectors read; rows missing them are dropped. Other fields are trusted as LOCK-68 wrote them.
 * Returns undefined when the report is not a version-1 gaps report.
 */
export function parseGapsReport(raw: unknown): GapsReport | undefined {
  if (!isObj(raw) || raw.version !== GAPS_VERSION) return undefined;
  const grades = rows(raw.grades).filter(
    (g) => str(g.path) && typeof g.grade === "string" && GRADES.has(g.grade) && num(g.score) && num(g.words) && num(g.ageDays),
  ) as unknown as GradedNote[];
  const emptySearches = rows(raw.emptySearches).filter((e) => str(e.root) && num(e.count) && num(e.totalMs)) as unknown as EmptySearchGap[];
  const largeFolders = rows(raw.largeFolders).filter((f) => str(f.folder) && num(f.notes) && num(f.avgWords)) as unknown as LargeFolder[];
  return { ...(raw as unknown as GapsReport), grades, emptySearches, largeFolders };
}

/** The report and the vault's grading config (defaults when missing or invalid). Undefined when there is no valid report: no gap proposals. */
export function readGapInputs(vaultRoot: string): { report: GapsReport; grading: GradingConfig } | undefined {
  let report: GapsReport | undefined;
  try {
    report = parseGapsReport(JSON.parse(fs.readFileSync(path.join(vaultRoot, GAPS_DIR, "latest.json"), "utf8")));
  } catch {
    return undefined;
  }
  if (report === undefined) return undefined;
  let text: string | undefined;
  try {
    text = fs.readFileSync(path.join(vaultRoot, GRADING_FILE), "utf8");
  } catch {
    text = undefined;
  }
  return { report, grading: parseGradingConfig(text).config };
}
