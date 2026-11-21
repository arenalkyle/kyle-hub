import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyPatch, parsePatch } from "diff";
import type { Issue, StatusDef } from "../../../core/domain/types";
import { categoryOf, effectiveType } from "../../../core/domain/fields";
import type { TicketService } from "../../../core/services";
import { parseDiff, parseSignature, parseTarget } from "./ticketMeta";
import { updateRetroState } from "./state";

export const APPLIED_LABEL = "applied";

export type ApplyOutcome = { ok: true; files: string[]; backups: string[]; git: boolean } | { ok: false; error: string };

const git = (args: string[], cwd: string): Promise<{ code: number; out: string }> =>
  new Promise((resolve) => {
    execFile("git", args, { cwd, windowsHide: true }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code) : 1) : 0;
      resolve({ code, out: `${stdout}${stderr}`.trim() });
    });
  });

const norm = (p: string): string => path.resolve(p).replace(/[\\/]+$/, "").toLowerCase();

/** True when `root` is itself the top level of a git work tree. */
export async function isGitRoot(root: string): Promise<boolean> {
  const r = await git(["rev-parse", "--show-toplevel"], root);
  if (r.code !== 0) return false;
  try {
    return norm(fs.realpathSync.native(r.out)) === norm(fs.realpathSync.native(root));
  } catch {
    return false;
  }
}

/** Relative file names of a (possibly multi-file) unified diff. */
export function diffFiles(diff: string): string[] {
  return parsePatch(diff).map((p) => stripPrefix(p.newFileName ?? p.oldFileName ?? "")).filter((f) => f !== "");
}

const stripPrefix = (f: string): string => f.replace(/^[ab]\//, "");

const stamp = (d: Date): string => d.toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");

/**
 * Applies a unified diff whose paths are relative to `root`. In a git repo: `git apply --check`, then `git apply`.
 * Elsewhere (`~/.claude`): in-memory patch with the built-in patcher, a timestamped `.bak` next to each existing file, then writes.
 * On any failure nothing is changed.
 */
export async function applyDiff(root: string, diff: string, now: Date = new Date()): Promise<ApplyOutcome> {
  let patches;
  try {
    patches = parsePatch(diff);
  } catch (e) {
    return { ok: false, error: `Unreadable diff: ${(e as Error).message}` };
  }
  if (patches.length === 0) return { ok: false, error: "The diff block has no files." };
  if (!fs.existsSync(root)) return { ok: false, error: `Target does not exist: ${root}` };
  const files = diffFiles(diff);

  if (await isGitRoot(root)) {
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "kh-apply-")), "change.diff");
    fs.writeFileSync(tmp, diff, "utf8");
    try {
      const check = await git(["apply", "--check", tmp], root);
      if (check.code !== 0) return { ok: false, error: `git apply --check failed: ${check.out}` };
      const applied = await git(["apply", tmp], root);
      if (applied.code !== 0) return { ok: false, error: `git apply failed: ${applied.out}` };
      return { ok: true, files, backups: [], git: true };
    } finally {
      fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
    }
  }

  const planned: { abs: string; before: string | undefined; after: string }[] = [];
  for (const p of patches) {
    const rel = stripPrefix(p.newFileName ?? "");
    const abs = path.resolve(root, rel);
    if (rel === "" || path.relative(path.resolve(root), abs).startsWith("..") || path.isAbsolute(path.relative(path.resolve(root), abs))) {
      return { ok: false, error: `Path escapes the target: ${rel}` };
    }
    const creating = p.oldFileName === "/dev/null";
    const exists = fs.existsSync(abs);
    if (creating && exists) return { ok: false, error: `${rel} already exists.` };
    if (!creating && !exists) return { ok: false, error: `${rel} does not exist.` };
    const before = creating ? undefined : fs.readFileSync(abs, "utf8");
    const after = applyPatch(before ?? "", p);
    if (after === false) return { ok: false, error: `The change to ${rel} no longer applies (the file changed since the proposal).` };
    planned.push({ abs, before, after });
  }
  const backups: string[] = [];
  for (const f of planned) {
    if (f.before === undefined) continue;
    const bak = `${f.abs}.${stamp(now)}.bak`;
    fs.copyFileSync(f.abs, bak);
    backups.push(bak);
  }
  for (const f of planned) {
    fs.mkdirSync(path.dirname(f.abs), { recursive: true });
    fs.writeFileSync(f.abs, f.after, "utf8");
  }
  return { ok: true, files, backups, git: false };
}

/** A proposal that can be applied: type proposal, open, accepted (past triage), with a diff block and not yet applied. */
export function canApply(issue: Issue, statuses: readonly StatusDef[]): boolean {
  if (effectiveType(issue) !== "proposal" || issue.tags.includes(APPLIED_LABEL)) return false;
  const cat = categoryOf(issue.status, statuses);
  if (cat === undefined || cat === "triage" || cat === "completed" || cat === "canceled") return false;
  return parseDiff(issue.description) !== undefined && parseTarget(issue.description) !== undefined;
}

export interface ApplyProposalDeps {
  tickets: TicketService;
  stateFile: string;
  now?: () => Date;
  author?: string;
}

/** Apply button: runs the ticket's diff, then comments, labels and records `{ signature, appliedAt }`. Failure only comments. */
export async function applyProposal(deps: ApplyProposalDeps, id: string): Promise<ApplyOutcome> {
  const { tickets } = deps;
  const author = deps.author ?? tickets.userName();
  const issue = tickets.get(id);
  if (!issue) return { ok: false, error: `No ticket ${id}.` };
  if (!canApply(issue, tickets.statuses())) return { ok: false, error: `${id} is not an accepted, open proposal with a diff.` };
  const root = parseTarget(issue.description)!;
  const diff = parseDiff(issue.description)!;
  const at = (deps.now ?? (() => new Date()))();
  const outcome = await applyDiff(root, diff, at);
  if (!outcome.ok) {
    await tickets.comment(id, `Apply failed, nothing was changed: ${outcome.error}`, { author });
    return outcome;
  }
  const list = outcome.files.map((f) => `- ${f}`).join("\n");
  const backups = outcome.backups.length > 0 ? `\n\nBackups:\n${outcome.backups.map((b) => `- ${b}`).join("\n")}` : "";
  await tickets.comment(id, `Applied at ${at.toISOString()}\n\nTarget: ${root}\n\n${list}${backups}`, { author });
  await tickets.update(id, { tags: [...issue.tags, APPLIED_LABEL] }, { author });
  const signature = parseSignature(issue.description);
  if (signature !== undefined) {
    updateRetroState(deps.stateFile, (s) => ({
      ...s,
      applied: [...s.applied.filter((a) => a.ticketId !== id), { signature, appliedAt: at.toISOString(), ticketId: id, quietRetros: 0 }],
    }));
  }
  return outcome;
}
