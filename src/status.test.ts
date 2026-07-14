import { describe, expect, it } from "vitest";
import { buildEnergyStatus } from "./status.js";

describe("buildEnergyStatus", () => {
  it("reports battery SOC and a healthy running generator above 8 kW", () => {
    const status = buildEnergyStatus([
      { Device: "System overview", code: "bs", rawValue: 32, timestamp: 1_784_018_082 },
      { Device: "System overview", code: "gs1", rawValue: 10_032, timestamp: 1_784_018_082 }
    ]);

    expect(status.battery.socPercent).toBe(32);
    expect(status.generator.outputWatts).toBe(10_032);
    expect(status.generator.on).toBe(true);
    expect(status.generator.healthy).toBe(true);
    expect(status.generator.status).toBe("HEALTHY_ON");
  });

  it("requires output to be strictly greater than 8 kW", () => {
    const status = buildEnergyStatus([
      { code: "bs", rawValue: 50 },
      { code: "gs1", rawValue: 8_000 }
    ]);

    expect(status.generator.on).toBe(true);
    expect(status.generator.healthy).toBe(false);
    expect(status.generator.status).toBe("ON_LOW_OUTPUT");
  });

  it("reports an off generator at zero output", () => {
    const status = buildEnergyStatus([{ code: "gs1", rawValue: 0 }]);

    expect(status.generator.on).toBe(false);
    expect(status.generator.healthy).toBe(false);
    expect(status.generator.status).toBe("OFF");
  });

  it("sums output across generator phases", () => {
    const status = buildEnergyStatus([
      { code: "gs1", rawValue: 3_000 },
      { code: "gs2", rawValue: 3_000 },
      { code: "gs3", rawValue: 3_000 }
    ]);

    expect(status.generator.outputWatts).toBe(9_000);
    expect(status.generator.status).toBe("HEALTHY_ON");
  });

  it("falls back to the battery monitor SOC value", () => {
    const status = buildEnergyStatus([{ Device: "Battery Monitor", code: "SOC", rawValue: 74.5 }]);

    expect(status.battery.socPercent).toBe(74.5);
    expect(status.generator.status).toBe("UNKNOWN");
  });

  it("does not treat stale last-known power as running when the run reason is stopped", () => {
    const status = buildEnergyStatus([
      { code: "bs", rawValue: 46, timestamp: 2_000 },
      { code: "gaRC", rawValue: 0, formattedValue: "Stopped", timestamp: 2_000 },
      { code: "gs1", rawValue: 9_942, timestamp: 1_000 }
    ]);

    expect(status.generator.commandedOn).toBe(false);
    expect(status.generator.outputFresh).toBe(false);
    expect(status.generator.outputWatts).toBe(0);
    expect(status.generator.status).toBe("OFF");
  });

  it("reports unknown output when the generator is requested but power is stale", () => {
    const status = buildEnergyStatus([
      { code: "bs", rawValue: 30, timestamp: 2_000 },
      { code: "gaRC", rawValue: 4, formattedValue: "State of Charge", timestamp: 2_000 },
      { code: "gs1", rawValue: 9_000, timestamp: 1_000 }
    ]);

    expect(status.generator.commandedOn).toBe(true);
    expect(status.generator.outputWatts).toBeNull();
    expect(status.generator.status).toBe("UNKNOWN");
  });
});
