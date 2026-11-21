import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ServiceRegistry } from "../../../core";
import { FileLogService } from "../../../core/logs/service";
import { forwardHookToLogs } from "../src/hook-logs";
import type { HookMessage } from "../src/hook-server";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "kh-hooklogs-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const msg = (): HookMessage => ({
  session: "sess-1",
  event: "PostToolUse",
  payload: { cwd: path.join(root, "repo") },
  env: { KH_TICKET: "LOCK-50", KH_RUN: "run-7" },
});

describe("forwardHookToLogs", () => {
  it("lands the hook event in the profile hooks spool", () => {
    const services = new ServiceRegistry();
    services.register("logs", new FileLogService({ dataRoot: (p) => path.join(root, "data", p), repoMap: [], projectsDir: root }));
    forwardHookToLogs(services, msg());
    const dir = path.join(root, "data", "home", "hooks");
    const files = fs.readdirSync(dir);
    expect(files).toHaveLength(1);
    const line = JSON.parse(fs.readFileSync(path.join(dir, files[0] ?? ""), "utf8").trim()) as Record<string, unknown>;
    expect(line).toMatchObject({ sessionId: "sess-1", name: "PostToolUse", ticketId: "LOCK-50", runId: "run-7" });
  });

  it("is a no-op and does not throw when the logs service is absent", () => {
    const services = new ServiceRegistry();
    expect(() => forwardHookToLogs(services, msg())).not.toThrow();
    expect(fs.existsSync(path.join(root, "data"))).toBe(false);
  });

  it("swallows a failing logs service", () => {
    const broken = { get: (): never => { throw new Error("boom"); } } as unknown as ServiceRegistry;
    expect(() => forwardHookToLogs(broken, msg())).not.toThrow();
  });
});
