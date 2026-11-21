import { execFile } from "child_process";
import { parsePrUrl, toPrState, type PrInfo } from "../core/pr";

export type GhErrorKind = "not-installed" | "not-authenticated" | "not-found" | "timeout" | "other";

export class GhError extends Error {
  constructor(
    readonly kind: GhErrorKind,
    message: string,
  ) {
    super(message);
  }
}

export interface RunGhOptions {
  timeoutMs?: number;
  /** Executable; defaults to `gh` (PATH lookup). */
  bin?: string;
}

export function classifyGhError(err: { code?: unknown; killed?: boolean }, stderr: string): GhErrorKind {
  if (err.code === "ENOENT") return "not-installed";
  if (err.killed || err.code === "ETIMEDOUT") return "timeout";
  const s = stderr.toLowerCase();
  if (/gh auth login|not logged in|authentication|gh_token|http 401/.test(s)) return "not-authenticated";
  if (/could not resolve to a pullrequest|not found|http 404|no pull requests? found/.test(s)) return "not-found";
  return "other";
}

/** Runs `gh` without a shell. Rejects with `GhError`. */
export function runGh(args: readonly string[], opts: RunGhOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      opts.bin?.trim() || "gh",
      [...args],
      { timeout: opts.timeoutMs ?? 20000, windowsHide: true, maxBuffer: 4 * 1024 * 1024, encoding: "utf8" },
      (err, stdout, stderr) => {
        if (!err) return resolve(stdout);
        const msg = (stderr || err.message).trim();
        reject(new GhError(classifyGhError(err as never, stderr), msg));
      },
    );
  });
}

interface RawPr {
  number: number;
  title: string;
  state: string;
  isDraft?: boolean;
  headRefName?: string;
  repository?: { name?: string; nameWithOwner?: string; owner?: { login?: string } };
}

export async function getPr(url: string, opts: RunGhOptions = {}): Promise<PrInfo> {
  const ref = parsePrUrl(url);
  if (!ref) throw new GhError("other", `Not a GitHub pull request URL: ${url}`);
  const out = await runGh(["pr", "view", ref.url, "--json", "number,title,state,isDraft,url,headRefName"], opts);
  let raw: RawPr;
  try {
    raw = JSON.parse(out) as RawPr;
  } catch {
    throw new GhError("other", "Unexpected output from gh");
  }
  // gh 2.97 rejects the `repository` field ("Unknown JSON field"), so it is not requested; owner/repo come from the URL.
  const nwo = raw.repository?.nameWithOwner?.split("/");
  return {
    owner: raw.repository?.owner?.login ?? nwo?.[0] ?? ref.owner,
    repo: raw.repository?.name ?? nwo?.[1] ?? ref.repo,
    number: raw.number ?? ref.number,
    url: ref.url,
    title: raw.title ?? "",
    state: toPrState(raw.state ?? "OPEN", raw.isDraft === true),
    headRefName: raw.headRefName,
  };
}

export interface GhStatus {
  ok: boolean;
  version?: string;
  user?: string;
  error?: GhErrorKind;
  message: string;
}

export function parseGhVersion(out: string): string | undefined {
  return /gh version (\S+)/.exec(out)?.[1];
}

export function parseGhUser(out: string): string | undefined {
  return /Logged in to \S+ (?:account|as) (\S+)/.exec(out)?.[1];
}

/** Checks that `gh` is installed and logged in (for the settings tab). */
export async function checkGh(opts: RunGhOptions = {}): Promise<GhStatus> {
  let version: string | undefined;
  try {
    version = parseGhVersion(await runGh(["--version"], opts));
  } catch (e) {
    const err = e as GhError;
    return {
      ok: false,
      error: err.kind,
      message: err.kind === "not-installed" ? "gh was not found on PATH. Install the GitHub CLI or set its path below." : err.message,
    };
  }
  const v = `gh ${version ?? ""}`.trim();
  try {
    const user = parseGhUser(await runGh(["auth", "status"], opts));
    return { ok: true, version, user, message: `${v} — logged in${user ? ` as ${user}` : ""}` };
  } catch (e) {
    const err = e as GhError;
    return { ok: false, version, error: "not-authenticated", message: `${v} found, but not logged in (${err.kind}). Run "gh auth login".` };
  }
}
