#!/usr/bin/env node
import {
  formatGeneratorSettings,
  generatorSettingsPath,
  loadGeneratorSettings
} from "./generator-settings.js";

function printHelp(): void {
  console.log(`Stored Victron generator settings

Usage:
  vrm-generator-settings [--json | --path | --validate]
  npm run generator-settings -- [--json | --path | --validate]

Options:
  --json      Output the stored settings as JSON
  --path      Print the local settings file path
  --validate  Validate the file and print a confirmation
  -h, --help  Show this help`);
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const allowed = new Set(["--json", "--path", "--validate", "--help", "-h"]);
  const unknown = [...args].find((argument) => !allowed.has(argument));
  if (unknown) {
    throw new Error(`Unknown option: ${unknown}`);
  }

  if (args.has("--help") || args.has("-h")) {
    printHelp();
    return;
  }
  if (args.has("--path")) {
    console.log(generatorSettingsPath());
    return;
  }

  const settings = await loadGeneratorSettings();
  if (args.has("--validate")) {
    console.log(`Generator settings are valid: ${generatorSettingsPath()}`);
  } else if (args.has("--json")) {
    console.log(JSON.stringify(settings, null, 2));
  } else {
    console.log(formatGeneratorSettings(settings));
  }
}

main().catch((error) => {
  console.error(`vrm-generator-settings: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
});
