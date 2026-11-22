import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ServiceRegistry, type BrainAccessEvent } from "../../../core";
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

describe("forwardHookToLogs access capture", () => {
  const vault = () => path.join(root, "vault");
  const setup = () => {
    const services = new ServiceRegistry();
    services.register("logs", new FileLogService({ dataRoot: (p) => path.join(root, "data", p), repoMap: [], projectsDir: root }));
    const events: BrainAccessEvent[] = [];
    return { services, events, opts: { vaultRoot: vault(), emitAccess: (e: BrainAccessEvent) => events.push(e), now: () => new Date("2026-01-02T03:04:05.000Z") } };
  };
  const spool = (): Array<Record<string, unknown>> => {
    const dir = path.join(root, "data", "home", "hooks");
    const f = fs.readdirSync(dir)[0] ?? "";
    return fs.readFileSync(path.join(dir, f), "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
  };
  const grep = (extra: Record<string, unknown> = {}): HookMessage => ({
    session: "term-1", event: "PostToolUse",
    payload: { cwd: vault(), tool_name: "Grep", tool_input: { pattern: "foo", path: path.join(vault(), "Brain") }, tool_response: { numFiles: 4 }, ...extra },
  });

  it("emits brain:access and spools path/pattern/hits", () => {
    const { services, events, opts } = setup();
    forwardHookToLogs(services, grep(), opts);
    expect(events).toEqual([{ t: "2026-01-02T03:04:05.000Z", sessionId: "term-1", kind: "search", pattern: "foo", hits: 4 }]);
    expect(spool()[0]?.access).toEqual({ kind: "search", root: "Brain", pattern: "foo", hits: 4 });
  });

  it("drops access outside the vault root but keeps the plain hook record", () => {
    const { services, events, opts } = setup();
    forwardHookToLogs(services, grep({ cwd: path.join(root, "repo"), tool_input: { pattern: "x", path: path.join(root, "repo") } }), opts);
    expect(events).toEqual([]);
    expect(spool()[0]?.access).toBeUndefined();
  });

  it("links sub-agent records to the parent session", () => {
    const { services, events, opts } = setup();
    forwardHookToLogs(services, grep({ agent_id: "ag-9", agent_type: "Explore" }), opts);
    forwardHookToLogs(services, { session: "term-1", event: "SubagentStart", payload: { cwd: vault(), agent_id: "ag-9", agent_type: "Explore" } }, opts);
    expect(events[0]).toMatchObject({ sessionId: "ag-9", parentSessionId: "term-1", agentType: "Explore" });
    for (const r of spool()) expect(r).toMatchObject({ sessionId: "ag-9", parentSessionId: "term-1", agentType: "Explore" });
  });
});
