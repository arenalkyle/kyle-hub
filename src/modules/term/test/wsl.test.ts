import { describe, expect, it } from "vitest";
import type { NetworkInterfaceInfo } from "node:os";
import type { ShellProfile } from "../src/shells";
import { adaptRestored, chooseProfileId, isWslUncPath, parseWslUnc, spawnArgs, withWslEnv, wslAdapterAddress, wslProfile } from "../src/wsl";

describe("isWslUncPath", () => {
  it("matches the wsl$ and wsl.localhost shares, either slash", () => {
    expect(isWslUncPath("\\\\wsl$\\Ubuntu\\home\\me\\vault")).toBe(true);
    expect(isWslUncPath("\\\\wsl.localhost\\Ubuntu\\home\\me\\vault")).toBe(true);
    expect(isWslUncPath("//wsl$/Ubuntu/home/me")).toBe(true);
    expect(isWslUncPath("\\\\WSL.LOCALHOST\\Ubuntu")).toBe(true);
  });
  it("rejects local and other UNC paths", () => {
    expect(isWslUncPath("C:\\vault")).toBe(false);
    expect(isWslUncPath("\\\\server\\share")).toBe(false);
    expect(isWslUncPath("/home/me/vault")).toBe(false);
  });
});

describe("withWslEnv", () => {
  it("lists hook and KH_ keys as Windows-to-WSL only, keeping existing entries", () => {
    const r = withWslEnv({ KYLE_TERM_PORT: "1", KYLE_TERM_TOKEN: "t", KH_TICKET: "K-1", OTHER: "x" }, "USERPROFILE/p:KYLE_TERM_PORT/u");
    expect(r.WSLENV).toBe("USERPROFILE/p:KYLE_TERM_PORT/u:KYLE_TERM_TOKEN/u:KH_TICKET/u");
    expect(r.OTHER).toBe("x");
  });
  it("is a no-op when nothing needs forwarding", () => {
    const env = { OTHER: "x" };
    expect(withWslEnv(env, "A")).toBe(env);
  });
});

describe("wslAdapterAddress", () => {
  const v4 = (address: string, internal = false): NetworkInterfaceInfo =>
    ({ address, family: "IPv4", internal, netmask: "255.255.240.0", mac: "00:00:00:00:00:00", cidr: null }) as NetworkInterfaceInfo;
  it("finds the WSL adapter's IPv4 address (old and new adapter names)", () => {
    expect(wslAdapterAddress({ Ethernet: [v4("192.168.1.5")], "vEthernet (WSL)": [v4("172.20.0.1")] })).toBe("172.20.0.1");
    expect(wslAdapterAddress({ "vEthernet (WSL (Hyper-V firewall))": [v4("172.21.0.1")] })).toBe("172.21.0.1");
  });
  it("is undefined when WSL isn't running", () => {
    expect(wslAdapterAddress({ Ethernet: [v4("192.168.1.5")], "Loopback Pseudo-Interface 1": [v4("127.0.0.1", true)] })).toBeUndefined();
  });
});

describe("parseWslUnc", () => {
  it("maps the share path to distro + Linux path", () => {
    expect(parseWslUnc(String.raw`\\wsl.localhost\Ubuntu\home\pepzii\locked-away`)).toEqual({ distro: "Ubuntu", linuxPath: "/home/pepzii/locked-away" });
    expect(parseWslUnc(String.raw`\\wsl$\Ubuntu-22.04\home\me\v\sub dir\\`)).toEqual({ distro: "Ubuntu-22.04", linuxPath: "/home/me/v/sub dir" });
    expect(parseWslUnc("//wsl.localhost/Debian/srv")).toEqual({ distro: "Debian", linuxPath: "/srv" });
    expect(parseWslUnc(String.raw`\\wsl.localhost\Ubuntu`)).toEqual({ distro: "Ubuntu", linuxPath: "/" });
  });
  it("is null for Windows and other UNC paths", () => {
    expect(parseWslUnc(String.raw`C:\Development\locked-away`)).toBeNull();
    expect(parseWslUnc(String.raw`\\server\share\x`)).toBeNull();
  });
});

describe("WSL shell profile", () => {
  const vault = String.raw`\\wsl.localhost\Ubuntu\home\pepzii\locked-away`;
  const win: ShellProfile[] = [
    { id: "powershell", name: "PowerShell 5.1", shell: "powershell.exe", args: ["-NoLogo"] },
    { id: "gitbash", name: "Git Bash", shell: "bash.exe", args: ["--login", "-i"] },
  ];
  const wsl = wslProfile(vault)!;
  const all = [wsl, ...win];

  it("is offered only for a vault on the WSL share", () => {
    expect(wsl).toEqual({ id: "wsl", name: "WSL (Ubuntu)", shell: "wsl.exe", args: ["-d", "Ubuntu", "--cd", "/home/pepzii/locked-away"], distro: "Ubuntu" });
    expect(wslProfile(String.raw`C:\Development\locked-away`)).toBeNull();
  });
  it("cds into the session's folder, converted to Linux", () => {
    expect(spawnArgs(wsl, `${vault}\\Projects\\a`)).toEqual(["-d", "Ubuntu", "--cd", "/home/pepzii/locked-away/Projects/a"]);
    expect(spawnArgs(wsl, String.raw`C:\elsewhere`)).toEqual(wsl.args);
    expect(spawnArgs(win[0]!, `${vault}\\x`)).toEqual(["-NoLogo"]);
  });
  it("is the default for the vault and its subfolders, whatever the saved default", () => {
    expect(chooseProfileId(vault, "powershell", all)).toBe("wsl");
    expect(chooseProfileId(`${vault}\\Projects`, "gitbash", all)).toBe("wsl");
  });
  it("a Windows folder keeps the saved Windows default (first native profile if the saved one is WSL or gone)", () => {
    expect(chooseProfileId(String.raw`C:\repo`, "gitbash", all)).toBe("gitbash");
    expect(chooseProfileId(String.raw`C:\repo`, "wsl", all)).toBe("powershell");
    expect(chooseProfileId(String.raw`C:\repo`, "pwsh", all)).toBe("powershell");
  });
  it("without a WSL vault nothing changes", () => {
    expect(chooseProfileId(String.raw`\\wsl$\Ubuntu\x`, "gitbash", win)).toBe("gitbash");
  });
  it("restored sessions in a WSL vault reopen in WSL; a Windows cwd falls back to the vault root", () => {
    const saved = [
      { id: "a", profileId: "powershell", cwd: String.raw`C:\Development\locked-away\Projects` },
      { id: "b", profileId: "gitbash", cwd: `${vault}\\Projects` },
    ];
    expect(adaptRestored(saved, vault)).toEqual([
      { id: "a", profileId: "wsl", cwd: vault },
      { id: "b", profileId: "wsl", cwd: `${vault}\\Projects` },
    ]);
    expect(adaptRestored(saved, String.raw`C:\Development\locked-away`)).toBe(saved);
  });
});

describe("Linux Obsidian in WSLg (plain Linux vault path): no WSL bridging", () => {
  const vault = "/home/pepzii/locked-away";
  const linux: ShellProfile[] = [{ id: "login", name: "Login shell (bash)", shell: "/bin/bash", args: ["-l"] }];
  it("no WSL profile, no share path, no adapter host", () => {
    expect(isWslUncPath(vault)).toBe(false);
    expect(parseWslUnc(vault)).toBeNull();
    expect(wslProfile(vault)).toBeNull();
  });
  it("sessions use the login shell and keep their args", () => {
    expect(chooseProfileId(vault, "powershell", linux)).toBe("login");
    expect(chooseProfileId(`${vault}/docs`, "login", linux)).toBe("login");
    expect(spawnArgs(linux[0]!, `${vault}/docs`)).toEqual(["-l"]);
  });
  it("restored sessions are left as saved (a Windows cwd falls back later via cwdExists)", () => {
    const saved = [{ id: "a", profileId: "powershell", cwd: String.raw`C:\Development\locked-away` }];
    expect(adaptRestored(saved, vault)).toBe(saved);
  });
});
