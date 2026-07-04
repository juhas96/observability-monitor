import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { monitorApi, onNotification } from "../ipc";
import { ACCOUNTS_KEY } from "./use-accounts";
import type { AggregateSnapshot } from "../types";

export const DIAGNOSTICS_KEY = ["diagnostics"] as const;

export function useAccountDiagnostics() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: [...DIAGNOSTICS_KEY, "accounts"],
    queryFn: () => monitorApi.listAccountDiagnostics(),
  });

  useEffect(() => {
    return onNotification<AggregateSnapshot>("monitor:snapshot", () => {
      void queryClient.invalidateQueries({ queryKey: DIAGNOSTICS_KEY });
    });
  }, [queryClient]);

  return query;
}

export function useDiagnosticMutations() {
  const queryClient = useQueryClient();
  return {
    runAccount: useMutation({
      mutationFn: (accountId: string) => monitorApi.runAccountDiagnostic(accountId),
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: DIAGNOSTICS_KEY });
        void queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY });
      },
    }),
    runVerification: useMutation({
      mutationFn: (req?: { includeChannelTests?: boolean }) => monitorApi.runVerification(req),
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: DIAGNOSTICS_KEY });
        void queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY });
      },
    }),
  };
}
