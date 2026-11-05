// Typed IPC wrappers over window.glazeAPI.glaze.ipc for the CI/CD Monitor.

import type {
  Account,
  AddAccountRequest,
  AggregateSnapshot,
  MonitorSettings,
  MonitorStatus,
  ProjectGroup,
  ProviderInfo,
  TestConnectionResult,
  UpdateAccountRequest,
} from "./types";

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return window.glazeAPI.glaze.ipc.invoke<T>(channel, ...args);
}

export const monitorApi = {
  listProviders: () => invoke<ProviderInfo[]>("providers:list"),
  listAccounts: () => invoke<Account[]>("accounts:list"),
  listGroups: () => invoke<ProjectGroup[]>("groups:list"),
  testConnection: (req: { provider: string; creds: Record<string, string> }) =>
    invoke<TestConnectionResult>("accounts:test", req),
  addAccount: (req: AddAccountRequest) => invoke<{ account: Account }>("accounts:add", req),
  updateAccount: (req: UpdateAccountRequest) => invoke<{ account: Account }>("accounts:update", req),
  removeAccount: (id: string) => invoke<{ ok: true }>("accounts:remove", { id }),

  getSnapshot: () => invoke<AggregateSnapshot>("monitor:getSnapshot", {}),
  refresh: (accountId?: string) => invoke<AggregateSnapshot>("monitor:refresh", { accountId }),
  getSettings: () => invoke<MonitorSettings>("monitor:getSettings"),
  updateSettings: (patch: Partial<MonitorSettings>) => invoke<MonitorSettings>("monitor:updateSettings", patch),
  getStatus: () => invoke<MonitorStatus>("monitor:getStatus"),
  openExternal: (url: string) => invoke<{ ok: true }>("monitor:openExternal", { url }),
};

/** Subscribe to a backend push channel; returns an unsubscribe function. */
export function onNotification<T>(channel: string, cb: (payload: T) => void): () => void {
  return window.glazeAPI.glaze.ipc.onNotification(channel, (params) => cb(params as T));
}
