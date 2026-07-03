import { getAccount, updateAccount } from "./accounts-store.js";
import { getToken } from "./token-store.js";
import type { Account, NormalizedStatus } from "./types.js";

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

interface GrafanaAuthContext {
  account: Account;
  token: string;
  baseUrl: string;
  config: GrafanaObservabilityConfig;
}

interface GrafanaRulesResponse {
  data?: {
    groups?: {
      name: string;
      rules?: { name: string; state?: string; lastEvaluation?: string; labels?: Record<string, string> }[];
    }[];
  };
}

interface GrafanaDataSource {
  uid?: string;
  name?: string;
  type?: string;
}

interface GrafanaDataSourceHealth {
  status?: string;
  message?: string;
}

interface LokiQueryRangeResponse {
  data?: {
    result?: { stream?: Record<string, string>; values?: [string, string][] }[];
    stats?: unknown;
  };
}

interface TempoSearchResponse {
  traces?: {
    traceID?: string;
    rootServiceName?: string;
    rootTraceName?: string;
    startTimeUnixNano?: string;
    durationMs?: number;
    spanSets?: { spans?: unknown[]; matched?: number }[];
  }[];
  metrics?: unknown;
}

const DEFAULT_CONFIG: GrafanaObservabilityConfig = {
  logPresets: [],
  tracePresets: [],
};

const RANGE_MS: Record<GrafanaRange, number> = {
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
};

const MAX_HEALTH_CHECKS = 25;
const MAX_LOG_LIMIT = 100;
const MAX_TRACE_LIMIT = 50;

function normalizeBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (!Number.isFinite(value) || value === undefined) return fallback;
  return Math.max(1, Math.min(max, Math.floor(value)));
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function parseNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function sanitizeLogPreset(value: unknown): GrafanaLogPreset | null {
  if (typeof value !== "object" || value === null) return null;
  const rec = value as Record<string, unknown>;
  const id = asString(rec.id);
  const name = asString(rec.name);
  const query = asString(rec.query);
  if (!id || !name || !query) return null;
  return {
    id,
    name,
    query,
    datasourceUid: asString(rec.datasourceUid),
    limit: parseNumber(rec.limit),
  };
}

function sanitizeTracePreset(value: unknown): GrafanaTracePreset | null {
  if (typeof value !== "object" || value === null) return null;
  const rec = value as Record<string, unknown>;
  const id = asString(rec.id);
  const name = asString(rec.name);
  const query = asString(rec.query);
  if (!id || !name || !query) return null;
  return {
    id,
    name,
    query,
    datasourceUid: asString(rec.datasourceUid),
    minDuration: asString(rec.minDuration),
    maxDuration: asString(rec.maxDuration),
    limit: parseNumber(rec.limit),
  };
}

export function parseObservabilityConfig(raw: string | undefined): GrafanaObservabilityConfig {
  if (!raw) return { ...DEFAULT_CONFIG };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const logPresets = Array.isArray(parsed.logPresets)
      ? parsed.logPresets.map(sanitizeLogPreset).filter((preset): preset is GrafanaLogPreset => preset !== null)
      : [];
    const tracePresets = Array.isArray(parsed.tracePresets)
      ? parsed.tracePresets.map(sanitizeTracePreset).filter((preset): preset is GrafanaTracePreset => preset !== null)
      : [];
    return {
      lokiDataSourceUid: asString(parsed.lokiDataSourceUid),
      tempoDataSourceUid: asString(parsed.tempoDataSourceUid),
      logPresets,
      tracePresets,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function serializeObservabilityConfig(config: GrafanaObservabilityConfig): string {
  return JSON.stringify({
    lokiDataSourceUid: asString(config.lokiDataSourceUid),
    tempoDataSourceUid: asString(config.tempoDataSourceUid),
    logPresets: config.logPresets.map((preset) => ({
      id: preset.id,
      name: preset.name.trim(),
      query: preset.query.trim(),
      datasourceUid: asString(preset.datasourceUid),
      limit: clampLimit(preset.limit, MAX_LOG_LIMIT, MAX_LOG_LIMIT),
    })),
    tracePresets: config.tracePresets.map((preset) => ({
      id: preset.id,
      name: preset.name.trim(),
      query: preset.query.trim(),
      datasourceUid: asString(preset.datasourceUid),
      minDuration: asString(preset.minDuration),
      maxDuration: asString(preset.maxDuration),
      limit: clampLimit(preset.limit, MAX_TRACE_LIMIT, MAX_TRACE_LIMIT),
    })),
  });
}

function mapDataSourceHealth(status: string | undefined): NormalizedStatus {
  const normalized = status?.toLowerCase();
  if (normalized === "ok") return "success";
  if (normalized === "error" || normalized === "failed" || normalized === "failure") return "failure";
  return "warning";
}

async function grafanaFetch<T>(baseUrl: string, token: string, path: string): Promise<T> {
  const res = await fetch(`${normalizeBase(baseUrl)}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Grafana ${res.status} on ${path}: ${res.statusText}${body ? ` - ${body.slice(0, 160)}` : ""}`);
  }
  return (await res.json()) as T;
}

async function getGrafanaContext(accountId: string): Promise<GrafanaAuthContext> {
  const account = await getAccount(accountId);
  if (!account) throw new Error(`Account not found: ${accountId}`);
  if (account.provider !== "grafana") throw new Error("Selected account is not a Grafana account.");
  const token = await getToken(accountId);
  if (!token) throw new Error("No stored token for this Grafana account.");
  const baseUrl = account.config?.baseUrl;
  if (!baseUrl) throw new Error("Grafana account is missing its instance URL.");
  return {
    account,
    token,
    baseUrl,
    config: parseObservabilityConfig(account.config?.grafanaObservability),
  };
}

function rangeBounds(range: GrafanaRange): { startMs: number; endMs: number; startNs: string; endNs: string; startSec: string; endSec: string } {
  const endMs = Date.now();
  const startMs = endMs - RANGE_MS[range];
  return {
    startMs,
    endMs,
    startNs: `${BigInt(startMs) * 1_000_000n}`,
    endNs: `${BigInt(endMs) * 1_000_000n}`,
    startSec: String(Math.floor(startMs / 1000)),
    endSec: String(Math.floor(endMs / 1000)),
  };
}

function isRange(value: unknown): value is GrafanaRange {
  return value === "15m" || value === "1h" || value === "6h" || value === "24h";
}

export function normalizeRange(value: unknown): GrafanaRange {
  return isRange(value) ? value : "1h";
}

async function listDataSources(baseUrl: string, token: string): Promise<GrafanaDataSourceSummary[]> {
  const dataSources = await grafanaFetch<GrafanaDataSource[]>(baseUrl, token, "/api/datasources");
  return dataSources
    .filter((dataSource) => dataSource.uid)
    .map((dataSource) => ({
      uid: dataSource.uid ?? "",
      name: dataSource.name ?? dataSource.uid ?? "Unknown data source",
      type: dataSource.type ?? "unknown",
    }));
}

async function enrichHealth(baseUrl: string, token: string, dataSources: GrafanaDataSourceSummary[]): Promise<GrafanaDataSourceSummary[]> {
  return await Promise.all(dataSources.slice(0, MAX_HEALTH_CHECKS).map(async (dataSource) => {
    try {
      const health = await grafanaFetch<GrafanaDataSourceHealth>(
        baseUrl,
        token,
        `/api/datasources/uid/${encodeURIComponent(dataSource.uid)}/health`,
      );
      return {
        ...dataSource,
        status: mapDataSourceHealth(health.status),
        healthStatus: health.status,
        healthMessage: health.message,
      };
    } catch (error) {
      return {
        ...dataSource,
        status: "warning" as const,
        healthStatus: "unavailable",
        healthMessage: errorMessage(error),
      };
    }
  }));
}

async function listActiveAlerts(baseUrl: string, token: string): Promise<GrafanaAlertSummary[]> {
  const base = normalizeBase(baseUrl);
  const rules = await grafanaFetch<GrafanaRulesResponse>(baseUrl, token, "/api/prometheus/grafana/api/v1/rules");
  const alerts: GrafanaAlertSummary[] = [];
  for (const group of rules.data?.groups ?? []) {
    for (const rule of group.rules ?? []) {
      if (rule.state !== "firing" && rule.state !== "pending") continue;
      alerts.push({
        name: rule.name,
        group: group.name,
        state: rule.state,
        lastEvaluation: rule.lastEvaluation,
        labels: rule.labels,
        url: `${base}/alerting/list`,
      });
    }
  }
  return alerts;
}

export async function getGrafanaOverview(accountId: string): Promise<GrafanaOverview> {
  const ctx = await getGrafanaContext(accountId);
  const errors: GrafanaOverview["errors"] = [];

  let alerts: GrafanaAlertSummary[] = [];
  try {
    alerts = await listActiveAlerts(ctx.baseUrl, ctx.token);
  } catch (error) {
    errors.push({ area: "alerts", message: errorMessage(error) });
  }

  let dataSources: GrafanaDataSourceSummary[] = [];
  try {
    dataSources = await listDataSources(ctx.baseUrl, ctx.token);
    dataSources = await enrichHealth(ctx.baseUrl, ctx.token, dataSources);
  } catch (error) {
    errors.push({ area: "dataSources", message: errorMessage(error) });
  }

  return {
    accountId,
    generatedAt: new Date().toISOString(),
    baseUrl: normalizeBase(ctx.baseUrl),
    config: ctx.config,
    alerts,
    dataSources,
    lokiDataSources: dataSources.filter((dataSource) => dataSource.type === "loki"),
    tempoDataSources: dataSources.filter((dataSource) => dataSource.type === "tempo"),
    errors,
  };
}

function findPreset<T extends { id: string }>(presets: T[], presetId: string): T {
  const preset = presets.find((candidate) => candidate.id === presetId);
  if (!preset) throw new Error(`Preset not found: ${presetId}`);
  return preset;
}

function selectedDataSource(explicit: string | undefined, fallback: string | undefined, kind: string): string {
  const uid = explicit || fallback;
  if (!uid) throw new Error(`No ${kind} data source selected for this preset.`);
  return uid;
}

export async function runGrafanaLogPreset(accountId: string, presetId: string, range: GrafanaRange): Promise<GrafanaLogResult> {
  const ctx = await getGrafanaContext(accountId);
  const preset = findPreset(ctx.config.logPresets, presetId);
  const datasourceUid = selectedDataSource(preset.datasourceUid, ctx.config.lokiDataSourceUid, "Loki");
  const bounds = rangeBounds(range);
  const limit = clampLimit(preset.limit, MAX_LOG_LIMIT, MAX_LOG_LIMIT);
  const params = new URLSearchParams({
    query: preset.query,
    limit: String(limit),
    start: bounds.startNs,
    end: bounds.endNs,
    direction: "backward",
  });
  const response = await grafanaFetch<LokiQueryRangeResponse>(
    ctx.baseUrl,
    ctx.token,
    `/api/datasources/proxy/uid/${encodeURIComponent(datasourceUid)}/loki/api/v1/query_range?${params}`,
  );
  const rows: GrafanaLogRow[] = [];
  for (const stream of response.data?.result ?? []) {
    const labels = stream.stream ?? {};
    for (const [timestampNs, line] of stream.values ?? []) {
      rows.push({
        timestamp: new Date(Number(BigInt(timestampNs) / 1_000_000n)).toISOString(),
        labels,
        line,
      });
    }
  }
  rows.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return { preset, rows: rows.slice(0, limit), stats: response.data?.stats };
}

export async function runGrafanaTracePreset(accountId: string, presetId: string, range: GrafanaRange): Promise<GrafanaTraceResult> {
  const ctx = await getGrafanaContext(accountId);
  const preset = findPreset(ctx.config.tracePresets, presetId);
  const datasourceUid = selectedDataSource(preset.datasourceUid, ctx.config.tempoDataSourceUid, "Tempo");
  const bounds = rangeBounds(range);
  const limit = clampLimit(preset.limit, MAX_TRACE_LIMIT, MAX_TRACE_LIMIT);
  const params = new URLSearchParams({
    q: preset.query,
    limit: String(limit),
    start: bounds.startSec,
    end: bounds.endSec,
  });
  if (preset.minDuration) params.set("minDuration", preset.minDuration);
  if (preset.maxDuration) params.set("maxDuration", preset.maxDuration);
  const response = await grafanaFetch<TempoSearchResponse>(
    ctx.baseUrl,
    ctx.token,
    `/api/datasources/proxy/uid/${encodeURIComponent(datasourceUid)}/api/search?${params}`,
  );
  const rows = (response.traces ?? []).map((trace) => ({
    traceId: trace.traceID ?? "",
    rootServiceName: trace.rootServiceName,
    rootTraceName: trace.rootTraceName,
    startTime: trace.startTimeUnixNano ? new Date(Number(BigInt(trace.startTimeUnixNano) / 1_000_000n)).toISOString() : undefined,
    durationMs: trace.durationMs,
    matchedSpanCount: trace.spanSets?.reduce((sum, spanSet) => sum + (spanSet.matched ?? spanSet.spans?.length ?? 0), 0),
  })).filter((trace) => trace.traceId !== "");
  return { preset, rows, metrics: response.metrics };
}

export async function updateGrafanaObservabilityConfig(
  accountId: string,
  config: GrafanaObservabilityConfig,
): Promise<{ account: Account; config: GrafanaObservabilityConfig }> {
  const existing = await getAccount(accountId);
  if (!existing) throw new Error(`Account not found: ${accountId}`);
  if (existing.provider !== "grafana") throw new Error("Selected account is not a Grafana account.");
  const serialized = serializeObservabilityConfig(config);
  const parsed = parseObservabilityConfig(serialized);
  const account = await updateAccount(accountId, {
    config: { ...(existing.config ?? {}), grafanaObservability: serialized },
  });
  return { account, config: parsed };
}
