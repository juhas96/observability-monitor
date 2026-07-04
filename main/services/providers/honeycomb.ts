/**
 * Honeycomb adapter. Surfaces trigger and SLO summaries for one dataset.
 * Credential: Honeycomb API key.
 */

import type {
  DashboardPanelResult,
  DashboardProviderQuery,
  DashboardQueryCapability,
  DashboardTableRow,
  MetricsSummary,
  MonitorItem,
  NormalizedStatus,
  ObservabilitySignal,
} from "../types.js";
import type { ProviderDefinition } from "./registry.js";

const API_BASE = "https://api.honeycomb.io";
const DEFAULT_UI_BASE = "https://ui.honeycomb.io";
const DEFAULT_TRIGGER_LIMIT = "50";
const DEFAULT_SLO_LIMIT = "25";

function headers(token: string, environment?: string): Record<string, string> {
  return {
    "X-Honeycomb-Team": token,
    ...(environment ? { "X-Honeycomb-Environment": environment } : {}),
    Accept: "application/json",
  };
}

async function hcFetch<T>(token: string, environment: string | undefined, path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: headers(token, environment) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Honeycomb ${res.status} on ${path}: ${res.statusText}${body ? ` - ${body.slice(0, 160)}` : ""}`);
  }
  return (await res.json()) as T;
}

interface HoneycombAuth {
  team?: { name?: string };
  environment?: { name?: string };
}

interface HoneycombTrigger {
  id?: string;
  name?: string;
  description?: string;
  disabled?: boolean;
  triggered?: boolean;
  updated_at?: string;
}

interface HoneycombSlo {
  id?: string;
  name?: string;
  description?: string;
  target_per_million?: number;
  updated_at?: string;
}

function boundedLimit(value: string | undefined, fallback: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Number(fallback);
  return Math.min(100, Math.max(1, Math.floor(parsed)));
}

function mapTrigger(trigger: HoneycombTrigger): NormalizedStatus {
  if (trigger.disabled) return "info";
  return trigger.triggered ? "failure" : "success";
}

function cleanUiBase(value: string | undefined): string {
  const trimmed = value?.trim().replace(/\/+$/, "");
  return trimmed && /^https?:\/\//i.test(trimmed) ? trimmed : DEFAULT_UI_BASE;
}

function pathPart(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? encodeURIComponent(trimmed) : undefined;
}

function honeycombDatasetUrl(creds: Record<string, string>): string {
  const base = cleanUiBase(creds.uiBaseUrl);
  const team = pathPart(creds.teamSlug);
  const environment = pathPart(creds.environment);
  const dataset = pathPart(creds.dataset);
  if (team && environment && dataset) return `${base}/${team}/environments/${environment}/datasets/${dataset}`;
  if (team && dataset) return `${base}/${team}/datasets/${dataset}`;
  return base;
}

function honeycombTriggerUrl(creds: Record<string, string>, trigger: HoneycombTrigger): string {
  const datasetUrl = honeycombDatasetUrl(creds);
  const id = pathPart(trigger.id);
  return id && datasetUrl !== cleanUiBase(creds.uiBaseUrl) ? `${datasetUrl}/triggers/${id}` : datasetUrl;
}

function honeycombSloUrl(creds: Record<string, string>, slo: HoneycombSlo): string {
  const datasetUrl = honeycombDatasetUrl(creds);
  const id = pathPart(slo.id);
  return id && datasetUrl !== cleanUiBase(creds.uiBaseUrl) ? `${datasetUrl}/slo/${id}` : datasetUrl;
}

async function fetchTriggers(creds: Record<string, string>): Promise<HoneycombTrigger[]> {
  return await hcFetch<HoneycombTrigger[]>(creds.token, creds.environment, `/1/triggers/${encodeURIComponent(creds.dataset)}`);
}

async function fetchSlos(creds: Record<string, string>): Promise<HoneycombSlo[]> {
  return await hcFetch<HoneycombSlo[]>(creds.token, creds.environment, `/1/slos/${encodeURIComponent(creds.dataset)}`);
}

function filteredTriggers(triggers: HoneycombTrigger[], query?: DashboardProviderQuery): HoneycombTrigger[] {
  const state = query?.params?.state?.trim() || "all";
  return triggers
    .filter((trigger) => {
      if (state === "all") return true;
      if (state === "triggered") return Boolean(trigger.triggered) && !trigger.disabled;
      if (state === "ok") return !trigger.triggered && !trigger.disabled;
      if (state === "disabled") return Boolean(trigger.disabled);
      return true;
    })
    .slice(0, boundedLimit(query?.params?.limit, DEFAULT_TRIGGER_LIMIT));
}

function triggerRows(triggers: HoneycombTrigger[], creds: Record<string, string>): DashboardTableRow[] {
  return triggers.map((trigger) => ({
    name: trigger.name ?? trigger.id ?? "Honeycomb trigger",
    state: trigger.disabled ? "disabled" : trigger.triggered ? "triggered" : "ok",
    status: mapTrigger(trigger),
    updated: trigger.updated_at ? new Date(trigger.updated_at).toLocaleString() : "",
    description: trigger.description ?? "",
    __url: honeycombTriggerUrl(creds, trigger),
    __urlLabel: "Open trigger",
  }));
}

function sloRows(slos: HoneycombSlo[], creds: Record<string, string>, query?: DashboardProviderQuery): DashboardTableRow[] {
  return slos.slice(0, boundedLimit(query?.params?.limit, DEFAULT_SLO_LIMIT)).map((slo) => ({
    name: slo.name ?? slo.id ?? "Honeycomb SLO",
    targetPerMillion: slo.target_per_million ?? null,
    updated: slo.updated_at ? new Date(slo.updated_at).toLocaleString() : "",
    description: slo.description ?? "",
    __url: honeycombSloUrl(creds, slo),
    __urlLabel: "Open SLO",
  }));
}

export const honeycombProvider: ProviderDefinition = {
  id: "honeycomb",
  label: "Honeycomb",
  scopeHint: "API key with read access. Dataset is required for triggers/SLO summaries.",
  fields: [
    { key: "token", label: "API key", type: "password", placeholder: "Honeycomb API key", required: true, secret: true },
    { key: "environment", label: "Environment (optional)", type: "text", placeholder: "production", required: false, secret: false },
    { key: "dataset", label: "Dataset", type: "text", placeholder: "api-prod", required: false, secret: false },
    { key: "teamSlug", label: "Team slug (optional)", type: "text", placeholder: "myteam", required: false, secret: false },
    { key: "uiBaseUrl", label: "UI base URL (optional)", type: "text", placeholder: DEFAULT_UI_BASE, required: false, secret: false },
  ],
  async validate(creds) {
    const auth = await hcFetch<HoneycombAuth>(creds.token, creds.environment, "/1/auth");
    return { identity: [auth.team?.name, auth.environment?.name].filter(Boolean).join(" · ") || "Honeycomb" };
  },
  async fetch(account, creds) {
    const now = new Date().toISOString();
    if (!creds.dataset) {
      return [{
        uid: `${account.id}:honeycomb-config:no-dataset`,
        accountId: account.id,
        provider: "honeycomb",
        kind: "honeycomb-config",
        category: "slo",
        title: "Honeycomb dataset not configured",
        subtitle: "Add a dataset to poll triggers and SLOs",
        status: "info",
        conclusion: "configuration",
        createdAt: now,
        updatedAt: now,
        url: honeycombDatasetUrl(creds),
      }];
    }

    const [triggers, slos] = await Promise.all([
      fetchTriggers(creds).catch(() => []),
      fetchSlos(creds).catch(() => []),
    ]);

    const triggerItems: MonitorItem[] = triggers.map((trigger) => {
      const when = trigger.updated_at || now;
      return {
        uid: `${account.id}:honeycomb-trigger:${trigger.id ?? trigger.name}`,
        accountId: account.id,
        provider: "honeycomb",
        kind: "honeycomb-trigger",
        category: "monitor",
        title: trigger.name || "Honeycomb trigger",
        subtitle: trigger.description || (trigger.disabled ? "Disabled trigger" : trigger.triggered ? "Triggered" : "OK"),
        status: mapTrigger(trigger),
        conclusion: trigger.disabled ? "disabled" : trigger.triggered ? "triggered" : "ok",
        createdAt: when,
        updatedAt: when,
        url: honeycombTriggerUrl(creds, trigger),
      };
    });

    const sloItems: MonitorItem[] = slos.slice(0, 10).map((slo) => {
      const when = slo.updated_at || now;
      return {
        uid: `${account.id}:honeycomb-slo:${slo.id ?? slo.name}`,
        accountId: account.id,
        provider: "honeycomb",
        kind: "honeycomb-slo",
        category: "slo",
        title: slo.name || "Honeycomb SLO",
        subtitle: slo.description || "SLO",
        status: "info",
        conclusion: slo.target_per_million !== undefined ? `${slo.target_per_million} ppm target` : "slo",
        createdAt: when,
        updatedAt: when,
        url: honeycombSloUrl(creds, slo),
      };
    });

    return [...triggerItems, ...sloItems];
  },
  async fetchSignals(_account, _creds, items) {
    return items.filter((item) => item.status === "failure" || item.category === "slo").map((item) => ({
      uid: `${item.uid}:signal`,
      accountId: item.accountId,
      provider: "honeycomb",
      kind: item.category === "slo" ? "slo" : "alert",
      category: item.category,
      title: item.title,
      subtitle: item.subtitle,
      status: item.status,
      severity: item.status === "failure" ? "high" : "info",
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      url: item.url,
      sourceItemUid: item.uid,
    } satisfies ObservabilitySignal));
  },
  async fetchMetricsSummary(account, _creds, items) {
    const triggered = items.filter((item) => item.status === "failure").length;
    const slos = items.filter((item) => item.category === "slo").length;
    return [{
      uid: `${account.id}:honeycomb-summary`,
      accountId: account.id,
      provider: "honeycomb",
      title: "Honeycomb telemetry",
      status: triggered > 0 ? "failure" : "success",
      updatedAt: new Date().toISOString(),
      metrics: [
        { label: "Triggered", value: String(triggered), status: triggered > 0 ? "failure" : "success" },
        { label: "SLOs", value: String(slos), status: "info" },
      ],
      url: honeycombDatasetUrl(_creds),
    } satisfies MetricsSummary];
  },
  async getDashboardQueryCapabilities(account, creds): Promise<DashboardQueryCapability[]> {
    if (!creds.dataset) return [];
    return [
      {
        id: "honeycomb.triggers",
        label: `${account.label} triggers`,
        description: "List Honeycomb triggers for the configured dataset.",
        requiresQuery: false,
        resultKind: "table",
        defaultVisualization: "table",
        defaultPanel: {
          title: "Honeycomb triggers",
          source: {
            kind: "provider",
            accountId: account.id,
            capabilityId: "honeycomb.triggers",
            params: { state: "all", limit: DEFAULT_TRIGGER_LIMIT },
          },
          visualization: "table",
          width: "full",
          height: "medium",
        },
        params: [
          { key: "state", label: "State", required: false, placeholder: "all / triggered / ok / disabled", defaultValue: "all" },
          { key: "limit", label: "Limit", required: false, placeholder: DEFAULT_TRIGGER_LIMIT, defaultValue: DEFAULT_TRIGGER_LIMIT },
        ],
      },
      {
        id: "honeycomb.slos",
        label: `${account.label} SLOs`,
        description: "List Honeycomb SLO definitions for the configured dataset.",
        requiresQuery: false,
        resultKind: "table",
        defaultVisualization: "table",
        defaultPanel: {
          title: "Honeycomb SLOs",
          source: {
            kind: "provider",
            accountId: account.id,
            capabilityId: "honeycomb.slos",
            params: { limit: DEFAULT_SLO_LIMIT },
          },
          visualization: "table",
          width: "full",
          height: "medium",
        },
        params: [
          { key: "limit", label: "Limit", required: false, placeholder: DEFAULT_SLO_LIMIT, defaultValue: DEFAULT_SLO_LIMIT },
        ],
      },
    ];
  },
  async runDashboardQuery(account, creds, query: DashboardProviderQuery): Promise<DashboardPanelResult> {
    if (!creds.dataset) throw new Error("Honeycomb dataset is required for dashboard panels.");
    if (query.capabilityId === "honeycomb.triggers") {
      const triggers = filteredTriggers(await fetchTriggers(creds), query);
      const triggered = triggers.filter((trigger) => trigger.triggered && !trigger.disabled).length;
      return {
        kind: "table",
        generatedAt: new Date().toISOString(),
        rows: triggerRows(triggers, creds),
        columns: ["name", "state", "status", "updated", "description"],
        provider: "honeycomb",
        accountId: account.id,
        warnings: triggered > 0 ? [`${triggered} Honeycomb triggers are firing.`] : undefined,
      };
    }
    if (query.capabilityId === "honeycomb.slos") {
      return {
        kind: "table",
        generatedAt: new Date().toISOString(),
        rows: sloRows(await fetchSlos(creds), creds, query),
        columns: ["name", "targetPerMillion", "updated", "description"],
        provider: "honeycomb",
        accountId: account.id,
      };
    }
    throw new Error(`Unsupported Honeycomb dashboard query: ${query.capabilityId}`);
  },
};
