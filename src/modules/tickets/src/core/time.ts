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

/** Short relative time (`just now`, `5m ago`, `3d ago`, `2mo ago`); null when `value` is not a date. */
export function relativeTime(value: string, now: Date): string | null {
  const t = new Date(value.length === 10 ? `${value}T00:00:00` : value.replace(" ", "T")).getTime();
  if (Number.isNaN(t)) return null;
  const s = Math.max(0, Math.round((now.getTime() - t) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(d / 365)}y ago`;
}
