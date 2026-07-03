import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { monitorApi, onNotification } from "../ipc";
import type { AggregateSnapshot, AlertRuleInput } from "../types";

const RULES_KEY = ["rules"] as const;

export function useRules() {
  return useQuery({ queryKey: [...RULES_KEY, "list"], queryFn: () => monitorApi.listRules() });
}

export function useRuleStates() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: [...RULES_KEY, "state"],
    queryFn: () => monitorApi.getRuleStates(),
  });

  useEffect(() => {
    return onNotification<AggregateSnapshot>("monitor:snapshot", () => {
      void queryClient.invalidateQueries({ queryKey: [...RULES_KEY, "state"] });
    });
  }, [queryClient]);

  return query;
}

export function useRuleMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: RULES_KEY });
  const save = useMutation({
    mutationFn: (req: AlertRuleInput) => monitorApi.saveRule(req),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => monitorApi.deleteRule(id),
    onSuccess: invalidate,
  });
  return { save, remove };
}
