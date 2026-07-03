// Live monitoring data: seeds from monitor:getSnapshot, then keeps the query
// cache updated from the backend's monitor:snapshot push channel.

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { monitorApi, onNotification } from "../ipc";
import type { AggregateSnapshot } from "../types";

export const SNAPSHOT_KEY = ["monitor", "snapshot"] as const;

export function useMonitorData() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: SNAPSHOT_KEY,
    queryFn: () => monitorApi.getSnapshot(),
    staleTime: Infinity,
  });

  useEffect(() => {
    const unsubscribe = onNotification<AggregateSnapshot>("monitor:snapshot", (snapshot) => {
      queryClient.setQueryData(SNAPSHOT_KEY, snapshot);
    });
    return unsubscribe;
  }, [queryClient]);

  return query;
}
