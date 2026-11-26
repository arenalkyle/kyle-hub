import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkCleanupPeriod, checkHooks } from "../../../src/core/ops/doctor";
import { buildSchtasksArgs, buildTaskXml, formatCommand, TASK_NAME } from "../../../src/core/ops/schedule";
import type { Io } from "../tickets/cli";
import { EXIT } from "../tickets/cli";
import { runDoctor, runSchedule, type OpsDeps } from "./cli";

let tmp: string;
let home: string;
let lines: string[];
let calls: string[][];

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kh-ops-"));
  home = path.join(tmp, "home");
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  lines = [];
  calls = [];
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const io = (): Io => ({
  cwd: tmp,
  env: { LOCALAPPDATA: path.join(tmp, "local") },
  stdin: () => "",
  out: (s) => lines.push(s),
  err: (s) => lines.push(s),
  now: () => new Date(2026, 10, 21, 9, 0, 0),
});

const deps = (status: number | null = 0, stdout = ""): OpsDeps => ({
  schtasks: (argv) => {
    calls.push(argv);
    return { status, stdout };
  },
  nodePath: "C:\\Program Files\\nodejs\\node.exe",
  khPath: "C:\\dev\\kyle-hub\\bin\\kh.js",
  userId: "PC\\kyle",
  homedir: home,
  now: new Date(2026, 10, 21, 9, 0, 0),
});

describe("cleanupPeriodDays check", () => {
  it("warns when settings.json is missing", () => {
    expect(checkCleanupPeriod(undefined).status).toBe("warn");
  });
  it("warns when the key is unset", () => {
    expect(checkCleanupPeriod("{}").status).toBe("warn");
  });
  it("warns when below 7 days", () => {
    expect(checkCleanupPeriod(JSON.stringify({ cleanupPeriodDays: 3 })).status).toBe("warn");
  });
  it("is ok at 7 days or more", () => {
    expect(checkCleanupPeriod(JSON.stringify({ cleanupPeriodDays: 30 }))).toMatchObject({ status: "ok" });
  });
  it("detects the kyle-hook command", () => {
    const hook = '{"hooks":{"Stop":[{"hooks":[{"command":"node \\"${CLAUDE_PROJECT_DIR}/.obsidian/plugins/kyle-hub/hooks/kyle-hook.js\\" Stop"}]}]}}';
    expect(checkHooks("{}", [hook]).status).toBe("ok");
    expect(checkHooks(undefined, [hook]).status).toBe("ok");
    expect(checkHooks("{}", [undefined]).status).toBe("warn");
    expect(checkHooks("{}").status).toBe("warn");
    expect(checkHooks(hook, [hook]).message).toContain("stale");
    expect(checkHooks(hook).status).toBe("warn");
  });
  it("accepts the portable command and flags absolute paths as needing migration", () => {
    const abs = JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: 'node "C:\\V\\.obsidian\\plugins\\kyle-hub\\hooks\\kyle-hook.js" Stop' }] }] } });
    const shellVar = JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: 'node "$CLAUDE_PROJECT_DIR/.obsidian/plugins/kyle-hub/hooks/kyle-hook.js" Stop' }] }] } });
    const r = checkHooks(undefined, [abs]);
    expect(r.status).toBe("warn");
    expect(r.message).toContain("absolute path");
    expect(checkHooks(undefined, [shellVar]).status).toBe("ok");
  });
});

describe("schedule argv and task XML", () => {
  it("builds the create/delete/query argv", () => {
    expect(buildSchtasksArgs("create", "C:\\x\\t.xml")).toEqual(["/Create", "/TN", TASK_NAME, "/XML", "C:\\x\\t.xml", "/F"]);
    expect(buildSchtasksArgs("delete")).toEqual(["/Delete", "/TN", TASK_NAME, "/F"]);
    expect(buildSchtasksArgs("query")).toEqual(["/Query", "/TN", TASK_NAME, "/FO", "LIST", "/V"]);
    expect(() => buildSchtasksArgs("create")).toThrow();
  });

  it("task XML has a 30-minute repeat, a logon trigger and the maintain action", () => {
    const xml = buildTaskXml({ nodePath: "C:\\node.exe", khPath: "C:\\kh.js", userId: "PC\\kyle", startBoundary: "2026-11-21T09:00:00" });
    expect(xml).toContain("<Interval>PT30M</Interval>");
    expect(xml).toContain("<LogonTrigger>");
    expect(xml).toContain("&quot;C:\\kh.js&quot; maintain");
    expect(formatCommand(["/Create", "/XML", "C:\\a b\\t.xml"])).toBe('schtasks /Create /XML "C:\\a b\\t.xml"');
  });
});

describe("kh schedule", () => {
  it("install without --yes writes the XML, prints the command and does not call schtasks", () => {
    const code = runSchedule(["install"], io(), deps());
    expect(code).toBe(EXIT.ok);
    expect(calls).toHaveLength(0);
    expect(lines.some((l) => l.startsWith("Command: schtasks /Create /TN kyle-hub-maintain /XML"))).toBe(true);
    expect(lines.join("\n")).toContain("--yes");
  });

  it("install --yes runs the create argv (mocked)", () => {
    expect(runSchedule(["install", "--yes"], io(), deps())).toBe(EXIT.ok);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.slice(0, 4)).toEqual(["/Create", "/TN", TASK_NAME, "/XML"]);
    expect(calls[0]?.at(-1)).toBe("/F");
  });

  it("status reports not registered on a non-zero query", () => {
    runSchedule(["status"], io(), deps(1));
    expect(lines[0]).toContain("not registered");
  });

  it("status prints next run from the LIST output", () => {
    runSchedule(["status"], io(), deps(0, "Folder: \\\r\nNext Run Time:  11/21/2026 9:30:00 AM\r\nStatus: Ready\r\n"));
    expect(lines).toEqual(["Next Run Time:  11/21/2026 9:30:00 AM", "Status: Ready"]);
  });
});

describe("kh doctor", () => {
  it("warns on a too-low cleanupPeriodDays from the settings file and exits ok", () => {
    fs.writeFileSync(path.join(home, ".claude", "settings.json"), JSON.stringify({ cleanupPeriodDays: 3 }));
    const code = runDoctor(io(), deps(1));
    expect(code).toBe(EXIT.ok);
    expect(lines.some((l) => l.startsWith("[warn] cleanupPeriodDays"))).toBe(true);
    expect(lines.some((l) => l.startsWith("[warn] scheduledTask"))).toBe(true);
    expect(lines.some((l) => l.startsWith("[ok] logDirs"))).toBe(true);
  });

  const vaultHook = (): string => {
    const vault = path.join(tmp, "vault");
    fs.mkdirSync(path.join(vault, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(vault, ".claude", "settings.local.json"), JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: 'node "${CLAUDE_PROJECT_DIR}/.obsidian/plugins/kyle-hub/hooks/kyle-hook.js" Stop' }] }] } }));
    return vault;
  };

  it("is green for cleanupPeriodDays 30, the hook in the vault file, and the task", () => {
    fs.writeFileSync(path.join(home, ".claude", "settings.json"), JSON.stringify({ cleanupPeriodDays: 30 }));
    const o = { ...io(), env: { LOCALAPPDATA: path.join(tmp, "local"), KYLE_HUB_VAULTS: vaultHook() } };
    runDoctor(o, deps(0));
    expect(lines.filter((l) => l.startsWith("[ok]"))).toHaveLength(4);
  });

  it("warns that the hook is stale while it is still in global settings", () => {
    fs.writeFileSync(path.join(home, ".claude", "settings.json"), JSON.stringify({ cleanupPeriodDays: 30, hooks: { Stop: [{ command: "kyle-hook.js" }] } }));
    const o = { ...io(), env: { LOCALAPPDATA: path.join(tmp, "local"), KYLE_HUB_VAULTS: vaultHook() } };
    runDoctor(o, deps(0));
    expect(lines.some((l) => l.startsWith("[warn] hooks") && l.includes("stale"))).toBe(true);
  });
});
