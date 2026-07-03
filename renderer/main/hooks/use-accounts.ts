// Account CRUD queries + mutations. Invalidates the snapshot so the dashboard
// reflects added/removed accounts.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { monitorApi } from "../ipc";
import { SNAPSHOT_KEY } from "./use-monitor-data";
import type { AddAccountRequest, UpdateAccountRequest } from "../types";

export const ACCOUNTS_KEY = ["accounts"] as const;

export function useAccounts() {
  return useQuery({
    queryKey: ACCOUNTS_KEY,
    queryFn: () => monitorApi.listAccounts(),
  });
}

export function useAccountMutations() {
  const queryClient = useQueryClient();

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY });
    void queryClient.invalidateQueries({ queryKey: SNAPSHOT_KEY });
  };

  const add = useMutation({
    mutationFn: (req: AddAccountRequest) => monitorApi.addAccount(req),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: (req: UpdateAccountRequest) => monitorApi.updateAccount(req),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => monitorApi.removeAccount(id),
    onSuccess: invalidate,
  });

  return { add, update, remove };
}
