/**
 * In-memory cache of the latest normalized items across all accounts.
 * Holds the last snapshot and rebuilds it as accounts are (re)fetched.
 */

import type {
  Account,
  AccountStaleness,
  AggregateSnapshot,
  HttpCheckResult,
  MetricsSummary,
  MonitorItem,
  NormalizedStatus,
  ObservabilityIncident,
  ObservabilitySeverity,
  ObservabilitySignal,
  PerAccountStatus,
  ProjectGroup,
  ProviderDeepLink,
  SignalKind,
} from "./types.js";

const MAX_ITEMS_PER_ACCOUNT = 50;
const STALE_AFTER_MS = 5 * 60 * 1000;

// accountId -> its most recent items (already capped, newest-first)
const itemsByAccount = new Map<string, MonitorItem[]>();
const signalsByAccount = new Map<string, ObservabilitySignal[]>();
const incidentsByAccount = new Map<string, ObservabilityIncident[]>();
const metricsByAccount = new Map<string, MetricsSummary[]>();
const deepLinksByAccount = new Map<string, ProviderDeepLink[]>();
const perAccount = new Map<string, PerAccountStatus>();
let knownAccounts: Account[] = [];
let knownGroups: ProjectGroup[] = [];
let lastCheckResults: HttpCheckResult[] = [];

/** Priority for computing the worst/most-relevant aggregate status. */
const STATUS_PRIORITY: NormalizedStatus[] = [
  "failure",
  "warning",
  "running",
  "queued",
  "success",
  "info",
  "cancelled",
  "unknown",
];

function worstStatus(items: MonitorItem[]): NormalizedStatus {
  for (const status of STATUS_PRIORITY) {
    if (items.some((i) => i.status === status)) return status;
  }
  return "unknown";
}

function severityForStatus(status: NormalizedStatus): ObservabilitySeverity {
  switch (status) {
    case "failure":
      return "critical";
    case "warning":
      return "high";
    case "running":
    case "queued":
      return "medium";
    case "success":
    case "info":
      return "info";
    default:
      return "low";
  }
}

function signalKindForItem(item: MonitorItem): SignalKind {
  switch (item.category) {
    case "alert":
      return "alert";
    case "deploy":
    case "release":
      return "deploy";
    case "run":
      return "run";
    case "log":
      return "log";
    case "datasource":
      return "datasource";
    case "issue":
      return "issue";
    case "domain":
    case "statuspage":
      return "status";
    case "metric":
      return "metric";
    case "slo":
      return "slo";
    default:
      return "other";
  }
}

function incidentStatusForItem(item: MonitorItem): ObservabilityIncident["status"] {
  if (item.status === "success" || item.status === "cancelled") return "resolved";
  if (item.status === "running" || item.status === "queued") return "acknowledged";
  if (item.status === "failure" || item.status === "warning") return "open";
  return "unknown";
}

function itemIsSignal(item: MonitorItem): boolean {
  return item.status === "failure" || item.status === "warning" || item.category === "alert" || item.category === "log" ||
    item.category === "datasource" || item.category === "domain" || item.category === "incident" || item.category === "issue" ||
    item.category === "monitor" || item.category === "slo" || item.category === "statuspage";
}

function itemIsIncident(item: MonitorItem): boolean {
  if (item.category === "incident" || item.category === "issue") return item.status !== "success" && item.status !== "info";
  return item.status === "failure" && (item.category === "alert" || item.category === "deploy" || item.category === "run" ||
    item.category === "log" || item.category === "monitor");
}

function signalsFromItems(items: MonitorItem[]): ObservabilitySignal[] {
  return items.filter(itemIsSignal).map((item) => ({
    uid: `${item.uid}:signal`,
    accountId: item.accountId,
    provider: item.provider,
    kind: signalKindForItem(item),
    category: item.category,
    title: item.title,
    subtitle: item.subtitle,
    status: item.status,
    severity: severityForStatus(item.status),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    url: item.url,
    sourceItemUid: item.uid,
  }));
}

function incidentsFromItems(items: MonitorItem[]): ObservabilityIncident[] {
  return items.filter(itemIsIncident).map((item) => ({
    uid: `${item.uid}:incident`,
    accountId: item.accountId,
    provider: item.provider,
    title: item.title,
    subtitle: item.subtitle,
    status: incidentStatusForItem(item),
    severity: severityForStatus(item.status),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    url: item.url,
    sourceItemUid: item.uid,
  }));
}

function deepLinksFromItems(items: MonitorItem[]): ProviderDeepLink[] {
  const seen = new Set<string>();
  const links: ProviderDeepLink[] = [];
  for (const item of items) {
    const key = `${item.accountId}:${item.provider}:${item.category}:${item.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({
      accountId: item.accountId,
      provider: item.provider,
      label: item.title,
      url: item.url,
      category: item.category,
    });
  }
  return links.slice(0, 12);
}

function uniqueByUid<T extends { uid: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.uid)) return false;
    seen.add(row.uid);
    return true;
  });
}

export function setKnownAccounts(accounts: Account[], groups: ProjectGroup[] = knownGroups): void {
  knownAccounts = accounts;
  knownGroups = groups;
}

/** Latest uptime-check results, included in every snapshot. */
export function setCheckResults(results: HttpCheckResult[]): void {
  lastCheckResults = results;
}

export function setAccountData(
  accountId: string,
  items: MonitorItem[],
  lastSyncAt: string,
  extras: {
    signals?: ObservabilitySignal[];
    incidents?: ObservabilityIncident[];
    metrics?: MetricsSummary[];
    deepLinks?: ProviderDeepLink[];
  } = {},
): void {
  const sorted = [...items]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, MAX_ITEMS_PER_ACCOUNT);
  itemsByAccount.set(accountId, sorted);
  signalsByAccount.set(accountId, uniqueByUid([...(extras.signals ?? []), ...signalsFromItems(sorted)]));
  incidentsByAccount.set(accountId, uniqueByUid([...(extras.incidents ?? []), ...incidentsFromItems(sorted)]));
  metricsByAccount.set(accountId, extras.metrics ?? []);
  deepLinksByAccount.set(accountId, [...(extras.deepLinks ?? []), ...deepLinksFromItems(sorted)]);
  perAccount.set(accountId, { count: sorted.length, lastSyncAt, lastError: undefined });
}

export function setAccountItems(accountId: string, items: MonitorItem[], lastSyncAt: string): void {
  setAccountData(accountId, items, lastSyncAt);
}

export function setAccountError(accountId: string, error: string, lastSyncAt: string): void {
  const existing = perAccount.get(accountId);
  perAccount.set(accountId, { count: existing?.count ?? 0, lastError: error, lastSyncAt });
}

export function removeAccount(accountId: string): void {
  itemsByAccount.delete(accountId);
  signalsByAccount.delete(accountId);
  incidentsByAccount.delete(accountId);
  metricsByAccount.delete(accountId);
  deepLinksByAccount.delete(accountId);
  perAccount.delete(accountId);
}

/** Keep the cache in sync with the set of currently-known account ids. */
export function pruneToAccounts(accountIds: Set<string>): void {
  for (const id of [...itemsByAccount.keys()]) {
    if (!accountIds.has(id)) itemsByAccount.delete(id);
  }
  for (const id of [...signalsByAccount.keys()]) {
    if (!accountIds.has(id)) signalsByAccount.delete(id);
  }
  for (const id of [...incidentsByAccount.keys()]) {
    if (!accountIds.has(id)) incidentsByAccount.delete(id);
  }
  for (const id of [...metricsByAccount.keys()]) {
    if (!accountIds.has(id)) metricsByAccount.delete(id);
  }
  for (const id of [...deepLinksByAccount.keys()]) {
    if (!accountIds.has(id)) deepLinksByAccount.delete(id);
  }
  for (const id of [...perAccount.keys()]) {
    if (!accountIds.has(id)) perAccount.delete(id);
  }
}

function buildStaleness(nowMs: number): Record<string, AccountStaleness> {
  const staleness: Record<string, AccountStaleness> = {};
  for (const account of knownAccounts) {
    const status = perAccount.get(account.id);
    if (!account.enabled) {
      staleness[account.id] = { accountId: account.id, stale: false, reason: "disabled" };
      continue;
    }
    if (!status?.lastSyncAt) {
      staleness[account.id] = { accountId: account.id, stale: true, reason: "never synced" };
      continue;
    }
    const ageSeconds = Math.max(0, Math.floor((nowMs - new Date(status.lastSyncAt).getTime()) / 1000));
    const stale = ageSeconds * 1000 > STALE_AFTER_MS;
    staleness[account.id] = {
      accountId: account.id,
      stale,
      lastSyncAt: status.lastSyncAt,
      ageSeconds,
      reason: stale ? "stale" : undefined,
    };
  }
  return staleness;
}

function serviceIdForAccount(account: Account): string {
  return account.groupId ?? `account:${account.id}`;
}

function buildServices(
  allItems: MonitorItem[],
  allSignals: ObservabilitySignal[],
  allIncidents: ObservabilityIncident[],
  allDeepLinks: ProviderDeepLink[],
  staleness: Record<string, AccountStaleness>,
  generatedAt: string,
): AggregateSnapshot["services"] {
  const groupsById = new Map(knownGroups.map((group) => [group.id, group]));
  const accountsByService = new Map<string, Account[]>();
  for (const account of knownAccounts) {
    const id = serviceIdForAccount(account);
    const list = accountsByService.get(id) ?? [];
    list.push(account);
    accountsByService.set(id, list);
  }

  return [...accountsByService.entries()].map(([id, accounts]) => {
    const accountIds = new Set(accounts.map((account) => account.id));
    const items = allItems.filter((item) => accountIds.has(item.accountId));
    const signals = allSignals.filter((signal) => accountIds.has(signal.accountId));
    const incidents = allIncidents.filter((incident) => accountIds.has(incident.accountId) && incident.status !== "resolved");
    const deploys = items.filter((item) => item.category === "deploy" || item.category === "release");
    const updatedAt = items[0]?.updatedAt ?? accounts[0]?.lastSyncAt ?? generatedAt;
    const groupId = accounts.find((account) => account.groupId)?.groupId;
    const group = groupId ? groupsById.get(groupId) : undefined;
    return {
      id,
      name: group?.name ?? accounts[0]?.label ?? "Ungrouped service",
      groupId,
      accountIds: accounts.map((account) => account.id),
      providerIds: [...new Set(accounts.map((account) => account.provider))],
      status: worstStatus(items),
      lastDeployAt: deploys[0]?.updatedAt,
      openIncidentCount: incidents.length,
      alertCount: signals.filter((signal) => signal.kind === "alert").length,
      signalCount: signals.length,
      staleAccountCount: accounts.filter((account) => staleness[account.id]?.stale).length,
      updatedAt,
      deepLinks: allDeepLinks.filter((link) => accountIds.has(link.accountId)).slice(0, 8),
    };
  }).sort((a, b) => {
    const statusDelta = STATUS_PRIORITY.indexOf(a.status) - STATUS_PRIORITY.indexOf(b.status);
    if (statusDelta !== 0) return statusDelta;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

export function buildSnapshot(): AggregateSnapshot {
  const generatedAt = new Date().toISOString();
  const nowMs = new Date(generatedAt).getTime();
  const allItems: MonitorItem[] = [];
  for (const items of itemsByAccount.values()) allItems.push(...items);
  allItems.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  const signals = [...signalsByAccount.values()].flat()
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  const incidents = [...incidentsByAccount.values()].flat()
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  const metrics = [...metricsByAccount.values()].flat()
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  const deepLinks = [...deepLinksByAccount.values()].flat();
  const staleness = buildStaleness(nowMs);

  const perAccountObj: Record<string, PerAccountStatus> = {};
  for (const [id, status] of perAccount.entries()) perAccountObj[id] = status;

  // Aggregate status is driven by the most recent active items only.
  return {
    items: allItems,
    services: buildServices(allItems, signals, incidents, deepLinks, staleness, generatedAt),
    signals,
    incidents,
    metrics,
    deepLinks,
    staleness,
    perAccount: perAccountObj,
    checks: lastCheckResults,
    aggregateStatus: worstStatus(allItems),
    generatedAt,
  };
}
