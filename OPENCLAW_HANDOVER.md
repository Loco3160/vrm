# OpenClaw Handover: Kanoa Victron Generator Monitor

## Objective

Run a read-only Victron VRM check every 15–30 minutes and report when the generator is expected to be on but is off, unavailable, or producing 8 kW or less.

The monitor handles:

- normal-hours and quiet-hours SOC thresholds;
- SOC hysteresis between the start and stop thresholds;
- a 45-second generator startup grace period;
- a conservative 180-second cooldown grace period;
- stale VRM generator-power readings;
- persistent expected-state tracking between checks.

## Repository

```text
https://github.com/Loco3160/vrm.git
```

Use the `master` branch.

## Initial installation

Node.js 18 or newer is required.

```bash
git clone https://github.com/Loco3160/vrm.git
cd vrm
npm ci
npm run build
```

## Private local files

Two files must be transferred securely from the existing working installation. Neither file is committed to Git.

1. `.env`
2. `config/generator-settings.json`

Place them at the repository root using exactly those paths:

```text
vrm/.env
vrm/config/generator-settings.json
```

The `.env` file contains the Victron access token. Do not print, log, transmit in chat, or commit it. Its structure is:

```dotenv
VRM_TOKEN=<personal-access-token-value-only>
VRM_BASE_URL=https://vrmapi.victronenergy.com/v2
VRM_TOKEN_KIND=Token
```

Do not include the `Token ` prefix in `VRM_TOKEN`; the client adds it automatically.

The generator settings file contains the local SOC schedule and timing rules. A blank structural example is available at `config/generator-settings.example.json`, but the populated local file should be transferred from the existing installation.

The repository's `.gitignore` excludes both private files.

## Validate the installation

Run these commands from the repository root:

```bash
npm run generator-settings -- --validate
npm run status -- --json
npm run monitor -- --json
```

Expected outcomes:

- settings validation exits `0`;
- status JSON identifies the configured site and includes battery SOC and generator state;
- monitor JSON contains `expected`, `actual`, `verdict`, `alert`, and `message` fields.

Optional full verification:

```bash
npm run typecheck
npm test -- --run
```

## Scheduled command

Run this command every 15–30 minutes, with the process working directory set to the cloned repository:

```bash
npm run monitor -- --json
```

Do not allow overlapping monitor runs. Each run updates the ignored local state file:

```text
config/generator-monitor-state.json
```

The repository directory and `config` directory must therefore be writable by the OpenClaw process.

## Interpreting the JSON

Primary fields:

- `period`: `quiet-hours` or `normal-hours`.
- `socPercent`: current battery state of charge.
- `thresholds`: active SOC start/stop thresholds for the current period.
- `expected.on`: whether the stored rules say the generator should be on.
- `expected.since`: when the expected state last changed.
- `actual.on`: whether current VRM evidence says the generator is on.
- `actual.healthy`: true only when fresh generator output is greater than 8,000 W.
- `actual.outputFresh`: whether the power measurement is current rather than a stale last-known value.
- `actual.commandedOn`: the GX generator command/run-reason state when available.
- `verdict`: machine-readable outcome.
- `alert`: whether OpenClaw should notify the user.
- `message`: concise human explanation.

Notification policy:

1. If `alert` is `true`, notify the user immediately with SOC, expected state, actual state, output kW, period, verdict, and message.
2. If `verdict` is `STARTING` or `COOLING_DOWN`, do not alert; the generator is within a configured transition grace period.
3. If `verdict` is `NOTICE_UNEXPECTED_ON`, an informational notification is optional. It is not treated as an alarm because minimum-runtime, manual-run, or other GX rules may explain it.
4. If `verdict` is `OK`, no notification is required unless a periodic healthy-status message was explicitly requested.
5. If the command fails, times out, returns invalid JSON, or cannot reach VRM, notify that monitoring itself failed. Do not claim the generator is off.

For schedulers that use process exit codes, this command exits `1` only for monitor alerts and `2` for execution/configuration errors:

```bash
npm run monitor -- --json --check
```

Plain `--json` exits `0` after any successful check and communicates the decision through the `alert` field.

## Suggested alert text

```text
Kanoa generator alert
Battery SOC: <socPercent>%
Period: <period>
Expected: <expected.on>
Actual: <actual.on>
Output: <actual.outputKilowatts> kW
Verdict: <verdict>
<message>
```

Never include the VRM token or raw environment variables in notifications.

## Updating the deployment

From the repository root:

```bash
git pull --ff-only origin master
npm ci
npm run build
npm run generator-settings -- --validate
npm run monitor -- --json
```

`git pull` will not overwrite `.env`, `config/generator-settings.json`, or `config/generator-monitor-state.json` because they are ignored local files.

## Troubleshooting

- `VRM_TOKEN environment variable is required`: `.env` is missing, incorrectly located, or has an empty token.
- Authentication failure: confirm the personal access token has not been revoked and `VRM_TOKEN_KIND=Token`.
- Generator settings file not found: securely copy `config/generator-settings.json` into the clone.
- Invalid generator settings: run `npm run generator-settings -- --validate` and correct the reported field.
- Generator output looks old: inspect `actual.outputFresh`, `actual.outputObservedAt`, `actual.commandedOn`, and `actual.runReason`. The monitor deliberately rejects stale output as evidence that the generator is still running.
- Multiple scheduler executions: disable overlapping runs so the hysteresis state remains deterministic.
