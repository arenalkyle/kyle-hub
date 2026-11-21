import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { planPromote, promoteEligible, scrubOptionsFrom } from "../../../src/core/domain/promote";
import type { ScrubOptions } from "../../../src/core/domain/scrub";
import { EXIT, KtError, type Io } from "../tickets/cli";

const USAGE = "kh promote <file> --to <homeVault> [--dry-run]";
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Scrub settings (`core.promote`, repo map) from the first configured vault's plugin data.json (read-only). */
export function readScrubOptions(env: Record<string, string | undefined>): ScrubOptions {
  const vault = (env.KYLE_HUB_VAULTS ?? env.KYLE_TICKETS_VAULTS ?? "").split(";").map((s) => s.trim()).find((s) => s.length > 0);
  let core: Record<string, unknown> = {};
  if (vault) {
    try {
      const data: unknown = JSON.parse(fs.readFileSync(path.join(vault, ".obsidian", "plugins", "kyle-hub", "data.json"), "utf8"));
      if (isObj(data) && isObj(data.modules) && isObj(data.modules.core)) core = data.modules.core;
    } catch {
      /* defaults */
    }
  }
  return scrubOptionsFrom(isObj(core.promote) ? core.promote : undefined, isObj(core.repos) ? (core.repos as Record<string, { github?: unknown }>) : undefined);
}

/** `kh promote`: scrub a work lesson / applied proposal and write it to `<homeVault>/Brain/lessons/`. `--dry-run` prints the diff only. */
export function runPromote(argv: string[], io: Io, opts: ScrubOptions = readScrubOptions(io.env)): number {
  let values: { to?: string; "dry-run"?: boolean };
  let positionals: string[];
  try {
    const r = parseArgs({ args: argv, options: { to: { type: "string" }, "dry-run": { type: "boolean" } }, strict: true, allowPositionals: true });
    values = r.values as typeof values;
    positionals = r.positionals;
  } catch (e) {
    throw new KtError(EXIT.usage, `${(e as Error).message}. Usage: ${USAGE}`);
  }
  const file = positionals[0];
  if (!file || positionals.length > 1 || !values.to) throw new KtError(EXIT.usage, `Usage: ${USAGE}`);
  const src = path.resolve(io.cwd, file);
  let text: string;
  try {
    text = fs.readFileSync(src, "utf8");
  } catch {
    throw new KtError(EXIT.notFound, `cannot read ${src}`);
  }
  const ok = promoteEligible(text);
  if (!ok.ok) throw new KtError(EXIT.validation, ok.reason);
  const plan = planPromote(path.basename(src), text, opts);
  const target = path.join(path.resolve(io.cwd, values.to), ...plan.targetRel.split("/"));
  io.out(plan.diff.trimEnd());
  const summary = Object.entries(plan.counts).map(([k, n]) => `${k}: ${n}`).join(", ") || "nothing to scrub";
  if (values["dry-run"]) {
    io.out(`dry run: would write ${target} (${summary}); nothing written.`);
    return EXIT.ok;
  }
  if (fs.existsSync(target)) throw new KtError(EXIT.validation, `${target} already exists; refusing to overwrite`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, plan.after, "utf8");
  io.out(`promoted to ${target} (${summary}).`);
  return EXIT.ok;
}
