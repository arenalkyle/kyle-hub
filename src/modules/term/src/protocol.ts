export type ToHelper =
  | { t: "spawn"; id: string; shell: string; args: string[]; cwd: string; cols: number; rows: number; env: Record<string, string> }
  | { t: "write"; id: string; data: string }
  | { t: "resize"; id: string; cols: number; rows: number }
  | { t: "kill"; id: string };

export type FromHelper =
  | { t: "ready" }
  | { t: "data"; id: string; data: string }
  | { t: "exit"; id: string; code: number; signal?: number }
  | { t: "error"; id?: string; message: string };

export function encode(msg: ToHelper | FromHelper): string {
  return JSON.stringify(msg) + "\n";
}

/** Incremental newline-delimited JSON decoder; tolerates partial lines and batched chunks. */
export class LineDecoder<T = unknown> {
  private buf = "";

  push(chunk: string): T[] {
    this.buf += chunk;
    const out: T[] = [];
    let idx: number;
    while ((idx = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (!line) continue;
      try {
        out.push(JSON.parse(line) as T);
      } catch {
        // skip malformed line
      }
    }
    return out;
  }
}
