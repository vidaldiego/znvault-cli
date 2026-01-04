// Path: znvault-cli/src/tui/hooks/useApi.ts
import { useState, useEffect, useCallback } from 'react';
import * as mode from '../../lib/mode.js';

interface HealthData {
  status: string;
  version: string;
  uptime: number;
  timestamp: string;
  database?: { status: string; role?: string };
  redis?: { status: string; sentinelNodes?: number };
  ha?: {
    enabled: boolean;
    nodeId: string;
    isLeader: boolean;
    clusterSize?: number;
  };
}

interface ClusterData {
  enabled: boolean;
  nodeId: string;
  isLeader: boolean;
  leaderNodeId: string | null;
  nodes: Array<{
    nodeId: string;
    host: string;
    isLeader: boolean;
    isHealthy: boolean;
    lastSeen?: string;
  }>;
}

interface LockdownData {
  scope: string;
  status: string;
  reason?: string;
  triggeredAt?: string;
  escalationCount: number;
}

interface AuditEntry {
  id: string;
  timestamp: string;
  action: string;
  username: string;
  ip: string;
  status: number;
  path?: string;
}

export interface DashboardData {
  health: HealthData | null;
  cluster: ClusterData | null;
  lockdown: LockdownData | null;
  audit: AuditEntry[];
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
}

/**
 * Hook to fetch and poll dashboard data from the API
 */
export function useDashboard(refreshInterval = 5000): DashboardData & { refresh: () => Promise<void> } {
  const [data, setData] = useState<DashboardData>({
    health: null,
    cluster: null,
    lockdown: null,
    audit: [],
    loading: true,
    error: null,
    lastUpdated: null,
  });

  const fetchData = useCallback(async () => {
    try {
      const [healthResult, clusterResult, lockdownResult] = await Promise.allSettled([
        mode.health(),
        mode.clusterStatus(),
        mode.getLockdownStatus(),
      ]);

      setData({
        health: healthResult.status === 'fulfilled' ? healthResult.value as HealthData : null,
        cluster: clusterResult.status === 'fulfilled' ? clusterResult.value as ClusterData : null,
        lockdown: lockdownResult.status === 'fulfilled' ? lockdownResult.value as LockdownData : null,
        audit: [], // Audit requires separate API call with auth
        loading: false,
        error: null,
        lastUpdated: new Date(),
      });
    } catch (err) {
      setData(prev => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to fetch data',
      }));
    }
  }, []);

  useEffect(() => {
    void fetchData();

    const interval = setInterval(() => {
      void fetchData();
    }, refreshInterval);

    return () => { clearInterval(interval); };
  }, [fetchData, refreshInterval]);

  return { ...data, refresh: fetchData };
}

/**
 * Hook for single API call with loading state
 */
export function useApiCall<T>(
  apiCall: () => Promise<T>,
  deps: unknown[] = []
): { data: T | null; loading: boolean; error: string | null; refresh: () => Promise<void> } {
  const [state, setState] = useState<{
    data: T | null;
    loading: boolean;
    error: string | null;
  }>({
    data: null,
    loading: true,
    error: null,
  });

  const refresh = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const result = await apiCall();
      setState({ data: result, loading: false, error: null });
    } catch (err) {
      setState(prev => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'API call failed',
      }));
    }
  }, deps); // deps is intentionally dynamic

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { ...state, refresh };
}
