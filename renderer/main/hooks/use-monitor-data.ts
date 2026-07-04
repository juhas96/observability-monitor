// Live monitoring data: seeds from monitor:getSnapshot, then keeps the query
// cache updated from the backend's monitor:snapshot push channel.

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { monitorApi, onNotification } from "../ipc";
import type { AggregateSnapshot, MonitorSettings } from "../types";

export const SNAPSHOT_KEY = ["monitor", "snapshot"] as const;
export const SETTINGS_KEY = ["monitor", "settings"] as const;

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

export function useMonitorSettings() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => monitorApi.getSettings(),
    staleTime: Infinity,
  });

  useEffect(() => {
    const unsubscribe = onNotification<{ value: MonitorSettings }>("settings:monitor-changed", (payload) => {
      queryClient.setQueryData(SETTINGS_KEY, payload.value);
    });
    return unsubscribe;
  }, [queryClient]);

  return query;
}
