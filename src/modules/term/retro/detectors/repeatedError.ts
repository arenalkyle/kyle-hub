import { maskSignature } from "../normalize";
import { signalOf, str, type PerRunDetector } from "./common";

/** `err:<tool>:<sigText>` for every failed tool result. */
export const repeatedError: PerRunDetector = (run, records) =>
  records.flatMap((r) => {
    if (r.type !== "error") return [];
    const tool = str(r.tool) ?? "unknown";
    return [signalOf(run, "repeated_error", `err:${tool}:${maskSignature(str(r.sigText) ?? "")}`, r.t)];
  });
