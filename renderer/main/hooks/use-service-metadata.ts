import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { monitorApi } from "../ipc";
import type { ServiceMetadataInput } from "../types";

export const SERVICE_METADATA_KEY = ["services", "metadata"] as const;

export function useServiceMetadata() {
  return useQuery({ queryKey: SERVICE_METADATA_KEY, queryFn: () => monitorApi.listServiceMetadata() });
}

export function useServiceMetadataMutations() {
  const queryClient = useQueryClient();
  return {
    save: useMutation({
      mutationFn: (input: ServiceMetadataInput) => monitorApi.saveServiceMetadata(input),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: SERVICE_METADATA_KEY }),
    }),
    remove: useMutation({
      mutationFn: (serviceId: string) => monitorApi.deleteServiceMetadata(serviceId),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: SERVICE_METADATA_KEY }),
    }),
  };
}
