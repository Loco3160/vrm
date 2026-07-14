#!/usr/bin/env node
import { readFile, rename, writeFile } from "node:fs/promises";
import dotenv from "dotenv";
import { z } from "zod";
import {
  evaluateGeneratorMonitor,
  type GeneratorMonitorResult,
  type PreviousExpectation
} from "./generator-monitor.js";
import { loadGeneratorSettings } from "./generator-settings.js";
import { buildEnergyStatus, DEFAULT_GENERATOR_HEALTHY_WATTS } from "./status.js";
import { VRMClient } from "./vrm-client.js";

const stateUrl = new URL("../config/generator-monitor-state.json", import.meta.url);
const stateSchema = z.object({
  siteId: z.number().int().positive(),
  expectedOn: z.boolean().nullable(),
  expectedSince: z.string().datetime().nullable().optional(),
  updatedAt: z.string().datetime()
}).strict();

interface Options {
  check: boolean;
  help: boolean;
  json: boolean;
  thresholdWatts: number;
}

function parseArgs(args: string[]): Options {
  const options: Options = {
    check: false,
    help: false,
    json: false,
    thresholdWatts: DEFAULT_GENERATOR_HEALTHY_WATTS
  };
  for (let index = 0; index < args.length; index += 1) {
    switch (args[index]) {
      case "--check":
        options.check = true;
        break;
      case "--json":
        options.json = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--threshold-watts": {
        const value = Number(args[index + 1]);
        if (!Number.isFinite(value) || value < 0) {
          throw new Error("--threshold-watts requires a non-negative number");
        }
        options.thresholdWatts = value;
        index += 1;
        break;
      }
      default:
        throw new Error(`Unknown option: ${args[index]}`);
    }
  }
  return options;
}

function printHelp(): void {
  console.log(`Victron generator expectation monitor

Usage:
  npm run monitor -- [--json] [--check]

Options:
  --json                    Output machine-readable JSON for automation
  --check                   Exit 1 when an alert is detected
  --threshold-watts <watts> Healthy generator output threshold (default: 8000)
  -h, --help                Show this help`);
}

async function loadPreviousExpectation(siteId: number): Promise<PreviousExpectation> {
  try {
    const parsed = stateSchema.safeParse(JSON.parse(await readFile(stateUrl, "utf8")));
    if (parsed.success && parsed.data.siteId === siteId) {
      return {
        on: parsed.data.expectedOn,
        since: parsed.data.expectedSince ?? parsed.data.updatedAt
      };
    }
    return { on: null, since: null };
  } catch (error: any) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) {
      return { on: null, since: null };
    }
    throw error;
  }
}

async function saveExpectedOn(siteId: number, result: GeneratorMonitorResult): Promise<void> {
  const temporaryUrl = new URL("generator-monitor-state.json.tmp", stateUrl);
  const value = {
    siteId,
    expectedOn: result.expected.on,
    expectedSince: result.expected.since,
    updatedAt: result.checkedAt
  };
  await writeFile(temporaryUrl, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryUrl, stateUrl);
}

function onOff(value: boolean | null): string {
  return value === null ? "UNKNOWN" : value ? "ON" : "OFF";
}

function printHuman(siteName: string, result: GeneratorMonitorResult): void {
  const output = result.actual.outputKilowatts === null
    ? "Unavailable"
    : `${result.actual.outputKilowatts.toFixed(2)} kW`;
  console.log(`${siteName} generator monitor`);
  console.log(`Time:       ${result.localTime} ${result.timeZone} (${result.period})`);
  console.log(`Battery:    ${result.socPercent === null ? "Unavailable" : `${result.socPercent.toFixed(1)}%`}`);
  console.log(`Rule:       ON <= ${result.thresholds.startAtOrBelowPercent ?? "?"}%, OFF >= ${result.thresholds.stopAtOrAbovePercent ?? "?"}%`);
  console.log(`Expected:   ${onOff(result.expected.on)}`);
  console.log(`Since:      ${result.expected.since ?? "Unknown"}`);
  console.log(`Actual:     ${onOff(result.actual.on)} / ${output} / ${result.actual.healthy ? "healthy" : "not healthy"}`);
  console.log(`Verdict:    ${result.verdict}`);
  console.log(`Reason:     ${result.expected.reason}`);
  console.log(`Message:    ${result.message}`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  dotenv.config({ path: new URL("../.env", import.meta.url), quiet: true });
  const settings = await loadGeneratorSettings();
  if (settings.site.id === null) {
    throw new Error("The stored generator settings require a site ID");
  }

  const client = new VRMClient();
  const response = await client.getDiagnostics({ siteId: settings.site.id, count: 1_000 });
  if (!response.ok || !Array.isArray(response.data)) {
    throw new Error(response.error?.message ?? "Could not retrieve VRM diagnostics");
  }

  const energyStatus = buildEnergyStatus(response.data, options.thresholdWatts);
  const previousExpectation = await loadPreviousExpectation(settings.site.id);
  const result = evaluateGeneratorMonitor(settings, energyStatus, new Date(), previousExpectation);
  await saveExpectedOn(settings.site.id, result);

  if (options.json) {
    console.log(JSON.stringify({ site: settings.site, ...result }, null, 2));
  } else {
    printHuman(settings.site.name, result);
  }
  if (options.check && result.alert) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`vrm-monitor: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
});
