// Provider metadata (id, label, scope hint, credential fields) from the backend
// registry — drives the add-account dialog's dynamic fields.

import { useQuery } from "@tanstack/react-query";

import { monitorApi } from "../ipc";
import type { HistoryRange, Provider } from "../types";

export const PROVIDERS_KEY = ["providers"] as const;
export const PROVIDER_WORKSPACE_CAPABILITIES_KEY = ["providers", "workspace-capabilities"] as const;

export function useProviders() {
  return useQuery({
    queryKey: PROVIDERS_KEY,
    queryFn: () => monitorApi.listProviders(),
    staleTime: Infinity,
  });
}

export function useProviderWorkspaceCapabilities() {
  return useQuery({
    queryKey: PROVIDER_WORKSPACE_CAPABILITIES_KEY,
    queryFn: () => monitorApi.listProviderWorkspaceCapabilities(),
  });
}

export function useProviderWorkspaceOverview(req: { provider: Provider; range: HistoryRange; accountId?: string }) {
  return useQuery({
    queryKey: ["providers", "workspace", req] as const,
    queryFn: () => monitorApi.getProviderWorkspaceOverview(req),
  });
}
