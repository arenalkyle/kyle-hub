export { detect, gatherInput, type GatherOptions } from "./detect";
export { DEFAULT_RETRO_CONFIG, resolveRetroConfig } from "./config";
export { commitRetro, readRetroState, retroFile, sessionsSinceRetro, writeRetroStateAtomic, RETRO_FILE, type RetroState, type RetroHistoryEntry } from "./state";
export { maskSignature } from "./normalize";
export type { Cluster, DetectInput, DetectResult, LogReader, RetroConfig, Signal, SignalKind } from "./types";
