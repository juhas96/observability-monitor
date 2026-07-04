/**
 * User-authored dashboard definitions. Plain JSON in userData/dashboards.json;
 * provider credentials stay in token-store and are never copied here.
 */

import { randomUUID } from "crypto";

import { listAccounts } from "./accounts-store.js";
import { DataStore } from "./data-store.js";
import { parseObservabilityConfig } from "./grafana-observability.js";
import type {
  DashboardDefinition,
  DashboardInput,
  DashboardLocalMetric,
  DashboardPanel,
  DashboardPanelScope,
  DashboardPanelSource,
  DashboardVisualization,
  HistoryEventType,
  HistoryRange,
  Provider,
  ServiceTier,
} from "./types.js";

interface DashboardsFile {
  version: 1;
  dashboards: DashboardDefinition[];
  migratedGrafanaPresets?: boolean;
}

const DEFAULT_FILE: DashboardsFile = { version: 1, dashboards: [], migratedGrafanaPresets: false };
const store = new DataStore<DashboardsFile>("dashboards.json", DEFAULT_FILE);

const RANGES: HistoryRange[] = ["15m", "1h", "6h", "24h", "7d", "14d"];
const VISUALIZATIONS: DashboardVisualization[] = ["line", "area", "bar", "stat", "table", "logs", "traces"];
const LOCAL_METRICS: DashboardLocalMetric[] = ["successFailure", "statusCounts", "incidentsAlerts", "events", "snapshotCounts", "checkLatency", "checkUptime"];
const EVENT_TYPES: HistoryEventType[] = ["deploy", "failure", "recovery", "alert", "incident", "check"];
const PROVIDERS: Provider[] = ["github", "cloudflare", "supabase", "netlify", "resend", "grafana", "heroku", "sentry", "pagerduty", "statuspage", "datadog", "honeycomb", "posthog", "betterstack"];
const SERVICE_TIERS: ServiceTier[] = ["critical", "standard", "internal", "experimental"];

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeRange(value: unknown, fallback: HistoryRange = "24h"): HistoryRange {
  return RANGES.includes(value as HistoryRange) ? value as HistoryRange : fallback;
}

function normalizeVisualization(value: unknown): DashboardVisualization {
  return VISUALIZATIONS.includes(value as DashboardVisualization) ? value as DashboardVisualization : "line";
}

function normalizeLocalMetric(value: unknown): DashboardLocalMetric {
  return LOCAL_METRICS.includes(value as DashboardLocalMetric) ? value as DashboardLocalMetric : "successFailure";
}

function optionalTrimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function normalizeProvider(value: unknown): Provider | undefined {
  return PROVIDERS.includes(value as Provider) ? value as Provider : undefined;
}

function normalizeTier(value: unknown): ServiceTier | undefined {
  return SERVICE_TIERS.includes(value as ServiceTier) ? value as ServiceTier : undefined;
}

function normalizeScopeFields(source: Record<string, unknown>): DashboardPanelScope {
  return {
    groupId: optionalTrimmedString(source.groupId),
    accountId: optionalTrimmedString(source.accountId),
    provider: normalizeProvider(source.provider),
    checkId: optionalTrimmedString(source.checkId),
    owner: optionalTrimmedString(source.owner),
    tier: normalizeTier(source.tier),
    dependency: optionalTrimmedString(source.dependency),
  };
}

function hasScopeFields(scope: DashboardPanelScope): boolean {
  return Object.values(scope).some((value) => value !== undefined);
}

function normalizeProviderParams(value: unknown): Record<string, string> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const entries = Object.entries(value)
    .filter(([key, raw]) => key.trim() !== "" && typeof raw === "string" && raw.trim() !== "")
    .map(([key, raw]) => [key.trim(), raw.trim()]);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function normalizePanelSource(source: unknown, dashboardRange: HistoryRange): DashboardPanelSource | null {
  const raw = asRecord(source);
  if (raw.kind === "local") {
    return {
      ...normalizeScopeFields(raw),
      kind: "local",
      metric: normalizeLocalMetric(raw.metric),
      range: raw.range ? normalizeRange(raw.range, dashboardRange) : undefined,
      eventTypes: Array.isArray(raw.eventTypes)
        ? raw.eventTypes.filter((type): type is HistoryEventType => EVENT_TYPES.includes(type as HistoryEventType))
        : undefined,
    };
  }
  if (raw.kind !== "provider") return null;
  const accountId = optionalTrimmedString(raw.accountId);
  const capabilityId = optionalTrimmedString(raw.capabilityId);
  if (!accountId || !capabilityId) return null;
  return {
    kind: "provider",
    accountId,
    capabilityId,
    range: raw.range ? normalizeRange(raw.range, dashboardRange) : undefined,
    query: optionalTrimmedString(raw.query),
    params: normalizeProviderParams(raw.params),
    xField: optionalTrimmedString(raw.xField),
    yField: optionalTrimmedString(raw.yField),
  };
}

function normalizePanel(panel: unknown, index: number, dashboardRange: HistoryRange): DashboardPanel | null {
  const raw = asRecord(panel);
  const source = normalizePanelSource(raw.source, dashboardRange);
  if (!source) return null;
  const order = typeof raw.order === "number" && Number.isFinite(raw.order) ? raw.order : index;
  return {
    id: optionalTrimmedString(raw.id) ?? randomUUID(),
    title: optionalTrimmedString(raw.title) ?? "Untitled panel",
    source,
    visualization: normalizeVisualization(raw.visualization),
    width: raw.width === "full" ? "full" : "half",
    height: raw.height === "small" || raw.height === "large" ? raw.height : "medium",
    refreshSeconds: typeof raw.refreshSeconds === "number" && raw.refreshSeconds >= 15 ? Math.round(raw.refreshSeconds) : undefined,
    order,
  };
}

function normalizeDashboard(input: DashboardInput, existing?: DashboardDefinition): DashboardDefinition {
  const now = new Date().toISOString();
  const id = optionalTrimmedString(input.id);
  const name = optionalTrimmedString(input.name);
  if (!name) throw new Error("Dashboard name is required.");
  const range = normalizeRange(input.range);
  const variables = normalizeScopeFields(asRecord(input.variables));
  const panels = (Array.isArray(input.panels) ? input.panels : [])
    .map((panel, index) => normalizePanel(panel, index, range))
    .filter((panel): panel is DashboardPanel => panel !== null)
    .sort((a, b) => a.order - b.order)
    .map((panel, order) => ({ ...panel, order }));
  return {
    id: existing?.id ?? id ?? randomUUID(),
    name,
    description: optionalTrimmedString(input.description),
    range,
    refreshSeconds: input.refreshSeconds && input.refreshSeconds >= 15 ? Math.round(input.refreshSeconds) : undefined,
    variables: hasScopeFields(variables) ? variables : undefined,
    panels,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

function importedGrafanaPanels(accountId: string, rawConfig: string | undefined): DashboardPanel[] {
  const config = parseObservabilityConfig(rawConfig);
  const panels: DashboardPanel[] = [];
  let order = 0;

  panels.push({
    id: randomUUID(),
    title: "Active Grafana alerts",
    visualization: "table",
    width: "full",
    height: "medium",
    order: order++,
    source: { kind: "provider", accountId, capabilityId: "grafana.alerts", range: "1h" },
  });
  panels.push({
    id: randomUUID(),
    title: "Data source health",
    visualization: "table",
    width: "full",
    height: "medium",
    order: order++,
    source: { kind: "provider", accountId, capabilityId: "grafana.datasources", range: "1h" },
  });

  for (const preset of config.logPresets) {
    panels.push({
      id: randomUUID(),
      title: preset.name,
      visualization: "logs",
      width: "full",
      height: "large",
      order: order++,
      source: {
        kind: "provider",
        accountId,
        capabilityId: "grafana.loki",
        range: "1h",
        query: preset.query,
        params: {
          ...(preset.datasourceUid ? { datasourceUid: preset.datasourceUid } : {}),
          ...(preset.limit ? { limit: String(preset.limit) } : {}),
        },
      },
    });
  }

  for (const preset of config.tracePresets) {
    panels.push({
      id: randomUUID(),
      title: preset.name,
      visualization: "traces",
      width: "full",
      height: "medium",
      order: order++,
      source: {
        kind: "provider",
        accountId,
        capabilityId: "grafana.tempo",
        range: "1h",
        query: preset.query,
        params: {
          ...(preset.datasourceUid ? { datasourceUid: preset.datasourceUid } : {}),
          ...(preset.minDuration ? { minDuration: preset.minDuration } : {}),
          ...(preset.maxDuration ? { maxDuration: preset.maxDuration } : {}),
          ...(preset.limit ? { limit: String(preset.limit) } : {}),
        },
      },
    });
  }

  return panels;
}

async function migrateGrafanaPresets(file: DashboardsFile): Promise<DashboardsFile> {
  if (file.migratedGrafanaPresets || file.dashboards.length > 0) return file;
  const accounts = await listAccounts();
  const dashboards: DashboardDefinition[] = [];
  for (const account of accounts) {
    if (account.provider !== "grafana") continue;
    const config = parseObservabilityConfig(account.config?.grafanaObservability);
    if (config.logPresets.length === 0 && config.tracePresets.length === 0) continue;
    const panels = importedGrafanaPanels(account.id, account.config?.grafanaObservability);
    dashboards.push({
      id: randomUUID(),
      name: `${account.label} Grafana`,
      description: "Imported from saved Grafana observability presets.",
      range: "1h",
      panels,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
  return { ...file, dashboards, migratedGrafanaPresets: true };
}

async function loadFile(): Promise<DashboardsFile> {
  const initial = await store.load();
  const shouldPersistMigration = !initial.migratedGrafanaPresets && initial.dashboards.length === 0;
  const file = await migrateGrafanaPresets(initial);
  if (!shouldPersistMigration || !file.migratedGrafanaPresets) return file;
  await store.save(file);
  return file;
}

export async function listDashboards(): Promise<DashboardDefinition[]> {
  return (await loadFile()).dashboards;
}

export async function saveDashboard(input: DashboardInput): Promise<DashboardDefinition> {
  const file = await loadFile();
  const index = input.id ? file.dashboards.findIndex((dashboard) => dashboard.id === input.id) : -1;
  const dashboard = normalizeDashboard(input, index >= 0 ? file.dashboards[index] : undefined);
  const dashboards = [...file.dashboards];
  if (index >= 0) dashboards[index] = dashboard;
  else dashboards.push(dashboard);
  await store.save({ ...file, dashboards });
  return dashboard;
}

export async function deleteDashboard(id: string): Promise<void> {
  const file = await loadFile();
  await store.save({ ...file, dashboards: file.dashboards.filter((dashboard) => dashboard.id !== id) });
}
