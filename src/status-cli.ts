#!/usr/bin/env node
import dotenv from "dotenv";
import { VRMClient } from "./vrm-client.js";
import {
  buildEnergyStatus,
  DEFAULT_GENERATOR_HEALTHY_WATTS,
  type EnergyStatus
} from "./status.js";

interface CliOptions {
  check: boolean;
  help: boolean;
  json: boolean;
  siteId?: number;
  thresholdWatts: number;
}

interface Site {
  id: number;
  name: string;
}

function parseNumber(value: string | undefined, option: string): number {
  const parsed = Number(value);
  if (!value || !Number.isFinite(parsed)) {
    throw new Error(`${option} requires a number`);
  }
  return parsed;
}

export function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    check: false,
    help: false,
    json: false,
    thresholdWatts: DEFAULT_GENERATOR_HEALTHY_WATTS
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    switch (argument) {
      case "--check":
        options.check = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--json":
        options.json = true;
        break;
      case "--site-id":
        options.siteId = parseNumber(args[index + 1], "--site-id");
        index += 1;
        break;
      case "--threshold-watts":
        options.thresholdWatts = parseNumber(args[index + 1], "--threshold-watts");
        index += 1;
        break;
      default:
        throw new Error(`Unknown option: ${argument}`);
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`Victron VRM battery and generator status

Usage:
  vrm-status [options]
  npm run status -- [options]

Options:
  --json                    Output machine-readable JSON
  --check                   Exit 1 unless generator output is above the threshold
  --site-id <id>            Use a specific VRM site (auto-detected by default)
  --threshold-watts <watts> Healthy/on threshold (default: 8000)
  -h, --help                Show this help`);
}

function parseSite(record: any): Site | null {
  const id = Number(record?.idSite ?? record?.id);
  if (!Number.isFinite(id)) {
    return null;
  }

  return {
    id,
    name: typeof record?.name === "string" ? record.name : `Site ${id}`
  };
}

async function resolveSite(client: VRMClient, requestedSiteId?: number): Promise<Site> {
  const response = await client.listInstallations({ extended: false });
  if (!response.ok || !Array.isArray(response.data)) {
    throw new Error(response.error?.message ?? "Could not list VRM installations");
  }

  const sites = response.data.map(parseSite).filter((site): site is Site => site !== null);
  if (requestedSiteId !== undefined) {
    return sites.find((site) => site.id === requestedSiteId)
      ?? { id: requestedSiteId, name: `Site ${requestedSiteId}` };
  }

  if (sites.length === 0) {
    throw new Error("No VRM installations were found");
  }
  if (sites.length > 1) {
    const choices = sites.map((site) => `${site.name} (${site.id})`).join(", ");
    throw new Error(`Multiple installations found; use --site-id. Available: ${choices}`);
  }

  return sites[0];
}

function formatValue(value: number | null, suffix: string, digits = 1): string {
  return value === null ? "Unavailable" : `${value.toFixed(digits)} ${suffix}`;
}

function generatorLabel(status: EnergyStatus["generator"]["status"]): string {
  switch (status) {
    case "HEALTHY_ON":
      return "HEALTHY / ON";
    case "ON_LOW_OUTPUT":
      return "ON / BELOW HEALTHY OUTPUT";
    case "OFF":
      return "OFF";
    default:
      return "UNKNOWN";
  }
}

function printHuman(site: Site, status: EnergyStatus): void {
  console.log(`${site.name} VRM status`);
  console.log(`Battery SOC:      ${formatValue(status.battery.socPercent, "%")}`);
  console.log(`Generator:        ${generatorLabel(status.generator.status)}`);
  console.log(`Generator output: ${formatValue(status.generator.outputKilowatts, "kW", 2)}`);
  console.log(`Healthy when:     > ${(status.generator.healthyThresholdWatts / 1_000).toFixed(2)} kW`);
  console.log(`Observed at:      ${status.observedAt ?? "Unavailable"}`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  dotenv.config({ path: new URL("../.env", import.meta.url), quiet: true });
  const client = new VRMClient();
  const site = await resolveSite(client, options.siteId);
  const response = await client.getDiagnostics({ siteId: site.id, count: 1_000 });
  if (!response.ok || !Array.isArray(response.data)) {
    throw new Error(response.error?.message ?? "Could not retrieve VRM diagnostics");
  }

  const status = buildEnergyStatus(response.data, options.thresholdWatts);
  if (options.json) {
    console.log(JSON.stringify({ site, ...status }, null, 2));
  } else {
    printHuman(site, status);
  }

  if (options.check && status.generator.healthy !== true) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`vrm-status: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
});
