import { describe, expect, it } from "vitest";
import { BUILTIN_RULES, makeRedactor, redact } from "./redact";

const r = makeRedactor();

/** Each built-in rule: a positive sample that must be masked and a negative that must pass through. */
const CORPUS: ReadonlyArray<{ rule: string; pos: string; neg: string; expectPos: string }> = [
  { rule: "private-key", pos: "-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----", neg: "-----BEGIN PUBLIC KEY-----", expectPos: "[REDACTED:private-key]" },
  { rule: "aws-access-key", pos: "key AKIAIOSFODNN7EXAMPLE end", neg: "key AKIA123 end", expectPos: "key [REDACTED:aws-access-key] end" },
  { rule: "github-token", pos: "ghp_" + "a".repeat(36), neg: "ghp_short", expectPos: "[REDACTED:github-token]" },
  { rule: "anthropic-key", pos: "sk-ant-api03-" + "b".repeat(30), neg: "sk-ant-x", expectPos: "[REDACTED:anthropic-key]" },
  { rule: "openai-key", pos: "sk-proj-" + "c".repeat(30), neg: "sk-abc", expectPos: "[REDACTED:openai-key]" },
  { rule: "linear-token", pos: "lin_api_" + "D".repeat(24), neg: "lin_api_x", expectPos: "[REDACTED:linear-token]" },
  { rule: "jwt", pos: "eyJhbGciOi.eyJzdWIiOi.SflKxwRJSM", neg: "eyJhbGci only", expectPos: "[REDACTED:jwt]" },
  { rule: "bearer", pos: "Authorization: Bearer abcdefgh12345678", neg: "Bearer x", expectPos: "Authorization: Bearer [REDACTED:bearer]" },
  { rule: "connection-string", pos: "postgres://user:s3cret@host/db", neg: "https://example.com/path", expectPos: "postgres://user:[REDACTED:connection-string]@host/db" },
  { rule: "password", pos: "password=hunter2", neg: "passwordless mode", expectPos: "password=[REDACTED:password]" },
];

describe("built-in redaction rules", () => {
  it("covers every rule in the corpus", () => {
    expect(CORPUS.map((c) => c.rule).sort()).toEqual(BUILTIN_RULES.map((x) => x.name).sort());
  });

  it.each(CORPUS)("$rule masks positives", ({ pos, expectPos }) => {
    expect(r(pos)).toBe(expectPos);
  });

  it.each(CORPUS)("$rule leaves negatives alone", ({ neg }) => {
    expect(r(neg)).toBe(neg);
  });
});

describe("makeRedactor options", () => {
  it("masks env values of six characters or more, not shorter ones", () => {
    const f = makeRedactor({ envValues: ["abcdef-secret-123", "short"] });
    expect(f("v=abcdef-secret-123 s=short")).toBe("v=[REDACTED:env] s=short");
  });

  it("masks denylist entries literally, regex metacharacters included", () => {
    const f = makeRedactor({ denylist: ["a.b(c)"] });
    expect(f("x a.b(c) y axbxc")).toBe("x [REDACTED:denylist] y axbxc");
  });

  it("applies rules in order through redact()", () => {
    expect(redact("aa", [{ name: "t", pattern: /a/g, replacement: "b" }])).toBe("bb");
  });
});
