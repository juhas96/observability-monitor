import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { monitorApi } from "../ipc";
import type { DashboardInput, DashboardPanel } from "../types";

export const DASHBOARDS_KEY = ["dashboards"] as const;
export const DASHBOARD_CAPABILITIES_KEY = ["dashboards", "capabilities"] as const;

export function useDashboards() {
  return useQuery({ queryKey: DASHBOARDS_KEY, queryFn: () => monitorApi.listDashboards() });
}

export function useDashboardCapabilities() {
  return useQuery({ queryKey: DASHBOARD_CAPABILITIES_KEY, queryFn: () => monitorApi.listDashboardCapabilities() });
}

export function useDashboardMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: DASHBOARDS_KEY });
  return {
    save: useMutation({
      mutationFn: (input: DashboardInput) => monitorApi.saveDashboard(input),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => monitorApi.deleteDashboard(id),
      onSuccess: invalidate,
    }),
    exportOne: useMutation({
      mutationFn: (id: string) => monitorApi.exportDashboard(id),
    }),
    importOne: useMutation({
      mutationFn: () => monitorApi.importDashboard(),
      onSuccess: invalidate,
    }),
  };
}

export function useDashboardPanel(panel: DashboardPanel, range: DashboardInput["range"], refreshSeconds?: number) {
  return useQuery({
    queryKey: ["dashboards", "panel", panel, range],
    queryFn: () => monitorApi.runDashboardPanel({ panel, range }),
    retry: false,
    refetchInterval: refreshSeconds && refreshSeconds >= 15 ? refreshSeconds * 1000 : false,
    staleTime: refreshSeconds && refreshSeconds >= 15 ? Math.max(0, (refreshSeconds - 1) * 1000) : 30_000,
  });
}
