export interface ParsedId {
  prefix: string;
  n: number;
}

export function formatId(prefix: string, n: number): string {
  return `${prefix}-${n}`;
}

export function parseId(str: string): ParsedId | null {
  const m = /^([A-Za-z][A-Za-z0-9]*)-(\d+)$/.exec(str.trim());
  return m ? { prefix: m[1]!, n: Number(m[2]) } : null;
}

/**
 * `counter` is the next number to hand out (starts at 1). The allocated number is
 * `max(counter, maxExisting + 1)` over IDs with the same prefix; the returned
 * `counter` is the new stored value (allocated + 1). Numbers are never reused.
 */
export function nextId(
  counter: number,
  existingIds: Iterable<string>,
  prefix: string,
): { id: string; counter: number } {
  let max = 0;
  for (const s of existingIds) {
    const p = parseId(s);
    if (p && p.prefix === prefix && p.n > max) max = p.n;
  }
  const n = Math.max(counter, max + 1);
  return { id: formatId(prefix, n), counter: n + 1 };
}
