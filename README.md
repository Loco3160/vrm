# Victron VRM MCP Server

A Model Context Protocol (MCP) server that provides read-only access to Victron VRM data.

This repository is based on [gimi-q/victron-vrm-mcp](https://github.com/gimi-q/victron-vrm-mcp) and is configured for `Loco3160/vrm`.

## Features

- Read-only access to Victron VRM API v2
- Complete implementation of all 41 GET endpoints
- Supports comprehensive VRM monitoring:
  - User & authentication management
  - Installation discovery and search
  - Real-time system overview
  - Time-series statistics and forecasts
  - Aggregated energy totals
  - Alarms and warnings
  - Detailed diagnostics
  - 20+ widget endpoints for specific device data
  - Data export in CSV/Excel formats
  - GPS tracking for mobile installations
- Full input validation and error handling
- Rate limiting awareness (200 requests rolling window)
- Comprehensive test coverage

## Installation

```bash
npm install
npm run build
cp .env.example .env
```

## Configuration

Set the following environment variables:

- `VRM_TOKEN` (required): Your VRM personal access token
- `VRM_BASE_URL` (optional): Default is `https://vrmapi.victronenergy.com/v2`
- `VRM_TOKEN_KIND` (optional): Either `Token` (default) or `Bearer`

This repository already includes an ignored local `.env` with empty token placeholder and a tracked `.env.example` template. Add your token to `.env`:

```
VRM_TOKEN=paste-your-personal-access-token-here
VRM_BASE_URL=https://vrmapi.victronenergy.com/v2
VRM_TOKEN_KIND=Token
```

Do not commit `.env`; it is excluded by `.gitignore`.

### Getting a VRM Token

1. Log into VRM Portal
2. Go to Preferences → Integrations → Access tokens
3. Create a new personal access token
4. Copy the token and set it as `VRM_TOKEN`

## Usage

### As MCP Server (stdio)

```bash
# After adding your token to .env
npm run build
npm start
```

### Claude Desktop Configuration

Add to your Claude Desktop config:

```json
{
  "mcpServers": {
    "vrm": {
      "command": "node",
      "args": ["/Users/calumsmeaton/Documents/vrm 2/dist/index.js"]
    }
  }
}
```

The server resolves `.env` from the project directory, so the token does not need to be copied into the MCP client configuration.

## Battery and Generator Status CLI

Build the project, then run the status command:

```bash
npm run build
npm run status
```

The CLI auto-detects your installation and reports battery state of charge plus generator output. Generator output strictly above 8,000 W is classified as `HEALTHY / ON`; output from 1–8,000 W is `ON / BELOW HEALTHY OUTPUT`, and zero output is `OFF`.

For scripts and monitoring:

```bash
# Machine-readable output
npm run status:json

# Exit with status 1 unless the generator is healthy/on
npm run status -- --check

# Override the site or threshold
npm run status -- --site-id 123456 --threshold-watts 8000
```

### Stored generator settings

Generator automation settings can be recorded locally in `config/generator-settings.json`. This file is ignored by Git; the repository includes `config/generator-settings.example.json` as a safe template.

```bash
# Display the stored settings
npm run generator-settings

# Validate or output them as JSON
npm run generator-settings -- --validate
npm run generator-settings -- --json

# Show live status alongside the stored settings
npm run status -- --settings
```

### Generator expectation monitor

The monitor applies the stored quiet-hours schedule, SOC hysteresis, startup grace, and cooldown grace to the live VRM data. It remembers the expected state and transition time between checks.

```bash
# Human-readable result
npm run monitor

# JSON output suitable for OpenClaw or another scheduler
npm run monitor -- --json

# Exit 1 when the generator should be on but is off or below 8 kW
npm run monitor -- --check
```

The schedule and SOC thresholds come from the ignored local settings file. The monitor's hysteresis state is stored in ignored file `config/generator-monitor-state.json`.

## Available Tools (41 Total)

### Core Monitoring (8 tools)
- `vrm_get_user_me` - Get current user information including user ID
- `vrm_list_installations` - List all installations accessible to the user
- `vrm_get_system_overview` - Get high-level system overview for a site
- `vrm_get_stats` - Time-series statistics (venus, live_feed, consumption, kwh, solar_yield, forecast)
- `vrm_get_overall_stats` - Aggregated totals for attribute codes over a period
- `vrm_get_alarms` - Retrieve alarms for a site
- `vrm_get_diagnostics` - Get most recent diagnostic datapoints
- `vrm_get_widget_graph` - Widget graph data for specific device instances

### Authentication & User Management (4 tools)
- `vrm_auth_login_as_demo` - Login as demo account
- `vrm_auth_logout` - Logout from current session
- `vrm_search_user_installations` - Search through user's installations

### Data Export & Downloads (5 tools)
- `vrm_download_installation_data` - Download data in CSV/Excel formats with optional parsing
- `vrm_download_gps_data` - Download GPS tracking data
- `vrm_get_installation_tags` - Get installation tags and labels
- `vrm_get_custom_widget` - Get custom widget configuration
- `vrm_get_dynamic_ess_settings` - Get Dynamic ESS configuration

### Widget State Monitoring (7 tools)
- `vrm_get_vebus_state` - VE.Bus system state
- `vrm_get_inverter_charger_state` - Inverter/charger operational state
- `vrm_get_charger_relay_state` - Charger relay switching status
- `vrm_get_solar_charger_relay_state` - Solar charger relay state
- `vrm_get_gateway_relay_state` - Gateway relay state
- `vrm_get_gateway_relay_two_state` - Secondary gateway relay state
- `vrm_get_status_widget` - General system status

### Warnings & Alarms (2 tools)
- `vrm_get_vebus_warnings_alarms` - VE.Bus system warnings and alarms
- `vrm_get_inverter_charger_warnings_alarms` - Inverter/charger warnings

### Device Summaries (9 tools)
- `vrm_get_battery_summary` - Battery voltage, current, SoC, health
- `vrm_get_solar_charger_summary` - MPPT performance and yield
- `vrm_get_ev_charger_summary` - EV charging status and power
- `vrm_get_global_link_summary` - GlobalLink device summary
- `vrm_get_motor_summary` - Motor drive RPM and power
- `vrm_get_pv_inverter_status` - PV inverter AC output status
- `vrm_get_tank_summary` - Tank levels and capacity
- `vrm_get_temp_summary_graph` - Temperature sensors and graphs
- `vrm_get_dc_meter` - DC power meter readings

### Advanced Diagnostics (4 tools)
- `vrm_get_bms_diagnostics` - BMS cell voltages and balancing
- `vrm_get_lithium_bms` - Lithium battery BMS data
- `vrm_get_historic_data` - Historic data trends
- `vrm_get_io_extender` - IO extender digital/analog signals

### System-Wide Information (3 tools)
- `vrm_get_data_attributes` - System-wide data attributes
- `vrm_get_firmwares` - Available firmware versions
- `vrm_get_reset_forecasts` - Forecast reset timestamps

## Example Usage in Claude

Once configured, you can ask Claude to:

- "Show me my solar system's current status"
- "What's my battery state of charge?"
- "Download today's energy data as CSV"
- "Check for any system alarms"
- "Show me solar production for the last week"
- "Get battery voltage trends"
- "Export monthly energy totals"

Claude will use the appropriate VRM tools to fetch and analyze your Victron system data.

## Development

```bash
# Run tests
npm test

# Run tests with UI
npm run test:ui

# Type checking
npm run typecheck

# Development mode with watch
npm run dev
```

## Testing

The project includes comprehensive unit tests for:
- Schema validation
- VRM client functionality
- MCP server integration
- Error handling
- Edge cases

Run tests with:

```bash
npm test
```

## Security

- Never logs tokens or sensitive data
- Strict path allowlisting
- Input validation on all tools
- Read-only operations only

## License

ISC
