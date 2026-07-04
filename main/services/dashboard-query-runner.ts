/**
 * Executes dashboard panels. Local panels are backed by normalized monitor
 * history/snapshot data; live provider panels require an adapter capability.
 */

import { buildSnapshot } from "./aggregator.js";
import { getAccount, listAccounts } from "./accounts-store.js";
import { listChecks } from "./checks-store.js";
import { getCheckLatencySeries, getEvents, getSeries } from "./history-store.js";
import { listServiceMetadata } from "./service-metadata-store.js";
import { getToken } from "./token-store.js";
import { get as getProviderDefinition, secretField } from "./providers/registry.js";
import type {
  Account,
  DashboardLocalSource,
  DashboardAnnotation,
  DashboardPanel,
  DashboardPanelResult,
  DashboardProviderSource,
  DashboardQueryCapability,
  DashboardSeriesPoint,
  DashboardStat,
  DashboardTableRow,
  HistoryRange,
  HistorySample,
  NormalizedStatus,
  Provider,
  ServiceMetadata,
} from "./types.js";

const STATUSES: NormalizedStatus[] = ["success", "failure", "warning", "running", "queued", "cancelled", "info", "unknown"];
const ANNOTATION_EVENT_TYPES = ["deploy", "failure", "recovery", "alert", "incident"] as const;
const MAX_ANNOTATIONS = 30;

const LOCAL_CAPABILITIES: DashboardQueryCapability[] = [
  {
    id: "local.successFailure",
    label: "Success/failure over time",
    description: "Trend successful and failed normalized provider items.",
    requiresQuery: false,
    resultKind: "timeseries",
    defaultVisualization: "line",
    defaultPanel: {
      title: "Success/failure trend",
      source: { kind: "local", metric: "successFailure" },
      visualization: "line",
      width: "full",
      height: "medium",
    },
  },
  {
    id: "local.statusCounts",
    label: "Status counts over time",
    description: "Trend normalized status counts across all or scoped accounts.",
    requiresQuery: false,
    resultKind: "timeseries",
    defaultVisualization: "bar",
    defaultPanel: {
      title: "Status counts",
      source: { kind: "local", metric: "statusCounts" },
      visualization: "bar",
      width: "full",
      height: "medium",
    },
  },
  {
    id: "local.incidentsAlerts",
    label: "Open incidents and alerts",
    description: "Trend open incidents and alert signals from monitor history.",
    requiresQuery: false,
    resultKind: "timeseries",
    defaultVisualization: "line",
    defaultPanel: {
      title: "Open incidents and alerts",
      source: { kind: "local", metric: "incidentsAlerts" },
      visualization: "line",
      width: "full",
      height: "medium",
    },
  },
  {
    id: "local.events",
    label: "Timeline events",
    description: "Deploy, failure, recovery, alert, and incident event table.",
    requiresQuery: false,
    resultKind: "events",
    defaultVisualization: "table",
    defaultPanel: {
      title: "Recent activity",
      source: { kind: "local", metric: "events" },
      visualization: "table",
      width: "full",
      height: "medium",
    },
  },
  {
    id: "local.failures",
    label: "Recent failures",
    description: "Recent failure events from normalized monitor history.",
    requiresQuery: false,
    resultKind: "events",
    defaultVisualization: "table",
    defaultPanel: {
      title: "Recent failures",
      source: { kind: "local", metric: "events", eventTypes: ["failure"] },
      visualization: "table",
      width: "full",
      height: "medium",
    },
  },
  {
    id: "local.deploys",
    label: "Deploys and releases",
    description: "Recent deploy and release events from normalized monitor history.",
    requiresQuery: false,
    resultKind: "events",
    defaultVisualization: "table",
    defaultPanel: {
      title: "Deploys and releases",
      source: { kind: "local", metric: "events", eventTypes: ["deploy"] },
      visualization: "table",
      width: "full",
      height: "medium",
    },
  },
  {
    id: "local.alertEvents",
    label: "Alerts and incidents",
    description: "Recent alert and incident events from normalized monitor history.",
    requiresQuery: false,
    resultKind: "events",
    defaultVisualization: "table",
    defaultPanel: {
      title: "Alerts and incidents",
      source: { kind: "local", metric: "events", eventTypes: ["alert", "incident"] },
      visualization: "table",
      width: "full",
      height: "medium",
    },
  },
  {
    id: "local.snapshotCounts",
    label: "Current snapshot counts",
    description: "Current item, incident, alert, provider, and account totals.",
    requiresQuery: false,
    resultKind: "stat",
    defaultVisualization: "stat",
    defaultPanel: {
      title: "Current health",
      source: { kind: "local", metric: "snapshotCounts" },
      visualization: "stat",
      width: "half",
      height: "small",
    },
  },
  {
    id: "local.checkLatency",
    label: "Uptime check latency",
    description: "Latency series for one synthetic uptime check.",
    requiresQuery: false,
    resultKind: "timeseries",
    defaultVisualization: "line",
    defaultPanel: {
      title: "Check latency",
      source: { kind: "local", metric: "checkLatency" },
      visualization: "line",
      width: "half",
      height: "medium",
    },
  },
  {
    id: "local.checkUptime",
    label: "Uptime check summary",
    description: "Uptime and average latency for one synthetic uptime check.",
    requiresQuery: false,
    resultKind: "stat",
    defaultVisualization: "stat",
    defaultPanel: {
      title: "Check uptime",
      source: { kind: "local", metric: "checkUptime" },
      visualization: "stat",
      width: "half",
      height: "small",
    },
  },
];

function timeLabel(ts: string): string {
  return new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function scopedAccountIds(source: DashboardLocalSource): Set<string> | null {
  if (!source.accountId) return null;
  return new Set([source.accountId]);
}

function hasServiceMetadataScope(source: DashboardLocalSource): boolean {
  return Boolean(source.owner || source.tier || source.dependency);
}

function serviceIdForAccount(accountId: string, row: Pick<HistorySample["perAccount"][string], "groupId"> | undefined, accountsById: Map<string, Account>): string {
  const account = accountsById.get(accountId);
  return row?.groupId ?? account?.groupId ?? `account:${accountId}`;
}

function matchesServiceMetadata(source: DashboardLocalSource, metadata: ServiceMetadata | undefined): boolean {
  if (source.owner && metadata?.owner !== source.owner) return false;
  if (source.tier && metadata?.tier !== source.tier) return false;
  if (source.dependency && !metadata?.dependencies?.includes(source.dependency)) return false;
  return true;
}

function accountMetadata(accountId: string, row: Pick<HistorySample["perAccount"][string], "groupId"> | undefined, accountsById: Map<string, Account>, metadataByService: Map<string, ServiceMetadata>): ServiceMetadata | undefined {
  return metadataByService.get(serviceIdForAccount(accountId, row, accountsById));
}

function sampleAccountMatches(
  source: DashboardLocalSource,
  accountId: string,
  row: HistorySample["perAccount"][string],
  accountsById: Map<string, Account>,
  metadataByService: Map<string, ServiceMetadata>,
): boolean {
  if (source.accountId && accountId !== source.accountId) return false;
  if (source.groupId && row.groupId !== source.groupId) return false;
  if (source.provider && row.provider !== source.provider) return false;
  if (!matchesServiceMetadata(source, accountMetadata(accountId, row, accountsById, metadataByService))) return false;
  return true;
}

function scopedCounts(sample: HistorySample, source: DashboardLocalSource, accountsById: Map<string, Account>, metadataByService: Map<string, ServiceMetadata>): Record<NormalizedStatus, number> {
  const counts = Object.fromEntries(STATUSES.map((status) => [status, 0])) as Record<NormalizedStatus, number>;
  const scopedAccounts = scopedAccountIds(source);
  if (!source.accountId && !source.groupId && !source.provider && !hasServiceMetadataScope(source)) {
    counts.success = sample.successCount;
    counts.failure = sample.failureCount;
    return counts;
  }
  for (const [accountId, row] of Object.entries(sample.perAccount)) {
    if (scopedAccounts && !scopedAccounts.has(accountId)) continue;
    if (!sampleAccountMatches(source, accountId, row, accountsById, metadataByService)) continue;
    for (const status of STATUSES) counts[status] += row.counts[status];
  }
  return counts;
}

function scopedIncidentAlertCounts(
  sample: HistorySample,
  source: DashboardLocalSource,
  accountsById: Map<string, Account>,
  metadataByService: Map<string, ServiceMetadata>,
): { incidents: number; alerts: number; missingScopedHistory: boolean } {
  if (!source.accountId && !source.groupId && !source.provider && !hasServiceMetadataScope(source)) {
    return { incidents: sample.openIncidentCount, alerts: sample.alertCount, missingScopedHistory: false };
  }
  let incidents = 0;
  let alerts = 0;
  let missingScopedHistory = false;
  const scopedAccounts = scopedAccountIds(source);
  for (const [accountId, row] of Object.entries(sample.perAccount)) {
    if (scopedAccounts && !scopedAccounts.has(accountId)) continue;
    if (!sampleAccountMatches(source, accountId, row, accountsById, metadataByService)) continue;
    if (row.openIncidentCount == null || row.alertCount == null) missingScopedHistory = true;
    incidents += row.openIncidentCount ?? 0;
    alerts += row.alertCount ?? 0;
  }
  return { incidents, alerts, missingScopedHistory };
}

function accountMatchesSource(account: Account, source: DashboardLocalSource, metadataByService: Map<string, ServiceMetadata>): boolean {
  if (source.accountId && account.id !== source.accountId) return false;
  if (source.groupId && account.groupId !== source.groupId) return false;
  if (source.provider && account.provider !== source.provider) return false;
  if (!matchesServiceMetadata(source, metadataByService.get(account.groupId ?? `account:${account.id}`))) return false;
  return true;
}

function seriesPoint(ts: string, series: string, value: number): DashboardSeriesPoint {
  return { ts, label: timeLabel(ts), series, value };
}

function tableRow(row: Record<string, unknown>): DashboardTableRow {
  const out: DashboardTableRow = {};
  for (const [key, value] of Object.entries(row)) {
    if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    } else {
      out[key] = JSON.stringify(value);
    }
  }
  return out;
}

async function localAnnotations(
  source: DashboardLocalSource,
  range: HistoryRange,
  accountsById: Map<string, Account>,
  metadataByService: Map<string, ServiceMetadata>,
): Promise<DashboardAnnotation[]> {
  const events = await getEvents({
    range,
    groupId: source.groupId,
    accountId: source.accountId,
    provider: source.provider,
    types: [...ANNOTATION_EVENT_TYPES],
  });
  return events
    .filter((event) => matchesServiceMetadata(source, accountMetadata(event.accountId, { groupId: event.groupId }, accountsById, metadataByService)))
    .slice(0, MAX_ANNOTATIONS)
    .map((event) => ({
      ts: event.ts,
      type: event.type,
      title: event.title,
      status: event.status,
      severity: event.severity,
      url: event.url,
    }))
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
}

async function runLocalPanel(source: DashboardLocalSource, range: HistoryRange): Promise<DashboardPanelResult> {
  const panelRange = source.range ?? range;
  const generatedAt = new Date().toISOString();
  const accounts = await listAccounts();
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  const metadataByService = hasServiceMetadataScope(source)
    ? new Map((await listServiceMetadata()).map((metadata) => [metadata.serviceId, metadata]))
    : new Map<string, ServiceMetadata>();

  if (source.metric === "events") {
    const events = await getEvents({
      range: panelRange,
      groupId: source.groupId,
      provider: source.provider,
      types: source.eventTypes,
    });
    const rows = events
      .filter((event) => !source.accountId || event.accountId === source.accountId)
      .filter((event) => matchesServiceMetadata(source, accountMetadata(event.accountId, { groupId: event.groupId }, accountsById, metadataByService)))
      .slice(0, 100)
      .map((event) => tableRow({
        time: new Date(event.ts).toLocaleString(),
        type: event.type,
        provider: event.provider,
        title: event.title,
        status: event.status,
        severity: event.severity,
        __eventId: event.id,
        __eventTs: event.ts,
        __eventType: event.type,
        __eventProvider: event.provider,
        __eventAccountId: event.accountId,
        __eventGroupId: event.groupId,
        __eventSourceUid: event.sourceUid,
        __eventStatus: event.status,
        __eventSeverity: event.severity,
        __url: event.url,
        __urlLabel: "Open event",
      }));
    return { kind: "events", generatedAt, rows, columns: ["time", "type", "provider", "title", "status", "severity"] };
  }

  if (source.metric === "snapshotCounts") {
    const snapshot = buildSnapshot();
    const accountIds = new Set(
      accounts
        .filter((account) => accountMatchesSource(account, source, metadataByService))
        .map((account) => account.id),
    );
    const items = snapshot.items.filter((item) => accountIds.has(item.accountId));
    const incidents = snapshot.incidents.filter((incident) => accountIds.has(incident.accountId) && incident.status !== "resolved");
    const alerts = snapshot.signals.filter((signal) => accountIds.has(signal.accountId) && signal.kind === "alert");
    const providers = new Set(items.map((item) => item.provider));
    const stats: DashboardStat[] = [
      { label: "Items", value: items.length },
      { label: "Open incidents", value: incidents.length, status: incidents.length ? "failure" : "success" },
      { label: "Alerts", value: alerts.length, status: alerts.length ? "warning" : "success" },
      { label: "Providers", value: providers.size },
      { label: "Accounts", value: accountIds.size },
    ];
    return { kind: "stat", generatedAt, stats };
  }

  if (source.metric === "checkLatency" || source.metric === "checkUptime") {
    if (!source.checkId) {
      return { kind: source.metric === "checkLatency" ? "timeseries" : "stat", generatedAt, warnings: ["Select an uptime check for this panel."] };
    }
    const check = (await listChecks()).find((candidate) => candidate.id === source.checkId);
    if (!check || (source.groupId && check.groupId !== source.groupId) || !matchesServiceMetadata(source, check.groupId ? metadataByService.get(check.groupId) : undefined)) {
      return {
        kind: source.metric === "checkLatency" ? "timeseries" : "stat",
        generatedAt,
        warnings: ["No uptime check matches the current dashboard filters."],
      };
    }
    const series = await getCheckLatencySeries(source.checkId, panelRange);
    if (source.metric === "checkUptime") {
      return {
        kind: "stat",
        generatedAt,
        stats: [
          { label: "Uptime", value: series.uptime == null ? "n/a" : `${(series.uptime * 100).toFixed(2)}%`, status: series.uptime != null && series.uptime < 0.99 ? "warning" : "success" },
          { label: "Avg latency", value: series.avgLatencyMs == null ? "n/a" : series.avgLatencyMs, unit: series.avgLatencyMs == null ? undefined : "ms" },
        ],
      };
    }
    return {
      kind: "timeseries",
      generatedAt,
      points: series.points.map((point) => seriesPoint(point.ts, "Latency", point.latencyMs ?? 0)),
      annotations: await localAnnotations(source, panelRange, accountsById, metadataByService),
    };
  }

  const samples = await getSeries(panelRange);
  if (source.metric === "successFailure") {
    return {
      kind: "timeseries",
      generatedAt,
      points: samples.flatMap((sample) => {
        const counts = scopedCounts(sample, source, accountsById, metadataByService);
        return [
          seriesPoint(sample.ts, "Success", counts.success),
          seriesPoint(sample.ts, "Failure", counts.failure),
        ];
      }),
      annotations: await localAnnotations(source, panelRange, accountsById, metadataByService),
    };
  }

  if (source.metric === "statusCounts") {
    return {
      kind: "timeseries",
      generatedAt,
      points: samples.flatMap((sample) => {
        const counts = scopedCounts(sample, source, accountsById, metadataByService);
        return STATUSES.filter((status) => counts[status] > 0).map((status) => seriesPoint(sample.ts, status, counts[status]));
      }),
      annotations: await localAnnotations(source, panelRange, accountsById, metadataByService),
    };
  }

  let missingScopedHistory = false;
  const points = samples.flatMap((sample) => {
    const counts = scopedIncidentAlertCounts(sample, source, accountsById, metadataByService);
    if (counts.missingScopedHistory) missingScopedHistory = true;
    return [
      seriesPoint(sample.ts, "Open incidents", counts.incidents),
      seriesPoint(sample.ts, "Alerts", counts.alerts),
    ];
  });
  return {
    kind: "timeseries",
    generatedAt,
    points,
    annotations: await localAnnotations(source, panelRange, accountsById, metadataByService),
    warnings: missingScopedHistory
      ? ["Some older history samples do not contain per-account alert/incident counts, so scoped values may omit those older points."]
      : undefined,
  };
}

async function runProviderPanel(source: DashboardProviderSource, range: HistoryRange): Promise<DashboardPanelResult> {
  const account = await getAccount(source.accountId);
  if (!account) throw new Error(`Account not found: ${source.accountId}`);
  if (!account.enabled) throw new Error(`Account is disabled: ${account.label}`);
  const definition = getProviderDefinition(account.provider);
  if (!definition.runDashboardQuery) throw new Error(`${definition.label} does not expose live dashboard queries.`);
  const token = await getToken(account.id);
  if (!token) throw new Error(`No stored token for ${account.label}.`);
  const secret = secretField(account.provider);
  const result = await definition.runDashboardQuery(
    account,
    { ...(account.config ?? {}), [secret.key]: token },
    {
      capabilityId: source.capabilityId,
      range: source.range ?? range,
      query: source.query,
      params: source.params,
      xField: source.xField,
      yField: source.yField,
    },
  );
  return { ...result, provider: account.provider, accountId: account.id };
}

export async function runDashboardPanel(panel: DashboardPanel, dashboardRange: HistoryRange): Promise<DashboardPanelResult> {
  return panel.source.kind === "local"
    ? await runLocalPanel(panel.source, dashboardRange)
    : await runProviderPanel(panel.source, dashboardRange);
}

export async function listDashboardCapabilities(): Promise<DashboardQueryCapability[]> {
  const capabilities: DashboardQueryCapability[] = [...LOCAL_CAPABILITIES];
  const accounts = await listAccounts();
  for (const account of accounts) {
    if (!account.enabled) continue;
    const definition = getProviderDefinition(account.provider);
    if (!definition.getDashboardQueryCapabilities) continue;
    const token = await getToken(account.id);
    if (!token) continue;
    try {
      const secret = secretField(account.provider);
      const providerCaps = await definition.getDashboardQueryCapabilities(account, { ...(account.config ?? {}), [secret.key]: token });
      capabilities.push(...providerCaps.map((capability) => ({
        ...capability,
        provider: account.provider as Provider,
        accountId: account.id,
        accountLabel: account.label,
        defaultPanel: capability.defaultPanel
          ? {
            ...capability.defaultPanel,
            source: capability.defaultPanel.source.kind === "provider"
              ? { ...capability.defaultPanel.source, accountId: capability.defaultPanel.source.accountId || account.id }
              : capability.defaultPanel.source,
          }
          : undefined,
      })));
    } catch {
      // Capabilities are best-effort; a broken account should not hide local dashboard tools.
    }
  }
  return capabilities;
}
