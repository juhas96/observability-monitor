// Typed IPC wrappers over window.glazeAPI.glaze.ipc for the CI/CD Monitor.

import type {
  Account,
  AddAccountRequest,
  AggregateSnapshot,
  GrafanaLogResult,
  GrafanaObservabilityConfig,
  GrafanaOverview,
  GrafanaRange,
  GrafanaTraceResult,
  HistoryEvent,
  HistoryEventType,
  HistoryRange,
  HistorySample,
  MonitorLogResponse,
  MonitorSettings,
  MonitorStatus,
  ProjectGroup,
  ProviderInfo,
  SloDefinition,
  SloStatus,
  TestConnectionResult,
  TriageState,
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
  getItemLogs: (itemUid: string) => invoke<MonitorLogResponse>("monitor:getItemLogs", { itemUid }),
  getSettings: () => invoke<MonitorSettings>("monitor:getSettings"),
  updateSettings: (patch: Partial<MonitorSettings>) => invoke<MonitorSettings>("monitor:updateSettings", patch),
  getStatus: () => invoke<MonitorStatus>("monitor:getStatus"),
  openExternal: (url: string) => invoke<{ ok: true }>("monitor:openExternal", { url }),

  getGrafanaOverview: (req: { accountId: string; range: GrafanaRange }) =>
    invoke<GrafanaOverview>("grafana:getOverview", req),
  runGrafanaLogPreset: (req: { accountId: string; presetId: string; range: GrafanaRange }) =>
    invoke<GrafanaLogResult>("grafana:runLogPreset", req),
  runGrafanaTracePreset: (req: { accountId: string; presetId: string; range: GrafanaRange }) =>
    invoke<GrafanaTraceResult>("grafana:runTracePreset", req),
  updateGrafanaObservabilityConfig: (req: { accountId: string; config: GrafanaObservabilityConfig }) =>
    invoke<{ account: Account; config: GrafanaObservabilityConfig }>("grafana:updateObservabilityConfig", req),

  getHistorySeries: (req: { range: HistoryRange }) => invoke<HistorySample[]>("history:getSeries", req),
  getHistoryEvents: (req: { range: HistoryRange; groupId?: string; provider?: string; types?: HistoryEventType[] }) =>
    invoke<HistoryEvent[]>("history:getEvents", req),
  listSlos: () => invoke<SloDefinition[]>("history:listSlos"),
  saveSlo: (req: { id?: string; name: string; scope: SloDefinition["scope"]; target: number; windowDays: number }) =>
    invoke<SloDefinition>("history:saveSlo", req),
  deleteSlo: (id: string) => invoke<{ ok: true }>("history:deleteSlo", { id }),
  getSloStatus: () => invoke<SloStatus[]>("history:getSloStatus"),

  listTriage: () => invoke<Record<string, TriageState>>("triage:list"),
  acknowledgeTriage: (uid: string) => invoke<TriageState>("triage:acknowledge", { uid }),
  silenceTriage: (uid: string, minutes: number) => invoke<TriageState>("triage:silence", { uid, minutes }),
  clearTriage: (uid: string) => invoke<{ ok: true }>("triage:clear", { uid }),
};

/** Subscribe to a backend push channel; returns an unsubscribe function. */
export function onNotification<T>(channel: string, cb: (payload: T) => void): () => void {
  return window.glazeAPI.glaze.ipc.onNotification(channel, (params) => cb(params as T));
}
