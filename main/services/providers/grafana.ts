/**
 * Grafana adapter. Surfaces configured observability summaries for one
 * Grafana instance.
 * Credentials: instance base URL + service account token (or API key).
 */

import { parseObservabilityConfig, runGrafanaLogPreset } from "../grafana-observability.js";
import type { MonitorItem, MonitorLogResponse, NormalizedStatus } from "../types.js";
import type { ProviderDefinition } from "./registry.js";

const DEFAULT_SHOW_ALERTS = true;
const DEFAULT_SHOW_DATA_SOURCE_HEALTH = true;
const DEFAULT_SHOW_DASHBOARDS = false;
const DEFAULT_SHOW_ANNOTATIONS = false;
const MAX_DATA_SOURCES = 25;
const MAX_DASHBOARDS = 10;
const MAX_ANNOTATIONS = 20;
const ANNOTATION_WINDOW_MS = 24 * 60 * 60 * 1000;

function normalizeBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

async function grafanaFetch<T>(baseUrl: string, token: string, path: string): Promise<T> {
  const res = await fetch(`${normalizeBase(baseUrl)}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Grafana ${res.status} on ${path}: ${res.statusText}${body ? ` — ${body.slice(0, 160)}` : ""}`);
  }
  return (await res.json()) as T;
}

interface GrafanaHealth {
  database?: string;
  version?: string;
}

interface GrafanaRulesResponse {
  data?: {
    groups?: {
      name: string;
      file?: string;
      rules?: { name: string; state?: string; lastEvaluation?: string; labels?: Record<string, string> }[];
    }[];
  };
}

interface GrafanaDataSource {
  uid?: string;
  name?: string;
  type?: string;
  url?: string;
}

interface GrafanaDataSourceHealth {
  status?: string;
  message?: string;
}

interface GrafanaDashboardSearchItem {
  id?: number;
  uid?: string;
  title?: string;
  url?: string;
  type?: string;
  folderTitle?: string;
  tags?: string[];
  isStarred?: boolean;
}

interface GrafanaAnnotation {
  id?: number;
  dashboardUID?: string;
  panelId?: number;
  time?: number;
  timeEnd?: number;
  text?: string;
  tags?: string[];
  newState?: string;
  prevState?: string;
}

function mapRuleState(state: string | undefined): NormalizedStatus {
  switch (state) {
    case "firing":
      return "failure";
    case "pending":
      return "warning";
    case "inactive":
    case "normal":
      return "success";
    default:
      return "unknown";
  }
}

function mapDataSourceHealth(status: string | undefined): NormalizedStatus {
  const normalized = status?.toLowerCase();
  if (normalized === "ok") return "success";
  if (normalized === "error" || normalized === "failed" || normalized === "failure") return "failure";
  return "warning";
}

function enabled(creds: Record<string, string>, key: string, defaultValue: boolean): boolean {
  return (creds[key] ?? String(defaultValue)) === "true";
}

function csv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function itemUrl(base: string, path: string | undefined, fallback: string): string {
  if (!path) return `${base}${fallback}`;
  if (/^https?:\/\//.test(path)) return path;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

function warningItem(accountId: string, base: string, kind: string, category: MonitorItem["category"], title: string, error: unknown): MonitorItem {
  const now = new Date().toISOString();
  const message = error instanceof Error ? error.message : String(error);
  return {
    uid: `${accountId}:${kind}:warning`,
    accountId,
    provider: "grafana",
    kind,
    category,
    title,
    subtitle: message,
    status: "warning",
    conclusion: "unavailable",
    createdAt: now,
    updatedAt: now,
    url: `${base}/`,
  };
}

function withLogActions(items: MonitorItem[], accountId: string, base: string, creds: Record<string, string>): MonitorItem[] {
  const firstLogPreset = parseObservabilityConfig(creds.grafanaObservability).logPresets[0];
  return items.map((item) => ({
    ...item,
    logAvailable: Boolean(firstLogPreset),
    logLabel: firstLogPreset ? "View Loki logs" : "Open in Grafana",
    logFallbackUrl: item.url || `${base}/explore`,
    logRef: firstLogPreset ? { accountId, presetId: firstLogPreset.id } : undefined,
  }));
}

async function fetchGrafanaLogs(accountId: string, item: MonitorItem): Promise<MonitorLogResponse> {
  const presetId = typeof item.logRef?.presetId === "string" ? item.logRef.presetId : "";
  if (!presetId) throw new Error("No Grafana Loki log preset is configured for this item.");
  const result = await runGrafanaLogPreset(accountId, presetId, "1h");
  const lines = result.rows.map((row) => ({
    timestamp: row.timestamp,
    section: result.preset.name,
    stream: Object.entries(row.labels).map(([key, value]) => `${key}=${value}`).join(" "),
    message: row.line,
  }));
  return {
    itemUid: item.uid,
    title: item.title,
    subtitle: `${result.preset.name} · last hour`,
    provider: "grafana",
    fetchedAt: new Date().toISOString(),
    fallbackUrl: item.logFallbackUrl ?? item.url,
    lines: lines.length > 0 ? lines : [{ section: result.preset.name, message: "No Loki log rows matched this preset." }],
  };
}

async function fetchAlerts(accountId: string, baseUrl: string, token: string): Promise<MonitorItem[]> {
  const base = normalizeBase(baseUrl);
  const rules = await grafanaFetch<GrafanaRulesResponse>(
    baseUrl,
    token,
    "/api/prometheus/grafana/api/v1/rules",
  );

  const items: MonitorItem[] = [];
  const now = new Date().toISOString();
  for (const group of rules.data?.groups ?? []) {
    for (const rule of group.rules ?? []) {
      if (rule.state !== "firing" && rule.state !== "pending") continue;
      items.push({
        uid: `${accountId}:grafana-alert:${group.name}:${rule.name}`,
        accountId,
        provider: "grafana",
        kind: "grafana-alert",
        category: "alert",
        title: rule.name,
        subtitle: `${group.name} · ${rule.state}`,
        status: mapRuleState(rule.state),
        conclusion: rule.state,
        createdAt: rule.lastEvaluation || now,
        updatedAt: rule.lastEvaluation || now,
        url: `${base}/alerting/list`,
      });
    }
  }

  if (items.length === 0) {
    items.push({
      uid: `${accountId}:grafana-alert:ok`,
      accountId,
      provider: "grafana",
      kind: "grafana-alert",
      category: "alert",
      title: "All alerts normal",
      subtitle: "No firing or pending alerts",
      status: "success",
      conclusion: "normal",
      createdAt: now,
      updatedAt: now,
      url: `${base}/alerting/list`,
    });
  }
  return items;
}

async function fetchDataSourceHealth(accountId: string, baseUrl: string, token: string, uidsFilter: string[]): Promise<MonitorItem[]> {
  const base = normalizeBase(baseUrl);
  const filter = new Set(uidsFilter);
  const dataSources = await grafanaFetch<GrafanaDataSource[]>(baseUrl, token, "/api/datasources");
  const selected = dataSources
    .filter((dataSource) => dataSource.uid && (filter.size === 0 || filter.has(dataSource.uid)))
    .slice(0, MAX_DATA_SOURCES);
  const now = new Date().toISOString();

  if (selected.length === 0) {
    return [{
      uid: `${accountId}:grafana-datasource:none`,
      accountId,
      provider: "grafana",
      kind: "grafana-datasource",
      category: "datasource",
      title: "No data sources matched",
      subtitle: filter.size > 0 ? "Check the configured data source UID filter" : "No data sources found",
      status: "info",
      conclusion: "none",
      createdAt: now,
      updatedAt: now,
      url: `${base}/connections/datasources`,
    }];
  }

  return await Promise.all(selected.map(async (dataSource) => {
    const uid = dataSource.uid ?? "unknown";
    try {
      const health = await grafanaFetch<GrafanaDataSourceHealth>(
        baseUrl,
        token,
        `/api/datasources/uid/${encodeURIComponent(uid)}/health`,
      );
      const status = mapDataSourceHealth(health.status);
      return {
        uid: `${accountId}:grafana-datasource:${uid}`,
        accountId,
        provider: "grafana",
        kind: "grafana-datasource",
        category: "datasource",
        title: dataSource.name || uid,
        subtitle: health.message || `${dataSource.type ?? "Data source"} · ${health.status ?? "unknown"}`,
        status,
        conclusion: health.status,
        createdAt: now,
        updatedAt: now,
        url: `${base}/connections/datasources/edit/${encodeURIComponent(uid)}`,
      } satisfies MonitorItem;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        uid: `${accountId}:grafana-datasource:${uid}`,
        accountId,
        provider: "grafana",
        kind: "grafana-datasource",
        category: "datasource",
        title: dataSource.name || uid,
        subtitle: message,
        status: "warning",
        conclusion: "health unavailable",
        createdAt: now,
        updatedAt: now,
        url: `${base}/connections/datasources/edit/${encodeURIComponent(uid)}`,
      } satisfies MonitorItem;
    }
  }));
}

async function fetchDashboards(accountId: string, baseUrl: string, token: string, query: string, tags: string[]): Promise<MonitorItem[]> {
  const base = normalizeBase(baseUrl);
  const params = new URLSearchParams({ type: "dash-db", limit: String(MAX_DASHBOARDS) });
  if (query.trim() !== "") params.set("query", query.trim());
  for (const tag of tags) params.append("tag", tag);

  const dashboards = await grafanaFetch<GrafanaDashboardSearchItem[]>(baseUrl, token, `/api/search?${params}`);
  const now = new Date().toISOString();
  return dashboards
    .filter((dashboard) => dashboard.type === undefined || dashboard.type === "dash-db")
    .slice(0, MAX_DASHBOARDS)
    .map((dashboard) => ({
      uid: `${accountId}:grafana-dashboard:${dashboard.uid ?? dashboard.id ?? dashboard.title ?? "unknown"}`,
      accountId,
      provider: "grafana",
      kind: "grafana-dashboard",
      category: "dashboard",
      title: dashboard.title || "Untitled dashboard",
      subtitle: [dashboard.folderTitle, dashboard.isStarred ? "Starred" : undefined, ...(dashboard.tags ?? [])].filter(Boolean).join(" · ") || "Dashboard",
      status: "info",
      conclusion: "available",
      createdAt: now,
      updatedAt: now,
      url: itemUrl(base, dashboard.url, "/dashboards"),
    }));
}

async function fetchAnnotations(accountId: string, baseUrl: string, token: string, tags: string[]): Promise<MonitorItem[]> {
  const base = normalizeBase(baseUrl);
  const to = Date.now();
  const params = new URLSearchParams({
    from: String(to - ANNOTATION_WINDOW_MS),
    to: String(to),
    limit: String(MAX_ANNOTATIONS),
    type: "annotation",
  });
  for (const tag of tags) params.append("tags", tag);

  const annotations = await grafanaFetch<GrafanaAnnotation[]>(baseUrl, token, `/api/annotations?${params}`);
  return annotations.slice(0, MAX_ANNOTATIONS).map((annotation) => {
    const iso = annotation.time ? new Date(annotation.time).toISOString() : new Date().toISOString();
    const tagsSubtitle = annotation.tags?.length ? annotation.tags.join(", ") : undefined;
    const dashboardSubtitle = annotation.dashboardUID ? `Dashboard ${annotation.dashboardUID}` : undefined;
    return {
      uid: `${accountId}:grafana-annotation:${annotation.id ?? annotation.time ?? annotation.text ?? "unknown"}`,
      accountId,
      provider: "grafana",
      kind: "grafana-annotation",
      category: "annotation",
      title: annotation.text || "Annotation",
      subtitle: [dashboardSubtitle, tagsSubtitle].filter(Boolean).join(" · ") || "Recent annotation",
      status: "info",
      conclusion: "annotation",
      createdAt: iso,
      updatedAt: iso,
      url: annotation.dashboardUID ? `${base}/d/${annotation.dashboardUID}` : `${base}/dashboards`,
    };
  });
}

export const grafanaProvider: ProviderDefinition = {
  id: "grafana",
  label: "Grafana",
  scopeHint: "Instance URL (e.g. https://you.grafana.net) + a service account token with Viewer access to selected observability APIs.",
  fields: [
    { key: "baseUrl", label: "Instance URL", type: "text", placeholder: "https://you.grafana.net", required: true, secret: false },
    { key: "token", label: "Service account token", type: "password", placeholder: "glsa_… / API key", required: true, secret: true },
    { key: "showAlerts", label: "Show alerts", type: "boolean", required: false, secret: false, defaultValue: "true" },
    { key: "showDataSourceHealth", label: "Show data source health", type: "boolean", required: false, secret: false, defaultValue: "true" },
    { key: "showDashboards", label: "Show dashboards", type: "boolean", required: false, secret: false, defaultValue: "false" },
    { key: "showAnnotations", label: "Show annotations", type: "boolean", required: false, secret: false, defaultValue: "false" },
    { key: "dataSourceUids", label: "Data source UIDs", type: "text", placeholder: "Optional, comma-separated", required: false, secret: false },
    { key: "dashboardQuery", label: "Dashboard search", type: "text", placeholder: "Optional search text", required: false, secret: false },
    { key: "dashboardTags", label: "Dashboard tags", type: "text", placeholder: "Optional, comma-separated", required: false, secret: false },
    { key: "annotationTags", label: "Annotation tags", type: "text", placeholder: "Optional, comma-separated", required: false, secret: false },
  ],
  async validate(creds) {
    const health = await grafanaFetch<GrafanaHealth>(creds.baseUrl, creds.token, "/api/health");
    return { identity: health.version ? `Grafana ${health.version}` : normalizeBase(creds.baseUrl) };
  },
  async fetch(account, creds) {
    const base = normalizeBase(creds.baseUrl);
    const items: MonitorItem[] = [];

    if (enabled(creds, "showAlerts", DEFAULT_SHOW_ALERTS)) {
      try {
        items.push(...await fetchAlerts(account.id, creds.baseUrl, creds.token));
      } catch (error) {
        items.push(warningItem(account.id, base, "grafana-alert", "alert", "Alerts unavailable", error));
      }
    }

    if (enabled(creds, "showDataSourceHealth", DEFAULT_SHOW_DATA_SOURCE_HEALTH)) {
      try {
        items.push(...await fetchDataSourceHealth(account.id, creds.baseUrl, creds.token, csv(creds.dataSourceUids)));
      } catch (error) {
        items.push(warningItem(account.id, base, "grafana-datasource", "datasource", "Data source health unavailable", error));
      }
    }

    if (enabled(creds, "showDashboards", DEFAULT_SHOW_DASHBOARDS)) {
      try {
        items.push(...await fetchDashboards(account.id, creds.baseUrl, creds.token, creds.dashboardQuery ?? "", csv(creds.dashboardTags)));
      } catch (error) {
        items.push(warningItem(account.id, base, "grafana-dashboard", "dashboard", "Dashboards unavailable", error));
      }
    }

    if (enabled(creds, "showAnnotations", DEFAULT_SHOW_ANNOTATIONS)) {
      try {
        items.push(...await fetchAnnotations(account.id, creds.baseUrl, creds.token, csv(creds.annotationTags)));
      } catch (error) {
        items.push(warningItem(account.id, base, "grafana-annotation", "annotation", "Annotations unavailable", error));
      }
    }

    return withLogActions(items, account.id, base, creds);
  },
  async fetchLogs(account, _creds, item) {
    return await fetchGrafanaLogs(account.id, item);
  },
};
