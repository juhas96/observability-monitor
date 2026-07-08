import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Bell, Clock3, Download, ExternalLink, GitBranch, GitCommitHorizontal, RefreshCw, Rocket, ScrollText, Search } from "lucide-react";
import { Badge, Button, Callout, Input, Text, toast } from "@glaze/core/components";

import {
  ALL,
  STATUS_FILTER_OPTIONS,
  dateRangeLabel,
  defaultDateRange,
  matchesDateRange,
  optionLabel,
  retainedHistoryDateBounds,
  sameDateRange,
  type AppliedFilter,
  FilterDateRangeField,
  FilterMenu,
  FilterSelectField,
  useStoredState,
} from "./components/filters";
import { LogViewerDialog } from "./components/log-viewer-dialog";
import { formatRelativeTime } from "./components/relative-time";
import { providerIcon, providerLabel } from "./components/provider-meta";
import { StatusBadge } from "./components/status-badge";
import { RouteBody, RouteHeader, RouteSurface, ScrollTable } from "./components/responsive-layout";
import { useAccounts, useGroups } from "./hooks/use-accounts";
import { useHistoryEvents, useHistoryStats } from "./hooks/use-history";
import { useMonitorData } from "./hooks/use-monitor-data";
import { useProviders } from "./hooks/use-providers";
import { useServiceMetadata } from "./hooks/use-service-metadata";
import { monitorApi } from "./ipc";
import { downloadCsv } from "./utils/csv";
import type { Account, AlertRuleInput, HistoryEvent, MonitorCategory, MonitorItem, NormalizedStatus, PipelineRow, ProjectGroup, Provider, ServiceHealth, ServiceMetadata, ServiceTier } from "./types";

const FILTER_KEY = "pipelines.filters.v1";
const FILTER_PRESET_KEY = `${FILTER_KEY}.presets`;
const INCIDENT_CREATE_KEY = "incidents.create.v1";
const ALERT_RULE_DRAFT_KEY = "alerts.draft.v1";
const PIPELINE_DRILLDOWN_KEY = "pipelines.drilldown.v1";
const ALL_GROUPS = "all";
const UNGROUPED = "ungrouped";
const PIPELINE_CATEGORIES: MonitorCategory[] = ["run", "deploy", "release", "migration"];

type ProviderFilter = "all" | Provider;
type StatusFilter = "all" | NormalizedStatus;

interface PipelineFilters {
  dateRange: ReturnType<typeof defaultDateRange>;
  provider: ProviderFilter;
  account: string;
  group: string;
  status: StatusFilter;
  category: "all" | "run" | "deploy" | "release" | "migration";
  actor: string;
  branch: string;
  owner: string;
  tier: "all" | ServiceTier;
  dependency: string;
  search: string;
}

const DEFAULT_FILTERS: PipelineFilters = {
  dateRange: defaultDateRange("24h"),
  provider: "all",
  account: ALL,
  group: ALL_GROUPS,
  status: "all",
  category: "all",
  actor: ALL,
  branch: ALL,
  owner: ALL,
  tier: "all",
  dependency: ALL,
  search: "",
};

const CATEGORY_OPTIONS: { value: PipelineFilters["category"]; label: string }[] = [
  { value: "all", label: "All pipeline types" },
  { value: "run", label: "Workflow runs" },
  { value: "deploy", label: "Deploys" },
  { value: "release", label: "Releases" },
  { value: "migration", label: "Migrations" },
];

const SERVICE_TIERS: { value: ServiceTier; label: string }[] = [
  { value: "critical", label: "Critical" },
  { value: "standard", label: "Standard" },
  { value: "internal", label: "Internal" },
  { value: "experimental", label: "Experimental" },
];

function serviceForAccount(services: ServiceHealth[], accountId: string | undefined): ServiceHealth | undefined {
  return accountId ? services.find((service) => service.accountIds.includes(accountId)) : undefined;
}

function metadataForAccount(account: Account | undefined, service: ServiceHealth | undefined, metadataByService: Map<string, ServiceMetadata>): ServiceMetadata | undefined {
  if (!account) return undefined;
  return metadataByService.get(service?.id ?? account.groupId ?? `account:${account.id}`);
}

function splitSubtitle(item: MonitorItem): { stage: string; branchOrContext?: string } {
  const parts = item.subtitle.split(" · ").map((part) => part.trim()).filter(Boolean);
  return {
    stage: parts[0] ?? item.category,
    branchOrContext: parts.slice(1).join(" · ") || undefined,
  };
}

function matchesGroup(account: Account | undefined, groupsById: Map<string, ProjectGroup>, filter: string): boolean {
  if (filter === ALL_GROUPS) return true;
  const groupId = account?.groupId && groupsById.has(account.groupId) ? account.groupId : UNGROUPED;
  return groupId === filter;
}

function matchesMetadata(metadata: ServiceMetadata | undefined, filters: Pick<PipelineFilters, "owner" | "tier" | "dependency">): boolean {
  if (filters.owner !== ALL && metadata?.owner !== filters.owner) return false;
  if (filters.tier !== "all" && metadata?.tier !== filters.tier) return false;
  if (filters.dependency !== ALL && !metadata?.dependencies?.includes(filters.dependency)) return false;
  return true;
}

function relatedEvents(item: MonitorItem, events: HistoryEvent[]): { failures: number; incidents: number } {
  const itemTs = new Date(item.updatedAt).getTime();
  if (!Number.isFinite(itemTs)) return { failures: 0, incidents: 0 };
  const windowEnd = itemTs + 2 * 60 * 60 * 1000;
  const related = events.filter((event) => {
    if (event.accountId !== item.accountId) return false;
    const eventTs = new Date(event.ts).getTime();
    return Number.isFinite(eventTs) && eventTs >= itemTs && eventTs <= windowEnd;
  });
  return {
    failures: related.filter((event) => event.type === "failure").length,
    incidents: related.filter((event) => event.type === "incident").length,
  };
}

function buildRows(args: {
  items: MonitorItem[];
  events: HistoryEvent[];
  accountsById: Map<string, Account>;
  groupsById: Map<string, ProjectGroup>;
  services: ServiceHealth[];
  metadataByService: Map<string, ServiceMetadata>;
}): PipelineRow[] {
  return args.items
    .filter((item) => PIPELINE_CATEGORIES.includes(item.category))
    .map((item) => {
      const account = args.accountsById.get(item.accountId);
      const service = serviceForAccount(args.services, item.accountId);
      const metadata = metadataForAccount(account, service, args.metadataByService);
      const group = account?.groupId ? args.groupsById.get(account.groupId) : undefined;
      const subtitle = splitSubtitle(item);
      const related = relatedEvents(item, args.events);
      return {
        item,
        account,
        group,
        service,
        metadata,
        stage: subtitle.stage,
        target: item.title,
        branchOrContext: subtitle.branchOrContext,
        actor: item.actor,
        commit: item.commitSha ? item.commitSha.slice(0, 7) : undefined,
        relatedFailures: related.failures,
        relatedIncidents: related.incidents,
      };
    })
    .sort((a, b) => new Date(b.item.updatedAt).getTime() - new Date(a.item.updatedAt).getTime());
}

function pipelineSearchText(row: PipelineRow): string {
  return [
    providerLabel(row.item.provider),
    row.account?.label,
    row.group?.name,
    row.service?.name,
    row.metadata?.owner,
    row.metadata?.tier,
    row.target,
    row.stage,
    row.branchOrContext,
    row.actor,
    row.commit,
    row.item.commitMessage,
    row.item.status,
    row.item.category,
    row.item.conclusion,
  ].filter(Boolean).join(" ").toLowerCase();
}

function alertRuleDraftFromPipeline(row: PipelineRow): AlertRuleInput {
  return {
    name: `Pipeline failures: ${row.account?.label ?? providerLabel(row.item.provider)}`,
    metric: "failureRate",
    operator: "gt",
    threshold: 0,
    scope: row.item.accountId ? { accountId: row.item.accountId } : { provider: row.item.provider },
    enabled: true,
    forMinutes: 5,
    cooldownMinutes: 15,
    dedupeMinutes: 30,
  };
}

function PipelineRowView({
  row,
  onOpen,
  onLogs,
  onIncident,
  onAlert,
}: {
  row: PipelineRow;
  onOpen: (item: MonitorItem) => void;
  onLogs: (item: MonitorItem) => void;
  onIncident: (item: MonitorItem) => void;
  onAlert: (row: PipelineRow) => void;
}) {
  const Icon = providerIcon(row.item.provider);
  const correlated = row.relatedFailures + row.relatedIncidents;
  return (
    <tr className="border-b border-separator/70 last:border-b-0">
      <td className="px-3 py-2 align-top">
        <div className="flex min-w-0 items-start gap-2">
          <Icon className="mt-0.5 size-4 shrink-0 text-tertiary" />
          <div className="min-w-0">
            <Text variant="strong" className="block truncate">{row.target}</Text>
            <Text variant="small" color="secondary" className="block truncate">{row.stage}</Text>
          </div>
        </div>
      </td>
      <td className="px-3 py-2 align-top">
        <Text variant="small" className="block">{providerLabel(row.item.provider)}</Text>
        <Text variant="small" color="tertiary" className="block truncate">{row.account?.label ?? row.item.accountId}</Text>
      </td>
      <td className="px-3 py-2 align-top">
        <Text variant="small" className="block truncate">{row.group?.name ?? row.service?.name ?? "Ungrouped"}</Text>
        <Text variant="small" color="tertiary" className="block truncate">{row.metadata?.owner ?? "No owner"}</Text>
      </td>
      <td className="px-3 py-2 align-top">
        <Text variant="small" className="block truncate">{row.branchOrContext ?? "No branch/context"}</Text>
        <Text variant="small" color="tertiary" className="block truncate">{row.actor ?? "No actor"}{row.commit ? ` · ${row.commit}` : ""}</Text>
      </td>
      <td className="px-3 py-2 align-top">
        <div className="flex flex-col gap-1">
          <StatusBadge status={row.item.status} />
          <Text variant="small" color="tertiary" className="tabular-nums">{formatRelativeTime(row.item.updatedAt)}</Text>
        </div>
      </td>
      <td className="px-3 py-2 align-top">
        {correlated > 0 ? (
          <Badge color={row.relatedFailures > 0 || row.relatedIncidents > 0 ? "red" : "secondary"}>
            {row.relatedFailures} failures · {row.relatedIncidents} incidents
          </Badge>
        ) : (
          <Text variant="small" color="tertiary">None nearby</Text>
        )}
      </td>
      <td className="px-3 py-2 align-top">
        <div className="flex justify-end gap-1">
          {row.item.logAvailable || row.item.logFallbackUrl ? (
            <Button variant="transparent" size="small" iconOnly aria-label="View logs" title="View logs" onClick={() => onLogs(row.item)}>
              <ScrollText className="size-4" />
            </Button>
          ) : null}
          <Button variant="transparent" size="small" iconOnly aria-label="Create incident" title="Create incident" onClick={() => onIncident(row.item)}>
            <AlertTriangle className="size-4" />
          </Button>
          <Button variant="transparent" size="small" iconOnly aria-label="Create alert rule" title="Create alert rule" onClick={() => onAlert(row)}>
            <Bell className="size-4" />
          </Button>
          <Button variant="transparent" size="small" iconOnly aria-label="Open provider" title="Open provider" onClick={() => onOpen(row.item)}>
            <ExternalLink className="size-4" />
          </Button>
        </div>
      </td>
    </tr>
  );
}

function SummaryTile({ icon, label, value, detail, tone }: { icon: ReactNode; label: string; value: string; detail: string; tone?: "red" | "yellow" | "green" | "blue" | "secondary" }) {
  return (
    <div className="rounded-lg border border-separator p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {icon}
          <Text variant="small" color="secondary" className="block truncate">{label}</Text>
        </div>
        <Badge color={tone ?? "secondary"}>{label}</Badge>
      </div>
      <Text variant="title" className="mt-2 block tabular-nums">{value}</Text>
      <Text variant="small" color="tertiary" className="mt-1 block">{detail}</Text>
    </div>
  );
}

export function PipelinesView() {
  const navigate = useNavigate();
  const [filters, setFilters, resetFilters] = useStoredState<PipelineFilters>(FILTER_KEY, DEFAULT_FILTERS);
  const [selectedLogItem, setSelectedLogItem] = useState<MonitorItem | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const snapshotQuery = useMonitorData();
  const accountsQuery = useAccounts();
  const groupsQuery = useGroups();
  const providersQuery = useProviders();
  const serviceMetadataQuery = useServiceMetadata();
  const eventsQuery = useHistoryEvents({ range: filters.dateRange, types: ["failure", "incident", "deploy"] });
  const historyStatsQuery = useHistoryStats();
  const dateBounds = retainedHistoryDateBounds(historyStatsQuery.data);

  useEffect(() => {
    const raw = localStorage.getItem(PIPELINE_DRILLDOWN_KEY);
    if (!raw) return;
    localStorage.removeItem(PIPELINE_DRILLDOWN_KEY);
    try {
      const payload = JSON.parse(raw) as Partial<PipelineFilters> & { itemUid?: string };
      setFilters({ ...DEFAULT_FILTERS, ...payload, dateRange: payload.dateRange ?? DEFAULT_FILTERS.dateRange });
    } catch {
      // Ignore stale handoff payloads.
    }
  }, [setFilters]);

  const accounts = accountsQuery.data ?? [];
  const groups = groupsQuery.data ?? [];
  const snapshot = snapshotQuery.data;
  const groupsById = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups]);
  const accountsById = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts]);
  const metadataByService = useMemo(() => new Map((serviceMetadataQuery.data ?? []).map((metadata) => [metadata.serviceId, metadata])), [serviceMetadataQuery.data]);
  const rows = useMemo(() => buildRows({
    items: snapshot?.items ?? [],
    events: eventsQuery.data ?? [],
    accountsById,
    groupsById,
    services: snapshot?.services ?? [],
    metadataByService,
  }), [accountsById, eventsQuery.data, groupsById, metadataByService, snapshot?.items, snapshot?.services]);

  const providerOptions = [{ value: "all", label: "All providers" }, ...(providersQuery.data ?? []).map((provider) => ({ value: provider.id, label: provider.label }))];
  const accountOptions = [{ value: ALL, label: "All accounts" }, ...accounts.map((account) => ({ value: account.id, label: account.label }))];
  const groupOptions = [{ value: ALL_GROUPS, label: "All services" }, { value: UNGROUPED, label: "Ungrouped" }, ...groups.map((group) => ({ value: group.id, label: group.name }))];
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
  const actorOptions = [
    { value: ALL, label: "All actors" },
    ...[...new Set(rows.map((row) => row.actor).filter((actor): actor is string => Boolean(actor)))]
      .sort((a, b) => a.localeCompare(b))
      .map((actor) => ({ value: actor, label: actor })),
  ];
  const branchOptions = [
    { value: ALL, label: "All branches/contexts" },
    ...[...new Set(rows.map((row) => row.branchOrContext).filter((branch): branch is string => Boolean(branch)))]
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 80)
      .map((branch) => ({ value: branch, label: branch })),
  ];

  const filteredRows = rows.filter((row) => {
    if (!matchesDateRange(row.item.updatedAt, filters.dateRange)) return false;
    if (filters.provider !== "all" && row.item.provider !== filters.provider) return false;
    if (filters.account !== ALL && row.item.accountId !== filters.account) return false;
    if (!matchesGroup(row.account, groupsById, filters.group)) return false;
    if (filters.status !== "all" && row.item.status !== filters.status) return false;
    if (filters.category !== "all" && row.item.category !== filters.category) return false;
    if (filters.actor !== ALL && row.actor !== filters.actor) return false;
    if (filters.branch !== ALL && row.branchOrContext !== filters.branch) return false;
    if (!matchesMetadata(row.metadata, filters)) return false;
    const search = filters.search.trim().toLowerCase();
    if (search && !pipelineSearchText(row).includes(search)) return false;
    return true;
  });

  const runningRows = filteredRows.filter((row) => row.item.status === "running" || row.item.status === "queued");
  const failedRows = filteredRows.filter((row) => row.item.status === "failure");
  const recentRows = filteredRows.filter((row) => row.item.status !== "running" && row.item.status !== "queued").slice(0, 50);
  const correlatedRows = filteredRows.filter((row) => row.relatedFailures + row.relatedIncidents > 0);

  const setFilter = <K extends keyof PipelineFilters>(key: K, value: PipelineFilters[K]) => setFilters({ ...filters, [key]: value });
  const openLogs = (item: MonitorItem) => {
    if (item.logAvailable) {
      setSelectedLogItem(item);
      setLogOpen(true);
      return;
    }
    if (item.logFallbackUrl || item.url) {
      void monitorApi.openExternal(item.logFallbackUrl ?? item.url).catch((error) => toast.error(String(error)));
    }
  };
  const openProvider = (item: MonitorItem) => void monitorApi.openExternal(item.url).catch((error) => toast.error(String(error)));
  const createIncident = (item: MonitorItem) => {
    localStorage.setItem(INCIDENT_CREATE_KEY, JSON.stringify({ monitorItem: item }));
    void navigate({ to: "/incidents" });
  };
  const createAlert = (row: PipelineRow) => {
    localStorage.setItem(ALERT_RULE_DRAFT_KEY, JSON.stringify(alertRuleDraftFromPipeline(row)));
    void navigate({ to: "/alerts" });
  };
  const refresh = async () => {
    setRefreshing(true);
    try {
      await monitorApi.refresh(filters.account === ALL ? undefined : filters.account);
      await snapshotQuery.refetch();
      toast.success("Pipelines refreshed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setRefreshing(false);
    }
  };
  const exportCsv = () => {
    downloadCsv(
      "pipelines.csv",
      ["provider", "account", "service", "owner", "category", "target", "stage", "branchOrContext", "actor", "commit", "status", "updated", "relatedFailures", "relatedIncidents", "url"],
      filteredRows.map((row) => [
        providerLabel(row.item.provider),
        row.account?.label ?? row.item.accountId,
        row.group?.name ?? row.service?.name ?? "",
        row.metadata?.owner ?? "",
        row.item.category,
        row.target,
        row.stage,
        row.branchOrContext ?? "",
        row.actor ?? "",
        row.commit ?? "",
        row.item.status,
        row.item.updatedAt,
        row.relatedFailures,
        row.relatedIncidents,
        row.item.url,
      ]),
    );
    toast.success(`Exported ${filteredRows.length} pipeline rows`);
  };

  const activeFilters: AppliedFilter[] = [
    !sameDateRange(filters.dateRange, DEFAULT_FILTERS.dateRange) ? { id: "dateRange", label: "Range", value: dateRangeLabel(filters.dateRange), onClear: () => setFilter("dateRange", DEFAULT_FILTERS.dateRange) } : null,
    filters.provider !== DEFAULT_FILTERS.provider ? { id: "provider", label: "Provider", value: optionLabel(providerOptions, filters.provider), onClear: () => setFilter("provider", DEFAULT_FILTERS.provider) } : null,
    filters.account !== DEFAULT_FILTERS.account ? { id: "account", label: "Account", value: optionLabel(accountOptions, filters.account), onClear: () => setFilter("account", DEFAULT_FILTERS.account) } : null,
    filters.group !== DEFAULT_FILTERS.group ? { id: "group", label: "Service", value: optionLabel(groupOptions, filters.group), onClear: () => setFilter("group", DEFAULT_FILTERS.group) } : null,
    filters.status !== DEFAULT_FILTERS.status ? { id: "status", label: "Status", value: optionLabel(STATUS_FILTER_OPTIONS, filters.status), onClear: () => setFilter("status", DEFAULT_FILTERS.status) } : null,
    filters.category !== DEFAULT_FILTERS.category ? { id: "category", label: "Type", value: optionLabel(CATEGORY_OPTIONS, filters.category), onClear: () => setFilter("category", DEFAULT_FILTERS.category) } : null,
    filters.actor !== DEFAULT_FILTERS.actor ? { id: "actor", label: "Actor", value: optionLabel(actorOptions, filters.actor), onClear: () => setFilter("actor", DEFAULT_FILTERS.actor) } : null,
    filters.branch !== DEFAULT_FILTERS.branch ? { id: "branch", label: "Branch", value: optionLabel(branchOptions, filters.branch), onClear: () => setFilter("branch", DEFAULT_FILTERS.branch) } : null,
    filters.owner !== DEFAULT_FILTERS.owner ? { id: "owner", label: "Owner", value: optionLabel(ownerOptions, filters.owner), onClear: () => setFilter("owner", DEFAULT_FILTERS.owner) } : null,
    filters.tier !== DEFAULT_FILTERS.tier ? { id: "tier", label: "Tier", value: optionLabel(tierOptions, filters.tier), onClear: () => setFilter("tier", DEFAULT_FILTERS.tier) } : null,
    filters.dependency !== DEFAULT_FILTERS.dependency ? { id: "dependency", label: "Dependency", value: optionLabel(dependencyOptions, filters.dependency), onClear: () => setFilter("dependency", DEFAULT_FILTERS.dependency) } : null,
    filters.search.trim() ? { id: "search", label: "Search", value: filters.search, onClear: () => setFilter("search", DEFAULT_FILTERS.search) } : null,
  ].filter((filter): filter is AppliedFilter => filter !== null);

  const sectionRows = [
    { id: "running", title: "Running or queued now", detail: "Pipeline work still in progress.", rows: runningRows, empty: "No runs, deploys, releases, or migrations are currently running or queued." },
    { id: "failed", title: "Failed recently", detail: "Rows that need investigation or an alert rule.", rows: failedRows, empty: "No failed pipeline rows match the current filters." },
    { id: "correlated", title: "Deploys before failures or incidents", detail: "Pipeline rows followed by failures or incidents on the same account within two hours.", rows: correlatedRows, empty: "No nearby failure or incident correlations match these filters." },
    { id: "recent", title: "Recent deploys, releases, runs, and migrations", detail: "The latest pipeline-like provider rows.", rows: recentRows, empty: "No pipeline rows match the current filters." },
  ];

  return (
    <RouteSurface className="h-full">
      <RouteHeader
        icon={<Rocket className="size-5" />}
        title="Pipelines"
        meta={<Badge color="secondary">{filteredRows.length} rows</Badge>}
        subtitle="Runs, deploys, releases, and migrations with logs, owners, failure correlation, and direct incident or alert actions."
        controls={
          <>
            <Button variant="filled" size="small" onClick={refresh} disabled={refreshing}>
              <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button variant="filled" size="small" onClick={exportCsv} disabled={filteredRows.length === 0}>
              <Download className="size-4" />
              CSV
            </Button>
            <FilterMenu
              filters={activeFilters}
              onReset={resetFilters}
              presetKey={FILTER_PRESET_KEY}
              presetValue={filters}
              onApplyPreset={(value) => setFilters({ ...DEFAULT_FILTERS, ...value, dateRange: value.dateRange ?? DEFAULT_FILTERS.dateRange })}
            >
              <FilterDateRangeField label="Range" value={filters.dateRange} onChange={(value) => setFilter("dateRange", value)} bounds={dateBounds} />
              <FilterSelectField label="Provider" value={filters.provider} onChange={(value) => setFilter("provider", value as ProviderFilter)} options={providerOptions} />
              <FilterSelectField label="Account" value={filters.account} onChange={(value) => setFilter("account", value)} options={accountOptions} />
              <FilterSelectField label="Service" value={filters.group} onChange={(value) => setFilter("group", value)} options={groupOptions} />
              <FilterSelectField label="Status" value={filters.status} onChange={(value) => setFilter("status", value as StatusFilter)} options={STATUS_FILTER_OPTIONS} />
              <FilterSelectField label="Pipeline type" value={filters.category} onChange={(value) => setFilter("category", value as PipelineFilters["category"])} options={CATEGORY_OPTIONS} />
              <FilterSelectField label="Actor" value={filters.actor} onChange={(value) => setFilter("actor", value)} options={actorOptions} />
              <FilterSelectField label="Branch/context" value={filters.branch} onChange={(value) => setFilter("branch", value)} options={branchOptions} />
              <FilterSelectField label="Owner" value={filters.owner} onChange={(value) => setFilter("owner", value)} options={ownerOptions} />
              <FilterSelectField label="Tier" value={filters.tier} onChange={(value) => setFilter("tier", value as PipelineFilters["tier"])} options={tierOptions} />
              <FilterSelectField label="Dependency" value={filters.dependency} onChange={(value) => setFilter("dependency", value)} options={dependencyOptions} />
            </FilterMenu>
          </>
        }
        search={
          <div className="relative">
            <Search className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-tertiary" />
            <Input value={filters.search} onChange={(event) => setFilter("search", event.target.value)} placeholder="Search target, workflow, branch, actor, owner, commit" className="pl-8" />
          </div>
        }
      />
      <RouteBody>
        {snapshotQuery.error ? <Callout color="red">{snapshotQuery.error instanceof Error ? snapshotQuery.error.message : String(snapshotQuery.error)}</Callout> : null}
        {accounts.length === 0 ? (
          <Callout color="secondary">Connect GitHub, Cloudflare, Netlify, Heroku, Supabase, or another pipeline-capable account in Setup to populate this screen.</Callout>
        ) : filteredRows.length === 0 ? (
          <Callout color="secondary">
            No pipeline rows match the current filters. Refresh provider accounts, widen the range, or clear filters to include run/deploy/release/migration rows.
          </Callout>
        ) : null}

        <div className="mb-4 grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <SummaryTile icon={<Clock3 className="size-4 text-tertiary" />} label="Running now" value={String(runningRows.length)} detail="Queued or in-progress rows" tone={runningRows.length > 0 ? "blue" : "secondary"} />
          <SummaryTile icon={<AlertTriangle className="size-4 text-support-red" />} label="Failed" value={String(failedRows.length)} detail="Rows with failure status" tone={failedRows.length > 0 ? "red" : "green"} />
          <SummaryTile icon={<GitCommitHorizontal className="size-4 text-tertiary" />} label="Correlated" value={String(correlatedRows.length)} detail="Followed by failures/incidents" tone={correlatedRows.length > 0 ? "yellow" : "secondary"} />
          <SummaryTile icon={<GitBranch className="size-4 text-tertiary" />} label="Providers" value={String(new Set(filteredRows.map((row) => row.item.provider)).size)} detail={dateRangeLabel(filters.dateRange)} tone="secondary" />
        </div>

        <div className="space-y-5">
          {sectionRows.map((section) => (
            <section key={section.id} className="rounded-lg border border-separator">
              <div className="flex min-w-0 items-start justify-between gap-3 border-b border-separator p-3">
                <div className="min-w-0">
                  <Text variant="strong" className="block">{section.title}</Text>
                  <Text variant="small" color="secondary" className="block">{section.detail}</Text>
                </div>
                <Badge color="secondary">{section.rows.length}</Badge>
              </div>
              {section.rows.length === 0 ? (
                <div className="p-3">
                  <Callout color="secondary">{section.empty}</Callout>
                </div>
              ) : (
                <ScrollTable>
                  <table className="min-w-[980px] w-full text-left text-sm">
                    <thead className="text-xs uppercase text-tertiary">
                      <tr>
                        <th className="border-b border-separator px-3 py-2 font-medium">Pipeline</th>
                        <th className="border-b border-separator px-3 py-2 font-medium">Provider</th>
                        <th className="border-b border-separator px-3 py-2 font-medium">Service</th>
                        <th className="border-b border-separator px-3 py-2 font-medium">Branch/context</th>
                        <th className="border-b border-separator px-3 py-2 font-medium">Status</th>
                        <th className="border-b border-separator px-3 py-2 font-medium">Nearby impact</th>
                        <th className="border-b border-separator px-3 py-2 font-medium text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {section.rows.slice(0, 80).map((row) => (
                        <PipelineRowView key={`${section.id}:${row.item.uid}`} row={row} onOpen={openProvider} onLogs={openLogs} onIncident={createIncident} onAlert={createAlert} />
                      ))}
                    </tbody>
                  </table>
                </ScrollTable>
              )}
            </section>
          ))}
        </div>
      </RouteBody>
      <LogViewerDialog item={selectedLogItem} open={logOpen} onOpenChange={setLogOpen} />
    </RouteSurface>
  );
}
