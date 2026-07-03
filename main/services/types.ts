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
  | "honeycomb";

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
  aggregateStatus: NormalizedStatus;
  generatedAt: string;
}

export interface MonitorSettings {
  pollIntervalSeconds: number;
  notifyOnFailure: boolean;
  notifyOnSuccess: boolean;
  notifyOnlyOnChange: boolean;
  soundOnNotify: boolean;
}

export type HistoryRange = "15m" | "1h" | "6h" | "24h" | "7d" | "14d";

export type HistoryEventType = "deploy" | "failure" | "recovery" | "alert" | "incident";

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

export const DEFAULT_SETTINGS: MonitorSettings = {
  pollIntervalSeconds: 60,
  notifyOnFailure: true,
  notifyOnSuccess: false,
  notifyOnlyOnChange: true,
  soundOnNotify: false,
};

export const MIN_POLL_INTERVAL_SECONDS = 30;
