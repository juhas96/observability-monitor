import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { monitorApi, onNotification } from "../ipc";
import type { AggregateSnapshot, HistoryDateRange, HistoryRange, HttpCheckInput } from "../types";

const CHECKS_KEY = ["checks"] as const;

export function useChecks() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: [...CHECKS_KEY, "list"],
    queryFn: () => monitorApi.listChecks(),
  });

  useEffect(() => {
    return onNotification<AggregateSnapshot>("monitor:snapshot", () => {
      void queryClient.invalidateQueries({ queryKey: CHECKS_KEY });
    });
  }, [queryClient]);

  return query;
}

export function useCheckMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: CHECKS_KEY });
  const save = useMutation({
    mutationFn: (req: HttpCheckInput) => monitorApi.saveCheck(req),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => monitorApi.deleteCheck(id),
    onSuccess: invalidate,
  });
  return { save, remove };
}

export function useCheckLatency(checkId: string, range: HistoryRange | HistoryDateRange) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: [...CHECKS_KEY, "latency", checkId, range],
    queryFn: () => typeof range === "string"
      ? monitorApi.getCheckLatencySeries({ checkId, range })
      : monitorApi.getCheckLatencySeries({ checkId, dateRange: range }),
    enabled: checkId.trim() !== "",
  });

  useEffect(() => {
    return onNotification<AggregateSnapshot>("monitor:snapshot", () => {
      void queryClient.invalidateQueries({ queryKey: [...CHECKS_KEY, "latency"] });
    });
  }, [queryClient]);

  return query;
}
