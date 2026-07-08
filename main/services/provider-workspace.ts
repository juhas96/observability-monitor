/**
 * Provider workspace aggregation.
 *
 * This layer is intentionally read-only. Provider credentials are loaded only
 * in the backend for adapter enrichment and never included in returned rows.
 */

import * as aggregator from "./aggregator.js";
import { listAccounts, listGroups } from "./accounts-store.js";
import { getEvents, getSeries } from "./history-store.js";
import { getToken } from "./token-store.js";
import { list as listProviderDefinitions, secretField, type ProviderWorkspaceContribution } from "./providers/registry.js";
import type {
  Account,
  AggregateSnapshot,
  DashboardTableRow,
  HistoryEvent,
  HistoryRange,
  HistorySample,
  MonitorItem,
  NormalizedStatus,
  ObservabilityIncident,
  ObservabilitySignal,
  Provider,
  ProviderWorkspaceAlertTemplate,
  ProviderWorkspaceCapability,
  ProviderWorkspaceEvidenceRow,
  ProviderWorkspaceOverview,
  ProviderWorkspaceResourceTable,
  ProviderWorkspaceSection,
  ProviderWorkspaceSeries,
  ProviderWorkspaceStat,
  ProjectGroup,
} from "./types.js";

const STATUS_FIELDS: { key: NormalizedStatus; label: string; tone: ProviderWorkspaceStat["tone"] }[] = [
  { key: "failure", label: "Failures", tone: "danger" },
  { key: "warning", label: "Warnings", tone: "warning" },
  { key: "running", label: "Running", tone: "info" },
  { key: "queued", label: "Queued", tone: "info" },
  { key: "success", label: "Success", tone: "success" },
];

const SECTIONS: Omit<ProviderWorkspaceSection, "available" | "detail">[] = [
  { id: "overview", label: "Overview", description: "Current account, health, stale, incident, and alert summary." },
  { id: "activity", label: "Activity", description: "Retained deploy, failure, recovery, alert, and incident activity." },
  { id: "analytics", label: "Health", description: "History-backed status, incident, and alert charts." },
  { id: "resources", label: "Inventory", description: "Accounts, provider-native inventory, signals, incidents, and links." },
  { id: "evidence", label: "Evidence", description: "Current log-capable items, retained events, incidents, signals, and vendor links." },
  { id: "alerts", label: "Alerts", description: "Provider-scoped alert rule templates." },
  { id: "exports", label: "Exports", description: "Secret-free CSV and JSON workspace exports." },
  { id: "setup", label: "Setup", description: "Provider metadata and collection-area guidance." },
];

function providerLabel(provider: Provider): string {
  return listProviderDefinitions().find((definition) => definition.id === provider)?.label ?? provider;
}

function asProvider(value: unknown): Provider | undefined {
  if (typeof value !== "string") return undefined;
  return listProviderDefinitions().some((definition) => definition.id === value) ? value as Provider : undefined;
}

function providerAccounts(accounts: Account[], provider: Provider, accountId?: string): Account[] {
  return accounts
    .filter((account) => account.provider === provider)
    .filter((account) => !accountId || account.id === accountId);
}

function accountLabel(accountsById: Map<string, Account>, accountId: string | undefined): string | undefined {
  if (!accountId) return undefined;
  const account = accountsById.get(accountId);
  return account?.identity || account?.label;
}

function groupLabel(groupsById: Map<string, ProjectGroup>, account: Account): string {
  return account.groupId ? groupsById.get(account.groupId)?.name ?? "" : "";
}

function numberLabel(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function timeLabel(value: string | undefined): string {
  if (!value) return "";
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return value;
  return new Date(ts).toLocaleString();
}

function eventTypeLabel(event: HistoryEvent): string {
  const category = event.category ?? event.type;
  return `${event.type}${category && category !== event.type ? ` · ${category}` : ""}`;
}

function sectionsFor(args: {
  accountCount: number;
  sampleCount: number;
  resourceCount: number;
  evidenceCount: number;
  warningCount: number;
}): ProviderWorkspaceSection[] {
  return SECTIONS.map((section) => {
    if (section.id === "activity" || section.id === "analytics") {
      return {
        ...section,
        available: args.sampleCount > 0,
        detail: args.sampleCount > 0 ? `${args.sampleCount} retained samples in range` : "No retained history for this provider and range yet.",
      };
    }
    if (section.id === "resources") {
      return {
        ...section,
        available: args.resourceCount > 0 || args.accountCount > 0,
        detail: args.resourceCount > 0 ? `${args.resourceCount} current resources and rows` : "No current rows beyond account metadata.",
      };
    }
    if (section.id === "evidence") {
      return {
        ...section,
        available: args.evidenceCount > 0,
        detail: args.evidenceCount > 0 ? `${args.evidenceCount} evidence rows` : "No events, log-capable rows, incidents, signals, or links yet.",
      };
    }
    if (section.id === "setup") {
      return {
        ...section,
        available: args.accountCount > 0,
        detail: args.warningCount > 0 ? `${args.warningCount} account warnings need setup review` : "Provider metadata and collection areas are available.",
      };
    }
    return {
      ...section,
      available: true,
      detail: args.accountCount > 0 ? `${args.accountCount} connected account${args.accountCount === 1 ? "" : "s"}` : "Connect an account to populate this section.",
    };
  });
}

function statusSeries(samples: HistorySample[]): ProviderWorkspaceSeries {
  return {
    id: "status",
    label: "Status trend",
    description: "Current normalized item statuses from retained provider samples.",
    kind: "area",
    fields: STATUS_FIELDS,
    points: samples.map((sample) => {
      const values: Record<string, number> = {};
      for (const field of STATUS_FIELDS) {
        values[field.key] = Object.values(sample.perAccount).reduce((sum, row) => sum + (row.counts[field.key] ?? 0), 0);
      }
      return {
        ts: sample.ts,
        label: new Date(sample.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        values,
      };
    }),
  };
}

function incidentAlertSeries(samples: HistorySample[]): ProviderWorkspaceSeries {
  return {
    id: "signals",
    label: "Incidents and alerts",
    description: "Open incidents and provider alert signals retained during polling.",
    kind: "line",
    fields: [
      { key: "openIncidents", label: "Open incidents", tone: "danger" },
      { key: "alerts", label: "Alerts", tone: "warning" },
    ],
    points: samples.map((sample) => ({
      ts: sample.ts,
      label: new Date(sample.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      values: {
        openIncidents: sample.openIncidentCount,
        alerts: sample.alertCount,
      },
    })),
  };
}

function activitySeries(events: HistoryEvent[]): ProviderWorkspaceSeries {
  const buckets = new Map<string, Record<string, number>>();
  for (const event of events) {
    const date = new Date(event.ts);
    const bucket = Number.isFinite(date.getTime())
      ? date.toISOString().slice(0, 13)
      : "unknown";
    const current = buckets.get(bucket) ?? { deploys: 0, failures: 0, recoveries: 0, alerts: 0, incidents: 0 };
    if (event.type === "deploy") current.deploys += 1;
    if (event.type === "failure") current.failures += 1;
    if (event.type === "recovery") current.recoveries += 1;
    if (event.type === "alert") current.alerts += 1;
    if (event.type === "incident") current.incidents += 1;
    buckets.set(bucket, current);
  }
  return {
    id: "activity",
    label: "Activity volume",
    description: "Retained event volume by hour.",
    kind: "bar",
    fields: [
      { key: "deploys", label: "Deploys", tone: "success" },
      { key: "failures", label: "Failures", tone: "danger" },
      { key: "alerts", label: "Alerts", tone: "warning" },
      { key: "incidents", label: "Incidents", tone: "danger" },
    ],
    points: [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([bucket, values]) => ({
        ts: bucket === "unknown" ? new Date().toISOString() : `${bucket}:00:00.000Z`,
        label: bucket === "unknown" ? "Unknown" : new Date(`${bucket}:00:00.000Z`).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        values,
      })),
  };
}

function accountRows(accounts: Account[], groupsById: Map<string, ProjectGroup>, snapshot: AggregateSnapshot): DashboardTableRow[] {
  return accounts.map((account) => {
    const status = snapshot.perAccount[account.id];
    const stale = snapshot.staleness[account.id];
    return {
      account: account.label,
      identity: account.identity ?? "",
      group: groupLabel(groupsById, account),
      enabled: account.enabled,
      items: status?.count ?? 0,
      lastSync: timeLabel(status?.lastSyncAt ?? account.lastSyncAt),
      stale: stale?.stale ? stale.reason ?? "yes" : "",
      error: status?.lastError ?? account.lastError ?? "",
    };
  });
}

function itemRows(items: MonitorItem[], accountsById: Map<string, Account>): DashboardTableRow[] {
  return items.map((item) => ({
    title: item.title,
    account: accountLabel(accountsById, item.accountId) ?? item.accountId,
    category: item.category,
    kind: item.kind,
    status: item.status,
    detail: [item.subtitle, item.conclusion].filter(Boolean).join(" · "),
    updated: timeLabel(item.updatedAt),
    log: item.logAvailable ? item.logLabel ?? "Available" : "",
    __url: item.url,
    __urlLabel: "Open",
  }));
}

function signalRows(signals: ObservabilitySignal[], accountsById: Map<string, Account>): DashboardTableRow[] {
  return signals.map((signal) => ({
    title: signal.title,
    account: accountLabel(accountsById, signal.accountId) ?? signal.accountId,
    kind: signal.kind,
    category: signal.category,
    status: signal.status,
    severity: signal.severity,
    updated: timeLabel(signal.updatedAt),
    detail: signal.subtitle,
    __url: signal.url,
    __urlLabel: "Open",
  }));
}

function incidentRows(incidents: ObservabilityIncident[], accountsById: Map<string, Account>): DashboardTableRow[] {
  return incidents.map((incident) => ({
    title: incident.title,
    account: accountLabel(accountsById, incident.accountId) ?? incident.accountId,
    status: incident.status,
    severity: incident.severity,
    updated: timeLabel(incident.updatedAt),
    detail: incident.subtitle,
    __url: incident.url,
    __urlLabel: "Open",
  }));
}

function currentRowsTableMeta(provider: Provider): { label: string; description: string } {
  switch (provider) {
    case "github":
      return { label: "Workflow runs", description: "GitHub workflow runs with status, branch, actor, and provider links where available." };
    case "cloudflare":
      return { label: "Pages and Workers activity", description: "Cloudflare deploys, worker status, zones, and current account signals exposed by the adapter." };
    case "netlify":
      return { label: "Site deploys", description: "Netlify deploy rows and site-level signals from the latest monitor snapshot." };
    case "heroku":
      return { label: "Apps and releases", description: "Heroku app release rows and current app health from connected accounts." };
    case "supabase":
      return { label: "Projects, migrations, and logs", description: "Supabase migration, log, and project health rows when enabled by account setup." };
    case "grafana":
      return { label: "Grafana alerts, data sources, dashboards, and annotations", description: "Grafana rows collected from alerting, data source health, dashboards, annotations, and live query setup." };
    case "sentry":
      return { label: "Issues and releases", description: "Sentry issue and error queue rows with provider evidence links." };
    case "posthog":
      return { label: "Errors and product signals", description: "PostHog exception and product telemetry rows from current polling." };
    case "pagerduty":
      return { label: "Services and incidents", description: "PagerDuty incident and service rows with current escalation status." };
    case "statuspage":
      return { label: "Components and incidents", description: "Statuspage component health and incident rows." };
    case "datadog":
      return { label: "Monitors and SLO signals", description: "Datadog monitor, metric, and SLO rows from readable scopes." };
    case "honeycomb":
      return { label: "Triggers and SLOs", description: "Honeycomb trigger and SLO rows with current firing state." };
    case "betterstack":
      return { label: "Monitors, incidents, and telemetry", description: "Better Stack monitor and incident rows from current polling." };
    case "resend":
      return { label: "Domains and broadcasts", description: "Resend domain, email, and broadcast rows with delivery/API evidence where available." };
    default:
      return { label: "Current provider rows", description: "Current normalized provider rows from the latest monitor snapshot." };
  }
}

function resourceTables(args: {
  provider: Provider;
  accounts: Account[];
  groupsById: Map<string, ProjectGroup>;
  snapshot: AggregateSnapshot;
  accountsById: Map<string, Account>;
  items: MonitorItem[];
  signals: ObservabilitySignal[];
  incidents: ObservabilityIncident[];
}): ProviderWorkspaceResourceTable[] {
  const currentRows = currentRowsTableMeta(args.provider);
  return [
    {
      id: "accounts",
      label: "Connected accounts",
      description: "Provider account records and current sync health. No secrets are included.",
      columns: ["account", "identity", "group", "enabled", "items", "lastSync", "stale", "error"],
      rows: accountRows(args.accounts, args.groupsById, args.snapshot),
      emptyDetail: "Connect a provider account to populate this table.",
    },
    {
      id: "items",
      label: currentRows.label,
      description: currentRows.description,
      columns: ["title", "account", "category", "kind", "status", "detail", "updated", "log"],
      rows: itemRows(args.items, args.accountsById),
      emptyDetail: "No current provider rows are available. Refresh the account or review setup diagnostics.",
    },
    {
      id: "signals",
      label: "Signals",
      description: "Current warning, failure, alert, issue, datasource, and status signals.",
      columns: ["title", "account", "kind", "category", "status", "severity", "updated", "detail"],
      rows: signalRows(args.signals, args.accountsById),
      emptyDetail: "No active provider signals.",
    },
    {
      id: "incidents",
      label: "Incidents",
      description: "Current provider incidents and issue-like rows.",
      columns: ["title", "account", "status", "severity", "updated", "detail"],
      rows: incidentRows(args.incidents, args.accountsById),
      emptyDetail: "No active provider incidents.",
    },
  ];
}

function appendContribution(base: ProviderWorkspaceContribution, next: ProviderWorkspaceContribution): ProviderWorkspaceContribution {
  return {
    series: [...(base.series ?? []), ...(next.series ?? [])],
    resources: [...(base.resources ?? []), ...(next.resources ?? [])],
    evidence: [...(base.evidence ?? []), ...(next.evidence ?? [])],
    alertTemplates: [...(base.alertTemplates ?? []), ...(next.alertTemplates ?? [])],
    warnings: [...(base.warnings ?? []), ...(next.warnings ?? [])],
  };
}

async function providerWorkspaceContribution(args: {
  provider: Provider;
  accounts: Account[];
  range: HistoryRange;
  items: MonitorItem[];
  signals: ObservabilitySignal[];
  incidents: ObservabilityIncident[];
  snapshot: AggregateSnapshot;
  samples: HistorySample[];
  events: HistoryEvent[];
}): Promise<ProviderWorkspaceContribution> {
  const definition = listProviderDefinitions().find((candidate) => candidate.id === args.provider);
  if (!definition?.buildWorkspace) return {};

  let contribution: ProviderWorkspaceContribution = {};
  for (const account of args.accounts) {
    const token = await getToken(account.id);
    if (!token) {
      contribution = appendContribution(contribution, {
        warnings: [`${account.label} cannot build ${definition.label} workspace enrichment because its secret is missing or unreadable.`],
      });
      continue;
    }

    try {
      const secret = secretField(account.provider);
      const accountItems = args.items.filter((item) => item.accountId === account.id);
      const accountSignals = args.signals.filter((signal) => signal.accountId === account.id);
      const accountIncidents = args.incidents.filter((incident) => incident.accountId === account.id);
      const next = await definition.buildWorkspace({
        account,
        range: args.range,
        items: accountItems,
        signals: accountSignals,
        incidents: accountIncidents,
        metrics: args.snapshot.metrics.filter((metric) => metric.accountId === account.id),
        deepLinks: args.snapshot.deepLinks.filter((link) => link.accountId === account.id),
        retainedSamples: args.samples.filter((sample) => Boolean(sample.perAccount[account.id])),
        retainedEvents: args.events.filter((event) => event.accountId === account.id),
      }, { ...(account.config ?? {}), [secret.key]: token });
      contribution = appendContribution(contribution, next);
    } catch (error) {
      contribution = appendContribution(contribution, {
        warnings: [`${account.label} workspace enrichment failed: ${error instanceof Error ? error.message : String(error)}`],
      });
    }
  }
  return contribution;
}

function evidenceRows(args: {
  accountsById: Map<string, Account>;
  events: HistoryEvent[];
  items: MonitorItem[];
  signals: ObservabilitySignal[];
  incidents: ObservabilityIncident[];
  snapshot: AggregateSnapshot;
  provider: Provider;
  accountId?: string;
}): ProviderWorkspaceEvidenceRow[] {
  const accountFilter = (accountId: string | undefined) => !args.accountId || accountId === args.accountId;
  const rows: ProviderWorkspaceEvidenceRow[] = [
    ...args.events.slice(0, 30).map((event) => ({
      id: `event:${event.id}`,
      ts: event.ts,
      type: "event" as const,
      title: event.title,
      subtitle: eventTypeLabel(event),
      status: event.status,
      severity: event.severity,
      accountId: event.accountId,
      accountLabel: accountLabel(args.accountsById, event.accountId),
      category: event.category,
      url: event.url,
      sourceUid: event.sourceUid,
    })),
    ...args.items.filter((item) => item.logAvailable || item.logFallbackUrl).slice(0, 20).map((item) => ({
      id: `item:${item.uid}`,
      ts: item.updatedAt,
      type: "item" as const,
      title: item.title,
      subtitle: [item.category, item.subtitle, item.logAvailable ? item.logLabel ?? "Logs available" : "Provider link"].filter(Boolean).join(" · "),
      status: item.status,
      accountId: item.accountId,
      accountLabel: accountLabel(args.accountsById, item.accountId),
      category: item.category,
      url: item.logFallbackUrl ?? item.url,
      logAvailable: item.logAvailable,
      sourceUid: item.uid,
    })),
    ...args.incidents.slice(0, 20).map((incident) => ({
      id: `incident:${incident.uid}`,
      ts: incident.updatedAt,
      type: "incident" as const,
      title: incident.title,
      subtitle: incident.subtitle,
      status: incident.status,
      severity: incident.severity,
      accountId: incident.accountId,
      accountLabel: accountLabel(args.accountsById, incident.accountId),
      url: incident.url,
      sourceUid: incident.sourceItemUid,
    })),
    ...args.signals.slice(0, 20).map((signal) => ({
      id: `signal:${signal.uid}`,
      ts: signal.updatedAt,
      type: "signal" as const,
      title: signal.title,
      subtitle: signal.subtitle,
      status: signal.status,
      severity: signal.severity,
      accountId: signal.accountId,
      accountLabel: accountLabel(args.accountsById, signal.accountId),
      category: signal.category,
      url: signal.url,
      sourceUid: signal.sourceItemUid,
    })),
    ...args.snapshot.deepLinks
      .filter((link) => link.provider === args.provider && accountFilter(link.accountId))
      .slice(0, 20)
      .map((link) => ({
        id: `link:${link.accountId}:${link.category}:${link.url}`,
        ts: args.snapshot.generatedAt,
        type: "link" as const,
        title: link.label,
        subtitle: "Provider deep link",
        accountId: link.accountId,
        accountLabel: accountLabel(args.accountsById, link.accountId),
        category: link.category,
        url: link.url,
      })),
  ];
  return rows
    .filter((row, index, all) => all.findIndex((candidate) => candidate.id === row.id) === index)
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
    .slice(0, 80);
}

function alertTemplates(provider: Provider, accountId?: string): ProviderWorkspaceAlertTemplate[] {
  const scope = accountId ? { accountId } : { provider };
  const label = providerLabel(provider);
  return [
    {
      id: `${provider}.failure-rate`,
      label: "Provider failures",
      description: "Fire when this provider has any failed normalized items.",
      rule: {
        name: `${label} failures`,
        metric: "failureRate",
        operator: "gt",
        threshold: 0,
        scope,
        enabled: true,
        forMinutes: 5,
        cooldownMinutes: 15,
        dedupeMinutes: 30,
      },
    },
    {
      id: `${provider}.open-incidents`,
      label: "Open incidents",
      description: "Fire when provider incidents or issue-like rows are open.",
      rule: {
        name: `${label} open incidents`,
        metric: "openIncidents",
        operator: "gt",
        threshold: 0,
        scope,
        enabled: true,
        minSeverity: "low",
        forMinutes: 0,
        cooldownMinutes: 30,
        dedupeMinutes: 60,
      },
    },
  ];
}

function stats(args: {
  accounts: Account[];
  items: MonitorItem[];
  signals: ObservabilitySignal[];
  incidents: ObservabilityIncident[];
  events: HistoryEvent[];
  snapshot: AggregateSnapshot;
}): ProviderWorkspaceStat[] {
  const failures = args.items.filter((item) => item.status === "failure").length;
  const warnings = args.items.filter((item) => item.status === "warning").length;
  const staleAccounts = args.accounts.filter((account) => args.snapshot.staleness[account.id]?.stale).length;
  const errors = args.accounts.filter((account) => args.snapshot.perAccount[account.id]?.lastError || account.lastError).length;
  return [
    { label: "Accounts", value: numberLabel(args.accounts.length), tone: args.accounts.some((account) => account.enabled) ? "info" : "neutral", detail: `${args.accounts.filter((account) => account.enabled).length} enabled` },
    { label: "Current rows", value: numberLabel(args.items.length), tone: failures > 0 ? "danger" : warnings > 0 ? "warning" : "success", detail: `${failures} failed, ${warnings} warning` },
    { label: "Open incidents", value: numberLabel(args.incidents.filter((incident) => incident.status !== "resolved").length), tone: args.incidents.length > 0 ? "danger" : "success", detail: `${args.signals.filter((signal) => signal.kind === "alert").length} alert signals` },
    { label: "Activity", value: numberLabel(args.events.length), tone: "info", detail: "events in selected range" },
    { label: "Setup issues", value: numberLabel(staleAccounts + errors), tone: staleAccounts + errors > 0 ? "warning" : "success", detail: `${staleAccounts} stale, ${errors} errors` },
  ];
}

async function baseContext() {
  const [accounts, groups] = await Promise.all([listAccounts(), listGroups()]);
  aggregator.setKnownAccounts(accounts, groups);
  const snapshot = aggregator.buildSnapshot();
  return {
    accounts,
    groups,
    snapshot,
    groupsById: new Map(groups.map((group) => [group.id, group])),
    accountsById: new Map(accounts.map((account) => [account.id, account])),
  };
}

export async function listWorkspaceCapabilities(): Promise<ProviderWorkspaceCapability[]> {
  const { accounts } = await baseContext();
  return listProviderDefinitions().map((definition) => {
    const matching = accounts.filter((account) => account.provider === definition.id);
    return {
      provider: definition.id,
      label: definition.label,
      accountCount: matching.length,
      enabledAccountCount: matching.filter((account) => account.enabled).length,
      sections: sectionsFor({
        accountCount: matching.length,
        sampleCount: 0,
        resourceCount: matching.length,
        evidenceCount: 0,
        warningCount: 0,
      }),
    };
  });
}

export async function getWorkspaceOverview(input: {
  provider: Provider;
  range: HistoryRange;
  accountId?: string;
}): Promise<ProviderWorkspaceOverview> {
  const { accounts, groupsById, accountsById, snapshot } = await baseContext();
  const scopedAccounts = providerAccounts(accounts, input.provider, input.accountId);
  const accountIds = new Set(scopedAccounts.map((account) => account.id));
  const [samples, events] = await Promise.all([
    getSeries(input.range, { provider: input.provider, accountId: input.accountId }),
    getEvents({ range: input.range, provider: input.provider, accountId: input.accountId }),
  ]);
  const items = snapshot.items.filter((item) => item.provider === input.provider && accountIds.has(item.accountId));
  const signals = snapshot.signals.filter((signal) => signal.provider === input.provider && accountIds.has(signal.accountId));
  const incidents = snapshot.incidents.filter((incident) => incident.provider === input.provider && accountIds.has(incident.accountId));
  const contribution = await providerWorkspaceContribution({
    provider: input.provider,
    accounts: scopedAccounts,
    range: input.range,
    items,
    signals,
    incidents,
    snapshot,
    samples,
    events,
  });
  const resources = [
    ...resourceTables({ provider: input.provider, accounts: scopedAccounts, groupsById, snapshot, accountsById, items, signals, incidents }),
    ...(contribution.resources ?? []),
  ];
  const evidence = evidenceRows({ accountsById, events, items, signals, incidents, snapshot, provider: input.provider, accountId: input.accountId });
  const warningCount = scopedAccounts.filter((account) => snapshot.staleness[account.id]?.stale || snapshot.perAccount[account.id]?.lastError || account.lastError).length;
  return {
    provider: input.provider,
    label: providerLabel(input.provider),
    generatedAt: snapshot.generatedAt,
    range: input.range,
    accountId: input.accountId,
    stats: stats({ accounts: scopedAccounts, items, signals, incidents, events, snapshot }),
    sections: sectionsFor({
      accountCount: scopedAccounts.length,
      sampleCount: samples.length,
      resourceCount: resources.reduce((sum, table) => sum + table.rows.length, 0),
      evidenceCount: evidence.length,
      warningCount,
    }),
    series: [statusSeries(samples), incidentAlertSeries(samples), activitySeries(events), ...(contribution.series ?? [])],
    resources,
    evidence: [...evidence, ...(contribution.evidence ?? [])],
    alertTemplates: [...alertTemplates(input.provider, input.accountId), ...(contribution.alertTemplates ?? [])],
    warnings: [
      scopedAccounts.length === 0 ? `No ${providerLabel(input.provider)} accounts are connected.` : undefined,
      samples.length === 0 ? "No retained history exists for this provider and range yet. Polling must run before charts populate." : undefined,
      warningCount > 0 ? `${warningCount} account${warningCount === 1 ? "" : "s"} have stale or erroring setup state.` : undefined,
      ...(contribution.warnings ?? []),
    ].filter((value): value is string => Boolean(value)),
  };
}

export function parseProvider(value: unknown): Provider {
  const provider = asProvider(value);
  if (!provider) throw new Error("Missing or invalid provider.");
  return provider;
}
