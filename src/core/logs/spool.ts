import fs from "node:fs";
import path from "node:path";

/** UTC day keys (`YYYY-MM-DD`, as spool file names are) from the day of `since` through the day of `now`. */
export function spoolDays(since: string, now: Date): string[] {
  const days: string[] = [];
  const end = now.toISOString().slice(0, 10);
  let day = since.slice(0, 10);
  while (/^\d{4}-\d{2}-\d{2}$/.test(day) && day <= end) {
    days.push(day);
    const next = new Date(`${day}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    day = next.toISOString().slice(0, 10);
  }
  return days;
}

/** Parsed records with `t` at or after `since` from `<dir>/<day>.jsonl` for each day in range. Never throws; unreadable lines are skipped. */
export function readSpoolSince(dir: string, since: string, now: Date): Record<string, unknown>[] {
  const from = Date.parse(since);
  const out: Record<string, unknown>[] = [];
  for (const day of spoolDays(since, now)) {
    let text: string;
    try {
      text = fs.readFileSync(path.join(dir, `${day}.jsonl`), "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      try {
        const rec = JSON.parse(line) as Record<string, unknown>;
        if (typeof rec.t === "string" && Date.parse(rec.t) >= from) out.push(rec);
      } catch {
        // a torn or foreign line is skipped
      }
    }
  }
  return out;
}
