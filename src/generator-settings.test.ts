import { describe, expect, it } from "vitest";
import { formatGeneratorSettings, generatorSettingsSchema } from "./generator-settings.js";

const validSettings = {
  schemaVersion: 1 as const,
  site: { id: 123456, name: "Test Site" },
  source: "manual" as const,
  updatedAt: null,
  generator: {
    soc: {
      enabled: true,
      startBelowPercent: 30,
      stopAbovePercent: 60,
      quietHoursStartBelowPercent: 20,
      quietHoursStopAbovePercent: 50,
      startDelaySeconds: 60,
      stopDelaySeconds: 120
    },
    acLoad: { enabled: false, startAboveWatts: null, stopBelowWatts: null, startDelaySeconds: null, stopDelaySeconds: null },
    batteryCurrent: { enabled: false, startAboveAmps: null, stopBelowAmps: null, startDelaySeconds: null, stopDelaySeconds: null },
    batteryVoltage: { enabled: false, startBelowVolts: null, stopAboveVolts: null, startDelaySeconds: null, stopDelaySeconds: null },
    inverterHighTemperature: { enabled: false, startDelaySeconds: null, stopDelaySeconds: null },
    inverterOverload: { enabled: false, startDelaySeconds: null, stopDelaySeconds: null },
    quietHours: { enabled: true, startTime: "22:00", endTime: "07:00" },
    minimumRuntimeSeconds: 300,
    warmUpSeconds: 30,
    coolDownSeconds: 60,
    periodicRun: { enabled: false, intervalDays: null, startTime: null, runDurationMinutes: null, skipIfRunWithinHours: null },
    notes: []
  }
};

describe("generator settings", () => {
  it("validates a complete settings file", () => {
    expect(generatorSettingsSchema.parse(validSettings)).toEqual(validSettings);
  });

  it("rejects SOC percentages outside 0-100", () => {
    const invalid = structuredClone(validSettings);
    invalid.generator.soc.startBelowPercent = 101;

    expect(generatorSettingsSchema.safeParse(invalid).success).toBe(false);
  });

  it("formats settings for the CLI", () => {
    const output = formatGeneratorSettings(validSettings);

    expect(output).toContain("Test Site stored generator settings");
    expect(output).toContain("Start below:           30%");
    expect(output).toContain("Quiet-hours period:    22:00–07:00");
  });
});
