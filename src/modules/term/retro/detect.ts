import type { DerivedRecord, Profile } from "../../../core/logs/types";
import { cluster } from "./cluster";
import { commandSequence } from "./detectors/commandSequence";
import { permissionDenied } from "./detectors/permissionDenied";
import { repeatedError } from "./detectors/repeatedError";
import { startupDocs } from "./detectors/startupDocs";
import { userCorrection } from "./detectors/userCorrection";
import { outliers } from "./detectors/outlier";
import type { PerRunDetector } from "./detectors/common";
import type { DetectInput, DetectResult, LogReader, RetroConfig, Signal } from "./types";

const PER_RUN: readonly PerRunDetector[] = [repeatedError, permissionDenied, commandSequence, userCorrection, startupDocs];

const after = (start: string, watermark: string | undefined): boolean =>
  watermark === undefined || Date.parse(start) > Date.parse(watermark);

/** Pure: signals from the runs after the watermark, then clusters. Reads nothing and writes nothing. */
export function detect(input: DetectInput): DetectResult {
  const runs = input.runs
    .filter((r) => after(r.start, input.watermark))
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0));
  const signals: Signal[] = [];
  for (const run of runs) {
    const records: readonly DerivedRecord[] = input.records.get(run.runId) ?? [];
    for (const d of PER_RUN) signals.push(...d(run, records, input.config));
  }
  signals.push(...outliers(runs, input.config, input.ticketTypes ?? new Map()));
  return { signals, clusters: cluster(signals, input.config) };
}

export interface GatherOptions {
  config: RetroConfig;
  watermark?: string;
  profile?: Profile;
  ticketTypes?: ReadonlyMap<string, string>;
}

/** Reads the runs after the watermark (and their records) through a LogReader, ready for `detect`. */
export async function gatherInput(reader: LogReader, opts: GatherOptions): Promise<DetectInput> {
  const runs = (await reader.runs({ since: opts.watermark }))
    .filter((r) => (opts.profile === undefined || r.profile === opts.profile) && after(r.start, opts.watermark));
  const records = new Map<string, DerivedRecord[]>();
  for (const run of runs) {
    const list: DerivedRecord[] = [];
    for await (const rec of reader.records(run.runId)) list.push(rec);
    records.set(run.runId, list);
  }
  return { runs, records, config: opts.config, watermark: opts.watermark, ticketTypes: opts.ticketTypes };
}

