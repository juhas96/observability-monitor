/**
 * Datadog adapter. Surfaces non-OK monitors as observability signals.
 * Credential: a single secret containing "api_key:application_key".
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

const DEFAULT_MONITOR_LIMIT = "50";

function parseToken(token: string): { apiKey: string; appKey?: string } {
  const [apiKey, appKey] = token.split(/[:\s,]+/).map((part) => part.trim()).filter(Boolean);
  return { apiKey: apiKey ?? "", appKey };
}

function baseUrl(site: string | undefined): string {
  const host = (site || "datadoghq.com").replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `https://api.${host}`;
}

function appUrl(site: string | undefined): string {
  const host = (site || "datadoghq.com").replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `https://app.${host}`;
}

function headers(token: string): Record<string, string> {
  const parsed = parseToken(token);
  return {
    "DD-API-KEY": parsed.apiKey,
    ...(parsed.appKey ? { "DD-APPLICATION-KEY": parsed.appKey } : {}),
    Accept: "application/json",
  };
}

async function ddFetch<T>(site: string | undefined, token: string, path: string): Promise<T> {
  const res = await fetch(`${baseUrl(site)}${path}`, { headers: headers(token) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Datadog ${res.status} on ${path}: ${res.statusText}${body ? ` - ${body.slice(0, 160)}` : ""}`);
  }
  return (await res.json()) as T;
}

interface DatadogValidateResponse {
  valid?: boolean;
}

interface DatadogMonitor {
  id: number;
  name?: string;
  type?: string;
  overall_state?: string;
  overall_state_modified?: string;
  modified?: string;
  tags?: string[];
  message?: string;
}

function boundedLimit(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Number(DEFAULT_MONITOR_LIMIT);
  return Math.min(100, Math.max(1, Math.floor(parsed)));
}

function mapState(state: string | undefined): NormalizedStatus {
  switch (state) {
    case "Alert":
      return "failure";
    case "Warn":
      return "warning";
    case "OK":
      return "success";
    case "No Data":
      return "warning";
    default:
      return "unknown";
  }
}

function monitorParams(creds: Record<string, string>, query?: DashboardProviderQuery): URLSearchParams {
  const params = new URLSearchParams({ group_states: "all", page_size: String(boundedLimit(query?.params?.limit)) });
  const monitorTags = query?.params?.monitorTags ?? creds.monitorTags ?? "";
  const tags = monitorTags.split(",").map((tag) => tag.trim()).filter(Boolean);
  if (tags.length > 0) params.set("monitor_tags", tags.join(","));
  const name = query?.params?.name?.trim();
  if (name) params.set("name", name);
  return params;
}

async function fetchMonitors(creds: Record<string, string>, query?: DashboardProviderQuery): Promise<DatadogMonitor[]> {
  const parsed = parseToken(creds.token);
  if (!parsed.appKey) throw new Error("Datadog application key is required for monitor dashboard panels.");
  const monitors = await ddFetch<DatadogMonitor[]>(creds.site, creds.token, `/api/v1/monitor?${monitorParams(creds, query)}`);
  const state = query?.params?.state?.trim();
  return state && state !== "all" ? monitors.filter((monitor) => monitor.overall_state === state) : monitors;
}

function monitorRows(monitors: DatadogMonitor[], site: string | undefined): DashboardTableRow[] {
  return monitors.map((monitor) => ({
    id: monitor.id,
    name: monitor.name ?? `Monitor ${monitor.id}`,
    type: monitor.type ?? "",
    state: monitor.overall_state ?? "",
    updated: monitor.overall_state_modified || monitor.modified ? new Date(monitor.overall_state_modified || monitor.modified || "").toLocaleString() : "",
    tags: (monitor.tags ?? []).slice(0, 8).join(", "),
    message: monitor.message ?? "",
    __url: `${appUrl(site)}/monitors/${monitor.id}`,
    __urlLabel: "Open monitor",
  }));
}

export const datadogProvider: ProviderDefinition = {
  id: "datadog",
  label: "Datadog",
  scopeHint: "Enter API key and application key as api_key:application_key. Site defaults to datadoghq.com.",
  fields: [
    { key: "token", label: "API key:application key", type: "password", placeholder: "api_key:app_key", required: true, secret: true },
    { key: "site", label: "Datadog site", type: "text", placeholder: "datadoghq.com / datadoghq.eu", required: false, secret: false, defaultValue: "datadoghq.com" },
    { key: "monitorTags", label: "Monitor tags (optional)", type: "text", placeholder: "service:api,env:prod", required: false, secret: false },
  ],
  async validate(creds) {
    const parsed = parseToken(creds.token);
    if (!parsed.apiKey) throw new Error("Datadog API key is required.");
    const result = await ddFetch<DatadogValidateResponse>(creds.site, parsed.apiKey, "/api/v1/validate");
    if (result.valid === false) throw new Error("Datadog API key is invalid.");
    return { identity: `Datadog ${creds.site || "datadoghq.com"}` };
  },
  async fetch(account, creds) {
    const parsed = parseToken(creds.token);
    if (!parsed.appKey) {
      const now = new Date().toISOString();
      return [{
        uid: `${account.id}:datadog-config:missing-app-key`,
        accountId: account.id,
        provider: "datadog",
        kind: "datadog-config",
        category: "monitor",
        title: "Datadog application key required",
        subtitle: "Monitor polling needs the secret in api_key:application_key form",
        status: "warning",
        conclusion: "configuration",
        createdAt: now,
        updatedAt: now,
        url: `${appUrl(creds.site)}/monitors/manage`,
      }];
    }

    const monitors = await fetchMonitors(creds);
    return monitors
      .filter((monitor) => monitor.overall_state !== "OK")
      .map((monitor) => {
        const when = monitor.overall_state_modified || monitor.modified || new Date().toISOString();
        return {
          uid: `${account.id}:datadog-monitor:${monitor.id}`,
          accountId: account.id,
          provider: "datadog",
          kind: "datadog-monitor",
          category: "monitor",
          title: monitor.name || `Monitor ${monitor.id}`,
          subtitle: [monitor.type, monitor.overall_state, ...(monitor.tags ?? []).slice(0, 3)].filter(Boolean).join(" · "),
          status: mapState(monitor.overall_state),
          conclusion: monitor.overall_state,
          createdAt: when,
          updatedAt: when,
          url: `${appUrl(creds.site)}/monitors/${monitor.id}`,
        } satisfies MonitorItem;
      });
  },
  async fetchSignals(_account, _creds, items) {
    return items.map((item) => ({
      uid: `${item.uid}:signal`,
      accountId: item.accountId,
      provider: "datadog",
      kind: "alert",
      category: "monitor",
      title: item.title,
      subtitle: item.subtitle,
      status: item.status,
      severity: item.status === "failure" ? "critical" : "high",
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      url: item.url,
      sourceItemUid: item.uid,
    } satisfies ObservabilitySignal));
  },
  async fetchMetricsSummary(account, creds, items) {
    const now = new Date().toISOString();
    const failing = items.filter((item) => item.status === "failure").length;
    const warning = items.filter((item) => item.status === "warning").length;
    return [{
      uid: `${account.id}:datadog-monitor-summary`,
      accountId: account.id,
      provider: "datadog",
      title: "Datadog monitors",
      status: failing > 0 ? "failure" : warning > 0 ? "warning" : "success",
      updatedAt: now,
      metrics: [
        { label: "Alerting", value: String(failing), status: failing > 0 ? "failure" : "success" },
        { label: "Warning", value: String(warning), status: warning > 0 ? "warning" : "success" },
      ],
      url: `${appUrl(creds.site)}/monitors/manage`,
    } satisfies MetricsSummary];
  },
  async getDashboardQueryCapabilities(account, creds): Promise<DashboardQueryCapability[]> {
    if (!parseToken(creds.token).appKey) return [];
    return [{
      id: "datadog.monitors",
      label: `${account.label} monitors`,
      description: "List Datadog monitors with optional name, tag, state, and limit filters.",
      requiresQuery: false,
      resultKind: "table",
      defaultVisualization: "table",
      defaultPanel: {
        title: "Datadog monitors",
        source: {
          kind: "provider",
          accountId: account.id,
          capabilityId: "datadog.monitors",
          params: {
            monitorTags: creds.monitorTags ?? "",
            state: "all",
            limit: DEFAULT_MONITOR_LIMIT,
          },
        },
        visualization: "table",
        width: "full",
        height: "medium",
      },
      params: [
        { key: "monitorTags", label: "Monitor tags", required: false, placeholder: "service:api,env:prod", defaultValue: creds.monitorTags ?? "" },
        { key: "name", label: "Name contains", required: false, placeholder: "api latency" },
        { key: "state", label: "State", required: false, placeholder: "Alert / Warn / OK / No Data / all", defaultValue: "all" },
        { key: "limit", label: "Limit", required: false, placeholder: DEFAULT_MONITOR_LIMIT, defaultValue: DEFAULT_MONITOR_LIMIT },
      ],
    }];
  },
  async runDashboardQuery(_account, creds, query: DashboardProviderQuery): Promise<DashboardPanelResult> {
    if (query.capabilityId !== "datadog.monitors") throw new Error(`Unsupported Datadog dashboard query: ${query.capabilityId}`);
    const monitors = await fetchMonitors(creds, query);
    const failing = monitors.filter((monitor) => mapState(monitor.overall_state) === "failure").length;
    const warning = monitors.filter((monitor) => mapState(monitor.overall_state) === "warning").length;
    return {
      kind: "table",
      generatedAt: new Date().toISOString(),
      rows: monitorRows(monitors, creds.site),
      columns: ["id", "name", "type", "state", "updated", "tags", "message"],
      provider: "datadog",
      warnings: failing || warning ? [`${failing} alerting and ${warning} warning/no-data monitors returned.`] : undefined,
    };
  },
};
