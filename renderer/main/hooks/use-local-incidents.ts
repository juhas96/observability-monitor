import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { monitorApi } from "../ipc";
import type { LocalIncidentInput, LocalIncidentStatus } from "../types";

export const LOCAL_INCIDENTS_KEY = ["local-incidents"] as const;

export function useLocalIncidents() {
  return useQuery({
    queryKey: LOCAL_INCIDENTS_KEY,
    queryFn: () => monitorApi.listLocalIncidents(),
  });
}

export function useLocalIncidentMutations() {
  const queryClient = useQueryClient();
  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: LOCAL_INCIDENTS_KEY });
  };
  return {
    save: useMutation({
      mutationFn: (input: LocalIncidentInput) => monitorApi.saveLocalIncident(input),
      onSuccess: invalidate,
    }),
    updateStatus: useMutation({
      mutationFn: ({ id, status, reason }: { id: string; status: LocalIncidentStatus; reason?: string }) =>
        monitorApi.updateLocalIncidentStatus(id, status, reason),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => monitorApi.deleteLocalIncident(id),
      onSuccess: invalidate,
    }),
    exportReport: useMutation({
      mutationFn: ({ id, format = "markdown" }: { id: string; format?: "markdown" | "json" }) => monitorApi.exportLocalIncident(id, format),
    }),
  };
}
