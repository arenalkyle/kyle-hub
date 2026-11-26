import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readVaultBrainFolders } from "./folders";

let vault: string;
beforeEach(() => { vault = fs.mkdtempSync(path.join(os.tmpdir(), "kh-folders-")); });
afterEach(() => fs.rmSync(vault, { recursive: true, force: true }));

const writeData = (data: unknown, configDir = ".obsidian"): void => {
  const dir = path.join(vault, configDir, "plugins", "kyle-hub");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "data.json"), typeof data === "string" ? data : JSON.stringify(data));
};

describe("readVaultBrainFolders", () => {
  it("defaults when data.json is missing, unreadable or has no brain keys", () => {
    const def = { brainFolder: "Brain", conventionsFolder: "Brain/conventions" };
    expect(readVaultBrainFolders(vault)).toEqual(def);
    writeData("{ nope");
    expect(readVaultBrainFolders(vault)).toEqual(def);
    writeData({ modules: { core: {} } });
    expect(readVaultBrainFolders(vault)).toEqual(def);
  });
  it("reads modules.brain from the vault's data.json (custom config dir too)", () => {
    writeData({ modules: { brain: { brainFolder: "Brain", conventionsFolder: "docs/conventions" } } });
    expect(readVaultBrainFolders(vault)).toEqual({ brainFolder: "Brain", conventionsFolder: "docs/conventions" });
    writeData({ modules: { brain: { brainFolder: "notes" } } }, ".config");
    expect(readVaultBrainFolders(vault, ".config")).toEqual({ brainFolder: "notes", conventionsFolder: "notes/conventions" });
  });
});
