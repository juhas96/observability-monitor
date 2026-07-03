import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { monitorApi } from "../ipc";

export const TRIAGE_KEY = ["triage"] as const;

export function useTriage() {
  return useQuery({
    queryKey: TRIAGE_KEY,
    queryFn: () => monitorApi.listTriage(),
  });
}

export function useTriageMutations() {
  const queryClient = useQueryClient();
  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: TRIAGE_KEY });
  };
  const acknowledge = useMutation({
    mutationFn: (uid: string) => monitorApi.acknowledgeTriage(uid),
    onSuccess: invalidate,
  });
  const silence = useMutation({
    mutationFn: ({ uid, minutes }: { uid: string; minutes: number }) => monitorApi.silenceTriage(uid, minutes),
    onSuccess: invalidate,
  });
  const clear = useMutation({
    mutationFn: (uid: string) => monitorApi.clearTriage(uid),
    onSuccess: invalidate,
  });
  return { acknowledge, silence, clear };
}
