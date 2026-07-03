import {useEffect} from "react";
import {useQuery, useQueryClient} from "@tanstack/react-query";

import {monitorApi, onNotification} from "../ipc";
import type {AggregateSnapshot, HistoryEventType, HistoryRange} from "../types";

export function useHistorySeries(range: HistoryRange) {
  const queryClient = useQueryClient();
  const queryKey = ["history", "series", range] as const;
  const query = useQuery({
    queryKey,
    queryFn: () => monitorApi.getHistorySeries({ range }),
  });

  useEffect(() => {
    return onNotification<AggregateSnapshot>("monitor:snapshot", () => {
      void queryClient.invalidateQueries({queryKey: ["history"]});
    });
  }, [queryClient]);

  return query;
}

export function useHistoryEvents(filters: { range: HistoryRange; groupId?: string; provider?: string; types?: HistoryEventType[] }) {
  const queryClient = useQueryClient();
  const queryKey = ["history", "events", filters] as const;
  const query = useQuery({
    queryKey,
    queryFn: () => monitorApi.getHistoryEvents(filters),
  });

  useEffect(() => {
    return onNotification<AggregateSnapshot>("monitor:snapshot", () => {
      void queryClient.invalidateQueries({queryKey: ["history"]});
    });
  }, [queryClient]);

  return query;
}
