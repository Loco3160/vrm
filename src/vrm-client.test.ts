import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('VRMClient', () => {
  let client: any;
  
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    
    process.env.VRM_TOKEN = 'test-token';
    process.env.VRM_BASE_URL = 'https://vrmapi.victronenergy.com/v2';
    process.env.VRM_TOKEN_KIND = 'Token';
    
    const { VRMClient } = await import('./vrm-client');
    client = new VRMClient();
  });
  
  describe('constructor', () => {
    it('should throw error if VRM_TOKEN is not set', async () => {
      delete process.env.VRM_TOKEN;
      const { VRMClient } = await import('./vrm-client');
      expect(() => new VRMClient()).toThrow('VRM_TOKEN environment variable is required');
    });
    
    it('should use default values for optional env vars', async () => {
      delete process.env.VRM_BASE_URL;
      delete process.env.VRM_TOKEN_KIND;
      process.env.VRM_TOKEN = 'test-token';
      const { VRMClient } = await import('./vrm-client');
      const testClient = new VRMClient();
      expect(testClient).toBeDefined();
    });
  });
  
  describe('path validation', () => {
    it('should allow valid paths', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ idUser: 12345 })
      });
      
      await client.getUserMe();
      expect(mockFetch).toHaveBeenCalled();
    });
    
    it('should reject invalid paths', async () => {
      // This test doesn't need a fetch mock since it should throw before making a request
      const invalidClient = Object.create(client);
      await expect(invalidClient.vrmGet('/invalid/path')).rejects.toThrow('Disallowed path');
    });
  });
  
  describe('getUserMe', () => {
    it('should return user data on success', async () => {
      const mockUserData = { idUser: 12345, name: 'Test User' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockUserData
      });
      
      const result = await client.getUserMe();
      
      expect(result.ok).toBe(true);
      expect(result.data).toEqual(mockUserData);
      expect(result.meta.status).toBe(200);
      expect(result.meta.rateLimited).toBe(false);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://vrmapi.victronenergy.com/v2/users/me',
        expect.objectContaining({
          method: 'GET',
          headers: {
            'X-Authorization': 'Token test-token',
            'Accept': 'application/json'
          }
        })
      );
    });
    
    it('should handle authentication errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ message: 'Unauthorized' })
      });
      
      const result = await client.getUserMe();
      
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('auth');
      expect(result.error?.message).toContain('Authentication failed');
      expect(result.meta.status).toBe(401);
    });
  });
  
  describe('listInstallations', () => {
    it('should fetch user ID if not provided', async () => {
      const mockUserData = { idUser: 12345 };
      const mockInstallations = { records: [{ id: 1, name: 'Site 1' }] };
      
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockUserData
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockInstallations
        });
      
      const result = await client.listInstallations({});
      
      expect(result.ok).toBe(true);
      expect(result.data).toEqual([{ id: 1, name: 'Site 1' }]);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should fetch the user ID from the current nested VRM response', async () => {
      const mockUserData = { success: true, user: { id: 24680 } };
      const mockInstallations = { records: [{ idSite: 1, name: 'Site 1' }] };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockUserData
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockInstallations
        });

      const result = await client.listInstallations({});

      expect(result.ok).toBe(true);
      expect(result.data).toEqual([{ idSite: 1, name: 'Site 1' }]);
      expect(mockFetch).toHaveBeenLastCalledWith(
        expect.stringContaining('/users/24680/installations'),
        expect.any(Object)
      );
    });
    
    it('should use provided idUser', async () => {
      const mockInstallations = { records: [{ id: 1, name: 'Site 1' }] };
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockInstallations
      });
      
      const result = await client.listInstallations({ idUser: 67890 });
      
      expect(result.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/users/67890/installations'),
        expect.any(Object)
      );
    });
    
    it('should handle extended parameter', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ records: [] })
      });
      
      await client.listInstallations({ idUser: 12345, extended: true });
      
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('?extended=1'),
        expect.any(Object)
      );
    });

    it('should handle installations with extended information', async () => {
      const mockExtendedInstallations = {
        records: [
          { 
            id: 1, 
            name: 'Home Solar System',
            location: 'Amsterdam, Netherlands',
            timezone: 'Europe/Amsterdam',
            devices: 5,
            lastUpdate: '2024-01-15T10:30:00Z'
          },
          { 
            id: 2, 
            name: 'Cabin Off-Grid',
            location: 'Remote Location',
            timezone: 'UTC',
            devices: 3,
            lastUpdate: '2024-01-15T09:45:00Z'
          }
        ]
      };
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockExtendedInstallations
      });
      
      const result = await client.listInstallations({ 
        idUser: 12345, 
        extended: true 
      });
      
      expect(result.ok).toBe(true);
      expect(result.data).toEqual(mockExtendedInstallations.records);
      expect(result.data[0]).toHaveProperty('location');
      expect(result.data[0]).toHaveProperty('timezone');
      expect(result.data[0]).toHaveProperty('devices');
    });

    it('should handle user fetch failure when idUser not provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ message: 'Unauthorized' })
      });
      
      const result = await client.listInstallations({});
      
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('user_fetch_failed');
      expect(result.error?.message).toBe('Failed to fetch user ID');
    });

    it('should handle installations fetch errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ message: 'Access denied' })
      });
      
      const result = await client.listInstallations({ idUser: 12345 });
      
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('auth');
      expect(result.error?.message).toContain('Authentication failed');
    });

    it('should handle empty installations list', async () => {
      const mockEmptyInstallations = { records: [] };
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockEmptyInstallations
      });
      
      const result = await client.listInstallations({ idUser: 12345 });
      
      expect(result.ok).toBe(true);
      expect(result.data).toEqual([]);
    });
  });
  
  describe('getStats', () => {
    it('should construct correct query parameters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ records: [] })
      });
      
      await client.getStats({
        siteId: 12345,
        type: 'consumption',
        interval: 'hours',
        start: 1609459200000,
        end: 1609545600000
      });
      
      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain('/installations/12345/stats');
      expect(callUrl).toContain('type=consumption');
      expect(callUrl).toContain('interval=hours');
      expect(callUrl).toContain('start=1609459200000');
      expect(callUrl).toContain('end=1609545600000');
    });

    it('should use default interval when not provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ records: [] })
      });
      
      await client.getStats({
        siteId: 12345,
        type: 'venus'
      });
      
      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain('interval=15mins');
    });

    it('should handle all valid stat types', async () => {
      const types = ['venus', 'live_feed', 'consumption', 'kwh', 'solar_yield', 'forecast'];
      
      for (const type of types) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ records: [] })
        });
        
        await client.getStats({ siteId: 12345, type: type as any });
        
        const callUrl = mockFetch.mock.calls[mockFetch.mock.calls.length - 1][0] as string;
        expect(callUrl).toContain(`type=${type}`);
      }
    });

    it('should handle stats data with proper format', async () => {
      const mockStatsData = {
        records: {
          consumption: [
            [1609459200000, 1200],
            [1609462800000, 1150]
          ],
          solar: [
            [1609459200000, 800],
            [1609462800000, 750]
          ]
        }
      };
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockStatsData
      });
      
      const result = await client.getStats({
        siteId: 12345,
        type: 'consumption'
      });
      
      expect(result.ok).toBe(true);
      expect(result.data).toEqual(mockStatsData.records);
    });

    it('should handle stats errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: async () => ({ message: 'Invalid time range' })
      });
      
      const result = await client.getStats({
        siteId: 12345,
        type: 'consumption',
        start: 1609545600000,
        end: 1609459200000 // End before start
      });
      
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('bad_request');
      expect(result.error?.message).toBe('Invalid time range');
    });
  });
  
  describe('getOverallStats', () => {
    it('should handle multiple attribute codes', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ records: {} })
      });
      
      await client.getOverallStats({
        siteId: 12345,
        type: 'custom',
        attributeCodes: ['Pb', 'Pc', 'kwh']
      });
      
      const callUrl = mockFetch.mock.calls[0][0] as string;
      // URL encoding converts [] to %5B%5D
      expect(callUrl).toContain('attributeCodes%5B%5D=Pb');
      expect(callUrl).toContain('attributeCodes%5B%5D=Pc');
      expect(callUrl).toContain('attributeCodes%5B%5D=kwh');
    });
    
    it('should add timezone note for relative periods', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ records: {} })
      });
      
      const result = await client.getOverallStats({
        siteId: 12345,
        type: 'today',
        attributeCodes: ['kwh']
      });
      
      expect(result.meta.note).toContain('timezone');
    });

    it('should use default type when not provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ records: {} })
      });
      
      await client.getOverallStats({
        siteId: 12345,
        attributeCodes: ['kwh']
      });
      
      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain('type=custom');
    });

    it('should handle custom time range for custom type', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ records: {} })
      });
      
      await client.getOverallStats({
        siteId: 12345,
        type: 'custom',
        attributeCodes: ['kwh', 'Pb'],
        start: 1609459200000,
        end: 1609545600000
      });
      
      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain('start=1609459200000');
      expect(callUrl).toContain('end=1609545600000');
    });

    it('should ignore start/end for non-custom types', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ records: {} })
      });
      
      await client.getOverallStats({
        siteId: 12345,
        type: 'today',
        attributeCodes: ['kwh'],
        start: 1609459200000,
        end: 1609545600000
      });
      
      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).not.toContain('start=');
      expect(callUrl).not.toContain('end=');
    });

    it('should handle all period types correctly', async () => {
      const types = ['custom', 'today', 'yesterday', 'month', 'year'];
      const timezonePeriods = ['today', 'yesterday', 'month', 'year'];
      
      for (const type of types) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ records: {} })
        });
        
        const result = await client.getOverallStats({
          siteId: 12345,
          type: type as any,
          attributeCodes: ['kwh']
        });
        
        expect(result.ok).toBe(true);
        
        if (timezonePeriods.includes(type)) {
          expect(result.meta.note).toContain('timezone');
        } else {
          expect(result.meta.note).toBeUndefined();
        }
      }
    });

    it('should handle overall stats with real data format', async () => {
      const mockOverallStatsData = {
        records: {
          kwh: { total: 1250.5, daily_avg: 41.7 },
          Pb: { total: 45.2, daily_avg: 1.5 },
          Pc: { total: 1205.3, daily_avg: 40.2 }
        }
      };
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockOverallStatsData
      });
      
      const result = await client.getOverallStats({
        siteId: 12345,
        type: 'month',
        attributeCodes: ['kwh', 'Pb', 'Pc']
      });
      
      expect(result.ok).toBe(true);
      expect(result.data).toEqual(mockOverallStatsData.records);
    });

    it('should handle overall stats errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ message: 'Invalid attribute codes' })
      });
      
      const result = await client.getOverallStats({
        siteId: 12345,
        type: 'custom',
        attributeCodes: ['INVALID_CODE']
      });
      
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('bad_request');
      expect(result.error?.message).toBe('Invalid attribute codes');
    });
  });
  
  describe('getSystemOverview', () => {
    it('should fetch system overview with correct parameters', async () => {
      const mockOverviewData = {
        battery: { level: 85, voltage: 12.4, current: -5.2 },
        solar: { power: 250, voltage: 18.2 },
        grid: { power: 0, voltage: 230 }
      };
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockOverviewData
      });
      
      const result = await client.getSystemOverview({ siteId: 12345 });
      
      expect(result.ok).toBe(true);
      expect(result.data).toEqual(mockOverviewData);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://vrmapi.victronenergy.com/v2/installations/12345/system-overview',
        expect.objectContaining({
          method: 'GET',
          headers: {
            'X-Authorization': 'Token test-token',
            'Accept': 'application/json'
          }
        })
      );
    });

    it('should handle system overview errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ message: 'Installation not found' })
      });
      
      const result = await client.getSystemOverview({ siteId: 99999 });
      
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('not_found');
      expect(result.error?.message).toContain('Resource not found');
      expect(result.meta.status).toBe(404);
    });
  });

  describe('getAlarms', () => {
    it('should fetch alarms with minimum required fields', async () => {
      const mockAlarmsData = {
        records: [
          { id: 1, level: 'Warning', description: 'Low battery voltage', timestamp: 1609459200 },
          { id: 2, level: 'Critical', description: 'High temperature', timestamp: 1609462800 }
        ]
      };
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockAlarmsData
      });
      
      const result = await client.getAlarms({ siteId: 12345 });
      
      expect(result.ok).toBe(true);
      expect(result.data).toEqual(mockAlarmsData.records);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/installations/12345/alarms'),
        expect.objectContaining({
          method: 'GET',
          headers: {
            'X-Authorization': 'Token test-token',
            'Accept': 'application/json'
          }
        })
      );
    });

    it('should handle activeOnly parameter', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ records: [] })
      });
      
      await client.getAlarms({ siteId: 12345, activeOnly: true });
      
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('activeOnly=true'),
        expect.any(Object)
      );
    });

    it('should handle pagination parameters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ records: [] })
      });
      
      await client.getAlarms({ 
        siteId: 12345, 
        page: 2, 
        pageSize: 50 
      });
      
      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain('page=2');
      expect(callUrl).toContain('pageSize=50');
    });

    it('should handle alarms errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: async () => ({ message: 'Invalid page parameter' })
      });
      
      const result = await client.getAlarms({ siteId: 12345, page: -1 });
      
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('bad_request');
      expect(result.error?.message).toBe('Invalid page parameter');
    });
  });

  describe('getDiagnostics', () => {
    it('should fetch diagnostics with minimum required fields', async () => {
      const mockDiagnosticsData = {
        records: [
          { id: 1, parameter: 'battery_voltage', value: 12.4, unit: 'V', timestamp: 1609459200 },
          { id: 2, parameter: 'solar_power', value: 250, unit: 'W', timestamp: 1609459260 }
        ]
      };
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockDiagnosticsData
      });
      
      const result = await client.getDiagnostics({ siteId: 12345 });
      
      expect(result.ok).toBe(true);
      expect(result.data).toEqual(mockDiagnosticsData.records);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/installations/12345/diagnostics'),
        expect.objectContaining({
          method: 'GET',
          headers: {
            'X-Authorization': 'Token test-token',
            'Accept': 'application/json'
          }
        })
      );
    });

    it('should use default count parameter', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ records: [] })
      });
      
      await client.getDiagnostics({ siteId: 12345 });
      
      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain('count=200');
    });

    it('should handle custom count and offset parameters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ records: [] })
      });
      
      await client.getDiagnostics({ 
        siteId: 12345, 
        count: 500, 
        offset: 100 
      });
      
      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain('count=500');
      expect(callUrl).toContain('offset=100');
    });

    it('should handle diagnostics errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ message: 'Count exceeds limit' })
      });
      
      const result = await client.getDiagnostics({ siteId: 12345, count: 2000 });
      
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('bad_request');
      expect(result.error?.message).toBe('Count exceeds limit');
    });
  });

  describe('getWidgetGraph', () => {
    it('should fetch widget graph with required parameters', async () => {
      const mockGraphData = {
        series: [
          { name: 'Battery Voltage', data: [[1609459200, 12.4], [1609459260, 12.3]] },
          { name: 'Solar Power', data: [[1609459200, 250], [1609459260, 280]] }
        ]
      };
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockGraphData
      });
      
      const result = await client.getWidgetGraph({
        siteId: 12345,
        attributeCodes: ['OV1', 'S'],
        instance: 276
      });
      
      expect(result.ok).toBe(true);
      expect(result.data).toEqual(mockGraphData);
      
      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain('/installations/12345/widgets/Graph');
      expect(callUrl).toContain('attributeCodes%5B%5D=OV1');
      expect(callUrl).toContain('attributeCodes%5B%5D=S');
      expect(callUrl).toContain('instance=276');
    });

    it('should add note when data is empty', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({})
      });
      
      const result = await client.getWidgetGraph({
        siteId: 12345,
        attributeCodes: ['OV1', 'S'],
        instance: 276
      });
      
      expect(result.ok).toBe(true);
      expect(result.meta.note).toContain('Widget returned empty data');
    });

    it('should handle multiple attribute codes', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ series: [] })
      });
      
      await client.getWidgetGraph({
        siteId: 12345,
        attributeCodes: ['OV1', 'S', 'P', 'Pb'],
        instance: 276
      });
      
      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain('attributeCodes%5B%5D=OV1');
      expect(callUrl).toContain('attributeCodes%5B%5D=S');
      expect(callUrl).toContain('attributeCodes%5B%5D=P');
      expect(callUrl).toContain('attributeCodes%5B%5D=Pb');
    });

    it('should handle widget graph errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ message: 'Widget not found' })
      });
      
      const result = await client.getWidgetGraph({
        siteId: 12345,
        attributeCodes: ['INVALID'],
        instance: 999
      });
      
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('not_found');
    });
  });
  
  describe('error handling', () => {
    it('should handle rate limiting', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({})
      });
      
      const result = await client.getUserMe();
      
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('rate_limited');
      expect(result.meta.rateLimited).toBe(true);
    });
    
    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      
      const result = await client.getUserMe();
      
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('network_error');
      expect(result.error?.message).toContain('Network error');
    });
    
    it('should handle 404 errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({})
      });
      
      const result = await client.getSystemOverview({ siteId: 99999 });
      
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('not_found');
    });
    
    it('should handle bad request errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: async () => ({ message: 'Invalid parameters' })
      });
      
      const result = await client.getStats({ siteId: 12345, type: 'venus' });
      
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('bad_request');
      expect(result.error?.message).toBe('Invalid parameters');
    });
  });

  // ===== NEW HIGH-PRIORITY ENDPOINTS TESTS =====
  
  describe('Batch 1: Authentication & User Management', () => {
    describe('authLoginAsDemo', () => {
      it('should login as demo account', async () => {
        const mockDemoData = { 
          success: true, 
          demoToken: 'demo-123',
          message: 'Logged in as demo user' 
        };
        
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockDemoData
        });
        
        const result = await client.authLoginAsDemo();
        
        expect(result.ok).toBe(true);
        expect(result.data).toEqual(mockDemoData);
        expect(mockFetch).toHaveBeenCalledWith(
          'https://vrmapi.victronenergy.com/v2/auth/loginAsDemo',
          expect.objectContaining({
            method: 'GET',
            headers: {
              'X-Authorization': 'Token test-token',
              'Accept': 'application/json'
            }
          })
        );
      });

      it('should handle demo login errors', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 403,
          json: async () => ({ message: 'Demo login not allowed' })
        });
        
        const result = await client.authLoginAsDemo();
        
        expect(result.ok).toBe(false);
        expect(result.error?.code).toBe('auth');
        expect(result.error?.message).toContain('Authentication failed');
      });
    });

    describe('authLogout', () => {
      it('should logout successfully', async () => {
        const mockLogoutData = { 
          success: true, 
          message: 'Logged out successfully' 
        };
        
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockLogoutData
        });
        
        const result = await client.authLogout();
        
        expect(result.ok).toBe(true);
        expect(result.data).toEqual(mockLogoutData);
        expect(mockFetch).toHaveBeenCalledWith(
          'https://vrmapi.victronenergy.com/v2/auth/logout',
          expect.objectContaining({
            method: 'GET'
          })
        );
      });

      it('should handle logout errors', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 400,
          json: async () => ({ message: 'No active session' })
        });
        
        const result = await client.authLogout();
        
        expect(result.ok).toBe(false);
        expect(result.error?.code).toBe('bad_request');
        expect(result.error?.message).toBe('No active session');
      });
    });

    describe('searchUserInstallations', () => {
      it('should search installations with query', async () => {
        const mockSearchResults = {
          records: [
            { id: 1, name: 'Solar House', location: 'Amsterdam', match_score: 0.95 },
            { id: 2, name: 'Solar Cabin', location: 'Bergen', match_score: 0.87 }
          ]
        };
        
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockSearchResults
        });
        
        const result = await client.searchUserInstallations({ 
          idUser: 12345, 
          query: 'solar',
          limit: 10 
        });
        
        expect(result.ok).toBe(true);
        expect(result.data).toEqual(mockSearchResults.records);
        
        const callUrl = mockFetch.mock.calls[0][0] as string;
        expect(callUrl).toContain('/users/12345/search');
        expect(callUrl).toContain('query=solar');
        expect(callUrl).toContain('limit=10');
      });

      it('should search installations without query', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ records: [] })
        });
        
        await client.searchUserInstallations({ idUser: 12345 });
        
        const callUrl = mockFetch.mock.calls[0][0] as string;
        expect(callUrl).toContain('/users/12345/search');
        expect(callUrl).not.toContain('query=');
      });

      it('should handle search errors', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 422,
          json: async () => ({ message: 'Invalid search parameters' })
        });
        
        const result = await client.searchUserInstallations({ 
          idUser: 12345, 
          limit: 0 
        });
        
        expect(result.ok).toBe(false);
        expect(result.error?.code).toBe('bad_request');
      });
    });
  });

  describe('Batch 2: Installation Data & Downloads', () => {
    describe('downloadInstallationData', () => {
      it('should download and parse CSV data by default', async () => {
        const mockBase64Data = Buffer.from('timestamp,voltage,current\n1609459200,12.4,-5.2\n1609459260,12.3,-5.1').toString('base64');
        
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockBase64Data
        });
        
        const result = await client.downloadInstallationData({ 
          siteId: 12345,
          start: 1609459200000,
          end: 1609545600000
        });
        
        expect(result.ok).toBe(true);
        expect(result.data.format).toBe('csv');
        expect(result.data.datatype).toBe('log');
        expect(result.data.records).toHaveLength(2);
        expect(result.data.records[0]).toEqual({ timestamp: 1609459200, voltage: 12.4, current: -5.2 });
        expect(result.data.summary.totalRecords).toBe(2);
        expect(result.meta.note).toContain('CSV data parsed');
        
        const callUrl = mockFetch.mock.calls[0][0] as string;
        expect(callUrl).toContain('/installations/12345/data-download');
        expect(callUrl).toContain('datatype=log');
        expect(callUrl).toContain('format=csv');
        expect(callUrl).toContain('start=1609459200000');
        expect(callUrl).toContain('end=1609545600000');
      });

      it('should handle different data types and formats', async () => {
        const mockBase64Data = 'binarydata123';
        
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockBase64Data
        });
        
        const result = await client.downloadInstallationData({ 
          siteId: 12345,
          datatype: 'kwh',
          format: 'xlsx',
          decode: false
        });
        
        expect(result.ok).toBe(true);
        expect(result.data.format).toBe('xlsx');
        expect(result.data.datatype).toBe('kwh');
        expect(result.data.content).toBe(mockBase64Data);
        expect(result.data.encoding).toBe('base64');
        
        const callUrl = mockFetch.mock.calls[0][0] as string;
        expect(callUrl).toContain('datatype=kwh');
        expect(callUrl).toContain('format=xlsx');
      });

      it('should handle CSV parsing failures gracefully', async () => {
        // Test with malformed JSON response that causes parsing to fail
        const mockMalformedResponse = { invalidStructure: 'not-base64-data!' };
        
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockMalformedResponse
        });
        
        const result = await client.downloadInstallationData({ 
          siteId: 12345,
          format: 'csv',
          decode: true
        });
        
        expect(result.ok).toBe(true);
        expect(result.data.format).toBe('csv');
        expect(result.data).toHaveProperty('content');
        expect(result.data.content).toEqual(mockMalformedResponse);
        expect(result.data.encoding).toBe('base64');
        expect(result.meta.note).toContain('Failed to parse CSV');
      });

      it('should handle download errors', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 422,
          json: async () => ({ message: 'Invalid time range' })
        });
        
        const result = await client.downloadInstallationData({ 
          siteId: 12345,
          start: 1609545600000,
          end: 1609459200000 // End before start
        });
        
        expect(result.ok).toBe(false);
        expect(result.error?.code).toBe('bad_request');
      });
    });

    describe('downloadGpsData', () => {
      it('should download GPS data', async () => {
        const mockGpsData = {
          gpsPoints: [
            { lat: 52.3676, lng: 4.9041, timestamp: 1609459200, altitude: 5 },
            { lat: 52.3677, lng: 4.9042, timestamp: 1609459260, altitude: 6 }
          ]
        };
        
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockGpsData
        });
        
        const result = await client.downloadGpsData({ 
          siteId: 12345,
          start: 1609459200000,
          end: 1609545600000
        });
        
        expect(result.ok).toBe(true);
        expect(result.data).toEqual(mockGpsData);
        
        const callUrl = mockFetch.mock.calls[0][0] as string;
        expect(callUrl).toContain('/installations/12345/gps-download');
        expect(callUrl).toContain('start=1609459200000');
        expect(callUrl).toContain('end=1609545600000');
      });

      it('should download GPS data without time range', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ gpsPoints: [] })
        });
        
        await client.downloadGpsData({ siteId: 12345 });
        
        const callUrl = mockFetch.mock.calls[0][0] as string;
        expect(callUrl).toContain('/installations/12345/gps-download');
        expect(callUrl).not.toContain('start=');
        expect(callUrl).not.toContain('end=');
      });

      it('should handle GPS download errors', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 404,
          json: async () => ({ message: 'No GPS data available' })
        });
        
        const result = await client.downloadGpsData({ siteId: 99999 });
        
        expect(result.ok).toBe(false);
        expect(result.error?.code).toBe('not_found');
      });
    });

    describe('getInstallationTags', () => {
      it('should fetch installation tags', async () => {
        const mockTagsData = {
          records: [
            { id: 1, name: 'residential', color: '#blue', description: 'Home installation' },
            { id: 2, name: 'critical', color: '#red', description: 'Mission critical system' }
          ]
        };
        
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockTagsData
        });
        
        const result = await client.getInstallationTags({ siteId: 12345 });
        
        expect(result.ok).toBe(true);
        expect(result.data).toEqual(mockTagsData.records);
        expect(mockFetch).toHaveBeenCalledWith(
          'https://vrmapi.victronenergy.com/v2/installations/12345/tags',
          expect.objectContaining({
            method: 'GET'
          })
        );
      });

      it('should handle empty tags', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ records: [] })
        });
        
        const result = await client.getInstallationTags({ siteId: 12345 });
        
        expect(result.ok).toBe(true);
        expect(result.data).toEqual([]);
      });

      it('should handle tags errors', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 403,
          json: async () => ({ message: 'Access denied to tags' })
        });
        
        const result = await client.getInstallationTags({ siteId: 99999 });
        
        expect(result.ok).toBe(false);
        expect(result.error?.code).toBe('auth');
      });
    });

    describe('getCustomWidget', () => {
      it('should fetch custom widget configuration', async () => {
        const mockWidgetData = {
          id: 'custom-widget-1',
          type: 'chart',
          configuration: {
            attributes: ['Pb', 'Pc', 'S'],
            interval: 'hours',
            displayType: 'line'
          },
          title: 'My Custom Energy Chart'
        };
        
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockWidgetData
        });
        
        const result = await client.getCustomWidget({ siteId: 12345 });
        
        expect(result.ok).toBe(true);
        expect(result.data).toEqual(mockWidgetData);
        expect(mockFetch).toHaveBeenCalledWith(
          'https://vrmapi.victronenergy.com/v2/installations/12345/custom-widget',
          expect.objectContaining({
            method: 'GET'
          })
        );
      });

      it('should handle no custom widget', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 404,
          json: async () => ({ message: 'No custom widget configured' })
        });
        
        const result = await client.getCustomWidget({ siteId: 12345 });
        
        expect(result.ok).toBe(false);
        expect(result.error?.code).toBe('not_found');
      });
    });

    describe('getDynamicEssSettings', () => {
      it('should fetch Dynamic ESS settings', async () => {
        const mockEssData = {
          enabled: true,
          mode: 'optimize_with_battery_life',
          schedules: [
            { start: '06:00', end: '18:00', mode: 'keep_batteries_charged' },
            { start: '18:00', end: '06:00', mode: 'optimize_without_battery_life' }
          ],
          batteryLifeSettings: {
            minimumSoc: 20,
            maxDischargeRate: 0.5
          }
        };
        
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockEssData
        });
        
        const result = await client.getDynamicEssSettings({ siteId: 12345 });
        
        expect(result.ok).toBe(true);
        expect(result.data).toEqual(mockEssData);
        expect(mockFetch).toHaveBeenCalledWith(
          'https://vrmapi.victronenergy.com/v2/installations/12345/dynamic-ess-settings',
          expect.objectContaining({
            method: 'GET'
          })
        );
      });

      it('should handle installations without Dynamic ESS', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 404,
          json: async () => ({ message: 'Dynamic ESS not available for this installation' })
        });
        
        const result = await client.getDynamicEssSettings({ siteId: 12345 });
        
        expect(result.ok).toBe(false);
        expect(result.error?.code).toBe('not_found');
      });
    });
  });

  describe('Batch 8: System-Wide Endpoints', () => {
    describe('getDataAttributes', () => {
      it('should fetch data attributes with all parameters', async () => {
        const mockAttributesData = {
          records: [
            { code: 'Pb', name: 'Battery Power', unit: 'W', description: 'Battery power consumption/generation' },
            { code: 'Pc', name: 'Consumption Power', unit: 'W', description: 'AC consumption power' },
            { code: 'S', name: 'Solar Power', unit: 'W', description: 'Solar panels power generation' }
          ]
        };
        
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockAttributesData
        });
        
        const result = await client.getDataAttributes({
          filter: 'power',
          sort: 'name',
          limit: 50,
          offset: 10
        });
        
        expect(result.ok).toBe(true);
        expect(result.data).toEqual(mockAttributesData.records);
        
        const callUrl = mockFetch.mock.calls[0][0] as string;
        expect(callUrl).toContain('/data-attributes');
        expect(callUrl).toContain('filter=power');
        expect(callUrl).toContain('sort=name');
        expect(callUrl).toContain('limit=50');
        expect(callUrl).toContain('offset=10');
      });

      it('should fetch data attributes without parameters', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ records: [] })
        });
        
        await client.getDataAttributes({});
        
        const callUrl = mockFetch.mock.calls[0][0] as string;
        expect(callUrl).toContain('/data-attributes');
        expect(callUrl).not.toContain('filter=');
        expect(callUrl).not.toContain('sort=');
        expect(callUrl).not.toContain('limit=');
        expect(callUrl).not.toContain('offset=');
      });

      it('should handle data attributes errors', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 422,
          json: async () => ({ message: 'Invalid filter parameter' })
        });
        
        const result = await client.getDataAttributes({ filter: 'invalid_filter' });
        
        expect(result.ok).toBe(false);
        expect(result.error?.code).toBe('bad_request');
      });
    });

    describe('getFirmwares', () => {
      it('should fetch firmware information with filters', async () => {
        const mockFirmwareData = {
          records: [
            { 
              id: 1, 
              version: '2.94', 
              type: 'venus-os', 
              releaseDate: '2024-01-15',
              description: 'Venus OS v2.94 with improved battery management'
            },
            { 
              id: 2, 
              version: '1.65', 
              type: 'multiplus-ii', 
              releaseDate: '2024-01-10',
              description: 'MultiPlus-II firmware v1.65'
            }
          ]
        };
        
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockFirmwareData
        });
        
        const result = await client.getFirmwares({
          type: 'venus-os',
          version: '2.94'
        });
        
        expect(result.ok).toBe(true);
        expect(result.data).toEqual(mockFirmwareData.records);
        
        const callUrl = mockFetch.mock.calls[0][0] as string;
        expect(callUrl).toContain('/firmwares');
        expect(callUrl).toContain('type=venus-os');
        expect(callUrl).toContain('version=2.94');
      });

      it('should fetch all firmwares without filters', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ records: [] })
        });
        
        await client.getFirmwares({});
        
        const callUrl = mockFetch.mock.calls[0][0] as string;
        expect(callUrl).toContain('/firmwares');
        expect(callUrl).not.toContain('type=');
        expect(callUrl).not.toContain('version=');
      });

      it('should handle firmware errors', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 404,
          json: async () => ({ message: 'Firmware type not found' })
        });
        
        const result = await client.getFirmwares({ type: 'nonexistent-type' });
        
        expect(result.ok).toBe(false);
        expect(result.error?.code).toBe('not_found');
      });
    });
  });

  // ===== ALL REMAINING ENDPOINTS TESTS =====
  
  describe('Batch 3: Installation Management', () => {
    describe('getResetForecasts', () => {
      it('should fetch forecast reset timestamp', async () => {
        const mockForecastData = {
          lastReset: '2024-01-15T10:30:00Z',
          nextReset: '2024-01-16T00:00:00Z',
          resetInterval: 24,
          resetReason: 'scheduled'
        };
        
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockForecastData
        });
        
        const result = await client.getResetForecasts({ siteId: 12345 });
        
        expect(result.ok).toBe(true);
        expect(result.data).toEqual(mockForecastData);
        expect(mockFetch).toHaveBeenCalledWith(
          'https://vrmapi.victronenergy.com/v2/installations/12345/reset-forecasts',
          expect.objectContaining({
            method: 'GET'
          })
        );
      });

      it('should handle forecast reset errors', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 404,
          json: async () => ({ message: 'No forecast data available' })
        });
        
        const result = await client.getResetForecasts({ siteId: 99999 });
        
        expect(result.ok).toBe(false);
        expect(result.error?.code).toBe('not_found');
      });
    });
  });

  describe('Batch 4: Widget State Endpoints', () => {
    describe('getVeBusState', () => {
      it('should fetch VE.Bus state with instance', async () => {
        const mockVeBusData = {
          state: 'Inverting',
          mode: 'On',
          voltage: 230.2,
          current: 5.4,
          frequency: 50.01,
          loadPercent: 25
        };
        
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockVeBusData
        });
        
        const result = await client.getVeBusState({ siteId: 12345, instance: 276 });
        
        expect(result.ok).toBe(true);
        expect(result.data).toEqual(mockVeBusData);
        
        const callUrl = mockFetch.mock.calls[0][0] as string;
        expect(callUrl).toContain('/installations/12345/widgets/VeBusState');
        expect(callUrl).toContain('instance=276');
      });

      it('should fetch VE.Bus state without instance', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ state: 'Off' })
        });
        
        await client.getVeBusState({ siteId: 12345 });
        
        const callUrl = mockFetch.mock.calls[0][0] as string;
        expect(callUrl).toContain('/installations/12345/widgets/VeBusState');
        expect(callUrl).not.toContain('instance=');
      });
    });

    describe('getInverterChargerState', () => {
      it('should fetch inverter/charger state', async () => {
        const mockInverterData = {
          state: 'Bulk',
          mode: 'Charger Only',
          chargingVoltage: 14.4,
          chargingCurrent: 30.0,
          batteryVoltage: 12.8
        };
        
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockInverterData
        });
        
        const result = await client.getInverterChargerState({ siteId: 12345, instance: 278 });
        
        expect(result.ok).toBe(true);
        expect(result.data).toEqual(mockInverterData);
        
        const callUrl = mockFetch.mock.calls[0][0] as string;
        expect(callUrl).toContain('/installations/12345/widgets/InverterChargerState');
        expect(callUrl).toContain('instance=278');
      });
    });

    describe('getChargerRelayState', () => {
      it('should fetch charger relay state', async () => {
        const mockRelayData = {
          relayState: 'Open',
          controlMode: 'Manual',
          switchCount: 147,
          lastSwitched: '2024-01-15T14:30:00Z'
        };
        
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockRelayData
        });
        
        const result = await client.getChargerRelayState({ siteId: 12345 });
        
        expect(result.ok).toBe(true);
        expect(result.data).toEqual(mockRelayData);
      });
    });

    describe('getSolarChargerRelayState', () => {
      it('should fetch solar charger relay state', async () => {
        const mockSolarRelayData = {
          relayState: 'Closed',
          mpptMode: 'Maximum Power Point',
          efficiency: 97.2,
          temperature: 45.3
        };
        
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockSolarRelayData
        });
        
        const result = await client.getSolarChargerRelayState({ siteId: 12345, instance: 279 });
        
        expect(result.ok).toBe(true);
        expect(result.data).toEqual(mockSolarRelayData);
      });
    });

    describe('getGatewayRelayState', () => {
      it('should fetch gateway relay state', async () => {
        const mockGatewayData = {
          relay1State: 'Open',
          relay1Function: 'Generator Start/Stop',
          connectionStatus: 'Connected',
          signalStrength: -65
        };
        
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockGatewayData
        });
        
        const result = await client.getGatewayRelayState({ siteId: 12345 });
        
        expect(result.ok).toBe(true);
        expect(result.data).toEqual(mockGatewayData);
      });
    });

    describe('getGatewayRelayTwoState', () => {
      it('should fetch secondary gateway relay state', async () => {
        const mockGateway2Data = {
          relay2State: 'Closed',
          relay2Function: 'Water Pump Control',
          automationActive: true,
          scheduledOperation: '06:00-18:00'
        };
        
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockGateway2Data
        });
        
        const result = await client.getGatewayRelayTwoState({ siteId: 12345, instance: 280 });
        
        expect(result.ok).toBe(true);
        expect(result.data).toEqual(mockGateway2Data);
      });
    });

    describe('getStatusWidget', () => {
      it('should fetch general status widget', async () => {
        const mockStatusData = {
          overallStatus: 'Normal',
          systemHealth: 'Good',
          activeAlarms: 0,
          activeWarnings: 1,
          lastUpdate: '2024-01-15T15:45:00Z',
          communicationStatus: 'Online'
        };
        
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockStatusData
        });
        
        const result = await client.getStatusWidget({ siteId: 12345 });
        
        expect(result.ok).toBe(true);
        expect(result.data).toEqual(mockStatusData);
      });
    });
  });

  describe('Batch 5: Widget Warnings & Alarms', () => {
    describe('getVeBusWarningsAlarms', () => {
      it('should fetch VE.Bus warnings and alarms', async () => {
        const mockWarningsData = {
          warnings: [
            { code: 'W001', message: 'High temperature warning', severity: 'Warning', timestamp: 1705329000 },
            { code: 'W002', message: 'Overload warning', severity: 'Warning', timestamp: 1705329300 }
          ],
          alarms: [
            { code: 'A001', message: 'Low battery alarm', severity: 'Alarm', timestamp: 1705329600 }
          ],
          summary: { totalWarnings: 2, totalAlarms: 1 }
        };
        
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockWarningsData
        });
        
        const result = await client.getVeBusWarningsAlarms({ siteId: 12345, instance: 276 });
        
        expect(result.ok).toBe(true);
        expect(result.data).toEqual(mockWarningsData);
        
        const callUrl = mockFetch.mock.calls[0][0] as string;
        expect(callUrl).toContain('/installations/12345/widgets/VeBusWarningsAndAlarms');
      });
    });

    describe('getInverterChargerWarningsAlarms', () => {
      it('should fetch inverter/charger warnings and alarms', async () => {
        const mockInverterWarnings = {
          warnings: [
            { code: 'IW001', message: 'Charging temperature high', severity: 'Warning', timestamp: 1705329000 }
          ],
          alarms: [],
          summary: { totalWarnings: 1, totalAlarms: 0 }
        };
        
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockInverterWarnings
        });
        
        const result = await client.getInverterChargerWarningsAlarms({ siteId: 12345 });
        
        expect(result.ok).toBe(true);
        expect(result.data).toEqual(mockInverterWarnings);
      });
    });
  });

  describe('Batch 6: Widget Summary Endpoints', () => {
    describe('getBatterySummary', () => {
      it('should fetch comprehensive battery summary', async () => {
        const mockBatteryData = {
          voltage: 12.6,
          current: -15.3,
          power: -192.8,
          soc: 78,
          temperature: 23.4,
          capacity: { total: 400, remaining: 312 },
          health: { cycleCount: 45, degradation: 2.1 },
          cells: { min: 3.14, max: 3.18, average: 3.16, balancing: true }
        };
        
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockBatteryData
        });
        
        const result = await client.getBatterySummary({ siteId: 12345, instance: 512 });
        
        expect(result.ok).toBe(true);
        expect(result.data).toEqual(mockBatteryData);
        
        const callUrl = mockFetch.mock.calls[0][0] as string;
        expect(callUrl).toContain('/installations/12345/widgets/BatterySummary');
        expect(callUrl).toContain('instance=512');
      });
    });

    describe('getSolarChargerSummary', () => {
      it('should fetch solar charger summary with MPPT data', async () => {
        const mockSolarData = {
          state: 'Bulk',
          pvVoltage: 89.2,
          pvCurrent: 12.4,
          pvPower: 1106,
          batteryVoltage: 14.1,
          chargingCurrent: 78.5,
          efficiency: 96.8,
          dailyYield: 12.4,
          totalYield: 2847.6
        };
        
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockSolarData
        });
        
        const result = await client.getSolarChargerSummary({ siteId: 12345 });
        
        expect(result.ok).toBe(true);
        expect(result.data).toEqual(mockSolarData);
      });
    });

    describe('getEvChargerSummary', () => {
      it('should fetch EV charger summary', async () => {
        const mockEvData = {
          status: 'Charging',
          chargingPower: 7200,
          maxPower: 11000,
          sessionEnergy: 15.6,
          sessionTime: 125,
          temperature: 35.2,
          efficiency: 94.5
        };
        
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockEvData
        });
        
        const result = await client.getEvChargerSummary({ siteId: 12345, instance: 800 });
        
        expect(result.ok).toBe(true);
        expect(result.data).toEqual(mockEvData);
      });
    });

    describe('getGlobalLinkSummary', () => {
      it('should fetch GlobalLink device summary', async () => {
        const mockGlobalLinkData = {
          generatorState: 'Running',
          generatorPower: 5500,
          generatorHours: 247.5,
          tankLevels: [
            { type: 'Fuel', level: 85, capacity: 200 },
            { type: 'Water', level: 67, capacity: 150 }
          ],
          inputs: { digital: [true, false, true], analog: [12.4, 3.7] }
        };
        
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockGlobalLinkData
        });
        
        const result = await client.getGlobalLinkSummary({ siteId: 12345 });
        
        expect(result.ok).toBe(true);
        expect(result.data).toEqual(mockGlobalLinkData);
      });
    });

    describe('getMotorSummary', () => {
      it('should fetch motor drive summary', async () => {
        const mockMotorData = {
          rpm: 1750,
          power: 2200,
          torque: 12.0,
          efficiency: 91.2,
          temperature: 68.5,
          status: 'Running',
          operatingHours: 1247.3
        };
        
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockMotorData
        });
        
        const result = await client.getMotorSummary({ siteId: 12345, instance: 700 });
        
        expect(result.ok).toBe(true);
        expect(result.data).toEqual(mockMotorData);
      });
    });

    describe('getPvInverterStatus', () => {
      it('should fetch PV inverter status', async () => {
        const mockPvInverterData = {
          status: 'Running',
          acPower: 4850,
          acVoltage: 230.1,
          acCurrent: 21.1,
          dcVoltage: 389.2,
          dcCurrent: 12.5,
          efficiency: 97.3,
          gridFrequency: 50.02
        };
        
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockPvInverterData
        });
        
        const result = await client.getPvInverterStatus({ siteId: 12345 });
        
        expect(result.ok).toBe(true);
        expect(result.data).toEqual(mockPvInverterData);
      });
    });

    describe('getTankSummary', () => {
      it('should fetch tank sensor summary', async () => {
        const mockTankData = {
          tanks: [
            { id: 1, type: 'Fuel', level: 75, capacity: 100, volume: 75.0, unit: 'L' },
            { id: 2, type: 'Fresh Water', level: 45, capacity: 200, volume: 90.0, unit: 'L' },
            { id: 3, type: 'Waste Water', level: 23, capacity: 80, volume: 18.4, unit: 'L' }
          ],
          summary: { totalTanks: 3, alertCount: 0 }
        };
        
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockTankData
        });
        
        const result = await client.getTankSummary({ siteId: 12345, instance: 600 });
        
        expect(result.ok).toBe(true);
        expect(result.data).toEqual(mockTankData);
      });
    });

    describe('getTempSummaryGraph', () => {
      it('should fetch temperature summary and graph data', async () => {
        const mockTempData = {
          sensors: [
            { id: 1, location: 'Battery', current: 24.3, min: 18.2, max: 32.1, unit: '°C' },
            { id: 2, location: 'Engine Room', current: 45.7, min: 28.4, max: 58.9, unit: '°C' }
          ],
          graphData: {
            timestamps: [1705329000, 1705329300, 1705329600],
            values: [[24.1, 24.2, 24.3], [45.2, 45.5, 45.7]]
          }
        };
        
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockTempData
        });
        
        const result = await client.getTempSummaryGraph({ siteId: 12345 });
        
        expect(result.ok).toBe(true);
        expect(result.data).toEqual(mockTempData);
      });
    });

    describe('getDcMeter', () => {
      it('should fetch DC power meter readings', async () => {
        const mockDcMeterData = {
          voltage: 48.2,
          current: 15.7,
          power: 756.9,
          energy: { daily: 18.2, total: 2847.6 },
          shunt: { temperature: 28.4, calibration: 500 }
        };
        
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockDcMeterData
        });
        
        const result = await client.getDcMeter({ siteId: 12345, instance: 900 });
        
        expect(result.ok).toBe(true);
        expect(result.data).toEqual(mockDcMeterData);
      });
    });
  });

  describe('Batch 7: Widget Diagnostics & Data', () => {
    describe('getBmsDiagnostics', () => {
      it('should fetch BMS diagnostics with cell data', async () => {
        const mockBmsData = {
          cells: {
            voltages: [3.156, 3.162, 3.158, 3.159, 3.161, 3.154, 3.160, 3.157],
            temperatures: [23.2, 23.4, 23.1, 23.3],
            balancing: [false, true, false, false, true, false, false, false]
          },
          diagnostics: {
            cycleCount: 127,
            chargingCycles: 89,
            dischargingCycles: 38,
            deepDischargeCycles: 2,
            totalAh: 12847.6,
            lastFullCharge: '2024-01-14T22:15:00Z'
          }
        };
        
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockBmsData
        });
        
        const result = await client.getBmsDiagnostics({ siteId: 12345, instance: 512 });
        
        expect(result.ok).toBe(true);
        expect(result.data).toEqual(mockBmsData);
        
        const callUrl = mockFetch.mock.calls[0][0] as string;
        expect(callUrl).toContain('/installations/12345/widgets/BMSDiagnostics');
      });
    });

    describe('getLithiumBms', () => {
      it('should fetch Lithium BMS advanced data', async () => {
        const mockLithiumData = {
          chemistry: 'LiFePO4',
          configuration: '16S4P',
          totalCapacity: 400,
          usableCapacity: 380,
          protections: {
            overVoltage: { threshold: 3.65, active: false },
            underVoltage: { threshold: 2.8, active: false },
            overCurrent: { threshold: 200, active: false },
            overTemperature: { threshold: 60, active: false }
          },
          safety: {
            contactor: 'Closed',
            precharge: 'Complete',
            isolation: 'Good'
          }
        };
        
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockLithiumData
        });
        
        const result = await client.getLithiumBms({ siteId: 12345 });
        
        expect(result.ok).toBe(true);
        expect(result.data).toEqual(mockLithiumData);
      });
    });

    describe('getSolarChargerSummary', () => {
      it('should fetch solar charger summary with specific instance', async () => {
        const mockSolarData = {
          voltage: 48.2,
          current: 12.5,
          power: 602,
          efficiency: 94.2,
          instance: 1000
        };
        
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockSolarData
        });
        
        const result = await client.getSolarChargerSummary({ siteId: 12345, instance: 1000 });
        
        expect(result.ok).toBe(true);
        expect(result.data).toEqual(mockSolarData);
      });
    });

    describe('getEvChargerSummary', () => {
      it('should fetch EV charger summary with specific instance', async () => {
        const mockEvData = {
          status: 'Charging',
          power: 7200,
          sessionEnergy: 15.4,
          maxCurrent: 32,
          instance: 1000
        };
        
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockEvData
        });
        
        const result = await client.getEvChargerSummary({ siteId: 12345, instance: 1000 });
        
        expect(result.ok).toBe(true);
        expect(result.data).toEqual(mockEvData);
      });
    });

    describe('getGlobalLinkSummary', () => {
      it('should fetch global link summary with specific instance', async () => {
        const mockGlobalData = {
          status: 'Connected',
          signalStrength: -65,
          dataUsage: { tx: 1024, rx: 2048 },
          instance: 1000
        };
        
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockGlobalData
        });
        
        const result = await client.getGlobalLinkSummary({ siteId: 12345, instance: 1000 });
        
        expect(result.ok).toBe(true);
        expect(result.data).toEqual(mockGlobalData);
      });
    });

    describe('getMotorSummary', () => {
      it('should fetch motor summary with specific instance', async () => {
        const mockMotorData = {
          rpm: 1800,
          power: 2500,
          torque: 13.3,
          temperature: 65.2,
          instance: 1000
        };
        
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockMotorData
        });
        
        const result = await client.getMotorSummary({ siteId: 12345, instance: 1000 });
        
        expect(result.ok).toBe(true);
        expect(result.data).toEqual(mockMotorData);
      });
    });

    describe('getPvInverterStatus', () => {
      it('should fetch PV inverter status with specific instance', async () => {
        const mockPvData = {
          status: 'Running',
          power: 3200,
          efficiency: 96.8,
          temperature: 42.1,
          instance: 1000
        };
        
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockPvData
        });
        
        const result = await client.getPvInverterStatus({ siteId: 12345, instance: 1000 });
        
        expect(result.ok).toBe(true);
        expect(result.data).toEqual(mockPvData);
      });
    });

    describe('getTankSummary', () => {
      it('should fetch tank summary with specific instance', async () => {
        const mockTankData = {
          level: 75.5,
          capacity: 200,
          fluid: 'Fresh Water',
          status: 'Normal',
          instance: 1000
        };
        
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockTankData
        });
        
        const result = await client.getTankSummary({ siteId: 12345, instance: 1000 });
        
        expect(result.ok).toBe(true);
        expect(result.data).toEqual(mockTankData);
      });
    });

    describe('getHistoricData', () => {
      it('should fetch historic data widget', async () => {
        const mockHistoricData = {
          timeRange: { start: 1705242000, end: 1705328400 },
          dataPoints: 288,
          series: [
            {
              name: 'Battery Voltage',
              data: [[1705242000, 12.4], [1705242300, 12.6], [1705242600, 12.8]]
            },
            {
              name: 'Solar Power',
              data: [[1705242000, 0], [1705242300, 150], [1705242600, 280]]
            }
          ],
          statistics: {
            batteryMin: 11.8, batteryMax: 14.2, batteryAvg: 12.7,
            solarTotal: 24.8, solarPeak: 1200
          }
        };
        
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockHistoricData
        });
        
        const result = await client.getHistoricData({ siteId: 12345, instance: 1000 });
        
        expect(result.ok).toBe(true);
        expect(result.data).toEqual(mockHistoricData);
      });
    });

    describe('getTempSummaryGraph', () => {
      it('should fetch temperature summary and graph data', async () => {
        const mockTempData = {
          temperatures: [
            { instance: 0, temperature: 25.5, customName: 'Battery', location: 'Main Bay' },
            { instance: 1, temperature: 28.2, customName: 'Inverter', location: 'Equipment' }
          ],
          graph: {
            datasets: [
              { time: 1640995200, temp0: 25.1, temp1: 28.0 },
              { time: 1640995800, temp0: 25.5, temp1: 28.2 }
            ]
          }
        };
        
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockTempData
        });
        
        const result = await client.getTempSummaryGraph({ siteId: 12345 });
        
        expect(result.ok).toBe(true);
        expect(result.data).toEqual(mockTempData);
      });

      it('should fetch temperature data with specific instance', async () => {
        const mockTempData = { temperature: 26.1, instance: 1000 };
        
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockTempData
        });
        
        const result = await client.getTempSummaryGraph({ siteId: 12345, instance: 1000 });
        
        expect(result.ok).toBe(true);
        expect(result.data).toEqual(mockTempData);
      });
    });

    describe('getDcMeter', () => {
      it('should fetch DC meter data with specific instance', async () => {
        const mockDcData = {
          power: 850.2,
          voltage: 48.7,
          current: 17.4,
          instance: 1000
        };
        
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockDcData
        });
        
        const result = await client.getDcMeter({ siteId: 12345, instance: 1000 });
        
        expect(result.ok).toBe(true);
        expect(result.data).toEqual(mockDcData);
      });
    });

    describe('getLithiumBms', () => {
      it('should fetch lithium BMS data with specific instance', async () => {
        const mockBmsData = {
          voltage: 51.2,
          current: -15.3,
          soc: 78,
          temperature: 22.4,
          instance: 1000
        };
        
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockBmsData
        });
        
        const result = await client.getLithiumBms({ siteId: 12345, instance: 1000 });
        
        expect(result.ok).toBe(true);
        expect(result.data).toEqual(mockBmsData);
      });
    });

    describe('getIoExtender', () => {
      it('should fetch IO extender input/output status', async () => {
        const mockIoData = {
          digitalInputs: [
            { channel: 1, state: true, function: 'Door Sensor', pullUp: true },
            { channel: 2, state: false, function: 'Float Switch', pullUp: false },
            { channel: 3, state: true, function: 'Alarm Button', pullUp: true }
          ],
          digitalOutputs: [
            { channel: 1, state: false, function: 'Pump Control', load: 'Relay' },
            { channel: 2, state: true, function: 'LED Indicator', load: 'LED' }
          ],
          analogInputs: [
            { channel: 1, value: 12.4, unit: 'V', function: 'Battery Monitor' },
            { channel: 2, value: 3.7, unit: 'V', function: 'Temperature' }
          ]
        };
        
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockIoData
        });
        
        const result = await client.getIoExtender({ siteId: 12345 });
        
        expect(result.ok).toBe(true);
        expect(result.data).toEqual(mockIoData);
      });

      it('should fetch IO extender data with specific instance', async () => {
        const mockIoData = {
          digitalInputs: [{ channel: 1, state: false, function: 'Switch', pullUp: true }],
          instance: 1000
        };
        
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockIoData
        });
        
        const result = await client.getIoExtender({ siteId: 12345, instance: 1000 });
        
        expect(result.ok).toBe(true);
        expect(result.data).toEqual(mockIoData);
      });
    });
  });
});
