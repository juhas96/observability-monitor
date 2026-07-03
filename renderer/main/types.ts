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
  | "posthog";

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

export interface MonitorSettings {
  pollIntervalSeconds: number;
  notifyOnFailure: boolean;
  notifyOnSuccess: boolean;
  notifyOnlyOnChange: boolean;
  soundOnNotify: boolean;
  digest: DigestSettings;
  launchAtLogin: boolean;
  mutedUntil?: string;
}

export type HistoryRange = "15m" | "1h" | "6h" | "24h" | "7d" | "14d";

export type HistoryEventType = "deploy" | "failure" | "recovery" | "alert" | "incident" | "check";

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
  title: string;
  status: NormalizedStatus | IncidentStatus;
  severity: ObservabilitySeverity;
  url: string;
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

export type RuleMetric = "failureRate" | "latency" | "openIncidents";
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
  enabled: boolean;
  forMinutes?: number;
  cooldownMinutes?: number;
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
  enabled?: boolean;
  forMinutes?: number;
  cooldownMinutes?: number;
}

export interface RuleState {
  ruleId: string;
  firing: boolean;
  breaching?: boolean;
  value: number | null;
  since?: string;
}

export interface MonitorStatus {
  encryptionAvailable: boolean;
  polling: boolean;
  accountCount: number;
}

export type GrafanaRange = "15m" | "1h" | "6h" | "24h";

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

export interface GrafanaDataSourceSummary {
  uid: string;
  name: string;
  type: string;
  status?: NormalizedStatus;
  healthStatus?: string;
  healthMessage?: string;
}

export interface GrafanaAlertSummary {
  name: string;
  group: string;
  state: string;
  lastEvaluation?: string;
  labels?: Record<string, string>;
  url: string;
}

export interface GrafanaOverview {
  accountId: string;
  generatedAt: string;
  baseUrl: string;
  config: GrafanaObservabilityConfig;
  alerts: GrafanaAlertSummary[];
  dataSources: GrafanaDataSourceSummary[];
  lokiDataSources: GrafanaDataSourceSummary[];
  tempoDataSources: GrafanaDataSourceSummary[];
  errors: { area: string; message: string }[];
}

export interface GrafanaLogRow {
  timestamp: string;
  labels: Record<string, string>;
  line: string;
}

export interface GrafanaLogResult {
  preset: GrafanaLogPreset;
  rows: GrafanaLogRow[];
  stats?: unknown;
}

export interface GrafanaTraceRow {
  traceId: string;
  rootServiceName?: string;
  rootTraceName?: string;
  startTime?: string;
  durationMs?: number;
  matchedSpanCount?: number;
}

export interface GrafanaTraceResult {
  preset: GrafanaTracePreset;
  rows: GrafanaTraceRow[];
  metrics?: unknown;
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
