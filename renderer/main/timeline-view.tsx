import { useEffect, useMemo, useState } from "react";
import { Bell, Download, ExternalLink, Plus } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import {
  Badge,
  Button,
  Callout,
  EmptyState,
  ScrollArea,
  Text,
  toast,
} from "@glaze/core/components";
import {
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import type { TooltipContentProps } from "recharts";

import { formatRelativeTime } from "./components/relative-time";
import {
  ALL,
  CATEGORY_FILTER_OPTIONS,
  EVENT_TYPE_OPTIONS,
  type AppliedFilter,
  FilterDateRangeField,
  FilterMenu,
  FilterSelectField,
  SEVERITY_FILTER_OPTIONS,
  STATUS_FILTER_OPTIONS,
  dateRangeLabel,
  defaultDateRange,
  dateRangeBounds,
  optionLabel,
  retainedHistoryDateBounds,
  sameDateRange,
  toSingleEventType,
  useStoredState,
} from "./components/filters";
import { providerIcon, providerLabel } from "./components/provider-meta";
import { useAccounts, useGroups } from "./hooks/use-accounts";
import { useHistoryEvents, useHistoryStats } from "./hooks/use-history";
import { useMonitorData } from "./hooks/use-monitor-data";
import { useProviders } from "./hooks/use-providers";
import { useServiceMetadata } from "./hooks/use-service-metadata";
import { monitorApi } from "./ipc";
import { downloadCsv } from "./utils/csv";
import type {
  Account,
  AlertRuleInput,
  HistoryEvent,
  HistoryEventType,
  IncidentStatus,
  MonitorCategory,
  NormalizedStatus,
  ObservabilitySeverity,
  ProjectGroup,
  Provider,
  ServiceHealth,
  ServiceMetadata,
  ServiceTier,
} from "./types";

const FILTER_KEY = "timeline.filters.v1";
const FILTER_PRESET_KEY = `${FILTER_KEY}.presets`;
const TIMELINE_DRILLDOWN_KEY = "timeline.drilldown.v1";
const INCIDENT_CREATE_KEY = "incidents.create.v1";
const ALERT_RULE_DRAFT_KEY = "alerts.draft.v1";
const DEFAULT_LANE_BY = "group";

interface TimelineFilters {
  dateRange: ReturnType<typeof defaultDateRange>;
  group: string;
  provider: "all" | Provider;
  account: string;
  type: "all" | HistoryEventType;
  status: "all" | NormalizedStatus | IncidentStatus;
  severity: "all" | ObservabilitySeverity;
  category: "all" | MonitorCategory;
  owner: string;
  tier: "all" | ServiceTier;
  dependency: string;
}

interface TimelineFilterPresetValue {
  filters: TimelineFilters;
  laneBy: "group" | "provider";
}

const DEFAULT_FILTERS: TimelineFilters = {
  dateRange: defaultDateRange("24h"),
  group: ALL,
  provider: "all",
  account: ALL,
  type: "all",
  status: "all",
  severity: "all",
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

function accountMap(accounts: Account[]): Map<string, Account> {
  return new Map(accounts.map((account) => [account.id, account]));
}

function groupMap(groups: ProjectGroup[]): Map<string, ProjectGroup> {
  return new Map(groups.map((group) => [group.id, group]));
}

function serviceForAccount(services: ServiceHealth[], accountId: string | undefined): ServiceHealth | undefined {
  if (!accountId) return undefined;
  return services.find((service) => service.accountIds.includes(accountId));
}

function metadataForEvent(
  event: HistoryEvent,
  accountsById: Map<string, Account>,
  services: ServiceHealth[],
  metadataByService: Map<string, ServiceMetadata>,
): ServiceMetadata | undefined {
  const service = serviceForAccount(services, event.accountId);
  if (service) return metadataByService.get(service.id);
  const account = accountsById.get(event.accountId);
  if (account?.groupId) return metadataByService.get(account.groupId);
  if (event.groupId) return metadataByService.get(event.groupId);
  return metadataByService.get(`account:${event.accountId}`);
}

function eventColor(event: HistoryEvent): string {
  if (event.type === "failure" || event.type === "incident") return "var(--red)";
  if (event.type === "alert") return "var(--yellow)";
  if (event.type === "recovery") return "var(--green)";
  return "var(--accent)";
}

function eventBadge(event: HistoryEvent): "red" | "yellow" | "secondary" {
  if (event.type === "failure" || event.type === "incident") return "red";
  if (event.type === "alert") return "yellow";
  return "secondary";
}

function openUrl(url: string): void {
  void monitorApi.openExternal(url).catch((error) => toast.error(error instanceof Error ? error.message : String(error)));
}

function timelineExportFilename(rangeLabel: string): string {
  const safeRange = rangeLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "filtered";
  return `timeline-${safeRange}-${new Date().toISOString().slice(0, 10)}.csv`;
}

function downloadTimelineCsv(events: HistoryEvent[], accountsById: Map<string, Account>, groupsById: Map<string, ProjectGroup>, rangeLabel: string): void {
  const columns = [
    "timestamp",
    "type",
    "provider",
    "account",
    "accountId",
    "group",
    "groupId",
    "title",
    "status",
    "severity",
    "category",
    "sourceUid",
    "url",
  ];
  const rows = events.map((event) => {
    const account = accountsById.get(event.accountId);
    const groupId = event.groupId ?? account?.groupId;
    return [
      event.ts,
      event.type,
      providerLabel(event.provider),
      account?.label ?? "",
      event.accountId,
      groupId ? groupsById.get(groupId)?.name ?? "" : "",
      groupId ?? "",
      event.title,
      event.status,
      event.severity,
      event.category ?? "",
      event.sourceUid ?? "",
      event.url,
    ];
  });
  downloadCsv(timelineExportFilename(rangeLabel), columns, rows);
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

function laneLabel(id: string, laneBy: "group" | "provider", groupsById: Map<string, ProjectGroup>): string {
  if (laneBy === "provider") return id === "unknown" ? "Unknown provider" : providerLabel(id as Provider);
  if (id === "ungrouped") return "Ungrouped";
  return groupsById.get(id)?.name ?? "Unknown group";
}

interface TimelinePoint {
  x: number;
  y: string;
  z: number;
  event: HistoryEvent;
}

function dateTick(value: number): string {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function pointFromPayload(value: unknown): TimelinePoint | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Partial<TimelinePoint>;
  if (typeof candidate.x !== "number" || typeof candidate.y !== "string" || typeof candidate.z !== "number") return undefined;
  if (typeof candidate.event !== "object" || candidate.event === null) return undefined;
  return candidate as TimelinePoint;
}

function pointFromScatterClick(value: unknown): TimelinePoint | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const withPayload = value as { payload?: unknown };
  return pointFromPayload(withPayload.payload) ?? pointFromPayload(value);
}

function timelineDrilldownFilters(value: unknown): Partial<TimelineFilters> | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<TimelineFilters>;
  return {
    dateRange: candidate.dateRange,
    group: typeof candidate.group === "string" ? candidate.group : undefined,
    provider: typeof candidate.provider === "string" ? candidate.provider as TimelineFilters["provider"] : undefined,
    account: typeof candidate.account === "string" ? candidate.account : undefined,
    type: typeof candidate.type === "string" ? candidate.type as TimelineFilters["type"] : undefined,
    status: typeof candidate.status === "string" ? candidate.status as TimelineFilters["status"] : undefined,
    severity: typeof candidate.severity === "string" ? candidate.severity as TimelineFilters["severity"] : undefined,
    category: typeof candidate.category === "string" ? candidate.category as TimelineFilters["category"] : undefined,
    owner: typeof candidate.owner === "string" ? candidate.owner : undefined,
    tier: typeof candidate.tier === "string" ? candidate.tier as TimelineFilters["tier"] : undefined,
    dependency: typeof candidate.dependency === "string" ? candidate.dependency : undefined,
  };
}

function TimelineTooltip({ active, payload }: TooltipContentProps) {
  if (!active) return null;
  const point = pointFromPayload(payload?.[0]?.payload);
  if (!point) return null;
  return (
    <div className="rounded-lg border border-separator bg-background-solid p-3 shadow-sm max-w-[280px]">
      <Text variant="small" color="tertiary">{point.y}</Text>
      <Text variant="strong">{point.event.title}</Text>
      <Text variant="small" color="secondary">
        {point.event.type} · {providerLabel(point.event.provider)} · {new Date(point.event.ts).toLocaleString()}
      </Text>
    </div>
  );
}

function TimelineChart({
  events,
  dateRange,
  laneBy,
  groupsById,
}: {
  events: HistoryEvent[];
  dateRange: TimelineFilters["dateRange"];
  laneBy: "group" | "provider";
  groupsById: Map<string, ProjectGroup>;
}) {
  const { start, end } = dateRangeBounds(dateRange);
  const points = events.map((event): TimelinePoint => {
    const laneId = laneBy === "provider" ? event.provider : event.groupId ?? "ungrouped";
    return {
      x: new Date(event.ts).getTime(),
      y: laneLabel(laneId, laneBy, groupsById),
      z: event.type === "deploy" ? 64 : event.type === "failure" || event.type === "incident" ? 100 : 80,
      event,
    };
  });
  const lanes = [...new Set(points.map((point) => point.y))];
  const height = Math.max(260, lanes.length * 48 + 88);

  return (
    <div className="min-w-0" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 18, right: 20, bottom: 8, left: 16 }}>
          <CartesianGrid stroke="var(--color-border-separator)" strokeDasharray="3 3" />
          <XAxis
            type="number"
            dataKey="x"
            domain={[start, end]}
            tickFormatter={dateTick}
            tick={{ fill: "var(--color-text-tertiary)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            type="category"
            dataKey="y"
            width={132}
            allowDuplicatedCategory={false}
            tick={{ fill: "var(--color-text-secondary)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <ZAxis dataKey="z" range={[56, 112]} />
          <Tooltip
            cursor={{ stroke: "var(--color-border-separator)", strokeDasharray: "3 3" }}
            content={(props) => <TimelineTooltip {...props} />}
          />
          {events.filter((event) => event.type === "deploy").map((event) => (
            <ReferenceLine
              key={`deploy:${event.id}`}
              x={new Date(event.ts).getTime()}
              stroke="var(--accent)"
              strokeOpacity={0.3}
              strokeDasharray="4 4"
            />
          ))}
          <Scatter
            name="Events"
            data={points}
            cursor="pointer"
            onClick={(value) => {
              const point = pointFromScatterClick(value);
              if (point) openUrl(point.event.url);
            }}
          >
            {points.map((point) => (
              <Cell key={point.event.id} fill={eventColor(point.event)} stroke="var(--background-solid)" strokeWidth={1.5} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

function EventRow({ event, account }: { event: HistoryEvent; account: Account | undefined }) {
  const navigate = useNavigate();
  const Icon = providerIcon(event.provider);
  const alertDraft = alertRuleDraftFromHistoryEvent(event, account);
  const createIncident = () => {
    localStorage.setItem(INCIDENT_CREATE_KEY, JSON.stringify({ event }));
    void navigate({ to: "/incidents" });
  };
  const createAlertRule = () => {
    if (!alertDraft) return;
    localStorage.setItem(ALERT_RULE_DRAFT_KEY, JSON.stringify(alertDraft));
    void navigate({ to: "/alerts" });
  };
  return (
    <div className="grid grid-cols-[7rem_6rem_1fr_auto] gap-3 py-2 border-t border-separator first:border-t-0 items-center">
      <Text variant="small" color="tertiary" className="tabular-nums">{formatRelativeTime(event.ts)}</Text>
      <Badge color={eventBadge(event)}>{event.type}</Badge>
      <div className="min-w-0 flex items-center gap-2">
        <Icon className="size-4 text-tertiary shrink-0" />
        <div className="min-w-0">
          <Text variant="strong" truncate>{event.title}</Text>
          <Text variant="small" color="secondary" truncate>{account?.label ?? providerLabel(event.provider)}</Text>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Button variant="transparent" size="small" iconOnly aria-label="Create incident from event" title="Create incident from event" onClick={createIncident}>
          <Plus className="size-4" />
        </Button>
        {alertDraft ? (
          <Button variant="transparent" size="small" iconOnly aria-label="Create alert rule from event" title="Create alert rule from event" onClick={createAlertRule}>
            <Bell className="size-4" />
          </Button>
        ) : null}
        <Button variant="transparent" size="small" iconOnly aria-label="Open event" onClick={() => openUrl(event.url)}>
          <ExternalLink className="size-4" />
        </Button>
      </div>
    </div>
  );
}

export function TimelineView() {
  const [storedFilters, setFilters, resetFilters] = useStoredState<TimelineFilters>(FILTER_KEY, DEFAULT_FILTERS);
  const filters: TimelineFilters = { ...DEFAULT_FILTERS, ...storedFilters, dateRange: storedFilters.dateRange ?? DEFAULT_FILTERS.dateRange };
  const historyStatsQuery = useHistoryStats();
  const dateBounds = retainedHistoryDateBounds(historyStatsQuery.data);
  const [laneBy, setLaneBy] = useState<"group" | "provider">(DEFAULT_LANE_BY);
  const setFilter = <K extends keyof TimelineFilters>(key: K, value: TimelineFilters[K]) => setFilters({ ...filters, [key]: value });
  const applyPreset = (value: TimelineFilterPresetValue) => {
    setFilters({ ...DEFAULT_FILTERS, ...value.filters, dateRange: value.filters.dateRange ?? DEFAULT_FILTERS.dateRange });
    setLaneBy(value.laneBy ?? DEFAULT_LANE_BY);
  };
  useEffect(() => {
    const raw = localStorage.getItem(TIMELINE_DRILLDOWN_KEY);
    if (!raw) return;
    localStorage.removeItem(TIMELINE_DRILLDOWN_KEY);
    try {
      const parsed = timelineDrilldownFilters(JSON.parse(raw));
      if (!parsed) return;
      setFilters({ ...DEFAULT_FILTERS, ...parsed, dateRange: parsed.dateRange ?? DEFAULT_FILTERS.dateRange });
      setLaneBy(parsed.provider && parsed.provider !== ALL ? "provider" : DEFAULT_LANE_BY);
    } catch {
      // Ignore stale drilldown payloads.
    }
  }, []);
  const eventsQuery = useHistoryEvents({
    range: filters.dateRange,
    groupId: filters.group === ALL ? undefined : filters.group,
    accountId: filters.account === ALL ? undefined : filters.account,
    provider: filters.provider === ALL ? undefined : filters.provider,
    status: filters.status === ALL ? undefined : filters.status,
    severity: filters.severity === ALL ? undefined : filters.severity,
    category: filters.category === ALL ? undefined : filters.category,
    types: toSingleEventType(filters.type),
  });
  const accountsQuery = useAccounts();
  const groupsQuery = useGroups();
  const providersQuery = useProviders();
  const snapshotQuery = useMonitorData();
  const serviceMetadataQuery = useServiceMetadata();
  const accountsById = useMemo(() => accountMap(accountsQuery.data ?? []), [accountsQuery.data]);
  const groupsById = useMemo(() => groupMap(groupsQuery.data ?? []), [groupsQuery.data]);
  const services = snapshotQuery.data?.services ?? [];
  const serviceMetadataById = useMemo(() => new Map((serviceMetadataQuery.data ?? []).map((metadata) => [metadata.serviceId, metadata])), [serviceMetadataQuery.data]);
  const events = (eventsQuery.data ?? []).filter((event) => {
    if (filters.owner === ALL && filters.tier === "all" && filters.dependency === ALL) return true;
    const metadata = metadataForEvent(event, accountsById, services, serviceMetadataById);
    if (filters.owner !== ALL && metadata?.owner !== filters.owner) return false;
    if (filters.tier !== "all" && metadata?.tier !== filters.tier) return false;
    if (filters.dependency !== ALL && !metadata?.dependencies?.includes(filters.dependency)) return false;
    return true;
  });
  const laneOptions = [{ value: "group", label: "Group lanes" }, { value: "provider", label: "Provider lanes" }];
  const groupOptions = [{ value: ALL, label: "All groups" }, ...(groupsQuery.data ?? []).map((group) => ({ value: group.id, label: group.name }))];
  const providerOptions = [{ value: ALL, label: "All providers" }, ...(providersQuery.data ?? []).map((provider) => ({ value: provider.id, label: provider.label }))];
  const accountOptions = [{ value: ALL, label: "All accounts" }, ...(accountsQuery.data ?? []).map((account) => ({ value: account.id, label: account.label }))];
  const statusOptions = [...STATUS_FILTER_OPTIONS, { value: "open", label: "Open" }, { value: "acknowledged", label: "Acknowledged" }, { value: "resolved", label: "Resolved" }, { value: "scheduled", label: "Scheduled" }];
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
    laneBy !== DEFAULT_LANE_BY
      ? { id: "laneBy", label: "Display", value: optionLabel(laneOptions, laneBy), onClear: () => setLaneBy(DEFAULT_LANE_BY) }
      : null,
    filters.type !== DEFAULT_FILTERS.type
      ? { id: "type", label: "Event", value: optionLabel(EVENT_TYPE_OPTIONS, filters.type), onClear: () => setFilter("type", DEFAULT_FILTERS.type) }
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
      ? { id: "status", label: "Status", value: optionLabel(statusOptions, filters.status), onClear: () => setFilter("status", DEFAULT_FILTERS.status) }
      : null,
    filters.severity !== DEFAULT_FILTERS.severity
      ? { id: "severity", label: "Severity", value: optionLabel(SEVERITY_FILTER_OPTIONS, filters.severity), onClear: () => setFilter("severity", DEFAULT_FILTERS.severity) }
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
  const exportTimeline = () => {
    downloadTimelineCsv(events, accountsById, groupsById, dateRangeLabel(filters.dateRange));
    toast.success(`Exported ${events.length} timeline ${events.length === 1 ? "event" : "events"}`);
  };

  return (
    <ScrollArea
      title="Timeline"
      actions={
        <div className="flex min-w-0 items-center gap-2 flex-wrap justify-end">
          <Button variant="glass" size="small" onClick={exportTimeline} disabled={events.length === 0}>
            <Download className="size-4" />
            Export CSV
          </Button>
          <FilterMenu
            filters={activeFilters}
            onReset={() => {
              resetFilters();
              setLaneBy(DEFAULT_LANE_BY);
            }}
            presetKey={FILTER_PRESET_KEY}
            presetValue={{ filters, laneBy }}
            onApplyPreset={applyPreset}
          >
            <FilterDateRangeField label="Range" value={filters.dateRange} onChange={(value) => setFilter("dateRange", value)} bounds={dateBounds} />
            <FilterSelectField label="Display" value={laneBy} onChange={(value) => setLaneBy(value as "group" | "provider")} options={laneOptions} />
            <FilterSelectField label="Event" value={filters.type} onChange={(value) => setFilter("type", value as TimelineFilters["type"])} options={EVENT_TYPE_OPTIONS} />
            <FilterSelectField label="Group" value={filters.group} onChange={(value) => setFilter("group", value)} options={groupOptions} />
            <FilterSelectField label="Provider" value={filters.provider} onChange={(value) => setFilter("provider", value as TimelineFilters["provider"])} options={providerOptions} />
            <FilterSelectField label="Account" value={filters.account} onChange={(value) => setFilter("account", value)} options={accountOptions} />
            <FilterSelectField label="Status" value={filters.status} onChange={(value) => setFilter("status", value as TimelineFilters["status"])} options={statusOptions} />
            <FilterSelectField label="Severity" value={filters.severity} onChange={(value) => setFilter("severity", value as TimelineFilters["severity"])} options={SEVERITY_FILTER_OPTIONS} />
            <FilterSelectField label="Category" value={filters.category} onChange={(value) => setFilter("category", value as TimelineFilters["category"])} options={CATEGORY_FILTER_OPTIONS} />
            <FilterSelectField label="Owner" value={filters.owner} onChange={(value) => setFilter("owner", value)} options={ownerOptions} />
            <FilterSelectField label="Tier" value={filters.tier} onChange={(value) => setFilter("tier", value as TimelineFilters["tier"])} options={tierOptions} />
            <FilterSelectField label="Dependency" value={filters.dependency} onChange={(value) => setFilter("dependency", value)} options={dependencyOptions} />
          </FilterMenu>
        </div>
      }
      className="h-full"
    >
      <div className="px-2 pb-8 flex flex-col gap-6">
        {events.length === 0 ? (
          activeFilters.length > 0 ? (
            <EmptyState title="No events match filters" description="Adjust or reset filters to show more events.">
              <Button
                variant="glass"
                size="small"
                onClick={() => {
                  resetFilters();
                  setLaneBy(DEFAULT_LANE_BY);
                }}
              >
                Reset filters
              </Button>
            </EmptyState>
          ) : (
            <EmptyState title="No correlation events yet" description="Deploys, failures, recoveries, alerts, and incidents appear after polling records history." />
          )
        ) : (
          <>
            <section className="rounded-lg border border-separator p-3">
              <TimelineChart events={events} dateRange={filters.dateRange} laneBy={laneBy} groupsById={groupsById} />
            </section>
            <section className="flex flex-col gap-2">
              <div className="px-2">
                <Text variant="strong">Recent Events</Text>
              </div>
              <div className="rounded-lg border border-separator p-3">
                {events.length === 0 ? (
                  <Callout color="secondary">No events match the current filters.</Callout>
                ) : (
                  <div className="flex flex-col">
                    {events.slice(0, 60).map((event) => (
                      <EventRow key={event.id} event={event} account={accountsById.get(event.accountId)} />
                    ))}
                  </div>
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </ScrollArea>
  );
}
