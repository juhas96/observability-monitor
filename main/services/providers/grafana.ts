/**
 * Grafana adapter. Surfaces configured observability summaries for one
 * Grafana instance.
 * Credentials: instance base URL + service account token (or API key).
 */

import { parseObservabilityConfig, runGrafanaLogPreset } from "../grafana-observability.js";
import type {
  DashboardPanelResult,
  DashboardProviderQuery,
  DashboardQueryCapability,
  DashboardSeriesPoint,
  MonitorItem,
  MonitorLogResponse,
  NormalizedStatus,
} from "../types.js";
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

interface PrometheusQueryRangeResponse {
  data?: {
    result?: { metric?: Record<string, string>; values?: [number, string][] }[];
  };
}

interface TempoTagValuesResponse {
  tagValues?: string[];
  metrics?: Record<string, unknown>;
}

const DASHBOARD_RANGE_MS: Record<string, number> = {
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "14d": 14 * 24 * 60 * 60 * 1000,
};

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

function rangeBounds(range: string): { startMs: number; endMs: number; startNs: string; endNs: string; startSec: string; endSec: string; stepSec: string } {
  const duration = DASHBOARD_RANGE_MS[range] ?? DASHBOARD_RANGE_MS["1h"];
  const endMs = Date.now();
  const startMs = endMs - duration;
  return {
    startMs,
    endMs,
    startNs: `${BigInt(startMs) * 1_000_000n}`,
    endNs: `${BigInt(endMs) * 1_000_000n}`,
    startSec: String(Math.floor(startMs / 1000)),
    endSec: String(Math.floor(endMs / 1000)),
    stepSec: String(Math.max(15, Math.ceil(duration / 1000 / 180))),
  };
}

function resultRow(row: Record<string, unknown>): Record<string, string | number | boolean | null | undefined> {
  const out: Record<string, string | number | boolean | null | undefined> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean"
      ? value
      : JSON.stringify(value);
  }
  return out;
}

function parseLimit(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, Math.round(parsed)));
}

function capabilitySuffix(capabilityId: string, prefix: string): string | undefined {
  return capabilityId.startsWith(`${prefix}:`) ? capabilityId.slice(prefix.length + 1) : undefined;
}

function selectedDashboardDatasource(query: DashboardProviderQuery, creds: Record<string, string>, prefix: string, fallbackKey?: string): string {
  const explicit = query.params?.datasourceUid || capabilitySuffix(query.capabilityId, prefix);
  if (explicit) return explicit;
  const config = parseObservabilityConfig(creds.grafanaObservability);
  const fallback = fallbackKey === "loki" ? config.lokiDataSourceUid : fallbackKey === "tempo" ? config.tempoDataSourceUid : undefined;
  if (!fallback) throw new Error("Select a Grafana data source for this panel.");
  return fallback;
}

function exploreUrl(baseUrl: string, pane: Record<string, unknown>): string {
  const panes = { dashboard: pane };
  const params = new URLSearchParams({
    panes: JSON.stringify(panes),
    schemaVersion: "1",
    orgId: "1",
  });
  return `${normalizeBase(baseUrl)}/explore?${params}`;
}

function exploreRange(bounds: ReturnType<typeof rangeBounds>): Record<string, string> {
  return {
    from: new Date(bounds.startMs).toISOString(),
    to: new Date(bounds.endMs).toISOString(),
  };
}

function grafanaTraceUrl(baseUrl: string, datasourceUid: string, traceId: string, bounds: ReturnType<typeof rangeBounds>): string {
  return exploreUrl(baseUrl, {
    datasource: datasourceUid,
    queries: [{ refId: "A", query: traceId, queryType: "traceql", limit: 20 }],
    range: exploreRange(bounds),
  });
}

function escapeTraceQlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function grafanaTraceServiceUrl(baseUrl: string, datasourceUid: string, serviceName: string, bounds: ReturnType<typeof rangeBounds>): string {
  return exploreUrl(baseUrl, {
    datasource: datasourceUid,
    queries: [{ refId: "A", query: `{resource.service.name="${escapeTraceQlString(serviceName)}"}`, queryType: "traceql", limit: 50 }],
    range: exploreRange(bounds),
  });
}

function grafanaLogsUrl(baseUrl: string, datasourceUid: string, logql: string, bounds: ReturnType<typeof rangeBounds>): string {
  return exploreUrl(baseUrl, {
    datasource: datasourceUid,
    queries: [{ refId: "A", expr: logql, queryType: "range" }],
    range: exploreRange(bounds),
  });
}

async function dashboardDataSources(baseUrl: string, token: string): Promise<GrafanaDataSource[]> {
  return await grafanaFetch<GrafanaDataSource[]>(baseUrl, token, "/api/datasources");
}

async function runDashboardAlerts(baseUrl: string, token: string): Promise<DashboardPanelResult> {
  const alertUrl = `${normalizeBase(baseUrl)}/alerting/list`;
  const rules = await grafanaFetch<GrafanaRulesResponse>(baseUrl, token, "/api/prometheus/grafana/api/v1/rules");
  const rows = [];
  for (const group of rules.data?.groups ?? []) {
    for (const rule of group.rules ?? []) {
      if (rule.state !== "firing" && rule.state !== "pending") continue;
      rows.push(resultRow({
        group: group.name,
        name: rule.name,
        state: rule.state,
        lastEvaluation: rule.lastEvaluation,
        labels: rule.labels,
        __url: alertUrl,
        __urlLabel: "Open alerting",
      }));
    }
  }
  return {
    kind: "table",
    generatedAt: new Date().toISOString(),
    rows,
    columns: ["group", "name", "state", "lastEvaluation", "labels"],
  };
}

async function runDashboardDataSources(baseUrl: string, token: string): Promise<DashboardPanelResult> {
  const base = normalizeBase(baseUrl);
  const sources = (await dashboardDataSources(baseUrl, token)).filter((source) => source.uid).slice(0, MAX_DATA_SOURCES);
  const rows = await Promise.all(sources.map(async (source) => {
    const uid = source.uid ?? "";
    const url = `${base}/connections/datasources/edit/${encodeURIComponent(uid)}`;
    try {
      const health = await grafanaFetch<GrafanaDataSourceHealth>(baseUrl, token, `/api/datasources/uid/${encodeURIComponent(uid)}/health`);
      return resultRow({ name: source.name, uid, type: source.type, status: health.status, message: health.message, __url: url, __urlLabel: "Open data source" });
    } catch (error) {
      return resultRow({ name: source.name, uid, type: source.type, status: "unavailable", message: error instanceof Error ? error.message : String(error), __url: url, __urlLabel: "Open data source" });
    }
  }));
  return {
    kind: "table",
    generatedAt: new Date().toISOString(),
    rows,
    columns: ["name", "uid", "type", "status", "message"],
  };
}

async function runDashboardLoki(baseUrl: string, token: string, query: DashboardProviderQuery, creds: Record<string, string>): Promise<DashboardPanelResult> {
  if (!query.query?.trim()) throw new Error("LogQL query is required.");
  const datasourceUid = selectedDashboardDatasource(query, creds, "grafana.loki", "loki");
  const bounds = rangeBounds(query.range);
  const limit = parseLimit(query.params?.limit, 100, 300);
  const url = grafanaLogsUrl(baseUrl, datasourceUid, query.query, bounds);
  const params = new URLSearchParams({
    query: query.query,
    limit: String(limit),
    start: bounds.startNs,
    end: bounds.endNs,
    direction: "backward",
  });
  const response = await grafanaFetch<{ data?: { result?: { stream?: Record<string, string>; values?: [string, string][] }[]; stats?: unknown } }>(
    baseUrl,
    token,
    `/api/datasources/proxy/uid/${encodeURIComponent(datasourceUid)}/loki/api/v1/query_range?${params}`,
  );
  const rows = [];
  for (const stream of response.data?.result ?? []) {
    for (const [timestampNs, line] of stream.values ?? []) {
      rows.push(resultRow({
        timestamp: new Date(Number(BigInt(timestampNs) / 1_000_000n)).toISOString(),
        labels: stream.stream,
        line,
        __url: url,
        __urlLabel: "Open in Grafana",
      }));
    }
  }
  rows.sort((a, b) => new Date(String(b.timestamp)).getTime() - new Date(String(a.timestamp)).getTime());
  return { kind: "logs", generatedAt: new Date().toISOString(), rows: rows.slice(0, limit), columns: ["timestamp", "labels", "line"] };
}

async function runDashboardTempo(baseUrl: string, token: string, query: DashboardProviderQuery, creds: Record<string, string>): Promise<DashboardPanelResult> {
  const traceQuery = query.query?.trim() || "{}";
  const datasourceUid = selectedDashboardDatasource(query, creds, "grafana.tempo", "tempo");
  const bounds = rangeBounds(query.range);
  const limit = parseLimit(query.params?.limit, 50, 100);
  const params = new URLSearchParams({
    q: traceQuery,
    limit: String(limit),
    start: bounds.startSec,
    end: bounds.endSec,
  });
  if (query.params?.minDuration) params.set("minDuration", query.params.minDuration);
  if (query.params?.maxDuration) params.set("maxDuration", query.params.maxDuration);
  const response = await grafanaFetch<{ traces?: { traceID?: string; rootServiceName?: string; rootTraceName?: string; startTimeUnixNano?: string; durationMs?: number; spanSets?: { matched?: number; spans?: unknown[] }[] }[] }>(
    baseUrl,
    token,
    `/api/datasources/proxy/uid/${encodeURIComponent(datasourceUid)}/api/search?${params}`,
  );
  const rows = (response.traces ?? []).map((trace) => resultRow({
    traceId: trace.traceID,
    service: trace.rootServiceName,
    name: trace.rootTraceName,
    startTime: trace.startTimeUnixNano ? new Date(Number(BigInt(trace.startTimeUnixNano) / 1_000_000n)).toISOString() : undefined,
    durationMs: trace.durationMs,
    matchedSpans: trace.spanSets?.reduce((sum, spanSet) => sum + (spanSet.matched ?? spanSet.spans?.length ?? 0), 0),
    __url: trace.traceID ? grafanaTraceUrl(baseUrl, datasourceUid, trace.traceID, bounds) : undefined,
    __urlLabel: "Open trace",
  }));
  return { kind: "traces", generatedAt: new Date().toISOString(), rows, columns: ["traceId", "service", "name", "startTime", "durationMs", "matchedSpans"] };
}

async function runDashboardTempoServices(baseUrl: string, token: string, query: DashboardProviderQuery, creds: Record<string, string>): Promise<DashboardPanelResult> {
  const datasourceUid = selectedDashboardDatasource(query, creds, "grafana.tempo-services", "tempo");
  const bounds = rangeBounds(query.range);
  const limit = parseLimit(query.params?.limit, 100, 300);
  const params = new URLSearchParams({
    start: bounds.startSec,
    end: bounds.endSec,
    limit: String(limit),
  });
  const response = await grafanaFetch<TempoTagValuesResponse>(
    baseUrl,
    token,
    `/api/datasources/proxy/uid/${encodeURIComponent(datasourceUid)}/api/search/tag/service.name/values?${params}`,
  );
  const rows = (response.tagValues ?? [])
    .filter((value): value is string => typeof value === "string" && value.trim() !== "")
    .slice(0, limit)
    .map((serviceName) => resultRow({
      service: serviceName,
      __url: grafanaTraceServiceUrl(baseUrl, datasourceUid, serviceName, bounds),
      __urlLabel: "Open traces",
    }));
  return { kind: "table", generatedAt: new Date().toISOString(), rows, columns: ["service"] };
}

function prometheusSeriesName(metric: Record<string, string> | undefined): string {
  if (!metric) return "value";
  return metric.__name__ || metric.job || metric.instance || Object.entries(metric).filter(([key]) => key !== "__name__").slice(0, 2).map(([key, value]) => `${key}=${value}`).join(", ") || "value";
}

async function runDashboardPrometheus(baseUrl: string, token: string, query: DashboardProviderQuery): Promise<DashboardPanelResult> {
  if (!query.query?.trim()) throw new Error("PromQL query is required.");
  const datasourceUid = query.params?.datasourceUid || capabilitySuffix(query.capabilityId, "grafana.prometheus");
  if (!datasourceUid) throw new Error("Select a Prometheus data source for this panel.");
  const bounds = rangeBounds(query.range);
  const params = new URLSearchParams({
    query: query.query,
    start: bounds.startSec,
    end: bounds.endSec,
    step: query.params?.step || bounds.stepSec,
  });
  const response = await grafanaFetch<PrometheusQueryRangeResponse>(
    baseUrl,
    token,
    `/api/datasources/proxy/uid/${encodeURIComponent(datasourceUid)}/api/v1/query_range?${params}`,
  );
  const points: DashboardSeriesPoint[] = [];
  for (const result of response.data?.result ?? []) {
    const series = prometheusSeriesName(result.metric);
    for (const [seconds, rawValue] of result.values ?? []) {
      const value = Number(rawValue);
      if (!Number.isFinite(value)) continue;
      const ts = new Date(seconds * 1000).toISOString();
      points.push({ ts, label: new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), series, value });
    }
  }
  return { kind: "timeseries", generatedAt: new Date().toISOString(), points };
}

function withLogActions(items: MonitorItem[], accountId: string, base: string, creds: Record<string, string>): MonitorItem[] {
  const firstLogPreset = parseObservabilityConfig(creds.grafanaObservability).logPresets[0];
  return items.map((item) => ({
    ...item,
    logAvailable: Boolean(firstLogPreset),
    logLabel: firstLogPreset ? "View Loki logs" : "Open in Grafana",
    logFallbackUrl: item.url || `${base}/explore`,
    logRef: firstLogPreset ? { accountId, presetId: firstLogPreset.id } : undefined,
    liveLogAvailable: Boolean(firstLogPreset),
    liveLogPollSeconds: firstLogPreset ? 5 : undefined,
    liveLogLabel: firstLogPreset ? "Live" : undefined,
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
  async getDashboardQueryCapabilities(_account, creds) {
    const dataSources = await dashboardDataSources(creds.baseUrl, creds.token).catch(() => []);
    const config = parseObservabilityConfig(creds.grafanaObservability);
    const hasLokiSource = Boolean(config.lokiDataSourceUid) || dataSources.some((source) => source.uid && source.type === "loki");
    const hasTempoSource = Boolean(config.tempoDataSourceUid) || dataSources.some((source) => source.uid && source.type === "tempo");
    const capabilities: DashboardQueryCapability[] = [
      {
        id: "grafana.alerts",
        label: "Grafana active alerts",
        description: "Firing and pending Grafana alert rules.",
        requiresQuery: false,
        resultKind: "table",
        defaultVisualization: "table",
        defaultPanel: {
          title: "Active Grafana alerts",
          source: { kind: "provider", accountId: _account.id, capabilityId: "grafana.alerts" },
          visualization: "table",
          width: "full",
          height: "medium",
        },
      },
      {
        id: "grafana.datasources",
        label: "Grafana data source health",
        description: "Health status for Grafana data sources.",
        requiresQuery: false,
        resultKind: "table",
        defaultVisualization: "table",
        defaultPanel: {
          title: "Grafana data source health",
          source: { kind: "provider", accountId: _account.id, capabilityId: "grafana.datasources" },
          visualization: "table",
          width: "full",
          height: "medium",
        },
      },
    ];
    if (hasLokiSource) {
      capabilities.push({
        id: "grafana.loki",
        label: "Loki LogQL",
        description: "Run a LogQL range query through Grafana.",
        queryLanguage: "LogQL",
        requiresQuery: true,
        resultKind: "logs",
        defaultVisualization: "logs",
        params: [
          { key: "datasourceUid", label: "Data source UID", required: false, placeholder: "Defaults to Grafana Loki setting" },
          { key: "limit", label: "Limit", required: false, defaultValue: "100" },
        ],
      });
    }
    if (hasTempoSource) {
      capabilities.push({
        id: "grafana.tempo",
        label: "Tempo TraceQL",
        description: "Search traces through Grafana Tempo.",
        queryLanguage: "TraceQL",
        requiresQuery: true,
        resultKind: "traces",
        defaultVisualization: "traces",
        defaultPanel: {
          title: "Recent traces",
          source: {
            kind: "provider",
            accountId: _account.id,
            capabilityId: "grafana.tempo",
            query: "{}",
            params: { limit: "50" },
          },
          visualization: "traces",
          width: "full",
          height: "large",
        },
        params: [
          { key: "datasourceUid", label: "Data source UID", required: false, placeholder: "Defaults to Grafana Tempo setting" },
          { key: "limit", label: "Limit", required: false, defaultValue: "50" },
          { key: "minDuration", label: "Min duration", required: false, placeholder: "100ms" },
          { key: "maxDuration", label: "Max duration", required: false, placeholder: "5s" },
        ],
      });
      capabilities.push({
        id: "grafana.tempo-services",
        label: "Tempo trace service names",
        description: "List discovered Tempo service names for the selected range.",
        requiresQuery: false,
        resultKind: "table",
        defaultVisualization: "table",
        defaultPanel: {
          title: "Trace service names",
          source: {
            kind: "provider",
            accountId: _account.id,
            capabilityId: "grafana.tempo-services",
            params: { limit: "100" },
          },
          visualization: "table",
          width: "half",
          height: "medium",
        },
        params: [
          { key: "datasourceUid", label: "Data source UID", required: false, placeholder: "Defaults to Grafana Tempo setting" },
          { key: "limit", label: "Limit", required: false, defaultValue: "100" },
        ],
      });
    }
    for (const dataSource of dataSources.filter((source) => source.uid && source.type === "prometheus")) {
      capabilities.push({
        id: `grafana.prometheus:${dataSource.uid}`,
        label: `Prometheus: ${dataSource.name ?? dataSource.uid}`,
        description: "Run a PromQL range query through Grafana.",
        queryLanguage: "PromQL",
        requiresQuery: true,
        resultKind: "timeseries",
        defaultVisualization: "line",
        params: [{ key: "step", label: "Step seconds", required: false, placeholder: "Auto" }],
      });
    }
    return capabilities;
  },
  async runDashboardQuery(_account, creds, query) {
    if (query.capabilityId === "grafana.alerts") return await runDashboardAlerts(creds.baseUrl, creds.token);
    if (query.capabilityId === "grafana.datasources") return await runDashboardDataSources(creds.baseUrl, creds.token);
    if (query.capabilityId.startsWith("grafana.loki")) return await runDashboardLoki(creds.baseUrl, creds.token, query, creds);
    if (query.capabilityId.startsWith("grafana.tempo-services")) return await runDashboardTempoServices(creds.baseUrl, creds.token, query, creds);
    if (query.capabilityId.startsWith("grafana.tempo")) return await runDashboardTempo(creds.baseUrl, creds.token, query, creds);
    if (query.capabilityId.startsWith("grafana.prometheus")) return await runDashboardPrometheus(creds.baseUrl, creds.token, query);
    throw new Error(`Unsupported Grafana dashboard query: ${query.capabilityId}`);
  },
};
