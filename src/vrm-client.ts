import { ToolInputs, VRMResponse } from "./schemas.js";

const ALLOWED_PATHS = [
  // Existing endpoints
  "/users/me",
  /^\/users\/\d+\/installations$/,
  /^\/installations\/\d+\/system-overview$/,
  /^\/installations\/\d+\/stats$/,
  /^\/installations\/\d+\/overallstats$/,
  /^\/installations\/\d+\/alarms$/,
  /^\/installations\/\d+\/diagnostics$/,
  /^\/installations\/\d+\/widgets\/Graph$/,
  
  // Batch 1: Authentication & User Management
  "/auth/loginAsDemo",
  "/auth/logout",
  /^\/users\/\d+\/search$/,
  
  // Batch 2: Installation Data & Downloads
  /^\/installations\/\d+\/data-download$/,
  /^\/installations\/\d+\/gps-download$/,
  /^\/installations\/\d+\/tags$/,
  /^\/installations\/\d+\/custom-widget$/,
  /^\/installations\/\d+\/dynamic-ess-settings$/,
  
  // Batch 3: Installation Management
  /^\/installations\/\d+\/reset-forecasts$/,
  
  // Batch 4: Widget State Endpoints
  /^\/installations\/\d+\/widgets\/VeBusState$/,
  /^\/installations\/\d+\/widgets\/InverterChargerState$/,
  /^\/installations\/\d+\/widgets\/ChargerRelayState$/,
  /^\/installations\/\d+\/widgets\/SolarChargerRelayState$/,
  /^\/installations\/\d+\/widgets\/GatewayRelayState$/,
  /^\/installations\/\d+\/widgets\/GatewayRelayTwoState$/,
  /^\/installations\/\d+\/widgets\/Status$/,
  
  // Batch 5: Widget Warnings & Alarms
  /^\/installations\/\d+\/widgets\/VeBusWarningsAndAlarms$/,
  /^\/installations\/\d+\/widgets\/InverterChargerWarningsAndAlarms$/,
  
  // Batch 6: Widget Summary Endpoints
  /^\/installations\/\d+\/widgets\/BatterySummary$/,
  /^\/installations\/\d+\/widgets\/SolarChargerSummary$/,
  /^\/installations\/\d+\/widgets\/EvChargerSummary$/,
  /^\/installations\/\d+\/widgets\/GlobalLinkSummary$/,
  /^\/installations\/\d+\/widgets\/MotorSummary$/,
  /^\/installations\/\d+\/widgets\/PVInverterStatus$/,
  /^\/installations\/\d+\/widgets\/TankSummary$/,
  /^\/installations\/\d+\/widgets\/TempSummaryAndGraph$/,
  /^\/installations\/\d+\/widgets\/DCMeter$/,
  
  // Batch 7: Widget Diagnostics & Data
  /^\/installations\/\d+\/widgets\/BMSDiagnostics$/,
  /^\/installations\/\d+\/widgets\/LithiumBMS$/,
  /^\/installations\/\d+\/widgets\/HistoricData$/,
  /^\/installations\/\d+\/widgets\/IOExtenderInOut$/,
  
  // Batch 8: System-Wide Endpoints
  "/data-attributes",
  "/firmwares"
];

export class VRMClient {
  private baseUrl: string;
  private token: string;
  private tokenKind: string;
  
  constructor() {
    this.baseUrl = process.env.VRM_BASE_URL || "https://vrmapi.victronenergy.com/v2";
    this.token = process.env.VRM_TOKEN || "";
    this.tokenKind = process.env.VRM_TOKEN_KIND || "Token";
    
    if (!this.token) {
      throw new Error("VRM_TOKEN environment variable is required");
    }
  }
  
  private getAuthHeaders() {
    return {
      "X-Authorization": `${this.tokenKind} ${this.token}`,
      "Accept": "application/json"
    };
  }
  
  private isAllowedPath(path: string): boolean {
    return ALLOWED_PATHS.some(pattern => {
      if (typeof pattern === "string") {
        return path === pattern;
      }
      return pattern.test(path);
    });
  }
  
  private async vrmGet(path: string, queryParams?: URLSearchParams): Promise<VRMResponse> {
    if (!this.isAllowedPath(path)) {
      throw new Error(`Disallowed path: ${path}`);
    }
    
    const url = `${this.baseUrl}${path}${queryParams ? `?${queryParams}` : ""}`;
    const requestId = crypto.randomUUID();
    const startTime = Date.now();
    
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: this.getAuthHeaders()
      });
      
      const durationMs = Date.now() - startTime;
      const body = await response.json().catch(() => ({})) as any;
      
      if (!response.ok) {
        let errorCode = "unknown_error";
        let errorMessage = `HTTP ${response.status}`;
        
        if (response.status === 401 || response.status === 403) {
          errorCode = "auth";
          errorMessage = "Authentication failed. Please check your VRM_TOKEN.";
        } else if (response.status === 404) {
          errorCode = "not_found";
          errorMessage = `Resource not found: ${path}`;
        } else if (response.status === 422 || response.status === 400) {
          errorCode = "bad_request";
          errorMessage = body.message || "Invalid request parameters";
        } else if (response.status === 429) {
          errorCode = "rate_limited";
          errorMessage = "Rate limited. Please try again later.";
        }
        
        return {
          ok: false,
          source: "vrm",
          endpoint: path,
          requestId,
          fetchedAt: new Date().toISOString(),
          data: body,
          meta: {
            status: response.status,
            durationMs,
            rateLimited: response.status === 429
          },
          error: {
            code: errorCode,
            message: errorMessage
          }
        };
      }
      
      return {
        ok: true,
        source: "vrm",
        endpoint: path,
        requestId,
        fetchedAt: new Date().toISOString(),
        data: body?.records || body,
        meta: {
          status: response.status,
          durationMs,
          rateLimited: false
        }
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      return {
        ok: false,
        source: "vrm",
        endpoint: path,
        requestId,
        fetchedAt: new Date().toISOString(),
        data: null,
        meta: {
          status: 0,
          durationMs,
          rateLimited: false
        },
        error: {
          code: "network_error",
          message: error instanceof Error ? error.message : "Network request failed"
        }
      };
    }
  }
  
  async getUserMe(): Promise<VRMResponse> {
    return this.vrmGet("/users/me");
  }
  
  async listInstallations(params: ToolInputs["vrm_list_installations"]): Promise<VRMResponse> {
    let idUser = params.idUser;
    
    if (!idUser) {
      const userResponse = await this.getUserMe();
      const userData = userResponse.data;
      const discoveredIdUser = userData?.idUser
        ?? userData?.id
        ?? userData?.user?.idUser
        ?? userData?.user?.id;

      if (!userResponse.ok || !discoveredIdUser) {
        return {
          ...userResponse,
          ok: false,
          error: {
            code: "user_fetch_failed",
            message: "Failed to fetch user ID"
          }
        };
      }
      idUser = discoveredIdUser;
    }
    
    const queryParams = new URLSearchParams();
    if (params.extended) {
      queryParams.append("extended", "1");
    }
    
    return this.vrmGet(`/users/${idUser}/installations`, queryParams);
  }
  
  async getSystemOverview(params: ToolInputs["vrm_get_system_overview"]): Promise<VRMResponse> {
    return this.vrmGet(`/installations/${params.siteId}/system-overview`);
  }
  
  async getStats(params: ToolInputs["vrm_get_stats"]): Promise<VRMResponse> {
    const queryParams = new URLSearchParams();
    queryParams.append("type", params.type);
    
    const interval = params.interval || "15mins";
    queryParams.append("interval", interval);
    if (params.start !== undefined) {
      queryParams.append("start", params.start.toString());
    }
    if (params.end !== undefined) {
      queryParams.append("end", params.end.toString());
    }
    
    // Add attributeCodes array parameter
    if (params.attributeCodes) {
      params.attributeCodes.forEach(code => {
        queryParams.append("attributeCodes[]", code);
      });
    }
    
    // Add show_instance parameter
    if (params.show_instance !== undefined) {
      queryParams.append("show_instance", params.show_instance.toString());
    }
    
    return this.vrmGet(`/installations/${params.siteId}/stats`, queryParams);
  }
  
  async getOverallStats(params: ToolInputs["vrm_get_overall_stats"]): Promise<VRMResponse> {
    const queryParams = new URLSearchParams();
    
    const type = params.type || "custom";
    queryParams.append("type", type);
    
    params.attributeCodes.forEach(code => {
      queryParams.append("attributeCodes[]", code);
    });
    
    if (params.start !== undefined && type === "custom") {
      queryParams.append("start", params.start.toString());
    }
    if (params.end !== undefined && type === "custom") {
      queryParams.append("end", params.end.toString());
    }
    
    const response = await this.vrmGet(`/installations/${params.siteId}/overallstats`, queryParams);
    
    if (response.ok && (type === "today" || type === "yesterday" || type === "month" || type === "year")) {
      response.meta.note = "Time periods like 'today' may be calculated relative to UTC or server timezone, not the installation's local timezone.";
    }
    
    return response;
  }
  
  async getAlarms(params: ToolInputs["vrm_get_alarms"]): Promise<VRMResponse> {
    const queryParams = new URLSearchParams();
    
    if (params.activeOnly) {
      queryParams.append("activeOnly", "true");
    }
    if (params.page !== undefined) {
      queryParams.append("page", params.page.toString());
    }
    if (params.pageSize !== undefined) {
      queryParams.append("pageSize", params.pageSize.toString());
    }
    
    // Add time range parameters for historical alarms
    if (params.start !== undefined) {
      queryParams.append("start", params.start.toString());
    }
    if (params.end !== undefined) {
      queryParams.append("end", params.end.toString());
    }
    if (params.from !== undefined) {
      queryParams.append("from", params.from.toString());
    }
    if (params.to !== undefined) {
      queryParams.append("to", params.to.toString());
    }
    
    return this.vrmGet(`/installations/${params.siteId}/alarms`, queryParams);
  }
  
  async getDiagnostics(params: ToolInputs["vrm_get_diagnostics"]): Promise<VRMResponse> {
    const queryParams = new URLSearchParams();
    
    const count = params.count || 200;
    queryParams.append("count", count.toString());
    if (params.offset !== undefined) {
      queryParams.append("offset", params.offset.toString());
    }
    
    return this.vrmGet(`/installations/${params.siteId}/diagnostics`, queryParams);
  }
  
  async getWidgetGraph(params: ToolInputs["vrm_get_widget_graph"]): Promise<VRMResponse> {
    const queryParams = new URLSearchParams();
    
    params.attributeCodes.forEach(code => {
      queryParams.append("attributeCodes[]", code);
    });
    queryParams.append("instance", params.instance.toString());
    
    const response = await this.vrmGet(`/installations/${params.siteId}/widgets/Graph`, queryParams);
    
    if (response.ok && (!response.data || Object.keys(response.data).length === 0)) {
      response.meta.note = "Widget returned empty data. Consider using get_diagnostics or get_stats for this data instead.";
    }
    
    return response;
  }
  
  // Batch 1: Authentication & User Management
  async authLoginAsDemo(): Promise<VRMResponse> {
    return this.vrmGet("/auth/loginAsDemo");
  }
  
  async authLogout(): Promise<VRMResponse> {
    return this.vrmGet("/auth/logout");
  }
  
  async searchUserInstallations(params: ToolInputs["vrm_search_user_installations"]): Promise<VRMResponse> {
    const queryParams = new URLSearchParams();
    
    if (params.query) {
      queryParams.append("query", params.query);
    }
    if (params.limit) {
      queryParams.append("limit", params.limit.toString());
    }
    
    return this.vrmGet(`/users/${params.idUser}/search`, queryParams);
  }
  
  // Batch 2: Installation Data & Downloads
  async downloadInstallationData(params: ToolInputs["vrm_download_installation_data"]): Promise<VRMResponse> {
    const queryParams = new URLSearchParams();
    
    // Set defaults
    const datatype = params.datatype || "log";
    const format = params.format || "csv";
    const decode = params.decode !== undefined ? params.decode : true;
    
    queryParams.append("datatype", datatype);
    queryParams.append("format", format);
    
    if (params.start !== undefined) {
      queryParams.append("start", params.start.toString());
    }
    if (params.end !== undefined) {
      queryParams.append("end", params.end.toString());
    }
    
    // Add debug parameter
    if (params.debug !== undefined) {
      queryParams.append("debug", params.debug.toString());
    }
    
    // Add async parameter
    if (params.async !== undefined) {
      queryParams.append("async", params.async.toString());
    }
    
    const response = await this.vrmGet(`/installations/${params.siteId}/data-download`, queryParams);
    
    // Process the response based on format and decode preference
    if (response.ok && response.data && decode && format === 'csv') {
      const originalData = response.data; // Store original data before processing
      try {
        // Check if data looks like base64
        if (typeof originalData !== 'string' || originalData.length === 0) {
          throw new Error('Invalid data format - not a string or empty');
        }

        // Decode base64 to UTF-8 string for CSV
        const csvString = Buffer.from(originalData, 'base64').toString('utf-8');
        
        // Validate CSV string isn't corrupted
        if (csvString.includes('\u0000') || csvString.length < 10) {
          throw new Error('Corrupted CSV data detected');
        }
        
        // Parse CSV into structured format
        const lines = csvString.split('\n').filter(line => line.trim());
        
        if (lines.length === 0) {
          response.data = {
            format,
            datatype,
            timeRange: { 
              start: params.start, 
              end: params.end,
              startISO: params.start ? new Date(params.start).toISOString() : undefined,
              endISO: params.end ? new Date(params.end).toISOString() : undefined
            },
            records: [],
            summary: {
              totalRecords: 0,
              columns: []
            }
          };
          response.meta.note = "No data found for the specified time range";
          return response;
        }

        const headers = lines[0]?.split(',') || [];
        const records = lines.slice(1).map(line => {
          const values = line.split(',');
          const record: any = {};
          headers.forEach((header, index) => {
            const value = values[index]?.trim();
            // Try to parse as number, otherwise keep as string
            record[header.trim()] = isNaN(Number(value)) ? value : Number(value);
          });
          return record;
        });
        
        response.data = {
          format,
          datatype,
          timeRange: { 
            start: params.start, 
            end: params.end,
            startISO: params.start ? new Date(params.start).toISOString() : undefined,
            endISO: params.end ? new Date(params.end).toISOString() : undefined
          },
          records,
          summary: {
            totalRecords: records.length,
            columns: headers.map(h => h.trim())
          }
        };
        response.meta.note = "CSV data parsed into structured format for easier analysis";
      } catch (error) {
        // If parsing fails, return original base64 data with better error info
        response.data = {
          format,
          datatype,
          timeRange: { start: params.start, end: params.end },
          content: originalData,
          encoding: "base64",
          filename: `installation_${params.siteId}_${datatype}_${Date.now()}.${format}`,
          parseError: error instanceof Error ? error.message : "Unknown parsing error"
        };
        response.meta.note = `Failed to parse CSV data: ${error instanceof Error ? error.message : "Unknown error"}`;
      }
    } else if (response.ok && response.data) {
      // For binary formats or when decode=false, return base64
      response.data = {
        format,
        datatype,
        timeRange: { start: params.start, end: params.end },
        content: response.data,
        encoding: "base64",
        filename: `installation_${params.siteId}_${datatype}_${Date.now()}.${format}`
      };
    }
    
    return response;
  }
  
  async downloadGpsData(params: ToolInputs["vrm_download_gps_data"]): Promise<VRMResponse> {
    const queryParams = new URLSearchParams();
    
    if (params.start !== undefined) {
      queryParams.append("start", params.start.toString());
    }
    if (params.end !== undefined) {
      queryParams.append("end", params.end.toString());
    }
    
    return this.vrmGet(`/installations/${params.siteId}/gps-download`, queryParams);
  }
  
  async getInstallationTags(params: ToolInputs["vrm_get_installation_tags"]): Promise<VRMResponse> {
    return this.vrmGet(`/installations/${params.siteId}/tags`);
  }
  
  async getCustomWidget(params: ToolInputs["vrm_get_custom_widget"]): Promise<VRMResponse> {
    return this.vrmGet(`/installations/${params.siteId}/custom-widget`);
  }
  
  async getDynamicEssSettings(params: ToolInputs["vrm_get_dynamic_ess_settings"]): Promise<VRMResponse> {
    return this.vrmGet(`/installations/${params.siteId}/dynamic-ess-settings`);
  }
  
  // Batch 8: System-Wide Endpoints
  async getDataAttributes(params: ToolInputs["vrm_get_data_attributes"]): Promise<VRMResponse> {
    const queryParams = new URLSearchParams();
    
    if (params.filter) {
      queryParams.append("filter", params.filter);
    }
    if (params.sort) {
      queryParams.append("sort", params.sort);
    }
    if (params.limit) {
      queryParams.append("limit", params.limit.toString());
    }
    if (params.offset !== undefined) {
      queryParams.append("offset", params.offset.toString());
    }
    
    return this.vrmGet("/data-attributes", queryParams);
  }
  
  async getFirmwares(params: ToolInputs["vrm_get_firmwares"]): Promise<VRMResponse> {
    const queryParams = new URLSearchParams();
    
    if (params.type) {
      queryParams.append("type", params.type);
    }
    if (params.version) {
      queryParams.append("version", params.version);
    }
    if (params.feedChannel) {
      queryParams.append("feedChannel", params.feedChannel);
    }
    if (params.victronConnectVersion) {
      queryParams.append("victronConnectVersion", params.victronConnectVersion);
    }
    if (params.limit) {
      queryParams.append("limit", params.limit.toString());
    }
    if (params.offset !== undefined) {
      queryParams.append("offset", params.offset.toString());
    }
    
    return this.vrmGet("/firmwares", queryParams);
  }

  // Batch 3: Installation Management
  async getResetForecasts(params: ToolInputs["vrm_get_reset_forecasts"]): Promise<VRMResponse> {
    return this.vrmGet(`/installations/${params.siteId}/reset-forecasts`);
  }

  // Batch 4: Widget State Endpoints
  async getVeBusState(params: ToolInputs["vrm_get_vebus_state"]): Promise<VRMResponse> {
    const queryParams = new URLSearchParams();
    
    if (params.instance !== undefined) {
      queryParams.append("instance", params.instance.toString());
    }
    
    return this.vrmGet(`/installations/${params.siteId}/widgets/VeBusState`, queryParams);
  }

  async getInverterChargerState(params: ToolInputs["vrm_get_inverter_charger_state"]): Promise<VRMResponse> {
    const queryParams = new URLSearchParams();
    
    if (params.instance !== undefined) {
      queryParams.append("instance", params.instance.toString());
    }
    
    return this.vrmGet(`/installations/${params.siteId}/widgets/InverterChargerState`, queryParams);
  }

  async getChargerRelayState(params: ToolInputs["vrm_get_charger_relay_state"]): Promise<VRMResponse> {
    const queryParams = new URLSearchParams();
    
    if (params.instance !== undefined) {
      queryParams.append("instance", params.instance.toString());
    }
    
    return this.vrmGet(`/installations/${params.siteId}/widgets/ChargerRelayState`, queryParams);
  }

  async getSolarChargerRelayState(params: ToolInputs["vrm_get_solar_charger_relay_state"]): Promise<VRMResponse> {
    const queryParams = new URLSearchParams();
    
    if (params.instance !== undefined) {
      queryParams.append("instance", params.instance.toString());
    }
    
    return this.vrmGet(`/installations/${params.siteId}/widgets/SolarChargerRelayState`, queryParams);
  }

  async getGatewayRelayState(params: ToolInputs["vrm_get_gateway_relay_state"]): Promise<VRMResponse> {
    const queryParams = new URLSearchParams();
    
    if (params.instance !== undefined) {
      queryParams.append("instance", params.instance.toString());
    }
    
    return this.vrmGet(`/installations/${params.siteId}/widgets/GatewayRelayState`, queryParams);
  }

  async getGatewayRelayTwoState(params: ToolInputs["vrm_get_gateway_relay_two_state"]): Promise<VRMResponse> {
    const queryParams = new URLSearchParams();
    
    if (params.instance !== undefined) {
      queryParams.append("instance", params.instance.toString());
    }
    
    return this.vrmGet(`/installations/${params.siteId}/widgets/GatewayRelayTwoState`, queryParams);
  }

  async getStatusWidget(params: ToolInputs["vrm_get_status_widget"]): Promise<VRMResponse> {
    const queryParams = new URLSearchParams();
    
    if (params.instance !== undefined) {
      queryParams.append("instance", params.instance.toString());
    }
    
    return this.vrmGet(`/installations/${params.siteId}/widgets/Status`, queryParams);
  }

  // Batch 5: Widget Warnings & Alarms
  async getVeBusWarningsAlarms(params: ToolInputs["vrm_get_vebus_warnings_alarms"]): Promise<VRMResponse> {
    const queryParams = new URLSearchParams();
    
    if (params.instance !== undefined) {
      queryParams.append("instance", params.instance.toString());
    }
    
    // Add time range parameters for historical warnings/alarms
    if (params.start !== undefined) {
      queryParams.append("start", params.start.toString());
    }
    if (params.end !== undefined) {
      queryParams.append("end", params.end.toString());
    }
    
    return this.vrmGet(`/installations/${params.siteId}/widgets/VeBusWarningsAndAlarms`, queryParams);
  }

  async getInverterChargerWarningsAlarms(params: ToolInputs["vrm_get_inverter_charger_warnings_alarms"]): Promise<VRMResponse> {
    const queryParams = new URLSearchParams();
    
    if (params.instance !== undefined) {
      queryParams.append("instance", params.instance.toString());
    }
    
    return this.vrmGet(`/installations/${params.siteId}/widgets/InverterChargerWarningsAndAlarms`, queryParams);
  }

  // Batch 6: Widget Summary Endpoints
  async getBatterySummary(params: ToolInputs["vrm_get_battery_summary"]): Promise<VRMResponse> {
    const queryParams = new URLSearchParams();
    
    if (params.instance !== undefined) {
      queryParams.append("instance", params.instance.toString());
    }
    
    return this.vrmGet(`/installations/${params.siteId}/widgets/BatterySummary`, queryParams);
  }

  async getSolarChargerSummary(params: ToolInputs["vrm_get_solar_charger_summary"]): Promise<VRMResponse> {
    const queryParams = new URLSearchParams();
    
    if (params.instance !== undefined) {
      queryParams.append("instance", params.instance.toString());
    }
    
    return this.vrmGet(`/installations/${params.siteId}/widgets/SolarChargerSummary`, queryParams);
  }

  async getEvChargerSummary(params: ToolInputs["vrm_get_ev_charger_summary"]): Promise<VRMResponse> {
    const queryParams = new URLSearchParams();
    
    if (params.instance !== undefined) {
      queryParams.append("instance", params.instance.toString());
    }
    
    return this.vrmGet(`/installations/${params.siteId}/widgets/EvChargerSummary`, queryParams);
  }

  async getGlobalLinkSummary(params: ToolInputs["vrm_get_global_link_summary"]): Promise<VRMResponse> {
    const queryParams = new URLSearchParams();
    
    if (params.instance !== undefined) {
      queryParams.append("instance", params.instance.toString());
    }
    
    return this.vrmGet(`/installations/${params.siteId}/widgets/GlobalLinkSummary`, queryParams);
  }

  async getMotorSummary(params: ToolInputs["vrm_get_motor_summary"]): Promise<VRMResponse> {
    const queryParams = new URLSearchParams();
    
    if (params.instance !== undefined) {
      queryParams.append("instance", params.instance.toString());
    }
    
    return this.vrmGet(`/installations/${params.siteId}/widgets/MotorSummary`, queryParams);
  }

  async getPvInverterStatus(params: ToolInputs["vrm_get_pv_inverter_status"]): Promise<VRMResponse> {
    const queryParams = new URLSearchParams();
    
    if (params.instance !== undefined) {
      queryParams.append("instance", params.instance.toString());
    }
    
    return this.vrmGet(`/installations/${params.siteId}/widgets/PVInverterStatus`, queryParams);
  }

  async getTankSummary(params: ToolInputs["vrm_get_tank_summary"]): Promise<VRMResponse> {
    const queryParams = new URLSearchParams();
    
    if (params.instance !== undefined) {
      queryParams.append("instance", params.instance.toString());
    }
    
    return this.vrmGet(`/installations/${params.siteId}/widgets/TankSummary`, queryParams);
  }

  async getTempSummaryGraph(params: ToolInputs["vrm_get_temp_summary_graph"]): Promise<VRMResponse> {
    const queryParams = new URLSearchParams();
    
    if (params.instance !== undefined) {
      queryParams.append("instance", params.instance.toString());
    }
    
    return this.vrmGet(`/installations/${params.siteId}/widgets/TempSummaryAndGraph`, queryParams);
  }

  async getDcMeter(params: ToolInputs["vrm_get_dc_meter"]): Promise<VRMResponse> {
    const queryParams = new URLSearchParams();
    
    if (params.instance !== undefined) {
      queryParams.append("instance", params.instance.toString());
    }
    
    return this.vrmGet(`/installations/${params.siteId}/widgets/DCMeter`, queryParams);
  }

  // Batch 7: Widget Diagnostics & Data
  async getBmsDiagnostics(params: ToolInputs["vrm_get_bms_diagnostics"]): Promise<VRMResponse> {
    const queryParams = new URLSearchParams();
    
    if (params.instance !== undefined) {
      queryParams.append("instance", params.instance.toString());
    }
    
    return this.vrmGet(`/installations/${params.siteId}/widgets/BMSDiagnostics`, queryParams);
  }

  async getLithiumBms(params: ToolInputs["vrm_get_lithium_bms"]): Promise<VRMResponse> {
    const queryParams = new URLSearchParams();
    
    if (params.instance !== undefined) {
      queryParams.append("instance", params.instance.toString());
    }
    
    return this.vrmGet(`/installations/${params.siteId}/widgets/LithiumBMS`, queryParams);
  }

  async getHistoricData(params: ToolInputs["vrm_get_historic_data"]): Promise<VRMResponse> {
    const queryParams = new URLSearchParams();
    
    if (params.instance !== undefined) {
      queryParams.append("instance", params.instance.toString());
    }
    
    return this.vrmGet(`/installations/${params.siteId}/widgets/HistoricData`, queryParams);
  }

  async getIoExtender(params: ToolInputs["vrm_get_io_extender"]): Promise<VRMResponse> {
    const queryParams = new URLSearchParams();
    
    if (params.instance !== undefined) {
      queryParams.append("instance", params.instance.toString());
    }
    
    return this.vrmGet(`/installations/${params.siteId}/widgets/IOExtenderInOut`, queryParams);
  }
}
