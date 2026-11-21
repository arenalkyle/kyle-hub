import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ServiceRegistry } from "../services";
import { logServiceFromSettings } from "./hubService";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "kh-hubsvc-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("logServiceFromSettings", () => {
  it("registers on the hub and routes hook events by configured repo profile", () => {
    const repo = path.join(root, "client-repo");
    const services = new ServiceRegistry();
    const svc = logServiceFromSettings({ repos: { client: { path: repo, profile: "work" }, bad: { path: 1 } } }, (p) => path.join(root, "data", p));
    services.register("logs", svc);
    expect(services.get("logs")).toBe(svc);

    services.get("logs")?.appendHookEvent({ sessionId: "s1", name: "Stop", cwd: path.join(repo, "src") });
    const workHooks = path.join(root, "data", "work", "hooks");
    const files = fs.existsSync(workHooks) ? fs.readdirSync(workHooks) : [];
    expect(files).toHaveLength(1);
    expect(fs.readFileSync(path.join(workHooks, files[0] ?? ""), "utf8")).toContain('"name":"Stop"');
  });

  it("ignores invalid settings instead of throwing", () => {
    expect(() => logServiceFromSettings({ logs: { denylist: "nope", retentionDays: "x" } }, (p) => path.join(root, p))).not.toThrow();
  });
});
