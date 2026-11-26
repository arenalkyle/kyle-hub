import { describe, expect, it } from "vitest";
// @ts-expect-error plain JS module
import { parseVaults, pickVaultsRaw } from "../scripts/deploy.mjs";

describe("deploy env", () => {
  it("prefers KYLE_HUB_VAULTS, falls back to KYLE_TICKETS_VAULTS", () => {
    expect(pickVaultsRaw("KYLE_TICKETS_VAULTS=C:\a\nKYLE_HUB_VAULTS=C:\b")).toBe("C:\b");
    expect(pickVaultsRaw("KYLE_TICKETS_VAULTS=C:\a")).toBe("C:\a");
    expect(pickVaultsRaw("")).toBe("");
  });
  it("splits on ; for win32", () => {
    expect(parseVaults("C:\a; C:\b", "win32")).toEqual(["C:\a", "C:\b"]);
  });
  it("keeps a \\\\wsl.localhost UNC path intact on win32 (WSL vault first, Windows copy second)", () => {
    const raw = pickVaultsRaw(String.raw`KYLE_HUB_VAULTS=\\wsl.localhost\Ubuntu\home\pepzii\locked-away;C:\Development\locked-away`);
    expect(parseVaults(raw, "win32")).toEqual([String.raw`\\wsl.localhost\Ubuntu\home\pepzii\locked-away`, String.raw`C:\Development\locked-away`]);
    expect(parseVaults(String.raw`\\wsl$\Ubuntu\home\me\v`, "win32")).toEqual([String.raw`\\wsl$\Ubuntu\home\me\v`]);
  });
});
