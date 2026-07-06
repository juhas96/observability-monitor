// Typed IPC wrappers over window.glazeAPI.glaze.ipc for the CI/CD Monitor.

import type {
  Account,
  AccountDiagnostic,
  AccountSetupImportSummary,
  AddAccountRequest,
  AggregateSnapshot,
  DashboardDefinition,
  DashboardInput,
  DashboardPanel,
  DashboardPanelResult,
  DashboardQueryCapability,
  AlertRule,
  AlertRuleInput,
  RulePreview,
  RuleState,
  CheckSeries,
  ChannelView,
  HttpCheck,
  HttpCheckInput,
  HistoryDateRange,
  HistoryEvent,
  HistoryEventType,
  HistoryRange,
  HistorySample,
  HistoryStats,
  InvestigationContext,
  InvestigationTrigger,
  LocalIncident,
  LocalIncidentInput,
  LocalIncidentStatus,
  MonitorLogResponse,
  MonitorSettings,
  MonitorStatus,
  PortableSetupExportRequest,
  PortableSetupImportSummary,
  ProjectGroup,
  ProviderInfo,
  ServiceMetadata,
  ServiceMetadataInput,
  SloDefinition,
  SloStatus,
  TestConnectionResult,
  TriageState,
  UpdateAccountRequest,
  VerificationReport,
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
  exportAccountSetup: () => invoke<{ ok: boolean; filePath?: string }>("accounts:exportSetup"),
  importAccountSetup: () => invoke<AccountSetupImportSummary>("accounts:importSetup"),
  exportPortableSetup: (req: PortableSetupExportRequest) => invoke<{ ok: boolean; filePath?: string }>("setup:export", req),
  importPortableSetup: () => invoke<PortableSetupImportSummary>("setup:import"),
  listAccountDiagnostics: () => invoke<AccountDiagnostic[]>("diagnostics:listAccounts"),
  runAccountDiagnostic: (accountId: string) => invoke<AccountDiagnostic>("diagnostics:runAccount", { accountId }),
  runVerification: (req?: { includeChannelTests?: boolean }) => invoke<VerificationReport>("verification:run", req ?? {}),
  listChannels: () => invoke<ChannelView[]>("channels:list"),
  listServiceMetadata: () => invoke<ServiceMetadata[]>("services:listMetadata"),
  saveServiceMetadata: (req: ServiceMetadataInput) => invoke<ServiceMetadata>("services:saveMetadata", req),
  deleteServiceMetadata: (serviceId: string) => invoke<{ ok: true }>("services:deleteMetadata", { serviceId }),

  getSnapshot: () => invoke<AggregateSnapshot>("monitor:getSnapshot", {}),
  refresh: (accountId?: string) => invoke<AggregateSnapshot>("monitor:refresh", { accountId }),
  getItemLogs: (itemUid: string) => invoke<MonitorLogResponse>("monitor:getItemLogs", { itemUid }),
  getSettings: () => invoke<MonitorSettings>("monitor:getSettings"),
  updateSettings: (patch: Partial<MonitorSettings>) => invoke<MonitorSettings>("monitor:updateSettings", patch),
  getStatus: () => invoke<MonitorStatus>("monitor:getStatus"),
  openExternal: (url: string) => invoke<{ ok: true }>("monitor:openExternal", { url }),
  openSettings: () => invoke<void>("window:openSettings"),
  getInvestigationContext: (req: Partial<InvestigationTrigger>) => invoke<InvestigationContext>("investigation:getContext", req),

  listDashboards: () => invoke<DashboardDefinition[]>("dashboards:list"),
  saveDashboard: (req: DashboardInput) => invoke<DashboardDefinition>("dashboards:save", req),
  deleteDashboard: (id: string) => invoke<{ ok: true }>("dashboards:delete", { id }),
  exportDashboard: (id: string) => invoke<{ ok: boolean; filePath?: string }>("dashboards:export", { id }),
  importDashboard: () => invoke<{ imported: number; skipped: number; panelsSkipped: number; filePath?: string }>("dashboards:import"),
  listDashboardCapabilities: () => invoke<DashboardQueryCapability[]>("dashboards:listCapabilities"),
  runDashboardPanel: (req: { panel: DashboardPanel; range: DashboardDefinition["range"] }) =>
    invoke<DashboardPanelResult>("dashboards:runPanel", req),

  getHistorySeries: (req: { range?: HistoryRange; dateRange?: HistoryDateRange; groupId?: string; accountId?: string; provider?: string }) =>
    invoke<HistorySample[]>("history:getSeries", req),
  getHistoryStats: () => invoke<HistoryStats>("history:getStats"),
  getHistoryEvents: (req: {
    range?: HistoryRange;
    dateRange?: HistoryDateRange;
    groupId?: string;
    accountId?: string;
    provider?: string;
    status?: string;
    severity?: string;
    category?: string;
    types?: HistoryEventType[];
  }) =>
    invoke<HistoryEvent[]>("history:getEvents", req),
  listSlos: () => invoke<SloDefinition[]>("history:listSlos"),
  saveSlo: (req: { id?: string; name: string; scope: SloDefinition["scope"]; target: number; windowDays: number }) =>
    invoke<SloDefinition>("history:saveSlo", req),
  deleteSlo: (id: string) => invoke<{ ok: true }>("history:deleteSlo", { id }),
  getSloStatus: () => invoke<SloStatus[]>("history:getSloStatus"),
  exportHistory: (req: {
    dataset: "events" | "samples";
    format: "csv" | "json";
    range?: HistoryRange;
    dateRange?: HistoryDateRange;
    groupId?: string;
    accountId?: string;
    provider?: string;
    status?: string;
    severity?: string;
    category?: string;
    types?: HistoryEventType[];
  }) =>
    invoke<{ ok: boolean; filePath?: string }>("history:export", req),
  clearHistory: () => invoke<HistoryStats>("history:clear"),
  pruneHistory: () => invoke<HistoryStats>("history:prune"),

  listChecks: () => invoke<HttpCheck[]>("checks:list"),
  saveCheck: (req: HttpCheckInput) => invoke<HttpCheck>("checks:save", req),
  deleteCheck: (id: string) => invoke<{ ok: true }>("checks:delete", { id }),
  getCheckLatencySeries: (req: { checkId: string; range?: HistoryRange; dateRange?: HistoryDateRange }) =>
    invoke<CheckSeries>("checks:getLatencySeries", req),

  listRules: () => invoke<AlertRule[]>("rules:list"),
  saveRule: (req: AlertRuleInput) => invoke<AlertRule>("rules:save", req),
  deleteRule: (id: string) => invoke<{ ok: true }>("rules:delete", { id }),
  getRuleStates: () => invoke<RuleState[]>("rules:getState"),
  previewRule: (req: AlertRuleInput) => invoke<RulePreview>("rules:preview", req),
  testRuleDelivery: (req: AlertRuleInput) => invoke<RulePreview>("rules:testDelivery", req),

  listTriage: () => invoke<Record<string, TriageState>>("triage:list"),
  acknowledgeTriage: (uid: string) => invoke<TriageState>("triage:acknowledge", { uid }),
  silenceTriage: (uid: string, minutes: number) => invoke<TriageState>("triage:silence", { uid, minutes }),
  clearTriage: (uid: string) => invoke<{ ok: true }>("triage:clear", { uid }),

  listLocalIncidents: () => invoke<LocalIncident[]>("localIncidents:list"),
  saveLocalIncident: (req: LocalIncidentInput) => invoke<LocalIncident>("localIncidents:save", req),
  updateLocalIncidentStatus: (id: string, status: LocalIncidentStatus, reason?: string) =>
    invoke<LocalIncident>("localIncidents:updateStatus", { id, status, reason }),
  deleteLocalIncident: (id: string) => invoke<{ ok: true }>("localIncidents:delete", { id }),
  exportLocalIncident: (id: string, format: "markdown" | "json" = "markdown") =>
    invoke<{ ok: boolean; filePath?: string }>("localIncidents:export", { id, format }),
};

/** Subscribe to a backend push channel; returns an unsubscribe function. */
export function onNotification<T>(channel: string, cb: (payload: T) => void): () => void {
  return window.glazeAPI.glaze.ipc.onNotification(channel, (params) => cb(params as T));
}
