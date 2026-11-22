import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readTemplate, resetTemplate, TEMPLATE_IDS, templatePath, type TemplateDefaults, writeTemplate } from "./templates";

const defaults = Object.fromEntries(TEMPLATE_IDS.map((id) => [id, `default ${id}`])) as TemplateDefaults;

let vault: string;
beforeEach(() => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), "kh-templates-"));
});
afterEach(() => {
  fs.rmSync(vault, { recursive: true, force: true });
});

describe("readTemplate", () => {
  it("returns the shipped default when the vault has no file", () => {
    expect(readTemplate(vault, "repo-note", defaults)).toBe("default repo-note");
  });

  it("returns the default when no vault root is available", () => {
    expect(readTemplate(undefined, "repo-note", defaults)).toBe("default repo-note");
  });

  it("returns the vault override when the file exists", () => {
    fs.mkdirSync(path.join(vault, ".kyle-hub", "templates"), { recursive: true });
    fs.writeFileSync(templatePath(vault, "repo-note"), "vault text", "utf8");
    expect(readTemplate(vault, "repo-note", defaults)).toBe("vault text");
  });

  it("picks up a direct edit on the next read without any reload", () => {
    writeTemplate(vault, "daily-reminder", "first");
    expect(readTemplate(vault, "daily-reminder", defaults)).toBe("first");
    fs.writeFileSync(templatePath(vault, "daily-reminder"), "second", "utf8");
    expect(readTemplate(vault, "daily-reminder", defaults)).toBe("second");
  });
});

describe("writeTemplate and resetTemplate", () => {
  it("writes the override, creating the folder, and reset falls back to the default", () => {
    writeTemplate(vault, "skill-proposal", "custom");
    expect(fs.readFileSync(templatePath(vault, "skill-proposal"), "utf8")).toBe("custom");
    resetTemplate(vault, "skill-proposal");
    expect(fs.existsSync(templatePath(vault, "skill-proposal"))).toBe(false);
    expect(readTemplate(vault, "skill-proposal", defaults)).toBe("default skill-proposal");
  });

  it("reset is a no-op when no override exists", () => {
    expect(() => resetTemplate(vault, "script-proposal")).not.toThrow();
  });
});
