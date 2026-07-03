/**
 * Provider registry (adapter pattern). Each integration implements a
 * ProviderDefinition; the poller, accounts handler, and add-account dialog are
 * all data-driven off this registry so new providers are a single new module.
 */

import type {
  Account,
  MetricsSummary,
  MonitorItem,
  MonitorLogResponse,
  ObservabilityIncident,
  ObservabilitySignal,
  Provider,
  ProviderDeepLink,
} from "../types.js";

export interface CredentialField {
  key: string; // e.g. "token", "projectRef", "baseUrl"
  label: string;
  type: "password" | "text" | "boolean";
  placeholder?: string;
  required: boolean;
  /** Secret fields go in the encrypted token-store; the rest live in account.config. */
  secret: boolean;
  /** String-backed default for non-secret config fields. */
  defaultValue?: string;
}

/** Serializable metadata for the renderer (no functions). */
export interface ProviderInfo {
  id: Provider;
  label: string;
  scopeHint: string;
  fields: CredentialField[];
}

export interface ProviderDefinition extends ProviderInfo {
  /** Verify the credentials and resolve a display identity. Throws on failure. */
  validate(creds: Record<string, string>): Promise<{ identity?: string }>;
  /** Fetch normalized items for one account. `creds` merges the secret + config. */
  fetch(account: Account, creds: Record<string, string>): Promise<MonitorItem[]>;
  /** Optional richer alert/status signal model for the ops cockpit. */
  fetchSignals?(account: Account, creds: Record<string, string>, items: MonitorItem[]): Promise<ObservabilitySignal[]>;
  /** Optional normalized incident model for incident providers and issue trackers. */
  fetchIncidents?(account: Account, creds: Record<string, string>, items: MonitorItem[]): Promise<ObservabilityIncident[]>;
  /** Optional compact metric/SLO summaries; raw telemetry stays in the provider. */
  fetchMetricsSummary?(account: Account, creds: Record<string, string>, items: MonitorItem[]): Promise<MetricsSummary[]>;
  /** Optional provider deep links for service/app overview cards. */
  getDeepLinks?(account: Account, creds: Record<string, string>, items: MonitorItem[]): Promise<ProviderDeepLink[]>;
  /** Fetch log/detail lines for one already-known snapshot item. */
  fetchLogs?(account: Account, creds: Record<string, string>, item: MonitorItem): Promise<MonitorLogResponse>;
}

const registry = new Map<Provider, ProviderDefinition>();

export function register(definition: ProviderDefinition): void {
  registry.set(definition.id, definition);
}

export function get(id: Provider): ProviderDefinition {
  const def = registry.get(id);
  if (!def) throw new Error(`Unknown provider: ${id}`);
  return def;
}

export function has(id: string): id is Provider {
  return registry.has(id as Provider);
}

export function list(): ProviderDefinition[] {
  return [...registry.values()];
}

/** The single secret credential field for a provider (every provider has exactly one). */
export function secretField(id: Provider): CredentialField {
  const field = get(id).fields.find((f) => f.secret);
  if (!field) throw new Error(`Provider ${id} has no secret field`);
  return field;
}

/** Metadata only, safe to send to the renderer. */
export function publicList(): ProviderInfo[] {
  return list().map(({ id, label, scopeHint, fields }) => ({ id, label, scopeHint, fields }));
}
