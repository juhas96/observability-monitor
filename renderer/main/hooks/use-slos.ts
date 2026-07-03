import {useEffect} from "react";
import {useMutation, useQuery, useQueryClient} from "@tanstack/react-query";

import {monitorApi, onNotification} from "../ipc";
import type {AggregateSnapshot, SloDefinition} from "../types";

export const SLO_KEY = ["history", "slos"] as const;
export const SLO_STATUS_KEY = ["history", "slo-status"] as const;

export function useSlos() {
  return useQuery({
    queryKey: SLO_KEY,
    queryFn: () => monitorApi.listSlos(),
  });
}

export function useSloStatus() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: SLO_STATUS_KEY,
    queryFn: () => monitorApi.getSloStatus(),
  });

  useEffect(() => {
    return onNotification<AggregateSnapshot>("monitor:snapshot", () => {
      void queryClient.invalidateQueries({queryKey: SLO_STATUS_KEY});
    });
  }, [queryClient]);

  return query;
}

export function useSloMutations() {
  const queryClient = useQueryClient();
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: SLO_KEY }),
      queryClient.invalidateQueries({ queryKey: SLO_STATUS_KEY }),
    ]);
  };
  const save = useMutation({
    mutationFn: (req: { id?: string; name: string; scope: SloDefinition["scope"]; target: number; windowDays: number }) =>
      monitorApi.saveSlo(req),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => monitorApi.deleteSlo(id),
    onSuccess: invalidate,
  });
  return { save, remove };
}
