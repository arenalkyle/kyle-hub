import { describe, expect, it } from "vitest";
import type { NetworkInterfaceInfo } from "node:os";
import { isWslUncPath, withWslEnv, wslAdapterAddress } from "../src/wsl";

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
