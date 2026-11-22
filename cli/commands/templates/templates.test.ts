import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TEMPLATE_DEFAULTS } from "../../../src/core/templates";
import { EXIT, KtError, type Io } from "../tickets/cli";
import { runTemplates } from "./cli";

let tmp: string;
let vault: string;
let lines: string[];

const io = (): Io => ({
  cwd: tmp,
  env: { LOCALAPPDATA: path.join(tmp, "local"), USERPROFILE: path.join(tmp, "home"), KYLE_HUB_VAULTS: vault },
  stdin: () => "",
  out: (s) => lines.push(s),
  err: (s) => lines.push(s),
  now: () => new Date("2026-06-01T12:00:00Z"),
});

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kh-templates-cli-"));
  vault = path.join(tmp, "vault");
  fs.mkdirSync(vault, { recursive: true });
  lines = [];
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("kh templates", () => {
  it("list marks which ids have a vault override", () => {
    fs.mkdirSync(path.join(vault, ".kyle-hub", "templates"), { recursive: true });
    fs.writeFileSync(path.join(vault, ".kyle-hub", "templates", "repo-note.md"), "mine", "utf8");
    expect(runTemplates(["list"], io())).toBe(EXIT.ok);
    expect(lines).toContain("repo-note  vault");
    expect(lines).toContain("daily-reminder  default");
    expect(lines).toHaveLength(6);
  });

  it("show prints the vault override when present", () => {
    fs.mkdirSync(path.join(vault, ".kyle-hub", "templates"), { recursive: true });
    fs.writeFileSync(path.join(vault, ".kyle-hub", "templates", "repo-note.md"), "mine\n", "utf8");
    expect(runTemplates(["show", "repo-note"], io())).toBe(EXIT.ok);
    expect(lines).toEqual(["mine"]);
  });

  it("show falls back to the default, and --vault overrides the configured vault", () => {
    expect(runTemplates(["show", "script-proposal", "--vault", vault], io())).toBe(EXIT.ok);
    expect(lines[0]).toBe(TEMPLATE_DEFAULTS["script-proposal"].replace(/\n$/, ""));
  });

  it("rejects unknown ids and missing subcommands with a usage error", () => {
    expect(() => runTemplates(["show", "nope"], io())).toThrow(KtError);
    expect(() => runTemplates([], io())).toThrow(KtError);
  });

  it("list without any configured vault is a usage error", () => {
    const noVault = { ...io(), env: { LOCALAPPDATA: tmp, USERPROFILE: tmp } };
    expect(() => runTemplates(["list"], noVault)).toThrow(/No vault configured/);
  });
});
