import type { GeneratorSettings } from "./generator-settings.js";
import type { EnergyStatus } from "./status.js";

export type MonitorPeriod = "quiet-hours" | "normal-hours";
export type MonitorVerdict =
  | "OK"
  | "STARTING"
  | "COOLING_DOWN"
  | "ALERT_NOT_RUNNING"
  | "ALERT_LOW_OUTPUT"
  | "ALERT_STATUS_UNKNOWN"
  | "NOTICE_UNEXPECTED_ON"
  | "UNKNOWN";

export interface GeneratorMonitorResult {
  checkedAt: string;
  localTime: string;
  timeZone: string;
  period: MonitorPeriod;
  socPercent: number | null;
  thresholds: {
    startAtOrBelowPercent: number | null;
    stopAtOrAbovePercent: number | null;
  };
  expected: {
    on: boolean | null;
    reason: string;
    since: string | null;
  };
  actual: EnergyStatus["generator"];
  verdict: MonitorVerdict;
  alert: boolean;
  message: string;
}

export interface PreviousExpectation {
  on: boolean | null;
  since: string | null;
}

function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function localTime(date: Date, timeZone: string): { text: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const hours = Number(parts.find((part) => part.type === "hour")?.value);
  const minutes = Number(parts.find((part) => part.type === "minute")?.value);
  return {
    text: `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`,
    minutes: hours * 60 + minutes
  };
}

export function isWithinTimeRange(currentMinutes: number, start: string, end: string): boolean {
  const startMinutes = timeToMinutes(start);
  const endMinutes = timeToMinutes(end);
  if (startMinutes === endMinutes) {
    return false;
  }
  if (startMinutes < endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }
  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

export function evaluateGeneratorMonitor(
  settings: GeneratorSettings,
  energyStatus: EnergyStatus,
  now = new Date(),
  previousExpectation: PreviousExpectation = { on: null, since: null }
): GeneratorMonitorResult {
  const time = localTime(now, settings.site.timeZone);
  const quietHours = settings.generator.quietHours;
  const isQuietHours = quietHours.enabled === true
    && quietHours.startTime !== null
    && quietHours.endTime !== null
    && isWithinTimeRange(time.minutes, quietHours.startTime, quietHours.endTime);
  const period: MonitorPeriod = isQuietHours ? "quiet-hours" : "normal-hours";

  const socSettings = settings.generator.soc;
  const startThreshold = isQuietHours
    ? socSettings.quietHoursStartBelowPercent ?? socSettings.startBelowPercent
    : socSettings.startBelowPercent;
  const stopThreshold = isQuietHours
    ? socSettings.quietHoursStopAbovePercent ?? socSettings.stopAbovePercent
    : socSettings.stopAbovePercent;
  const socPercent = energyStatus.battery.socPercent;

  let expectedOn: boolean | null = null;
  let reason = "SOC generator condition or thresholds are not configured";
  if (socSettings.enabled === true && socPercent !== null && startThreshold !== null && stopThreshold !== null) {
    if (socPercent <= startThreshold) {
      expectedOn = true;
      reason = `SOC ${socPercent}% is at or below the ${startThreshold}% start threshold`;
    } else if (socPercent >= stopThreshold) {
      expectedOn = false;
      reason = `SOC ${socPercent}% is at or above the ${stopThreshold}% stop threshold`;
    } else if (previousExpectation.on !== null) {
      expectedOn = previousExpectation.on;
      reason = `SOC ${socPercent}% is between thresholds; retaining the previous expected state`;
    } else if (energyStatus.generator.on !== null) {
      expectedOn = energyStatus.generator.on;
      reason = `SOC ${socPercent}% is between thresholds; initial state follows the observed generator state`;
    }
  }

  const expectedSince = expectedOn === null
    ? null
    : previousExpectation.on === expectedOn && previousExpectation.since !== null
      ? previousExpectation.since
      : now.toISOString();
  const secondsSinceExpectation = expectedSince === null
    ? null
    : Math.max(0, (now.getTime() - new Date(expectedSince).getTime()) / 1_000);
  const startupGraceSeconds = settings.generator.warmUpSeconds ?? 0;
  const cooldownGraceSeconds = settings.generator.coolDownSeconds ?? 0;

  const actual = energyStatus.generator;
  let verdict: MonitorVerdict = "UNKNOWN";
  let alert = false;
  let message = "Unable to determine whether the generator should be running";

  if (expectedOn === true) {
    if (actual.healthy === true) {
      verdict = "OK";
      message = "Generator is expected on and is producing healthy output";
    } else if (secondsSinceExpectation !== null && secondsSinceExpectation < startupGraceSeconds) {
      verdict = "STARTING";
      message = `Generator is within its ${startupGraceSeconds}-second startup grace period`;
    } else if (actual.on === true) {
      verdict = "ALERT_LOW_OUTPUT";
      alert = true;
      message = "Generator is expected on but output is below the healthy threshold";
    } else if (actual.on === false) {
      verdict = "ALERT_NOT_RUNNING";
      alert = true;
      message = "Generator is expected on but no generator output is detected";
    } else {
      verdict = "ALERT_STATUS_UNKNOWN";
      alert = true;
      message = "Generator is expected on but its live status is unavailable";
    }
  } else if (expectedOn === false) {
    if (actual.on === true) {
      if (secondsSinceExpectation !== null && secondsSinceExpectation < cooldownGraceSeconds) {
        verdict = "COOLING_DOWN";
        message = `Generator is within its ${cooldownGraceSeconds}-second cooldown period`;
      } else {
        verdict = "NOTICE_UNEXPECTED_ON";
        message = "Generator is running although the SOC rule says it may stop; timing or manual rules may explain this";
      }
    } else if (actual.on === false) {
      verdict = "OK";
      message = "Generator is not expected on and no output is detected";
    }
  }

  return {
    checkedAt: now.toISOString(),
    localTime: time.text,
    timeZone: settings.site.timeZone,
    period,
    socPercent,
    thresholds: {
      startAtOrBelowPercent: startThreshold,
      stopAtOrAbovePercent: stopThreshold
    },
    expected: {
      on: expectedOn,
      reason,
      since: expectedSince
    },
    actual,
    verdict,
    alert,
    message
  };
}
