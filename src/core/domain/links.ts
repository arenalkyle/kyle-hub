/** `Name` -> `[[Name]]`. */
export function toLink(name: string): string {
  return `[[${name}]]`;
}

/** `[[Name]]` / `[[Name|alias]]` -> `Name`; plain strings pass through. */
export function fromLink(value: string): string {
  const m = /^\s*\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]\s*$/.exec(value);
  return m ? m[1]!.trim() : value.trim();
}
