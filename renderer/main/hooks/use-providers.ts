// Provider metadata (id, label, scope hint, credential fields) from the backend
// registry — drives the add-account dialog's dynamic fields.

import { useQuery } from "@tanstack/react-query";

import { monitorApi } from "../ipc";

export const PROVIDERS_KEY = ["providers"] as const;

export function useProviders() {
  return useQuery({
    queryKey: PROVIDERS_KEY,
    queryFn: () => monitorApi.listProviders(),
    staleTime: Infinity,
  });
}
