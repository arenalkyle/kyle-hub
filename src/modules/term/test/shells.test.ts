import { describe, expect, it } from "vitest";
import { detectProfiles, pickProfileId, type DetectDeps } from "../src/shells";

const deps = (o: Partial<DetectDeps> & { found?: string[]; files?: string[] }): DetectDeps => ({
  platform: "win32",
  env: { ProgramFiles: "C:\\Program Files" },
  exists: (p) => (o.files ?? []).includes(p),
  where: (c) => (o.found ?? []).includes(c) ? `C:\\x\\${c}.exe` : null,
  ...o,
});

describe("detectProfiles", () => {
  it("always lists PowerShell 5.1 first and cmd last", () => {
    const p = detectProfiles(deps({}));
    expect(p.map((x) => x.id)).toEqual(["powershell", "cmd"]);
  });
  it("lists pwsh and Git Bash only when found", () => {
    const p = detectProfiles(deps({ found: ["pwsh"], files: ["C:\\Program Files\\Git\\bin\\bash.exe"] }));
    expect(p.map((x) => x.id)).toEqual(["powershell", "pwsh", "gitbash", "cmd"]);
  });
  it("derives bash from where git", () => {
    const p = detectProfiles(deps({ where: (c) => (c === "git" ? "D:\\G\\cmd\\git.exe" : null), files: ["D:\\G\\bin\\bash.exe"] }));
    expect(p.find((x) => x.id === "gitbash")?.shell).toBe("D:\\G\\bin\\bash.exe");
  });
  it("a saved profile that is no longer detected falls back to the first", () => {
    const p = detectProfiles(deps({}));
    expect(pickProfileId("gitbash", p)).toBe("powershell");
    expect(pickProfileId("cmd", p)).toBe("cmd");
  });
});

describe("detectProfiles on macOS", () => {
  const mac = (env: Record<string, string>, files: string[]): DetectDeps => ({
    platform: "darwin", env, exists: (p) => files.includes(p), where: () => null,
  });
  it("puts the login shell first, as a login shell, then the other of zsh/bash", () => {
    const p = detectProfiles(mac({ SHELL: "/bin/zsh" }, ["/bin/zsh", "/bin/bash"]));
    expect(p.map((x) => [x.id, x.shell, x.args.join(" ")])).toEqual([
      ["login", "/bin/zsh", "-l"], ["bash", "/bin/bash", "-l"],
    ]);
    expect(pickProfileId("powershell", p)).toBe("login");
  });
  it("falls back to zsh and bash when SHELL is unset", () => {
    expect(detectProfiles(mac({}, ["/bin/zsh", "/bin/bash"])).map((x) => x.id)).toEqual(["zsh", "bash"]);
  });
});
