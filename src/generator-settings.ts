import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const nullableBoolean = z.boolean().nullable();
const nullableNonNegative = z.number().nonnegative().nullable();
const nullablePercent = z.number().min(0).max(100).nullable();
const nullableTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable();

const delayedConditionSchema = z.object({
  enabled: nullableBoolean,
  startDelaySeconds: nullableNonNegative,
  stopDelaySeconds: nullableNonNegative
}).strict();

export const generatorSettingsSchema = z.object({
  schemaVersion: z.literal(1),
  site: z.object({
    id: z.number().int().positive().nullable(),
    name: z.string().min(1)
  }).strict(),
  source: z.enum(["manual", "mqtt"]),
  updatedAt: z.string().datetime().nullable(),
  generator: z.object({
    soc: delayedConditionSchema.extend({
      startBelowPercent: nullablePercent,
      stopAbovePercent: nullablePercent,
      quietHoursStartBelowPercent: nullablePercent,
      quietHoursStopAbovePercent: nullablePercent
    }).strict(),
    acLoad: delayedConditionSchema.extend({
      startAboveWatts: nullableNonNegative,
      stopBelowWatts: nullableNonNegative
    }).strict(),
    batteryCurrent: delayedConditionSchema.extend({
      startAboveAmps: nullableNonNegative,
      stopBelowAmps: nullableNonNegative
    }).strict(),
    batteryVoltage: delayedConditionSchema.extend({
      startBelowVolts: nullableNonNegative,
      stopAboveVolts: nullableNonNegative
    }).strict(),
    inverterHighTemperature: delayedConditionSchema,
    inverterOverload: delayedConditionSchema,
    quietHours: z.object({
      enabled: nullableBoolean,
      startTime: nullableTime,
      endTime: nullableTime
    }).strict(),
    minimumRuntimeSeconds: nullableNonNegative,
    warmUpSeconds: nullableNonNegative,
    coolDownSeconds: nullableNonNegative,
    periodicRun: z.object({
      enabled: nullableBoolean,
      intervalDays: nullableNonNegative,
      startTime: nullableTime,
      runDurationMinutes: nullableNonNegative,
      skipIfRunWithinHours: nullableNonNegative
    }).strict(),
    notes: z.array(z.string())
  }).strict()
}).strict();

export type GeneratorSettings = z.infer<typeof generatorSettingsSchema>;

export const generatorSettingsUrl = new URL("../config/generator-settings.json", import.meta.url);

export function generatorSettingsPath(): string {
  return fileURLToPath(generatorSettingsUrl);
}

export async function loadGeneratorSettings(): Promise<GeneratorSettings> {
  let contents: string;
  try {
    contents = await readFile(generatorSettingsUrl, "utf8");
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      throw new Error(
        `Generator settings file not found at ${generatorSettingsPath()}. `
        + "Copy config/generator-settings.example.json to config/generator-settings.json."
      );
    }
    throw error;
  }

  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch {
    throw new Error(`Generator settings file is not valid JSON: ${generatorSettingsPath()}`);
  }

  const result = generatorSettingsSchema.safeParse(value);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Generator settings are invalid: ${details}`);
  }

  return result.data;
}

function display(value: string | number | boolean | null, suffix = ""): string {
  if (value === null) {
    return "Not set";
  }
  if (typeof value === "boolean") {
    return value ? "Enabled" : "Disabled";
  }
  return `${value}${suffix}`;
}

export function formatGeneratorSettings(settings: GeneratorSettings): string {
  const generator = settings.generator;
  const quietHoursPeriod = generator.quietHours.startTime && generator.quietHours.endTime
    ? `${generator.quietHours.startTime}–${generator.quietHours.endTime}`
    : "Not set";
  const lines = [
    `${settings.site.name} stored generator settings`,
    `Source:                  ${settings.source}`,
    `Updated:                 ${settings.updatedAt ?? "Not set"}`,
    "",
    "SOC condition",
    `  Enabled:               ${display(generator.soc.enabled)}`,
    `  Start below:           ${display(generator.soc.startBelowPercent, "%")}`,
    `  Stop above:            ${display(generator.soc.stopAbovePercent, "%")}`,
    `  Quiet-hours start:     ${display(generator.soc.quietHoursStartBelowPercent, "%")}`,
    `  Quiet-hours stop:      ${display(generator.soc.quietHoursStopAbovePercent, "%")}`,
    `  Start delay:           ${display(generator.soc.startDelaySeconds, " s")}`,
    `  Stop delay:            ${display(generator.soc.stopDelaySeconds, " s")}`,
    "",
    "Other conditions",
    `  AC load:               ${display(generator.acLoad.enabled)}`,
    `  Battery current:       ${display(generator.batteryCurrent.enabled)}`,
    `  Battery voltage:       ${display(generator.batteryVoltage.enabled)}`,
    `  Inverter temperature:  ${display(generator.inverterHighTemperature.enabled)}`,
    `  Inverter overload:     ${display(generator.inverterOverload.enabled)}`,
    "",
    "Timing",
    `  Quiet hours:           ${display(generator.quietHours.enabled)}`,
    `  Quiet-hours period:    ${quietHoursPeriod}`,
    `  Minimum runtime:       ${display(generator.minimumRuntimeSeconds, " s")}`,
    `  Warm-up:               ${display(generator.warmUpSeconds, " s")}`,
    `  Cooldown:              ${display(generator.coolDownSeconds, " s")}`,
    `  Periodic run:          ${display(generator.periodicRun.enabled)}`
  ];

  if (generator.notes.length > 0) {
    lines.push("", "Notes", ...generator.notes.map((note) => `  - ${note}`));
  }

  return lines.join("\n");
}
