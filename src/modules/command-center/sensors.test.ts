import { describe, expect, it } from "vitest";
import { METRICS, parseNvidiaSmi, sparkPoints, type SensorSample } from "./sensors";

describe("parseNvidiaSmi", () => {
  it("parses a csv line", () => {
    expect(parseNvidiaSmi("NVIDIA GeForce RTX 3070, 12, 1024, 8192, 45, 38.50\n")).toEqual({ name: "NVIDIA GeForce RTX 3070", load: 12, memUsedMb: 1024, memTotalMb: 8192, tempC: 45, powerW: 38.5 });
  });
  it("returns undefined for empty output", () => expect(parseNvidiaSmi("")).toBeUndefined());
});

describe("sparkPoints", () => {
  it("right-aligns samples within capacity", () => {
    const h: SensorSample[] = [{ at: 0, cpuLoad: 100, ramUsedGb: 1, ramTotalGb: 2 }];
    expect(sparkPoints(h, METRICS[0]!, 100, 10, 2)).toBe("100.0,0.0");
  });
});
