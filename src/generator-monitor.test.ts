import { describe, expect, it } from "vitest";
import type { GeneratorSettings } from "./generator-settings.js";
import { evaluateGeneratorMonitor, isWithinTimeRange } from "./generator-monitor.js";
import type { EnergyStatus } from "./status.js";

const settings: GeneratorSettings = {
  schemaVersion: 1,
  site: { id: 123456, name: "Test Site", timeZone: "Europe/London" },
  source: "manual",
  updatedAt: "2026-07-14T09:53:33Z",
  generator: {
    soc: {
      enabled: true,
      startBelowPercent: 40,
      stopAbovePercent: 70,
      quietHoursStartBelowPercent: 30,
      quietHoursStopAbovePercent: 50,
      startDelaySeconds: null,
      stopDelaySeconds: null
    },
    acLoad: { enabled: null, startAboveWatts: null, stopBelowWatts: null, startDelaySeconds: null, stopDelaySeconds: null },
    batteryCurrent: { enabled: null, startAboveAmps: null, stopBelowAmps: null, startDelaySeconds: null, stopDelaySeconds: null },
    batteryVoltage: { enabled: null, startBelowVolts: null, stopAboveVolts: null, startDelaySeconds: null, stopDelaySeconds: null },
    inverterHighTemperature: { enabled: null, startDelaySeconds: null, stopDelaySeconds: null },
    inverterOverload: { enabled: null, startDelaySeconds: null, stopDelaySeconds: null },
    quietHours: { enabled: true, startTime: "22:00", endTime: "07:00" },
    minimumRuntimeSeconds: null,
    warmUpSeconds: 45,
    coolDownSeconds: 180,
    periodicRun: { enabled: null, intervalDays: null, startTime: null, runDurationMinutes: null, skipIfRunWithinHours: null },
    notes: []
  }
};

function energy(socPercent: number, outputWatts: number): EnergyStatus {
  return {
    observedAt: "2026-07-14T09:00:00Z",
    battery: { socPercent },
    generator: {
      outputWatts,
      outputKilowatts: outputWatts / 1_000,
      outputObservedAt: "2026-07-14T09:00:00Z",
      outputFresh: true,
      commandedOn: outputWatts > 0,
      runReason: outputWatts > 0 ? "State of Charge" : "Stopped",
      healthyThresholdWatts: 8_000,
      on: outputWatts > 0,
      healthy: outputWatts > 8_000,
      status: outputWatts > 8_000 ? "HEALTHY_ON" : outputWatts > 0 ? "ON_LOW_OUTPUT" : "OFF"
    }
  };
}

describe("generator monitor", () => {
  it("handles quiet hours that cross midnight", () => {
    expect(isWithinTimeRange(6 * 60, "22:00", "07:00")).toBe(true);
    expect(isWithinTimeRange(10 * 60, "22:00", "07:00")).toBe(false);
    expect(isWithinTimeRange(23 * 60, "22:00", "07:00")).toBe(true);
  });

  it("uses quiet-hour thresholds in the morning", () => {
    const result = evaluateGeneratorMonitor(settings, energy(30, 9_000), new Date("2026-07-14T05:00:00Z"));

    expect(result.period).toBe("quiet-hours");
    expect(result.expected.on).toBe(true);
    expect(result.verdict).toBe("OK");
  });

  it("allows startup time when the normal threshold first calls for the generator", () => {
    const result = evaluateGeneratorMonitor(settings, energy(40, 0), new Date("2026-07-14T14:00:00Z"));

    expect(result.period).toBe("normal-hours");
    expect(result.expected.on).toBe(true);
    expect(result.verdict).toBe("STARTING");
    expect(result.alert).toBe(false);
  });

  it("retains the prior expected state inside the hysteresis band", () => {
    const result = evaluateGeneratorMonitor(
      settings,
      energy(40, 9_000),
      new Date("2026-07-14T05:00:00Z"),
      { on: true, since: "2026-07-14T04:00:00Z" }
    );

    expect(result.expected.on).toBe(true);
    expect(result.expected.reason).toContain("retaining the previous expected state");
  });

  it("alerts when the generator should be on but output is low", () => {
    const result = evaluateGeneratorMonitor(
      settings,
      energy(25, 5_000),
      new Date("2026-07-14T05:00:00Z"),
      { on: true, since: "2026-07-14T04:59:00Z" }
    );

    expect(result.verdict).toBe("ALERT_LOW_OUTPUT");
    expect(result.alert).toBe(true);
  });

  it("allows the configured cooldown after the stop threshold is reached", () => {
    const result = evaluateGeneratorMonitor(settings, energy(70, 9_000), new Date("2026-07-14T14:00:00Z"));

    expect(result.expected.on).toBe(false);
    expect(result.verdict).toBe("COOLING_DOWN");
    expect(result.alert).toBe(false);
  });
});
