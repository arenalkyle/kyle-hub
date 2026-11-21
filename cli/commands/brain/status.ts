import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { draftStatus, type StatusDraftInput } from "../../../src/core/brain/statusDraft";
import { effectiveRepo } from "../../../src/core/domain/fields";
import { fromLink } from "../../../src/core/domain/links";
import { EXIT, KtError, discoverFolder, loadCtx, loadIssues, loadProjects, type Io } from "../tickets/cli";
import { readHubData, type HubDataView } from "./cli";

const STATUS_USAGE = "kh status draft --repo <key> [--dir <tickets folder>]";
const pad = (n: number): string => String(n).padStart(2, "0");

/** Read-only git query; "" outside a repo or on error. */
function git(cwd: string, args: string[]): string {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

/** `.kh/last-test.json`: `{ "at": string, "passed": number, "failed": number, "command"?: string }`. */
function lastTestOf(root: string): StatusDraftInput["lastTest"] {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(path.join(root, ".kh", "last-test.json"), "utf8"));
    if (typeof raw !== "object" || raw === null) return undefined;
    const r = raw as Record<string, unknown>;
    if (typeof r.at !== "string" || typeof r.passed !== "number" || typeof r.failed !== "number") return undefined;
    return { at: r.at, passed: r.passed, failed: r.failed, ...(typeof r.command === "string" ? { command: r.command } : {}) };
  } catch {
    return undefined;
  }
}

/** Tickets whose effective repo is `key` (own repo, else the project's). Empty when no tickets folder is found. */
function ticketsFor(key: string, dirOpt: string | undefined, io: Io): StatusDraftInput["tickets"] {
  let folder: string;
  try {
    folder = discoverFolder(dirOpt, io);
  } catch {
    return [];
  }
  const ctx = loadCtx(folder);
  const projects = new Map(loadProjects(ctx).map((p) => [p.name, p] as const));
  return loadIssues(ctx)
    .filter((t) => effectiveRepo(t, t.project ? projects.get(fromLink(t.project)) : undefined) === key)
    .map((t) => ({ id: t.id, title: t.title, status: t.status }));
}

/** `kh status draft`: prints a STATUS.md skeleton to stdout. Reads the repo and git history; writes nothing. */
export function runStatusDraft(argv: string[], io: Io, data: HubDataView = readHubData(io.env)): number {
  let v: Record<string, string | boolean | undefined>;
  try {
    v = parseArgs({ args: argv, options: { repo: { type: "string" }, dir: { type: "string" } }, strict: true, allowPositionals: false }).values;
  } catch (e) {
    throw new KtError(EXIT.usage, `${(e as Error).message}. Usage: ${STATUS_USAGE}`);
  }
  if (typeof v.repo !== "string") throw new KtError(EXIT.usage, `--repo is required. Usage: ${STATUS_USAGE}`);
  const entry = data.repos[v.repo];
  if (!entry) throw new KtError(EXIT.usage, `unknown repo "${v.repo}" (not in the repo map)`);
  const root = path.resolve(entry.path);

  const statusRel = ["STATUS.md", path.join("docs", "STATUS.md")].find((p) => fs.existsSync(path.join(root, p)));
  const sha = statusRel !== undefined ? git(root, ["log", "-1", "--format=%H", "--", statusRel]) : "";
  const commits = git(root, ["log", ...(sha ? [`${sha}..HEAD`] : []), "-n", "50", "--format=%s"]).split("\n").filter(Boolean);
  const now = io.now();
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const dirOpt = typeof v.dir === "string" ? v.dir : undefined;
  io.out(draftStatus({ date, commits, tickets: ticketsFor(v.repo, dirOpt, io), lastTest: lastTestOf(root) }).trimEnd());
  return EXIT.ok;
}
