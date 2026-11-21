const p2 = (n: number): string => String(n).padStart(2, "0");

/** Local date, `YYYY-MM-DD`. */
export function formatDate(d: Date): string {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

/** Frontmatter timestamp: local `YYYY-MM-DDTHH:mm:ss`, no zone. */
export function formatIso(d: Date): string {
  return `${formatDate(d)}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

/** Feed timestamp: local `YYYY-MM-DD HH:mm`. */
export function formatFeedTime(d: Date): string {
  return `${formatDate(d)} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
