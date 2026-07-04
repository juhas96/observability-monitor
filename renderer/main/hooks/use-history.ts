import {useEffect} from "react";
import {useQuery, useQueryClient} from "@tanstack/react-query";

import {monitorApi, onNotification} from "../ipc";
import type { AggregateSnapshot, HistoryDateRange, HistoryEventType, HistoryRange } from "../types";

export function useHistorySeries(
  range: HistoryRange | HistoryDateRange,
  filters: { groupId?: string; accountId?: string; provider?: string } = {},
) {
  const queryClient = useQueryClient();
  const queryKey = ["history", "series", range, filters] as const;
  const query = useQuery({
    queryKey,
    queryFn: () => typeof range === "string"
      ? monitorApi.getHistorySeries({ ...filters, range })
      : monitorApi.getHistorySeries({ ...filters, dateRange: range }),
  });

  useEffect(() => {
    return onNotification<AggregateSnapshot>("monitor:snapshot", () => {
      void queryClient.invalidateQueries({queryKey: ["history"]});
    });
  }, [queryClient]);

  return query;
}

export function useHistoryEvents(filters: {
  range: HistoryRange | HistoryDateRange;
  groupId?: string;
  accountId?: string;
  provider?: string;
  status?: string;
  severity?: string;
  category?: string;
  types?: HistoryEventType[];
}) {
  const queryClient = useQueryClient();
  const queryKey = ["history", "events", filters] as const;
  const query = useQuery({
    queryKey,
    queryFn: () => {
      const { range, ...rest } = filters;
      return typeof range === "string"
        ? monitorApi.getHistoryEvents({ ...rest, range })
        : monitorApi.getHistoryEvents({ ...rest, dateRange: range });
    },
  });

  useEffect(() => {
    return onNotification<AggregateSnapshot>("monitor:snapshot", () => {
      void queryClient.invalidateQueries({queryKey: ["history"]});
    });
  }, [queryClient]);

  return query;
}

export function useHistoryStats() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["history", "stats"] as const,
    queryFn: () => monitorApi.getHistoryStats(),
  });

  useEffect(() => {
    return onNotification<AggregateSnapshot>("monitor:snapshot", () => {
      void queryClient.invalidateQueries({ queryKey: ["history", "stats"] });
    });
  }, [queryClient]);

  return query;
}
