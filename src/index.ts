#!/usr/bin/env node
// Only load the project .env file if VRM_TOKEN is not already set.
// Resolving it relative to this module lets MCP clients launch the server from
// any working directory.
if (!process.env.VRM_TOKEN) {
  // Temporarily silence all output during dotenv loading
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  
  // Silence all output
  process.stdout.write = () => true;
  process.stderr.write = () => true;
  console.log = () => {};
  console.error = () => {};
  
  try {
    const dotenv = await import("dotenv");
    dotenv.config({ path: new URL("../.env", import.meta.url) });
  } finally {
    // Restore all output functions
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  }
}

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { VRMClient } from "./vrm-client.js";

const server = new Server(
  {
    name: "vrm-readonly",
    version: "0.1.0"
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

const vrmClient = new VRMClient();

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools = [
      {
        name: "vrm_get_user_me",
        description: "Get your VRM account information and user profile.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false
        }
      },
      {
        name: "vrm_list_installations",
        description: "List all your Victron energy installations/sites (solar systems, batteries, etc.).",
        inputSchema: {
          type: "object",
          properties: {
            idUser: { type: "number", description: "User ID (optional - will auto-detect if not provided)" },
            extended: { type: "boolean", description: "Include extended information about installations" }
          },
          additionalProperties: false
        }
      },
      {
        name: "vrm_get_system_overview",
        description: "Get current status of your energy system including battery level, solar production, consumption, and grid usage.",
        inputSchema: {
          type: "object",
          required: ["siteId"],
          properties: {
            siteId: { type: "number", description: "Installation/site ID to get overview for" }
          },
          additionalProperties: false
        }
      },
      {
        name: "vrm_get_stats",
        description: "Get time-series data for solar production, battery usage, consumption, energy yield, and forecasts over time.",
        inputSchema: {
          type: "object",
          required: ["siteId", "type"],
          properties: {
            siteId: { type: "number", description: "Installation/site ID" },
            type: { type: "string", enum: ["venus", "live_feed", "consumption", "kwh", "solar_yield", "forecast"], description: "Type of stats to retrieve" },
            interval: { type: "string", description: "Time interval (e.g., '15mins', 'hours', 'days')", default: "15mins" },
            start: { type: "number", description: "Start time as epoch milliseconds" },
            end: { type: "number", description: "End time as epoch milliseconds" },
            attributeCodes: { type: "array", items: { type: "string" }, description: "Array of attribute codes to filter specific data points" },
            show_instance: { type: "boolean", description: "Whether to show device instance information in response" }
          },
          additionalProperties: false
        }
      },
      {
        name: "vrm_get_overall_stats",
        description: "Get aggregated energy totals (daily, monthly, yearly) for solar yield, consumption, battery performance, etc.",
        inputSchema: {
          type: "object",
          required: ["siteId", "attributeCodes"],
          properties: {
            siteId: { type: "number", description: "Installation/site ID" },
            type: { type: "string", enum: ["custom", "today", "yesterday", "month", "year"], description: "Time period type", default: "custom" },
            attributeCodes: { type: "array", items: { type: "string" }, minItems: 1, description: "Array of attribute codes to get totals for (e.g., ['Pb', 'Pc', 'kwh'])" },
            start: { type: "number", description: "Start time as epoch milliseconds (for custom type)" },
            end: { type: "number", description: "End time as epoch milliseconds (for custom type)" }
          },
          additionalProperties: false
        }
      },
      {
        name: "vrm_get_alarms",
        description: "Check for any system alarms or alerts from your solar/battery installation. Supports historical time ranges to retrieve past alarms and warnings.",
        inputSchema: {
          type: "object",
          required: ["siteId"],
          properties: {
            siteId: { type: "number", description: "Installation/site ID" },
            activeOnly: { type: "boolean", description: "Show only active alarms", default: false },
            page: { type: "number", minimum: 1, description: "Page number for pagination" },
            pageSize: { type: "number", minimum: 1, maximum: 200, description: "Number of alarms per page" },
            start: { type: "number", description: "Start time as epoch milliseconds for historical alarms" },
            end: { type: "number", description: "End time as epoch milliseconds for historical alarms" },
            from: { type: "number", description: "Alternative start time parameter" },
            to: { type: "number", description: "Alternative end time parameter" }
          },
          additionalProperties: false
        }
      },
      {
        name: "vrm_get_diagnostics",
        description: "Get detailed diagnostic data and technical readings from your energy system devices.",
        inputSchema: {
          type: "object",
          required: ["siteId"],
          properties: {
            siteId: { type: "number", description: "Installation/site ID" },
            count: { type: "number", minimum: 1, maximum: 1000, description: "Number of diagnostic records to retrieve", default: 200 },
            offset: { type: "number", minimum: 0, description: "Offset for pagination" }
          },
          additionalProperties: false
        }
      },
      {
        name: "vrm_get_widget_graph",
        description: "Get specific device performance graphs (battery voltage, inverter output, solar panel data, etc.).",
        inputSchema: {
          type: "object",
          required: ["siteId", "attributeCodes", "instance"],
          properties: {
            siteId: { type: "number", description: "Installation/site ID" },
            attributeCodes: { type: "array", items: { type: "string" }, minItems: 1, description: "Array of attribute codes for the graph data" },
            instance: { type: "number", description: "Device instance ID" }
          },
          additionalProperties: false
        }
      },
      
      // Batch 1: Authentication & User Management
      {
        name: "vrm_auth_login_as_demo",
        description: "Login as a demo account to explore VRM functionality.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false
        }
      },
      {
        name: "vrm_auth_logout",
        description: "Logout from the current VRM session.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false
        }
      },
      {
        name: "vrm_search_user_installations",
        description: "Search through user's installations with optional filters.",
        inputSchema: {
          type: "object",
          required: ["idUser"],
          properties: {
            idUser: { type: "number", description: "User ID to search installations for" },
            query: { type: "string", description: "Search query string" },
            limit: { type: "number", minimum: 1, maximum: 100, description: "Maximum number of results" }
          },
          additionalProperties: false
        }
      },
      
      // Batch 2: Installation Data & Downloads
      {
        name: "vrm_download_installation_data",
        description: "Download installation data in various formats (CSV, Excel) with optional parsing for CSV.",
        inputSchema: {
          type: "object",
          required: ["siteId"],
          properties: {
            siteId: { type: "number", description: "Installation/site ID" },
            start: { type: "number", description: "Start timestamp (epoch milliseconds)" },
            end: { type: "number", description: "End timestamp (epoch milliseconds)" },
            datatype: { type: "string", enum: ["log", "benchmark", "kwh"], description: "Type of data to download", default: "log" },
            format: { type: "string", enum: ["csv", "excelxml", "xls", "xlsx"], description: "File format", default: "csv" },
            decode: { type: "boolean", description: "Whether to decode and parse CSV data", default: true }
          },
          additionalProperties: false
        }
      },
      {
        name: "vrm_download_gps_data",
        description: "Download GPS tracking data for mobile installations.",
        inputSchema: {
          type: "object",
          required: ["siteId"],
          properties: {
            siteId: { type: "number", description: "Installation/site ID" },
            start: { type: "number", description: "Start timestamp (epoch milliseconds)" },
            end: { type: "number", description: "End timestamp (epoch milliseconds)" }
          },
          additionalProperties: false
        }
      },
      {
        name: "vrm_get_installation_tags",
        description: "Get tags and labels associated with an installation.",
        inputSchema: {
          type: "object",
          required: ["siteId"],
          properties: {
            siteId: { type: "number", description: "Installation/site ID" }
          },
          additionalProperties: false
        }
      },
      {
        name: "vrm_get_custom_widget",
        description: "Get custom widget configuration for an installation.",
        inputSchema: {
          type: "object",
          required: ["siteId"],
          properties: {
            siteId: { type: "number", description: "Installation/site ID" }
          },
          additionalProperties: false
        }
      },
      {
        name: "vrm_get_dynamic_ess_settings",
        description: "Get Dynamic ESS (Energy Storage System) configuration settings.",
        inputSchema: {
          type: "object",
          required: ["siteId"],
          properties: {
            siteId: { type: "number", description: "Installation/site ID" }
          },
          additionalProperties: false
        }
      },
      
      // Batch 8: System-Wide Endpoints
      {
        name: "vrm_get_data_attributes",
        description: "Get system-wide data attributes with filtering and sorting options.",
        inputSchema: {
          type: "object",
          properties: {
            filter: { type: "string", description: "Filter string for attributes" },
            sort: { type: "string", description: "Sort field for results" },
            limit: { type: "number", minimum: 1, maximum: 1000, description: "Maximum number of results" },
            offset: { type: "number", minimum: 0, description: "Offset for pagination" }
          },
          additionalProperties: false
        }
      },
      {
        name: "vrm_get_firmwares",
        description: "Get available firmware versions and information.",
        inputSchema: {
          type: "object",
          properties: {
            type: { type: "string", description: "Firmware type filter" },
            version: { type: "string", description: "Specific version filter" }
          },
          additionalProperties: false
        }
      },

      // Batch 3: Installation Management
      {
        name: "vrm_get_reset_forecasts",
        description: "Get forecast reset timestamp for an installation.",
        inputSchema: {
          type: "object",
          required: ["siteId"],
          properties: {
            siteId: { type: "number", description: "Installation/site ID" }
          },
          additionalProperties: false
        }
      },

      // Batch 4: Widget State Endpoints
      {
        name: "vrm_get_vebus_state",
        description: "Get VE.Bus system state information including inverter and charger status.",
        inputSchema: {
          type: "object",
          required: ["siteId"],
          properties: {
            siteId: { type: "number", description: "Installation/site ID" },
            instance: { type: "number", description: "Device instance ID (optional)" }
          },
          additionalProperties: false
        }
      },
      {
        name: "vrm_get_inverter_charger_state",
        description: "Get inverter/charger state and operational status.",
        inputSchema: {
          type: "object",
          required: ["siteId"],
          properties: {
            siteId: { type: "number", description: "Installation/site ID" },
            instance: { type: "number", description: "Device instance ID (optional)" }
          },
          additionalProperties: false
        }
      },
      {
        name: "vrm_get_charger_relay_state",
        description: "Get charger relay state and switching status.",
        inputSchema: {
          type: "object",
          required: ["siteId"],
          properties: {
            siteId: { type: "number", description: "Installation/site ID" },
            instance: { type: "number", description: "Device instance ID (optional)" }
          },
          additionalProperties: false
        }
      },
      {
        name: "vrm_get_solar_charger_relay_state",
        description: "Get solar charger relay state and MPPT switching status.",
        inputSchema: {
          type: "object",
          required: ["siteId"],
          properties: {
            siteId: { type: "number", description: "Installation/site ID" },
            instance: { type: "number", description: "Device instance ID (optional)" }
          },
          additionalProperties: false
        }
      },
      {
        name: "vrm_get_gateway_relay_state",
        description: "Get gateway relay state for remote switching control.",
        inputSchema: {
          type: "object",
          required: ["siteId"],
          properties: {
            siteId: { type: "number", description: "Installation/site ID" },
            instance: { type: "number", description: "Device instance ID (optional)" }
          },
          additionalProperties: false
        }
      },
      {
        name: "vrm_get_gateway_relay_two_state",
        description: "Get secondary gateway relay state for dual relay control.",
        inputSchema: {
          type: "object",
          required: ["siteId"],
          properties: {
            siteId: { type: "number", description: "Installation/site ID" },
            instance: { type: "number", description: "Device instance ID (optional)" }
          },
          additionalProperties: false
        }
      },
      {
        name: "vrm_get_status_widget",
        description: "Get general system status information and operational state.",
        inputSchema: {
          type: "object",
          required: ["siteId"],
          properties: {
            siteId: { type: "number", description: "Installation/site ID" },
            instance: { type: "number", description: "Device instance ID (optional)" }
          },
          additionalProperties: false
        }
      },

      // Batch 5: Widget Warnings & Alarms
      {
        name: "vrm_get_vebus_warnings_alarms",
        description: "Get VE.Bus system warnings and alarms for troubleshooting. Supports historical time ranges to retrieve past warnings like overload events.",
        inputSchema: {
          type: "object",
          required: ["siteId"],
          properties: {
            siteId: { type: "number", description: "Installation/site ID" },
            instance: { type: "number", description: "Device instance ID (optional)" },
            start: { type: "number", description: "Start time as epoch milliseconds for historical warnings" },
            end: { type: "number", description: "End time as epoch milliseconds for historical warnings" }
          },
          additionalProperties: false
        }
      },
      {
        name: "vrm_get_inverter_charger_warnings_alarms",
        description: "Get inverter/charger specific warnings and alarms.",
        inputSchema: {
          type: "object",
          required: ["siteId"],
          properties: {
            siteId: { type: "number", description: "Installation/site ID" },
            instance: { type: "number", description: "Device instance ID (optional)" }
          },
          additionalProperties: false
        }
      },

      // Batch 6: Widget Summary Endpoints
      {
        name: "vrm_get_battery_summary",
        description: "Get comprehensive battery summary including voltage, current, SoC, and health status.",
        inputSchema: {
          type: "object",
          required: ["siteId"],
          properties: {
            siteId: { type: "number", description: "Installation/site ID" },
            instance: { type: "number", description: "Device instance ID (optional)" }
          },
          additionalProperties: false
        }
      },
      {
        name: "vrm_get_solar_charger_summary",
        description: "Get solar charger summary with MPPT performance and yield data.",
        inputSchema: {
          type: "object",
          required: ["siteId"],
          properties: {
            siteId: { type: "number", description: "Installation/site ID" },
            instance: { type: "number", description: "Device instance ID (optional)" }
          },
          additionalProperties: false
        }
      },
      {
        name: "vrm_get_ev_charger_summary",
        description: "Get EV charger summary with charging status and power delivery.",
        inputSchema: {
          type: "object",
          required: ["siteId"],
          properties: {
            siteId: { type: "number", description: "Installation/site ID" },
            instance: { type: "number", description: "Device instance ID (optional)" }
          },
          additionalProperties: false
        }
      },
      {
        name: "vrm_get_global_link_summary",
        description: "Get GlobalLink device summary for generator and tank monitoring.",
        inputSchema: {
          type: "object",
          required: ["siteId"],
          properties: {
            siteId: { type: "number", description: "Installation/site ID" },
            instance: { type: "number", description: "Device instance ID (optional)" }
          },
          additionalProperties: false
        }
      },
      {
        name: "vrm_get_motor_summary",
        description: "Get motor drive summary with RPM, power, and operational status.",
        inputSchema: {
          type: "object",
          required: ["siteId"],
          properties: {
            siteId: { type: "number", description: "Installation/site ID" },
            instance: { type: "number", description: "Device instance ID (optional)" }
          },
          additionalProperties: false
        }
      },
      {
        name: "vrm_get_pv_inverter_status",
        description: "Get PV inverter status with AC output and grid-tie information.",
        inputSchema: {
          type: "object",
          required: ["siteId"],
          properties: {
            siteId: { type: "number", description: "Installation/site ID" },
            instance: { type: "number", description: "Device instance ID (optional)" }
          },
          additionalProperties: false
        }
      },
      {
        name: "vrm_get_tank_summary",
        description: "Get tank sensor summary with fluid levels and capacity information.",
        inputSchema: {
          type: "object",
          required: ["siteId"],
          properties: {
            siteId: { type: "number", description: "Installation/site ID" },
            instance: { type: "number", description: "Device instance ID (optional)" }
          },
          additionalProperties: false
        }
      },
      {
        name: "vrm_get_temp_summary_graph",
        description: "Get temperature sensor summary and historical graph data.",
        inputSchema: {
          type: "object",
          required: ["siteId"],
          properties: {
            siteId: { type: "number", description: "Installation/site ID" },
            instance: { type: "number", description: "Device instance ID (optional)" }
          },
          additionalProperties: false
        }
      },
      {
        name: "vrm_get_dc_meter",
        description: "Get DC power meter readings with voltage, current, and power measurements.",
        inputSchema: {
          type: "object",
          required: ["siteId"],
          properties: {
            siteId: { type: "number", description: "Installation/site ID" },
            instance: { type: "number", description: "Device instance ID (optional)" }
          },
          additionalProperties: false
        }
      },

      // Batch 7: Widget Diagnostics & Data
      {
        name: "vrm_get_bms_diagnostics",
        description: "Get Battery Management System diagnostics with cell voltages and balancing data.",
        inputSchema: {
          type: "object",
          required: ["siteId"],
          properties: {
            siteId: { type: "number", description: "Installation/site ID" },
            instance: { type: "number", description: "Device instance ID (optional)" }
          },
          additionalProperties: false
        }
      },
      {
        name: "vrm_get_lithium_bms",
        description: "Get Lithium battery BMS data with advanced cell monitoring and safety information.",
        inputSchema: {
          type: "object",
          required: ["siteId"],
          properties: {
            siteId: { type: "number", description: "Installation/site ID" },
            instance: { type: "number", description: "Device instance ID (optional)" }
          },
          additionalProperties: false
        }
      },
      {
        name: "vrm_get_historic_data",
        description: "Get historic data widget with time-series information and trends.",
        inputSchema: {
          type: "object",
          required: ["siteId"],
          properties: {
            siteId: { type: "number", description: "Installation/site ID" },
            instance: { type: "number", description: "Device instance ID (optional)" }
          },
          additionalProperties: false
        }
      },
      {
        name: "vrm_get_io_extender",
        description: "Get IO extender input/output status for digital and analog signals.",
        inputSchema: {
          type: "object",
          required: ["siteId"],
          properties: {
            siteId: { type: "number", description: "Installation/site ID" },
            instance: { type: "number", description: "Device instance ID (optional)" }
          },
          additionalProperties: false
        }
      }
    ];
  
  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  try {
    const toolName = name;
    
    // List of valid tool names
    const validTools = [
      // Original endpoints
      "vrm_get_user_me",
      "vrm_list_installations", 
      "vrm_get_system_overview",
      "vrm_get_stats",
      "vrm_get_overall_stats",
      "vrm_get_alarms",
      "vrm_get_diagnostics",
      "vrm_get_widget_graph",
      
      // Batch 1: Authentication & User Management
      "vrm_auth_login_as_demo",
      "vrm_auth_logout",
      "vrm_search_user_installations",
      
      // Batch 2: Installation Data & Downloads
      "vrm_download_installation_data",
      "vrm_download_gps_data",
      "vrm_get_installation_tags",
      "vrm_get_custom_widget",
      "vrm_get_dynamic_ess_settings",
      
      // Batch 8: System-Wide Endpoints
      "vrm_get_data_attributes",
      "vrm_get_firmwares",
      
      // Batch 3: Installation Management
      "vrm_get_reset_forecasts",
      
      // Batch 4: Widget State Endpoints
      "vrm_get_vebus_state",
      "vrm_get_inverter_charger_state",
      "vrm_get_charger_relay_state",
      "vrm_get_solar_charger_relay_state",
      "vrm_get_gateway_relay_state",
      "vrm_get_gateway_relay_two_state",
      "vrm_get_status_widget",
      
      // Batch 5: Widget Warnings & Alarms
      "vrm_get_vebus_warnings_alarms",
      "vrm_get_inverter_charger_warnings_alarms",
      
      // Batch 6: Widget Summary Endpoints
      "vrm_get_battery_summary",
      "vrm_get_solar_charger_summary",
      "vrm_get_ev_charger_summary",
      "vrm_get_global_link_summary",
      "vrm_get_motor_summary",
      "vrm_get_pv_inverter_status",
      "vrm_get_tank_summary",
      "vrm_get_temp_summary_graph",
      "vrm_get_dc_meter",
      
      // Batch 7: Widget Diagnostics & Data
      "vrm_get_bms_diagnostics",
      "vrm_get_lithium_bms",
      "vrm_get_historic_data",
      "vrm_get_io_extender"
    ];
    
    if (!validTools.includes(toolName)) {
      throw new Error(`Unknown tool: ${name}`);
    }
    
    // Use args directly since JSON Schema validation is handled by MCP
    const validatedArgs = args || {};
    
    let result;
    
    switch (toolName) {
      case "vrm_get_user_me":
        result = await vrmClient.getUserMe();
        break;
        
      case "vrm_list_installations":
        result = await vrmClient.listInstallations(validatedArgs as any);
        break;
        
      case "vrm_get_system_overview":
        result = await vrmClient.getSystemOverview(validatedArgs as any);
        break;
        
      case "vrm_get_stats":
        result = await vrmClient.getStats(validatedArgs as any);
        break;
        
      case "vrm_get_overall_stats":
        result = await vrmClient.getOverallStats(validatedArgs as any);
        break;
        
      case "vrm_get_alarms":
        result = await vrmClient.getAlarms(validatedArgs as any);
        break;
        
      case "vrm_get_diagnostics":
        result = await vrmClient.getDiagnostics(validatedArgs as any);
        break;
        
      case "vrm_get_widget_graph":
        result = await vrmClient.getWidgetGraph(validatedArgs as any);
        break;
        
      // Batch 1: Authentication & User Management
      case "vrm_auth_login_as_demo":
        result = await vrmClient.authLoginAsDemo();
        break;
        
      case "vrm_auth_logout":
        result = await vrmClient.authLogout();
        break;
        
      case "vrm_search_user_installations":
        result = await vrmClient.searchUserInstallations(validatedArgs as any);
        break;
        
      // Batch 2: Installation Data & Downloads
      case "vrm_download_installation_data":
        result = await vrmClient.downloadInstallationData(validatedArgs as any);
        break;
        
      case "vrm_download_gps_data":
        result = await vrmClient.downloadGpsData(validatedArgs as any);
        break;
        
      case "vrm_get_installation_tags":
        result = await vrmClient.getInstallationTags(validatedArgs as any);
        break;
        
      case "vrm_get_custom_widget":
        result = await vrmClient.getCustomWidget(validatedArgs as any);
        break;
        
      case "vrm_get_dynamic_ess_settings":
        result = await vrmClient.getDynamicEssSettings(validatedArgs as any);
        break;
        
      // Batch 8: System-Wide Endpoints
      case "vrm_get_data_attributes":
        result = await vrmClient.getDataAttributes(validatedArgs as any);
        break;
        
      case "vrm_get_firmwares":
        result = await vrmClient.getFirmwares(validatedArgs as any);
        break;

      // Batch 3: Installation Management
      case "vrm_get_reset_forecasts":
        result = await vrmClient.getResetForecasts(validatedArgs as any);
        break;

      // Batch 4: Widget State Endpoints
      case "vrm_get_vebus_state":
        result = await vrmClient.getVeBusState(validatedArgs as any);
        break;

      case "vrm_get_inverter_charger_state":
        result = await vrmClient.getInverterChargerState(validatedArgs as any);
        break;

      case "vrm_get_charger_relay_state":
        result = await vrmClient.getChargerRelayState(validatedArgs as any);
        break;

      case "vrm_get_solar_charger_relay_state":
        result = await vrmClient.getSolarChargerRelayState(validatedArgs as any);
        break;

      case "vrm_get_gateway_relay_state":
        result = await vrmClient.getGatewayRelayState(validatedArgs as any);
        break;

      case "vrm_get_gateway_relay_two_state":
        result = await vrmClient.getGatewayRelayTwoState(validatedArgs as any);
        break;

      case "vrm_get_status_widget":
        result = await vrmClient.getStatusWidget(validatedArgs as any);
        break;

      // Batch 5: Widget Warnings & Alarms
      case "vrm_get_vebus_warnings_alarms":
        result = await vrmClient.getVeBusWarningsAlarms(validatedArgs as any);
        break;

      case "vrm_get_inverter_charger_warnings_alarms":
        result = await vrmClient.getInverterChargerWarningsAlarms(validatedArgs as any);
        break;

      // Batch 6: Widget Summary Endpoints
      case "vrm_get_battery_summary":
        result = await vrmClient.getBatterySummary(validatedArgs as any);
        break;

      case "vrm_get_solar_charger_summary":
        result = await vrmClient.getSolarChargerSummary(validatedArgs as any);
        break;

      case "vrm_get_ev_charger_summary":
        result = await vrmClient.getEvChargerSummary(validatedArgs as any);
        break;

      case "vrm_get_global_link_summary":
        result = await vrmClient.getGlobalLinkSummary(validatedArgs as any);
        break;

      case "vrm_get_motor_summary":
        result = await vrmClient.getMotorSummary(validatedArgs as any);
        break;

      case "vrm_get_pv_inverter_status":
        result = await vrmClient.getPvInverterStatus(validatedArgs as any);
        break;

      case "vrm_get_tank_summary":
        result = await vrmClient.getTankSummary(validatedArgs as any);
        break;

      case "vrm_get_temp_summary_graph":
        result = await vrmClient.getTempSummaryGraph(validatedArgs as any);
        break;

      case "vrm_get_dc_meter":
        result = await vrmClient.getDcMeter(validatedArgs as any);
        break;

      // Batch 7: Widget Diagnostics & Data
      case "vrm_get_bms_diagnostics":
        result = await vrmClient.getBmsDiagnostics(validatedArgs as any);
        break;

      case "vrm_get_lithium_bms":
        result = await vrmClient.getLithiumBms(validatedArgs as any);
        break;

      case "vrm_get_historic_data":
        result = await vrmClient.getHistoricData(validatedArgs as any);
        break;

      case "vrm_get_io_extender":
        result = await vrmClient.getIoExtender(validatedArgs as any);
        break;
        
      default:
        throw new Error(`Unhandled tool: ${name}`);
    }
    
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorCode = "tool_error";
    
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ok: false,
            error: {
              code: errorCode,
              message: errorMessage
            }
          }, null, 2)
        }
      ],
      isError: true
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("VRM MCP Server started");
  
  // Handle process termination gracefully
  process.on('SIGTERM', () => {
    console.error('Received SIGTERM, shutting down gracefully');
    process.exit(0);
  });
  
  process.on('SIGINT', () => {
    console.error('Received SIGINT, shutting down gracefully');
    process.exit(0);
  });
  
  // Handle unhandled errors
  process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
  });
  
  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
  });
}

main().catch((error) => {
  console.error('Failed to start VRM MCP Server:', error);
  process.exit(1);
});
