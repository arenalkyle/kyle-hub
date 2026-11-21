export interface RedactRule {
  name: string;
  pattern: RegExp;
  replacement: string;
}

/** Stub: applies the given rules in order. Real rule set lands in 4.1. */
export function redact(text: string, rules: readonly RedactRule[] = []): string {
  let out = text;
  for (const r of rules) out = out.replace(r.pattern, r.replacement);
  return out;
}
