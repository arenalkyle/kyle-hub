import { maskSignature } from "../normalize";
import { signalOf, str, type PerRunDetector } from "./common";

/** `perm:<tool>:<pattern>` for every denied tool call. */
export const permissionDenied: PerRunDetector = (run, records) =>
  records.flatMap((r) => {
    if (r.type !== "permission_denied") return [];
    const tool = str(r.tool) ?? "unknown";
    return [signalOf(run, "permission_denied", `perm:${tool}:${maskSignature(str(r.pattern) ?? tool)}`, r.t)];
  });
