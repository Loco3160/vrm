export const DEFAULT_GENERATOR_HEALTHY_WATTS = 8_000;

export type GeneratorStatus = "HEALTHY_ON" | "ON_LOW_OUTPUT" | "OFF" | "UNKNOWN";

export interface DiagnosticRow {
  Device?: string;
  code?: string;
  description?: string;
  formattedValue?: string;
  rawValue?: unknown;
  timestamp?: number;
}

export interface EnergyStatus {
  observedAt: string | null;
  battery: {
    socPercent: number | null;
  };
  generator: {
    outputWatts: number | null;
    outputKilowatts: number | null;
    outputObservedAt: string | null;
    outputFresh: boolean | null;
    commandedOn: boolean | null;
    runReason: string | null;
    healthyThresholdWatts: number;
    on: boolean | null;
    healthy: boolean | null;
    status: GeneratorStatus;
  };
}

function numericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function isGeneratorOutput(row: DiagnosticRow): boolean {
  return /^gs\d+$/i.test(row.code ?? "")
    || /^genset\s+l\d+$/i.test(row.description ?? "");
}

function latestRow(rows: DiagnosticRow[]): DiagnosticRow | undefined {
  return [...rows].sort((left, right) => (right.timestamp ?? 0) - (left.timestamp ?? 0))[0];
}

export function buildEnergyStatus(
  rows: DiagnosticRow[],
  healthyThresholdWatts = DEFAULT_GENERATOR_HEALTHY_WATTS,
  freshnessSeconds = 300
): EnergyStatus {
  if (!Number.isFinite(healthyThresholdWatts) || healthyThresholdWatts < 0) {
    throw new Error("Generator healthy threshold must be a non-negative number");
  }

  const systemSoc = latestRow(rows.filter((row) => row.code?.toLowerCase() === "bs"));
  const batteryMonitorSoc = latestRow(rows.filter((row) => row.code === "SOC"));
  const socRow = systemSoc ?? batteryMonitorSoc;
  const socPercent = numericValue(socRow?.rawValue);

  const generatorRows = rows.filter(isGeneratorOutput);
  const latestDiagnosticTimestamp = Math.max(
    0,
    ...rows.map((row) => row.timestamp ?? 0)
  );
  const latestGeneratorTimestamp = Math.max(
    0,
    ...generatorRows.map((row) => row.timestamp ?? 0)
  );
  const generatorHasTimestamps = latestGeneratorTimestamp > 0 && latestDiagnosticTimestamp > 0;
  const outputFresh = generatorRows.length === 0
    ? null
    : !generatorHasTimestamps || latestDiagnosticTimestamp - latestGeneratorTimestamp <= freshnessSeconds;
  const generatorValues = generatorRows
    .map((row) => numericValue(row.rawValue))
    .filter((value): value is number => value !== null);

  let outputWatts = generatorValues.length > 0 && outputFresh !== false
    ? generatorValues.reduce((total, value) => total + value, 0)
    : null;
  const runReasonRow = latestRow(rows.filter((row) => row.code === "gaRC"));
  const runReasonValue = numericValue(runReasonRow?.rawValue);
  const runReasonFresh = runReasonRow?.timestamp === undefined
    || latestDiagnosticTimestamp === 0
    || latestDiagnosticTimestamp - runReasonRow.timestamp <= freshnessSeconds;
  const commandedOn = runReasonValue === null || !runReasonFresh ? null : runReasonValue !== 0;

  if (commandedOn === false) {
    outputWatts = 0;
  }
  const on = outputWatts === null ? null : outputWatts > 0;
  const healthy = outputWatts === null ? null : outputWatts > healthyThresholdWatts;

  let status: GeneratorStatus = "UNKNOWN";
  if (healthy) {
    status = "HEALTHY_ON";
  } else if (on) {
    status = "ON_LOW_OUTPUT";
  } else if (on === false) {
    status = "OFF";
  }

  const relevantTimestamps = [socRow, ...generatorRows]
    .map((row) => row?.timestamp)
    .filter((timestamp): timestamp is number => typeof timestamp === "number");
  const observedTimestamp = relevantTimestamps.length > 0 ? Math.max(...relevantTimestamps) : null;

  return {
    observedAt: observedTimestamp === null ? null : new Date(observedTimestamp * 1_000).toISOString(),
    battery: {
      socPercent
    },
    generator: {
      outputWatts,
      outputKilowatts: outputWatts === null ? null : outputWatts / 1_000,
      outputObservedAt: latestGeneratorTimestamp === 0
        ? null
        : new Date(latestGeneratorTimestamp * 1_000).toISOString(),
      outputFresh,
      commandedOn,
      runReason: runReasonRow?.formattedValue ?? null,
      healthyThresholdWatts,
      on,
      healthy,
      status
    }
  };
}
