import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Bell, Download, ExternalLink, RefreshCw, Search } from "lucide-react";
import {
  ScrollArea,
  Button,
  EmptyState,
  Callout,
  Badge,
  Text,
  toast,
} from "@glaze/core/components";

import { AccountSection } from "./components/account-section";
import {
  ALL,
  CATEGORY_FILTER_OPTIONS,
  type AppliedFilter,
  FilterDateRangeField,
  FilterMenu,
  FilterSelectField,
  STATUS_FILTER_OPTIONS,
  dateRangeLabel,
  defaultDateRange,
  matchesDateRange,
  optionLabel,
  retainedHistoryDateBounds,
  sameDateRange,
  useStoredState,
} from "./components/filters";
import { LogViewerDialog } from "./components/log-viewer-dialog";
import { openInvestigation } from "./components/investigation";
import { formatRelativeTime } from "./components/relative-time";
import { providerIcon, providerLabel } from "./components/provider-meta";
import { useMonitorData } from "./hooks/use-monitor-data";
import { useAccounts, useGroups } from "./hooks/use-accounts";
import { useHistoryEvents, useHistoryStats } from "./hooks/use-history";
import { useProviders } from "./hooks/use-providers";
import { useServiceMetadata } from "./hooks/use-service-metadata";
import { monitorApi } from "./ipc";
import { downloadCsv } from "./utils/csv";
import type { Account, AggregateSnapshot, AlertRuleInput, HistoryEvent, MonitorCategory, MonitorItem, NormalizedStatus, ProjectGroup, Provider, ServiceHealth, ServiceMetadata, ServiceTier } from "./types";

type ProviderFilter = "all" | Provider;
type StatusFilter = "all" | NormalizedStatus;

const ALL_GROUPS = "all";
const UNGROUPED = "ungrouped";
const FILTER_KEY = "dashboard.filters.v2";
const FILTER_PRESET_KEY = `${FILTER_KEY}.presets`;
const DASHBOARD_ITEM_SELECT_EVENT = "dashboard:item-select";
const DASHBOARD_ITEM_SELECT_KEY = "dashboard.item.select.v1";
const ALERT_RULE_DRAFT_KEY = "alerts.draft.v1";

interface DashboardFilters {
  dateRange: ReturnType<typeof defaultDateRange>;
  group: string;
  provider: ProviderFilter;
  account: string;
  status: StatusFilter;
  category: "all" | MonitorCategory;
  owner: string;
  tier: "all" | ServiceTier;
  dependency: string;
}

const DEFAULT_FILTERS: DashboardFilters = {
  dateRange: defaultDateRange("24h"),
  group: ALL_GROUPS,
  provider: "all",
  account: ALL,
  status: "all",
  category: "all",
  owner: ALL,
  tier: "all",
  dependency: ALL,
};

const SERVICE_TIERS: { value: ServiceTier; label: string }[] = [
  { value: "critical", label: "Critical" },
  { value: "standard", label: "Standard" },
  { value: "internal", label: "Internal" },
  { value: "experimental", label: "Experimental" },
];

function matchesStatus(status: NormalizedStatus, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  return status === filter;
}

function matchesGroup(account: Account, groupsById: Map<string, ProjectGroup>, filter: string): boolean {
  if (filter === ALL_GROUPS) return true;
  const groupId = account.groupId && groupsById.has(account.groupId) ? account.groupId : UNGROUPED;
  return groupId === filter;
}

function serviceForAccount(services: ServiceHealth[], accountId: string | undefined): ServiceHealth | undefined {
  return accountId ? services.find((service) => service.accountIds.includes(accountId)) : undefined;
}

function metadataForAccount(account: Account, services: ServiceHealth[], metadataByService: Map<string, ServiceMetadata>): ServiceMetadata | undefined {
  const service = serviceForAccount(services, account.id);
  return metadataByService.get(service?.id ?? account.groupId ?? `account:${account.id}`);
}

function metadataForEvent(event: HistoryEvent, accountsById: Map<string, Account>, services: ServiceHealth[], metadataByService: Map<string, ServiceMetadata>): ServiceMetadata | undefined {
  const account = event.accountId ? accountsById.get(event.accountId) : undefined;
  const service = serviceForAccount(services, event.accountId);
  return metadataByService.get(service?.id ?? event.groupId ?? account?.groupId ?? (event.accountId ? `account:${event.accountId}` : ""));
}

function matchesEventGroup(event: HistoryEvent, account: Account | undefined, groupsById: Map<string, ProjectGroup>, filter: string): boolean {
  if (filter === ALL_GROUPS) return true;
  const groupId = event.groupId ?? account?.groupId;
  if (filter === UNGROUPED) return !groupId || !groupsById.has(groupId);
  return groupId === filter;
}

function matchesServiceMetadata(metadata: ServiceMetadata | undefined, filters: Pick<DashboardFilters, "owner" | "tier" | "dependency">): boolean {
  if (filters.owner !== ALL && metadata?.owner !== filters.owner) return false;
  if (filters.tier !== "all" && metadata?.tier !== filters.tier) return false;
  if (filters.dependency !== ALL && !metadata?.dependencies?.includes(filters.dependency)) return false;
  return true;
}

function metadataCells(metadata: ServiceMetadata | undefined): [string, string, string] {
  return [
    metadata?.owner ?? "",
    metadata?.tier ?? "",
    (metadata?.dependencies ?? []).join("; "),
  ];
}

function downloadDashboardCsv({
  visibleAccounts,
  itemsByAccount,
  activityEvents,
  accountsById,
  groupsById,
  services,
  metadataByService,
  snapshot,
}: {
  visibleAccounts: Account[];
  itemsByAccount: Map<string, MonitorItem[]>;
  activityEvents: HistoryEvent[];
  accountsById: Map<string, Account>;
  groupsById: Map<string, ProjectGroup>;
  services: ServiceHealth[];
  metadataByService: Map<string, ServiceMetadata>;
  snapshot: AggregateSnapshot | undefined;
}): void {
  const columns = [
    "rowType",
    "timestamp",
    "provider",
    "account",
    "accountId",
    "group",
    "groupId",
    "status",
    "category",
    "kindOrType",
    "title",
    "severity",
    "url",
    "owner",
    "tier",
    "dependencies",
    "detail",
  ];
  const rows: unknown[][] = [];
  for (const account of visibleAccounts) {
    const group = account.groupId ? groupsById.get(account.groupId) : undefined;
    const metadata = metadataForAccount(account, services, metadataByService);
    const accountStatus = snapshot?.perAccount[account.id];
    const staleness = snapshot?.staleness[account.id];
    const accountSummaryStatus = !account.enabled ? "disabled" : accountStatus?.lastError ? "failure" : staleness?.stale ? "warning" : "success";
    rows.push([
      "account",
      accountStatus?.lastSyncAt ?? account.lastSyncAt ?? account.createdAt,
      providerLabel(account.provider),
      account.label,
      account.id,
      group?.name ?? "",
      account.groupId ?? "",
      accountSummaryStatus,
      "",
      "account",
      account.identity ?? account.label,
      "",
      "",
      ...metadataCells(metadata),
      [accountStatus?.lastError, staleness?.stale ? `stale: ${staleness.reason ?? "yes"}` : undefined].filter(Boolean).join(" · "),
    ]);
    for (const item of itemsByAccount.get(account.id) ?? []) {
      rows.push([
        "monitor_item",
        item.updatedAt,
        providerLabel(item.provider),
        account.label,
        account.id,
        group?.name ?? "",
        account.groupId ?? "",
        item.status,
        item.category,
        item.kind,
        item.title,
        "",
        item.url,
        ...metadataCells(metadata),
        [item.subtitle, item.conclusion].filter(Boolean).join(" · "),
      ]);
    }
  }
  for (const event of activityEvents) {
    const account = accountsById.get(event.accountId);
    const groupId = event.groupId ?? account?.groupId;
    const metadata = metadataForEvent(event, accountsById, services, metadataByService);
    rows.push([
      "history_event",
      event.ts,
      providerLabel(event.provider),
      account?.label ?? "",
      event.accountId,
      groupId ? groupsById.get(groupId)?.name ?? "" : "",
      groupId ?? "",
      event.status,
      event.category ?? "",
      event.type,
      event.title,
      event.severity,
      event.url,
      ...metadataCells(metadata),
      event.sourceUid ?? "",
    ]);
  }
  downloadCsv(`dashboard-${new Date().toISOString().slice(0, 10)}.csv`, columns, rows);
}

function alertRuleDraftFromMonitorItem(item: MonitorItem, account: Account | undefined): AlertRuleInput {
  return {
    name: `Failures: ${account?.label ?? providerLabel(item.provider)}`,
    metric: "failureRate",
    operator: "gt",
    threshold: 0,
    scope: item.accountId ? { accountId: item.accountId } : { provider: item.provider },
    enabled: true,
    forMinutes: 5,
    cooldownMinutes: 15,
    dedupeMinutes: 30,
  };
}

function alertRuleDraftFromHistoryEvent(event: HistoryEvent, account: Account | undefined): AlertRuleInput | null {
  const scope = event.accountId ? { accountId: event.accountId } : { provider: event.provider };
  if (event.type === "alert" || event.type === "incident") {
    return {
      name: `Open incidents: ${account?.label ?? providerLabel(event.provider)}`,
      metric: "openIncidents",
      operator: "gt",
      threshold: 0,
      scope,
      enabled: true,
      minSeverity: event.severity,
      forMinutes: 0,
      cooldownMinutes: 15,
      dedupeMinutes: 30,
    };
  }
  if (event.type === "failure") {
    return {
      name: `Failures: ${account?.label ?? providerLabel(event.provider)}`,
      metric: "failureRate",
      operator: "gt",
      threshold: 0,
      scope,
      enabled: true,
      forMinutes: 5,
      cooldownMinutes: 15,
      dedupeMinutes: 30,
    };
  }
  return null;
}

function readDashboardItemPayload(value: unknown): { itemUid: string; action: "logs" } | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { itemUid?: unknown; action?: unknown };
  if (typeof candidate.itemUid !== "string" || candidate.action !== "logs") return null;
  return { itemUid: candidate.itemUid, action: "logs" };
}

function EventRow({
  event,
  account,
  onInvestigate,
  onCreateAlertRule,
}: {
  event: HistoryEvent;
  account: Account | undefined;
  onInvestigate: (event: HistoryEvent) => void;
  onCreateAlertRule: (event: HistoryEvent) => void;
}) {
  const Icon = providerIcon(event.provider);
  const canCreateAlertRule = event.type === "alert" || event.type === "incident" || event.type === "failure";
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 border-t border-separator py-2 first:border-t-0 sm:grid-cols-[7rem_minmax(0,1fr)_auto]">
      <Text variant="small" color="tertiary" className="tabular-nums">{formatRelativeTime(event.ts)}</Text>
      <div className="flex min-w-0 items-center gap-2">
        <Icon className="size-4 shrink-0 text-tertiary" />
        <div className="min-w-0">
          <Text variant="strong" truncate className="block">{event.title}</Text>
          <Text variant="small" color="secondary" truncate className="block">
            {account?.label ?? providerLabel(event.provider)} · {event.type} · {event.status}
          </Text>
        </div>
      </div>
      <div className="col-start-2 flex items-center justify-end gap-1 sm:col-start-auto">
        <Button variant="transparent" size="small" iconOnly aria-label="Start investigation" title="Start investigation" onClick={() => onInvestigate(event)}>
          <Search className="size-4" />
        </Button>
        {canCreateAlertRule ? (
          <Button variant="transparent" size="small" iconOnly aria-label="Create alert rule" title="Create alert rule" onClick={() => onCreateAlertRule(event)}>
            <Bell className="size-4" />
          </Button>
        ) : null}
        <Button variant="transparent" size="small" iconOnly aria-label="Open event" onClick={() => void monitorApi.openExternal(event.url).catch((err) => toast.error(String(err)))}>
          <ExternalLink className="size-4" />
        </Button>
      </div>
    </div>
  );
}

export function DashboardView() {
  const navigate = useNavigate();
  const snapshotQuery = useMonitorData();
  const accountsQuery = useAccounts();
  const groupsQuery = useGroups();
  const providersQuery = useProviders();
  const serviceMetadataQuery = useServiceMetadata();
  const historyStatsQuery = useHistoryStats();

  const [storedFilters, setFilters, resetFilters] = useStoredState<DashboardFilters>(FILTER_KEY, DEFAULT_FILTERS);
  const filters: DashboardFilters = { ...DEFAULT_FILTERS, ...storedFilters, dateRange: storedFilters.dateRange ?? DEFAULT_FILTERS.dateRange };
  const dateBounds = retainedHistoryDateBounds(historyStatsQuery.data);
  const [refreshing, setRefreshing] = useState(false);
  const [logItem, setLogItem] = useState<MonitorItem | null>(null);

  const setFilter = <K extends keyof DashboardFilters>(key: K, value: DashboardFilters[K]) => setFilters({ ...filters, [key]: value });

  const handleOpen = (item: MonitorItem) => {
    void monitorApi.openExternal(item.url).catch((err) => toast.error(String(err)));
  };

  const handleViewLogs = (item: MonitorItem) => {
    if (item.logAvailable) {
      setLogItem(item);
      return;
    }
    const fallback = item.logFallbackUrl ?? item.url;
    void monitorApi.openExternal(fallback).catch((err) => toast.error(String(err)));
  };

  const handleInvestigate = (item: MonitorItem) => {
    openInvestigation({ kind: "item", itemUid: item.uid, accountId: item.accountId, provider: item.provider, title: item.title, subtitle: item.subtitle, ts: item.updatedAt, url: item.url });
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await monitorApi.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  };

  const accounts = accountsQuery.data ?? [];
  const groups = groupsQuery.data ?? [];
  const snapshot = snapshotQuery.data;
  const services = snapshot?.services ?? [];

  const applyItemPayload = (payload: { itemUid: string; action: "logs" }) => {
    const item = snapshot?.items.find((candidate) => candidate.uid === payload.itemUid);
    if (!item) return false;
    handleViewLogs(item);
    return true;
  };

  useEffect(() => {
    if (!snapshot) return;
    const raw = localStorage.getItem(DASHBOARD_ITEM_SELECT_KEY);
    if (!raw) return;
    try {
      const payload = readDashboardItemPayload(JSON.parse(raw));
      if (!payload) {
        localStorage.removeItem(DASHBOARD_ITEM_SELECT_KEY);
        return;
      }
      if (applyItemPayload(payload)) localStorage.removeItem(DASHBOARD_ITEM_SELECT_KEY);
    } catch {
      localStorage.removeItem(DASHBOARD_ITEM_SELECT_KEY);
    }
  }, [snapshot]);

  useEffect(() => {
    const onSelect = (event: Event) => {
      const payload = readDashboardItemPayload((event as CustomEvent).detail);
      if (!payload) return;
      if (applyItemPayload(payload)) localStorage.removeItem(DASHBOARD_ITEM_SELECT_KEY);
    };
    window.addEventListener(DASHBOARD_ITEM_SELECT_EVENT, onSelect);
    return () => window.removeEventListener(DASHBOARD_ITEM_SELECT_EVENT, onSelect);
  }, [snapshot]);

  const groupsById = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups]);
  const accountsById = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts]);
  const metadataByService = useMemo(() => new Map((serviceMetadataQuery.data ?? []).map((metadata) => [metadata.serviceId, metadata])), [serviceMetadataQuery.data]);
  const handleCreateAlertRule = (item: MonitorItem) => {
    localStorage.setItem(ALERT_RULE_DRAFT_KEY, JSON.stringify(alertRuleDraftFromMonitorItem(item, accountsById.get(item.accountId))));
    void navigate({ to: "/alerts" });
  };
  const handleInvestigateEvent = (event: HistoryEvent) => {
    openInvestigation({ kind: "event", eventId: event.id, accountId: event.accountId, provider: event.provider, groupId: event.groupId, title: event.title, ts: event.ts, url: event.url });
  };
  const handleCreateAlertRuleFromEvent = (event: HistoryEvent) => {
    const draft = alertRuleDraftFromHistoryEvent(event, accountsById.get(event.accountId));
    if (!draft) return;
    localStorage.setItem(ALERT_RULE_DRAFT_KEY, JSON.stringify(draft));
    void navigate({ to: "/alerts" });
  };
  const eventQuery = useHistoryEvents({
    range: filters.dateRange,
    groupId: undefined,
    accountId: filters.account === ALL ? undefined : filters.account,
    provider: filters.provider === "all" ? undefined : filters.provider,
    status: filters.status === "all" ? undefined : filters.status,
    category: filters.category === "all" ? undefined : filters.category,
  });

  const itemsByAccount = new Map<string, MonitorItem[]>();
  for (const item of snapshot?.items ?? []) {
    if (!matchesStatus(item.status, filters.status)) continue;
    if (filters.category !== "all" && item.category !== filters.category) continue;
    if (!matchesDateRange(item.updatedAt, filters.dateRange)) continue;
    const list = itemsByAccount.get(item.accountId) ?? [];
    list.push(item);
    itemsByAccount.set(item.accountId, list);
  }

  const visibleAccounts = accounts.filter(
    (a) =>
      (filters.provider === "all" || a.provider === filters.provider) &&
      (filters.account === ALL || a.id === filters.account) &&
      matchesGroup(a, groupsById, filters.group) &&
      matchesServiceMetadata(metadataForAccount(a, services, metadataByService), filters) &&
      (filters.status === "all" && filters.category === "all" ? true : (itemsByAccount.get(a.id)?.length ?? 0) > 0),
  );

  const activityEvents = (eventQuery.data ?? []).filter((event) => {
    const account = accountsById.get(event.accountId);
    if (!matchesEventGroup(event, account, groupsById, filters.group)) return false;
    if (!matchesServiceMetadata(metadataForEvent(event, accountsById, services, metadataByService), filters)) return false;
    return true;
  });

  const accountsByGroup = new Map<string, Account[]>();
  for (const account of visibleAccounts) {
    const groupId = account.groupId && groupsById.has(account.groupId) ? account.groupId : UNGROUPED;
    const list = accountsByGroup.get(groupId) ?? [];
    list.push(account);
    accountsByGroup.set(groupId, list);
  }

  const visibleGroups = [
    ...groups
      .map((group) => ({ id: group.id, title: group.name, accounts: accountsByGroup.get(group.id) ?? [] }))
      .filter((group) => group.accounts.length > 0),
    { id: UNGROUPED, title: "Ungrouped", accounts: accountsByGroup.get(UNGROUPED) ?? [] },
  ].filter((group) => group.accounts.length > 0);

  const groupOptions = [{ value: ALL_GROUPS, label: "All groups" }, { value: UNGROUPED, label: "Ungrouped" }, ...groups.map((group) => ({ value: group.id, label: group.name }))];
  const providerOptions = [{ value: "all", label: "All providers" }, ...(providersQuery.data ?? []).map((p) => ({ value: p.id, label: p.label }))];
  const accountOptions = [{ value: ALL, label: "All accounts" }, ...accounts.map((account) => ({ value: account.id, label: account.label }))];
  const ownerOptions = [
    { value: ALL, label: "All owners" },
    ...[...new Set((serviceMetadataQuery.data ?? []).map((metadata) => metadata.owner).filter((owner): owner is string => Boolean(owner)))]
      .sort((a, b) => a.localeCompare(b))
      .map((owner) => ({ value: owner, label: owner })),
  ];
  const tierOptions = [{ value: "all", label: "All tiers" }, ...SERVICE_TIERS];
  const dependencyOptions = [
    { value: ALL, label: "All dependencies" },
    ...[...new Set((serviceMetadataQuery.data ?? []).flatMap((metadata) => metadata.dependencies ?? []))]
      .sort((a, b) => a.localeCompare(b))
      .map((dependency) => ({ value: dependency, label: dependency })),
  ];
  const activeFilters: AppliedFilter[] = [
    !sameDateRange(filters.dateRange, DEFAULT_FILTERS.dateRange)
      ? { id: "dateRange", label: "Range", value: dateRangeLabel(filters.dateRange), onClear: () => setFilter("dateRange", DEFAULT_FILTERS.dateRange) }
      : null,
    filters.group !== DEFAULT_FILTERS.group
      ? { id: "group", label: "Group", value: optionLabel(groupOptions, filters.group), onClear: () => setFilter("group", DEFAULT_FILTERS.group) }
      : null,
    filters.provider !== DEFAULT_FILTERS.provider
      ? { id: "provider", label: "Provider", value: optionLabel(providerOptions, filters.provider), onClear: () => setFilter("provider", DEFAULT_FILTERS.provider) }
      : null,
    filters.account !== DEFAULT_FILTERS.account
      ? { id: "account", label: "Account", value: optionLabel(accountOptions, filters.account), onClear: () => setFilter("account", DEFAULT_FILTERS.account) }
      : null,
    filters.status !== DEFAULT_FILTERS.status
      ? { id: "status", label: "Status", value: optionLabel(STATUS_FILTER_OPTIONS, filters.status), onClear: () => setFilter("status", DEFAULT_FILTERS.status) }
      : null,
    filters.category !== DEFAULT_FILTERS.category
      ? { id: "category", label: "Category", value: optionLabel(CATEGORY_FILTER_OPTIONS, filters.category), onClear: () => setFilter("category", DEFAULT_FILTERS.category) }
      : null,
    filters.owner !== DEFAULT_FILTERS.owner
      ? { id: "owner", label: "Owner", value: optionLabel(ownerOptions, filters.owner), onClear: () => setFilter("owner", DEFAULT_FILTERS.owner) }
      : null,
    filters.tier !== DEFAULT_FILTERS.tier
      ? { id: "tier", label: "Tier", value: optionLabel(tierOptions, filters.tier), onClear: () => setFilter("tier", DEFAULT_FILTERS.tier) }
      : null,
    filters.dependency !== DEFAULT_FILTERS.dependency
      ? { id: "dependency", label: "Dependency", value: optionLabel(dependencyOptions, filters.dependency), onClear: () => setFilter("dependency", DEFAULT_FILTERS.dependency) }
      : null,
  ].filter((filter): filter is AppliedFilter => filter !== null);
  const exportDashboard = () => {
    downloadDashboardCsv({
      visibleAccounts,
      itemsByAccount,
      activityEvents,
      accountsById,
      groupsById,
      services,
      metadataByService,
      snapshot,
    });
    const itemCount = visibleAccounts.reduce((count, account) => count + (itemsByAccount.get(account.id)?.length ?? 0), 0);
    toast.success(`Exported ${visibleAccounts.length} accounts, ${itemCount} monitor rows, and ${activityEvents.length} activity events`);
  };

  const actions = (
    <div className="flex min-w-0 items-center gap-2 flex-wrap justify-end">
      <Button variant="glass" size="small" onClick={exportDashboard} disabled={visibleAccounts.length === 0 && activityEvents.length === 0}>
        <Download className="size-4" />
        Export CSV
      </Button>
      <FilterMenu
        filters={activeFilters}
        onReset={resetFilters}
        presetKey={FILTER_PRESET_KEY}
        presetValue={filters}
        onApplyPreset={(value) => setFilters({ ...DEFAULT_FILTERS, ...value, dateRange: value.dateRange ?? DEFAULT_FILTERS.dateRange })}
      >
        <FilterDateRangeField label="Range" value={filters.dateRange} onChange={(value) => setFilter("dateRange", value)} bounds={dateBounds} />
        <FilterSelectField label="Group" value={filters.group} onChange={(value) => setFilter("group", value)} options={groupOptions} />
        <FilterSelectField label="Provider" value={filters.provider} onChange={(value) => setFilter("provider", value as ProviderFilter)} options={providerOptions} />
        <FilterSelectField label="Account" value={filters.account} onChange={(value) => setFilter("account", value)} options={accountOptions} />
        <FilterSelectField label="Status" value={filters.status} onChange={(value) => setFilter("status", value as StatusFilter)} options={STATUS_FILTER_OPTIONS} />
        <FilterSelectField label="Category" value={filters.category} onChange={(value) => setFilter("category", value as DashboardFilters["category"])} options={CATEGORY_FILTER_OPTIONS} />
        <FilterSelectField label="Owner" value={filters.owner} onChange={(value) => setFilter("owner", value)} options={ownerOptions} />
        <FilterSelectField label="Tier" value={filters.tier} onChange={(value) => setFilter("tier", value as DashboardFilters["tier"])} options={tierOptions} />
        <FilterSelectField label="Dependency" value={filters.dependency} onChange={(value) => setFilter("dependency", value)} options={dependencyOptions} />
      </FilterMenu>
      <Button variant="glass" size="large" iconOnly aria-label="Refresh" onClick={handleRefresh} disabled={refreshing}>
        <RefreshCw className={`size-4.5 ${refreshing ? "animate-spin" : ""}`} />
      </Button>
    </div>
  );

  return (
    <ScrollArea title="Dashboard" actions={actions} className="h-full">
      <div className="px-2 pb-8 flex flex-col gap-6">
        {accounts.length === 0 ? (
          <EmptyState
            title="No accounts connected"
            description="Connect provider accounts to start monitoring cross-app health."
            actions={<Button variant="accent" onClick={() => navigate({ to: "/accounts" })}>Add account</Button>}
          />
        ) : visibleGroups.length === 0 ? (
          <Callout color="secondary">
            <div className="flex items-center justify-between gap-3">
              <Text variant="small">No accounts match the current filters.</Text>
              <Button variant="glass" size="small" onClick={resetFilters}>Reset filters</Button>
            </div>
          </Callout>
        ) : (
          visibleGroups.map((group) => (
            <section key={group.id} className="flex flex-col gap-3">
              <div className="flex items-center gap-2 px-2">
                <Text variant="strong">{group.title}</Text>
                <Badge color="secondary">{group.accounts.length}</Badge>
              </div>
              <div className="flex flex-col gap-6">
                {group.accounts.map((account) => (
                  <AccountSection
                    key={account.id}
                    account={account}
                    status={snapshot?.perAccount[account.id]}
                    items={itemsByAccount.get(account.id) ?? []}
                    onOpen={handleOpen}
                    onViewLogs={handleViewLogs}
                    onInvestigate={handleInvestigate}
                    onCreateAlertRule={handleCreateAlertRule}
                  />
                ))}
              </div>
            </section>
          ))
        )}

        {accounts.length > 0 ? (
          <section className="flex flex-col gap-2">
            <div className="flex items-center gap-2 px-2">
              <Text variant="strong">Activity in range</Text>
              <Badge color="secondary">{activityEvents.length}</Badge>
            </div>
            <div className="rounded-lg border border-separator p-3">
              {activityEvents.length === 0 ? (
                <Callout color="secondary">
                  <div className="flex items-center justify-between gap-3">
                    <Text variant="small">No persisted activity matches the current filters.</Text>
                    <Button variant="glass" size="small" onClick={resetFilters}>Reset filters</Button>
                  </div>
                </Callout>
              ) : (
                <div className="flex flex-col">
                  {activityEvents.slice(0, 80).map((event) => (
                    <EventRow
                      key={event.id}
                      event={event}
                      account={accountsById.get(event.accountId)}
                      onInvestigate={handleInvestigateEvent}
                      onCreateAlertRule={handleCreateAlertRuleFromEvent}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>
        ) : null}

        {accounts.length > 0 && !snapshot ? (
          <Callout color="secondary">Fetching the latest runs and deployments…</Callout>
        ) : null}
      </div>
      <LogViewerDialog item={logItem} open={logItem !== null} onOpenChange={(open) => !open && setLogItem(null)} />
    </ScrollArea>
  );
}
