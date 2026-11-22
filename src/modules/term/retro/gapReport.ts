import fs from "node:fs";
import path from "node:path";
import { parseGapsReport, type GapsReport } from "../../../core/domain/gaps";
import { parseGradingConfig, type GradingConfig } from "../../../core/domain/grading";
import { GAPS_DIR, GRADING_FILE } from "../../../core/gaps/gather";

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
