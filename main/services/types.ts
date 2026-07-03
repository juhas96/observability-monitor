/**
 * Shared domain types for the Multi Monitor backend.
 *
 * These types are the contract between the stores, provider adapters, poller,
 * and the IPC layer. The renderer imports structurally-compatible copies.
 */

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

/** Broad display category used to pick a row icon/label; providers set it per item. */
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

/**
 * Account metadata persisted in accounts.json — NEVER contains the secret token.
 * Non-secret provider fields (project ref, instance URL, account id, repo filter)
 * live in `config`; the resolved display identity lives in `identity`.
 */
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

/** A single normalized item (run/deploy/migration/log/alert/…) shown in the dashboard. */
export interface MonitorItem {
  uid: string; // `${accountId}:${kind}:${nativeId}`
  accountId: string;
  provider: Provider;
  kind: string; // provider-specific, e.g. "github-run", "supabase-migration"
  category: MonitorCategory;
  title: string;
  subtitle: string;
  status: NormalizedStatus;
  conclusion?: string; // raw provider status/conclusion (for tooltip)
  createdAt: string; // ISO
  updatedAt: string; // ISO
  url: string; // deep link to open in browser
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
  items: MonitorItem[]; // newest-first, capped per account
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
  hour: number; // 0-23 local hour to deliver the digest
}

export interface MonitorSettings {
  pollIntervalSeconds: number;
  notifyOnFailure: boolean;
  notifyOnSuccess: boolean;
  notifyOnlyOnChange: boolean;
  soundOnNotify: boolean;
  digest: DigestSettings;
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

/** A user-defined HTTP uptime/synthetic check (no secret). */
export interface HttpCheck {
  id: string;
  name: string;
  url: string;
  method: string; // GET | HEAD | POST
  expectedStatus?: number; // exact status to treat as up; otherwise any < 400 is up
  timeoutMs?: number;
  groupId?: string;
  enabled: boolean;
  createdAt: string;
}

/** Save payload for a check from the renderer. */
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

/** Result of probing a single check during a poll cycle. */
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

/** One downsampled latency point for a check's history chart. */
export interface CheckLatencyPoint {
  ts: string;
  latencyMs: number | null;
  ok: boolean;
}

/** Latency series + summary stats for a single check over a range. */
export interface CheckSeries {
  points: CheckLatencyPoint[];
  uptime: number | null; // 0..1 over the range
  avgLatencyMs: number | null;
}

/** Metric a custom alerting rule evaluates against the latest snapshot. */
export type RuleMetric = "failureRate" | "latency" | "openIncidents";
export type RuleOperator = "gt" | "lt";

export interface RuleScope {
  groupId?: string;
  accountId?: string;
  provider?: Provider;
  checkId?: string;
}

/** A user-defined threshold rule that fires notifications when breached. */
export interface AlertRule {
  id: string;
  name: string;
  metric: RuleMetric;
  operator: RuleOperator;
  threshold: number;
  scope: RuleScope;
  enabled: boolean;
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
}

/** Current evaluation state of a rule, exposed to the renderer. */
export interface RuleState {
  ruleId: string;
  firing: boolean;
  value: number | null;
  since?: string;
}

export const DEFAULT_SETTINGS: MonitorSettings = {
  pollIntervalSeconds: 60,
  notifyOnFailure: true,
  notifyOnSuccess: false,
  notifyOnlyOnChange: true,
  soundOnNotify: false,
  digest: { enabled: false, cadence: "daily", hour: 9 },
};

export const MIN_POLL_INTERVAL_SECONDS = 30;

/** Notification channel that forwards events to a Slack incoming webhook or generic webhook. */
export type ChannelType = "slack" | "webhook";

/** Event categories a channel can subscribe to. */
export type DispatchEventKind = "failure" | "success" | "alert" | "digest";

/** Non-secret channel metadata persisted in channels.json — the URL lives in the encrypted vault. */
export interface Channel {
  id: string;
  type: ChannelType;
  name: string;
  enabled: boolean;
  events: DispatchEventKind[];
}

/** Save payload from the renderer; `url` is optional so edits can keep the stored secret. */
export interface ChannelInput {
  id?: string;
  type: ChannelType;
  name: string;
  enabled: boolean;
  events: DispatchEventKind[];
  url?: string;
}

/** A single event forwarded to enabled channels. */
export interface DispatchEvent {
  kind: DispatchEventKind;
  title: string;
  body?: string;
  url?: string;
}
