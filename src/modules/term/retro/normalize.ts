const MAX_SIGNATURE = 200;

/**
 * Masks the variable parts of an already-normalized error text (ADR-0006 signatures).
 * Input is `normalizeSig` output, so numbers and paths are already `<num>` / `<path>`; this also masks
 * timestamps and hex hashes that `normalizeSig` leaves in place.
 */
export function maskSignature(text: string): string {
  return text
    .replace(/(?:<num>|\d+)-(?:<num>|\d+)-(?:<num>|\d+)[T ](?:<num>|\d+):(?:<num>|\d+)(?::(?:<num>|\d+)(?:\.(?:<num>|\d+))?)?Z?/g, "<ts>")
    .replace(/(?:[A-Za-z]:)?[\/][^\s"'`:]+/g, "<path>")
    .replace(/\b[0-9a-f]{7,}\b/gi, "<hash>")
    .replace(/\b\d+\b/g, "<num>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SIGNATURE);
}
