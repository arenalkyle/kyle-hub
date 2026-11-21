/** Reads back what the templates wrote into a retro ticket body. */

/** `Target: <root>` line. */
export function parseTarget(description: string): string | undefined {
  return /^Target: (.+?)\s*$/m.exec(description)?.[1];
}

/** First fenced ```diff block. */
export function parseDiff(description: string): string | undefined {
  const m = /^```diff\r?\n([\s\S]*?)\r?\n```[ \t]*$/m.exec(description);
  return m?.[1] !== undefined ? `${m[1]}\n` : undefined;
}

/** `Signature: \`...\`` line of the evidence section. */
export function parseSignature(description: string): string | undefined {
  return /^Signature: `(.+)`\s*$/m.exec(description)?.[1];
}

/** Run ids of the evidence `kh logs show <id>` links. */
export function parseRunIds(description: string): string[] {
  return [...description.matchAll(/`kh logs show ([^`\s]+)`/g)].map((m) => m[1]!);
}

/** The body plus the fenced diff. */
export function withDiff(body: string, diff: string | undefined): string {
  return diff === undefined ? body : `${body}\n\n## Proposed change\n\n\`\`\`diff\n${diff.replace(/\n$/, "")}\n\`\`\``;
}
