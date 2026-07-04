import { useQuery } from "@tanstack/react-query";

import { monitorApi } from "../ipc";

export const CHANNELS_KEY = ["channels"] as const;

export function useChannels() {
  return useQuery({ queryKey: [...CHANNELS_KEY, "list"], queryFn: () => monitorApi.listChannels() });
}
