// Renderer-side mirror of the backend domain types (main/services/types.ts).
// Kept structurally identical so IPC payloads type-check on both ends.

export type Provider =
  | "github"
  | "cloudflare"
  | "supabase"
  | "netlify"
  | "resend"
  | "grafana"
  | "heroku"
  | "sentry"
  | "pagerduty"
  | "statuspage"
  | "datadog"
  | "honeycomb"
  | "posthog"
  | "betterstack";

export type MonitorCategory =
  | "run"
  | "deploy"
  | "migration"
  | "log"
  | "alert"
  | "datasource"
  | "dashboard"
  | "annotation"
  | "incident"
  | "issue"
  | "monitor"
  | "metric"
  | "slo"
  | "trace"
  | "statuspage"
  | "email"
  | "domain"
  | "release"
  | "other";

export type NormalizedStatus =
  | "success"
  | "failure"
  | "warning"
  | "running"
  | "queued"
  | "cancelled"
  | "info"
  | "unknown";

export type MonitorLogRef = Record<string, string | number | boolean | undefined>;

export interface MonitorLogLine {
  timestamp?: string;
  section?: string;
  stream?: string;
  level?: string;
  message: string;
}

export interface MonitorLogResponse {
  itemUid: string;
  title: string;
  subtitle?: string;
  provider: Provider;
  fetchedAt: string;
  fallbackUrl?: string;
  lines: MonitorLogLine[];
}

export interface Account {
  id: string;
  provider: Provider;
  label: string;
  groupId?: string;
  createdAt: string;
  enabled: boolean;
  lastSyncAt?: string;
  lastError?: string;
  identity?: string;
  config?: Record<string, string>;
}

export interface ProjectGroup {
  id: string;
  name: string;
  createdAt: string;
}

export interface MonitorItem {
  uid: string;
  accountId: string;
  provider: Provider;
  kind: string;
  category: MonitorCategory;
  title: string;
  subtitle: string;
  status: NormalizedStatus;
  conclusion?: string;
  createdAt: string;
  updatedAt: string;
  url: string;
  commitSha?: string;
  commitMessage?: string;
  actor?: string;
  logAvailable?: boolean;
  logLabel?: string;
  logFallbackUrl?: string;
  logRef?: MonitorLogRef;
  liveLogAvailable?: boolean;
  liveLogPollSeconds?: number;
  liveLogLabel?: string;
}

export interface PerAccountStatus {
  count: number;
  lastError?: string;
  lastSyncAt?: string;
}

export type ObservabilitySeverity = "critical" | "high" | "medium" | "low" | "info";

export type SignalKind =
  | "alert"
  | "deploy"
  | "run"
  | "log"
  | "metric"
  | "slo"
  | "datasource"
  | "issue"
  | "status"
  | "email"
  | "other";

export interface ObservabilitySignal {
  uid: string;
  accountId: string;
  provider: Provider;
  kind: SignalKind;
  category: MonitorCategory;
  title: string;
  subtitle: string;
  status: NormalizedStatus;
  severity: ObservabilitySeverity;
  createdAt: string;
  updatedAt: string;
  url: string;
  sourceItemUid?: string;
}

export type IncidentStatus = "open" | "acknowledged" | "resolved" | "scheduled" | "unknown";

export interface ObservabilityIncident {
  uid: string;
  accountId: string;
  provider: Provider;
  title: string;
  subtitle: string;
  status: IncidentStatus;
  severity: ObservabilitySeverity;
  createdAt: string;
  updatedAt: string;
  url: string;
  sourceItemUid?: string;
}

export interface MetricsSummary {
  uid: string;
  accountId: string;
  provider: Provider;
  title: string;
  status: NormalizedStatus;
  updatedAt: string;
  metrics: { label: string; value: string; unit?: string; status?: NormalizedStatus }[];
  url?: string;
}

export interface ProviderDeepLink {
  accountId: string;
  provider: Provider;
  label: string;
  url: string;
  category: MonitorCategory | "settings" | "logs" | "metrics" | "traces";
}

export type ProviderCollectionCategory =
  | "core"
  | "logs"
  | "traces"
  | "metrics"
  | "dashboards"
  | "annotations"
  | "datasources"
  | "incidents"
  | "alerts"
  | "liveQueries";

export type ProviderCollectionDefault = "always" | "configured" | "disabled";

export interface ProviderCollectionArea {
  id: string;
  label: string;
  category: ProviderCollectionCategory;
  configKey?: string;
  defaultState: ProviderCollectionDefault;
  guidance: string;
  requiresDashboardCapability?: boolean;
}

export type AccountCollectionAreaStatus = "always-on" | "enabled" | "disabled" | "unavailable" | "missing-config";

export interface AccountCollectionAreaDiagnostic extends ProviderCollectionArea {
  status: AccountCollectionAreaStatus;
  detail?: string;
}

export interface AccountStaleness {
  accountId: string;
  stale: boolean;
  lastSyncAt?: string;
  ageSeconds?: number;
  reason?: string;
}

export interface ServiceHealth {
  id: string;
  name: string;
  groupId?: string;
  accountIds: string[];
  providerIds: Provider[];
  status: NormalizedStatus;
  lastDeployAt?: string;
  openIncidentCount: number;
  alertCount: number;
  signalCount: number;
  staleAccountCount: number;
  updatedAt: string;
  deepLinks: ProviderDeepLink[];
}

export type ServiceTier = "critical" | "standard" | "internal" | "experimental";

export interface ServiceMetadata {
  serviceId: string;
  owner?: string;
  tier?: ServiceTier;
  runbookUrl?: string;
  dashboardUrl?: string;
  repositoryUrl?: string;
  dependencies?: string[];
  notes?: string;
  updatedAt: string;
}

export interface ServiceMetadataInput {
  serviceId: string;
  owner?: string;
  tier?: ServiceTier;
  runbookUrl?: string;
  dashboardUrl?: string;
  repositoryUrl?: string;
  dependencies?: string[];
  notes?: string;
}

export interface AggregateSnapshot {
  items: MonitorItem[];
  services: ServiceHealth[];
  signals: ObservabilitySignal[];
  incidents: ObservabilityIncident[];
  metrics: MetricsSummary[];
  deepLinks: ProviderDeepLink[];
  staleness: Record<string, AccountStaleness>;
  perAccount: Record<string, PerAccountStatus>;
  checks: HttpCheckResult[];
  aggregateStatus: NormalizedStatus;
  generatedAt: string;
}

export type DigestCadence = "daily" | "weekly";

export interface DigestSettings {
  enabled: boolean;
  cadence: DigestCadence;
  hour: number;
}

export interface MaintenanceWindow {
  id: string;
  label: string;
  enabled: boolean;
  days: number[];
  startHour: number;
  endHour: number;
  scope?: RuleScope;
}

export interface MonitorSettings {
  pollIntervalSeconds: number;
  notifyOnFailure: boolean;
  notifyOnSuccess: boolean;
  notifyOnlyOnChange: boolean;
  soundOnNotify: boolean;
  historyRetentionDays: number;
  digest: DigestSettings;
  maintenanceWindows: MaintenanceWindow[];
  launchAtLogin: boolean;
  mutedUntil?: string;
}

export type HistoryRange = "15m" | "1h" | "6h" | "24h" | "7d" | "14d";

export type DashboardVisualization = "line" | "area" | "bar" | "stat" | "table" | "logs" | "traces";
export type DashboardPanelWidth = "half" | "full";
export type DashboardPanelHeight = "small" | "medium" | "large";

export type DashboardLocalMetric =
  | "successFailure"
  | "statusCounts"
  | "incidentsAlerts"
  | "events"
  | "snapshotCounts"
  | "checkLatency"
  | "checkUptime";

export interface DashboardPanelScope {
  groupId?: string;
  accountId?: string;
  provider?: Provider;
  checkId?: string;
  owner?: string;
  tier?: ServiceTier;
  dependency?: string;
}

export interface DashboardLocalSource extends DashboardPanelScope {
  kind: "local";
  metric: DashboardLocalMetric;
  range?: HistoryRange;
  eventTypes?: HistoryEventType[];
}

export interface DashboardProviderSource {
  kind: "provider";
  accountId: string;
  capabilityId: string;
  range?: HistoryRange;
  query?: string;
  params?: Record<string, string>;
  xField?: string;
  yField?: string;
}

export type DashboardPanelSource = DashboardLocalSource | DashboardProviderSource;

export interface DashboardPanel {
  id: string;
  title: string;
  source: DashboardPanelSource;
  visualization: DashboardVisualization;
  width: DashboardPanelWidth;
  height: DashboardPanelHeight;
  refreshSeconds?: number;
  order: number;
}

export interface DashboardPanelTemplate {
  title: string;
  source: DashboardPanelSource;
  visualization: DashboardVisualization;
  width: DashboardPanelWidth;
  height: DashboardPanelHeight;
  refreshSeconds?: number;
}

export interface DashboardVariables extends DashboardPanelScope {}

export interface DashboardDefinition {
  id: string;
  name: string;
  description?: string;
  range: HistoryRange;
  refreshSeconds?: number;
  variables?: DashboardVariables;
  panels: DashboardPanel[];
  createdAt: string;
  updatedAt: string;
}

export interface DashboardInput {
  id?: string;
  name: string;
  description?: string;
  range: HistoryRange;
  refreshSeconds?: number;
  variables?: DashboardVariables;
  panels: DashboardPanel[];
}

export type DashboardPanelResultKind = "timeseries" | "stat" | "table" | "logs" | "traces" | "events";

export interface DashboardSeriesPoint {
  ts: string;
  label?: string;
  series?: string;
  value: number;
}

export interface DashboardTableRow {
  __url?: string;
  __urlLabel?: string;
  [key: string]: string | number | boolean | null | undefined;
}

export interface DashboardStat {
  label: string;
  value: string | number;
  unit?: string;
  status?: NormalizedStatus;
}

export interface DashboardAnnotation {
  ts: string;
  type: HistoryEventType;
  title: string;
  status: NormalizedStatus | IncidentStatus;
  severity: ObservabilitySeverity;
  url?: string;
}

export interface DashboardPanelResult {
  kind: DashboardPanelResultKind;
  generatedAt: string;
  title?: string;
  points?: DashboardSeriesPoint[];
  stats?: DashboardStat[];
  rows?: DashboardTableRow[];
  columns?: string[];
  annotations?: DashboardAnnotation[];
  warnings?: string[];
  provider?: Provider;
  accountId?: string;
  presentation?: DashboardResultPresentation;
}

export type DashboardResultRowKind = "generic" | "log" | "trace" | "event";

export interface DashboardResultPresentation {
  rowKind?: DashboardResultRowKind;
  primaryField?: string;
  secondaryField?: string;
  timestampField?: string;
  severityField?: string;
  statusField?: string;
  durationField?: string;
  sourceField?: string;
  messageField?: string;
}

export interface DashboardQueryCapability {
  id: string;
  label: string;
  provider?: Provider;
  accountId?: string;
  accountLabel?: string;
  description?: string;
  queryLanguage?: string;
  requiresQuery: boolean;
  resultKind: DashboardPanelResultKind;
  defaultVisualization: DashboardVisualization;
  params?: { key: string; label: string; required?: boolean; placeholder?: string; defaultValue?: string }[];
  defaultPanel?: DashboardPanelTemplate;
}

export interface DashboardProviderQuery {
  capabilityId: string;
  range: HistoryRange;
  query?: string;
  params?: Record<string, string>;
  xField?: string;
  yField?: string;
}

export type HistoryEventType = "deploy" | "failure" | "recovery" | "alert" | "incident" | "check";
export type HistoryDateRange = { mode: "relative"; range: HistoryRange } | { mode: "custom"; from?: string; to?: string };

export interface HistoryStatusCounts {
  success: number;
  failure: number;
  warning: number;
  running: number;
  queued: number;
  cancelled: number;
  info: number;
  unknown: number;
}

export interface HistorySampleAccount {
  provider: Provider;
  groupId?: string;
  counts: HistoryStatusCounts;
  openIncidentCount?: number;
  alertCount?: number;
}

export interface HistorySample {
  ts: string;
  aggregateStatus: NormalizedStatus;
  perAccount: Record<string, HistorySampleAccount>;
  perService: Record<string, NormalizedStatus>;
  openIncidentCount: number;
  alertCount: number;
  failureCount: number;
  successCount: number;
}

export interface HistoryEvent {
  id: string;
  ts: string;
  type: HistoryEventType;
  provider: Provider;
  accountId: string;
  groupId?: string;
  sourceUid?: string;
  category?: MonitorCategory;
  title: string;
  status: NormalizedStatus | IncidentStatus;
  severity: ObservabilitySeverity;
  url: string;
}

export interface HistoryStats {
  retentionDays: number;
  storageBytes: number;
  sampleCount: number;
  eventCount: number;
  checkSampleCount: number;
  sloCount: number;
  oldestSampleAt?: string;
  newestSampleAt?: string;
  oldestEventAt?: string;
  newestEventAt?: string;
  oldestCheckSampleAt?: string;
  newestCheckSampleAt?: string;
}

export interface SloDefinition {
  id: string;
  name: string;
  scope: {
    groupId?: string;
    accountId?: string;
    provider?: Provider;
  };
  target: number;
  windowDays: number;
  createdAt: string;
  updatedAt: string;
}

export interface SloStatus {
  slo: SloDefinition;
  compliance: number | null;
  successCount: number;
  failureCount: number;
  remainingBudget: number | null;
  burnRate: number | null;
  atRisk: boolean;
  series: { ts: string; compliance: number | null; remainingBudget: number | null }[];
}

export interface TriageState {
  acknowledgedAt?: string;
  silencedUntil?: string;
}

export type LocalIncidentStatus = "open" | "acknowledged" | "resolved";
export type LocalIncidentSourceKind = "signal" | "incident" | "manual";

export interface LocalIncidentNote {
  id: string;
  body: string;
  createdAt: string;
}

export interface LocalIncident {
  id: string;
  sourceKind: LocalIncidentSourceKind;
  sourceUid?: string;
  sourceUrl?: string;
  accountId?: string;
  provider?: Provider;
  title: string;
  description?: string;
  status: LocalIncidentStatus;
  severity: ObservabilitySeverity;
  assignee?: string;
  rootCause?: string;
  resolvedReason?: string;
  relatedEventIds: string[];
  notes: LocalIncidentNote[];
  createdAt: string;
  updatedAt: string;
  acknowledgedAt?: string;
  resolvedAt?: string;
}

export interface LocalIncidentInput {
  id?: string;
  sourceKind?: LocalIncidentSourceKind;
  sourceUid?: string;
  sourceUrl?: string;
  accountId?: string;
  provider?: Provider;
  title: string;
  description?: string;
  status?: LocalIncidentStatus;
  severity?: ObservabilitySeverity;
  assignee?: string;
  rootCause?: string;
  resolvedReason?: string;
  relatedEventIds?: string[];
  note?: string;
}

export interface HttpCheck {
  id: string;
  name: string;
  url: string;
  method: string;
  expectedStatus?: number;
  timeoutMs?: number;
  groupId?: string;
  enabled: boolean;
  createdAt: string;
}

export interface HttpCheckInput {
  id?: string;
  name: string;
  url: string;
  method?: string;
  expectedStatus?: number;
  timeoutMs?: number;
  groupId?: string;
  enabled?: boolean;
}

export interface HttpCheckResult {
  checkId: string;
  name: string;
  url: string;
  groupId?: string;
  ok: boolean;
  statusCode?: number;
  latencyMs: number;
  error?: string;
  checkedAt: string;
}

export interface CheckLatencyPoint {
  ts: string;
  latencyMs: number | null;
  ok: boolean;
}

export interface CheckSeries {
  points: CheckLatencyPoint[];
  uptime: number | null;
  avgLatencyMs: number | null;
}

export type RuleMetric = "failureRate" | "latency" | "checkDown" | "openIncidents";
export type RuleOperator = "gt" | "lt";

export interface RuleScope {
  groupId?: string;
  accountId?: string;
  provider?: Provider;
  checkId?: string;
}

export interface AlertRule {
  id: string;
  name: string;
  metric: RuleMetric;
  operator: RuleOperator;
  threshold: number;
  scope: RuleScope;
  channelIds?: string[];
  enabled: boolean;
  minSeverity?: ObservabilitySeverity;
  forMinutes?: number;
  cooldownMinutes?: number;
  dedupeMinutes?: number;
  mutedUntil?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AlertRuleInput {
  id?: string;
  name: string;
  metric: RuleMetric;
  operator: RuleOperator;
  threshold: number;
  scope: RuleScope;
  channelIds?: string[] | null;
  enabled?: boolean;
  minSeverity?: ObservabilitySeverity | null;
  forMinutes?: number;
  cooldownMinutes?: number;
  dedupeMinutes?: number;
  mutedUntil?: string | null;
}

export interface RuleState {
  ruleId: string;
  firing: boolean;
  breaching?: boolean;
  value: number | null;
  since?: string;
}

export interface RulePreview {
  generatedAt: string;
  value: number | null;
  breaching: boolean;
  description: string;
  noDataReason?: string;
}

export type ChannelType = "slack" | "webhook";
export type DispatchEventKind = "failure" | "success" | "alert" | "recovery" | "digest";

export interface DispatchEventContext {
  serviceId?: string;
  serviceName?: string;
  owner?: string;
  tier?: ServiceTier;
  runbookUrl?: string;
  dashboardUrl?: string;
  repositoryUrl?: string;
  dependencies?: string[];
}

export interface ChannelView {
  id: string;
  type: ChannelType;
  name: string;
  enabled: boolean;
  events: DispatchEventKind[];
  hasUrl: boolean;
}

export interface MonitorStatus {
  encryptionAvailable: boolean;
  polling: boolean;
  accountCount: number;
}

export type DiagnosticStatus = "ok" | "warning" | "error" | "disabled" | "unknown";
export type DiagnosticErrorCategory = "auth" | "permission" | "rateLimit" | "network" | "config" | "provider" | "unknown";

export interface AccountDashboardCapabilityDiagnostic {
  providerSupportsLive: boolean;
  available: boolean;
  capabilityCount: number;
  defaultPanelCount: number;
  customQueryCount: number;
  capabilityLabels: string[];
  defaultPanelTitles: string[];
  customQueryLabels: string[];
  queryLanguages: string[];
  resultKinds: DashboardPanelResultKind[];
  checkedAt?: string;
  unavailableReason?: string;
  error?: string;
}

export interface AccountDiagnostic {
  accountId: string;
  provider: Provider;
  label: string;
  enabled: boolean;
  identity?: string;
  groupId?: string;
  status: DiagnosticStatus;
  hasToken: boolean;
  encryptionAvailable: boolean;
  lastSyncAt?: string;
  lastError?: string;
  stale?: boolean;
  staleReason?: string;
  backoff?: {
    failures: number;
    nextAttemptAt: string;
    remainingSeconds: number;
  };
  missingRequiredConfig: string[];
  dashboardCapabilities?: AccountDashboardCapabilityDiagnostic;
  collectionAreas: AccountCollectionAreaDiagnostic[];
  validation?: {
    ok: boolean;
    checkedAt: string;
    identity?: string;
    error?: string;
    category?: DiagnosticErrorCategory;
  };
}

export type VerificationArea = "accounts" | "channels" | "checks" | "dashboards" | "local";
export type VerificationStatus = "passed" | "warning" | "failed" | "skipped";

export interface VerificationResult {
  id: string;
  area: VerificationArea;
  label: string;
  status: VerificationStatus;
  detail?: string;
}

export interface VerificationReport {
  generatedAt: string;
  results: VerificationResult[];
}

export interface AccountSetupImportSummary {
  imported: number;
  skipped: number;
  groupsCreated: number;
  filePath?: string;
}

export interface PortableSetupExportRequest {
  accountIds: string[];
  filters: Record<string, string>;
}

export interface PortableSetupImportSummary {
  accountsImported: number;
  accountsSkipped: number;
  groupsImported: number;
  dashboardsImported: number;
  dashboardsSkipped: number;
  checksImported: number;
  checksSkipped: number;
  rulesImported: number;
  rulesSkipped: number;
  slosImported: number;
  slosSkipped: number;
  channelsImported: number;
  channelsSkipped: number;
  serviceMetadataImported: number;
  serviceMetadataSkipped: number;
  filtersImported: number;
  filePath?: string;
  uiFilters: Record<string, string>;
}

export interface GrafanaLogPreset {
  id: string;
  name: string;
  query: string;
  datasourceUid?: string;
  limit?: number;
}

export interface GrafanaTracePreset {
  id: string;
  name: string;
  query: string;
  datasourceUid?: string;
  minDuration?: string;
  maxDuration?: string;
  limit?: number;
}

export interface GrafanaObservabilityConfig {
  lokiDataSourceUid?: string;
  tempoDataSourceUid?: string;
  logPresets: GrafanaLogPreset[];
  tracePresets: GrafanaTracePreset[];
}

export interface TestConnectionResult {
  ok: boolean;
  identity?: string;
  error?: string;
}

export interface CredentialField {
  key: string;
  label: string;
  type: "password" | "text" | "boolean";
  placeholder?: string;
  required: boolean;
  secret: boolean;
  defaultValue?: string;
}

export interface ProviderInfo {
  id: Provider;
  label: string;
  scopeHint: string;
  fields: CredentialField[];
  collectionAreas: ProviderCollectionArea[];
}

export interface InvestigationTrigger {
  kind: "item" | "event" | "manual";
  itemUid?: string;
  eventId?: string;
  accountId?: string;
  provider?: Provider;
  groupId?: string;
  title?: string;
  subtitle?: string;
  status?: NormalizedStatus | IncidentStatus;
  severity?: ObservabilitySeverity;
  category?: MonitorCategory;
  ts?: string;
  url?: string;
}

export interface InvestigationContext {
  generatedAt: string;
  trigger: InvestigationTrigger;
  account?: Pick<Account, "id" | "provider" | "label" | "groupId" | "identity" | "enabled" | "lastSyncAt" | "lastError">;
  group?: ProjectGroup;
  service?: ServiceHealth;
  serviceMetadata?: ServiceMetadata;
  currentItems: MonitorItem[];
  relatedEvents: HistoryEvent[];
  relatedSignals: ObservabilitySignal[];
  relatedIncidents: ObservabilityIncident[];
  relatedMetrics: MetricsSummary[];
  relatedChecks: HttpCheckResult[];
  deepLinks: ProviderDeepLink[];
}

export interface AddAccountRequest {
  provider: Provider;
  label: string;
  creds: Record<string, string>;
  groupId?: string | null;
  newGroupName?: string;
}

export interface UpdateAccountRequest {
  id: string;
  label?: string;
  enabled?: boolean;
  creds?: Record<string, string>;
  groupId?: string | null;
  newGroupName?: string;
}
