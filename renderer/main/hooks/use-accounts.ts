// Account CRUD queries + mutations. Invalidates the snapshot so the dashboard
// reflects added/removed accounts.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { monitorApi } from "../ipc";
import { SNAPSHOT_KEY } from "./use-monitor-data";
import type { AddAccountRequest, PortableSetupExportRequest, UpdateAccountRequest } from "../types";

export const ACCOUNTS_KEY = ["accounts"] as const;
export const GROUPS_KEY = ["groups"] as const;

export function useAccounts() {
  return useQuery({
    queryKey: ACCOUNTS_KEY,
    queryFn: () => monitorApi.listAccounts(),
  });
}

export function useGroups() {
  return useQuery({
    queryKey: GROUPS_KEY,
    queryFn: () => monitorApi.listGroups(),
  });
}

export function useAccountMutations() {
  const queryClient = useQueryClient();

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY });
    void queryClient.invalidateQueries({ queryKey: GROUPS_KEY });
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

  const exportSetup = useMutation({
    mutationFn: (req: PortableSetupExportRequest) => monitorApi.exportPortableSetup(req),
  });

  const importSetup = useMutation({
    mutationFn: () => monitorApi.importPortableSetup(),
    onSuccess: () => {
      void queryClient.invalidateQueries();
    },
  });

  return { add, update, remove, exportSetup, importSetup };
}
