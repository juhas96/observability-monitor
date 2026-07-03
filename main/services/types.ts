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
  | "heroku";

/** Broad display category used to pick a row icon/label; providers set it per item. */
export type MonitorCategory =
  | "run"
  | "deploy"
  | "migration"
  | "log"
  | "alert"
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

/**
 * Account metadata persisted in accounts.json — NEVER contains the secret token.
 * Non-secret provider fields (project ref, instance URL, account id, repo filter)
 * live in `config`; the resolved display identity lives in `identity`.
 */
export interface Account {
  id: string;
  provider: Provider;
  label: string;
  createdAt: string;
  enabled: boolean;
  lastSyncAt?: string;
  lastError?: string;
  identity?: string;
  config?: Record<string, string>;
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
}

export interface PerAccountStatus {
  count: number;
  lastError?: string;
  lastSyncAt?: string;
}

export interface AggregateSnapshot {
  items: MonitorItem[]; // newest-first, capped per account
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

export const DEFAULT_SETTINGS: MonitorSettings = {
  pollIntervalSeconds: 60,
  notifyOnFailure: true,
  notifyOnSuccess: false,
  notifyOnlyOnChange: true,
  soundOnNotify: false,
};

export const MIN_POLL_INTERVAL_SECONDS = 30;
