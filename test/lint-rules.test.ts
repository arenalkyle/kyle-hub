import { ESLint } from "eslint";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const eslint = new ESLint({ cwd: root });

async function lint(file: string, code: string) {
  const [r] = await eslint.lintText(code, { filePath: path.join(root, file) });
  return r!.messages.filter((m) => m.ruleId === "no-restricted-imports");
}

describe("architecture lint rules", () => {
  it("fails a cross-module import (tickets -> term)", async () => {
    const m = await lint("src/modules/tickets/src/fixture.ts", 'import { x } from "../../term/src/session-manager";\nexport const y = x;\n');
    expect(m.length).toBe(1);
  });
  it("fails a cross-module import via modules path", async () => {
    expect(await lint("src/modules/term/src/fixture.ts", 'import "../../tickets/index";\n')).toHaveLength(1);
  });
  it("allows importing core", async () => {
    expect(await lint("src/modules/tickets/src/fixture.ts", 'import { redact } from "../../../core";\nexport const y = redact;\n')).toHaveLength(0);
  });
  it("forbids obsidian and react in core/domain", async () => {
    expect(await lint("src/core/domain/fixture.ts", 'import { Notice } from "obsidian";\nexport const y = Notice;\n')).toHaveLength(1);
    expect(await lint("src/core/domain/fixture.ts", 'import React from "react";\nexport const y = React;\n')).toHaveLength(1);
  });
  it("forbids core importing modules", async () => {
    expect(await lint("src/core/fixture.ts", 'import "../modules/tickets/index";\n')).toHaveLength(1);
  });
});
