export interface RedactRule {
  name: string;
  pattern: RegExp;
  replacement: string;
}

/** Applies the given rules in order. Each match becomes its replacement (`$n` groups supported). */
export function redact(text: string, rules: readonly RedactRule[] = []): string {
  let out = text;
  for (const r of rules) out = out.replace(r.pattern, r.replacement);
  return out;
}

const tag = (name: string): string => `[REDACTED:${name}]`;

/** Built-in secret rules, ordered: more specific token shapes first. */
export const BUILTIN_RULES: readonly RedactRule[] = [
  { name: "private-key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, replacement: tag("private-key") },
  { name: "aws-access-key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, replacement: tag("aws-access-key") },
  { name: "github-token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/g, replacement: tag("github-token") },
  { name: "anthropic-key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/g, replacement: tag("anthropic-key") },
  { name: "openai-key", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g, replacement: tag("openai-key") },
  { name: "linear-token", pattern: /\blin_(?:api|oauth)_[A-Za-z0-9]{20,}\b/g, replacement: tag("linear-token") },
  { name: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, replacement: tag("jwt") },
  { name: "bearer", pattern: /\b(Bearer\s+)[A-Za-z0-9._~+/-]{8,}=*/gi, replacement: `$1${tag("bearer")}` },
  { name: "connection-string", pattern: /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+@/gi, replacement: `$1${tag("connection-string")}@` },
  { name: "password", pattern: /\b((?:password|passwd|pwd|secret|api[_-]?key)\s*[=:]\s*)[^\s"']+/gi, replacement: `$1${tag("password")}` },
];

export interface RedactOptions {
  /** Literal values (e.g. from the run repo's `.env*` files) to mask wherever they appear. */
  envValues?: readonly string[];
  /** User denylist: literal strings from settings. */
  denylist?: readonly string[];
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Builds a redactor: literal values first (env, denylist), then the built-in rules. */
export function makeRedactor(opts: RedactOptions = {}): (text: string) => string {
  const literal = (name: string) => (v: string): RedactRule => ({ name, pattern: new RegExp(escapeRe(v), "g"), replacement: tag(name) });
  const rules: RedactRule[] = [
    ...(opts.envValues ?? []).filter((v) => v.length >= 6).map(literal("env")),
    ...(opts.denylist ?? []).filter((v) => v.length > 0).map(literal("denylist")),
    ...BUILTIN_RULES,
  ];
  return (text: string) => redact(text, rules);
}
