// Renderer-side mirror of the backend domain types (main/services/types.ts).
// Kept structurally identical so IPC payloads type-check on both ends.

export type Provider =
  | "github"
  | "cloudflare"
  | "supabase"
  | "netlify"
  | "resend"
  | "grafana"
  | "heroku";

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
}

export interface PerAccountStatus {
  count: number;
  lastError?: string;
  lastSyncAt?: string;
}

export interface AggregateSnapshot {
  items: MonitorItem[];
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

export interface MonitorStatus {
  encryptionAvailable: boolean;
  polling: boolean;
  accountCount: number;
}

export interface TestConnectionResult {
  ok: boolean;
  identity?: string;
  error?: string;
}

export interface CredentialField {
  key: string;
  label: string;
  type: "password" | "text";
  placeholder?: string;
  required: boolean;
  secret: boolean;
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
