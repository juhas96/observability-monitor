import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Download, Edit3, ExternalLink, Plus, Trash2 } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import {
  Badge,
  Button,
  Callout,
  Dialog,
  EmptyState,
  Field,
  FieldSet,
  Input,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Text,
  toast,
} from "@glaze/core/components";

import { BarChart, LineChart, ProgressBar, type ChartPoint } from "./components/charts";
import {
  ALL,
  type AppliedFilter,
  FilterDateRangeField,
  FilterMenu,
  FilterSelectField,
  defaultDateRange,
  dateRangeBounds,
  dateRangeLabel,
  optionLabel,
  retainedHistoryDateBounds,
  sameDateRange,
  useStoredState,
} from "./components/filters";
import { providerLabel } from "./components/provider-meta";
import { monitorApi } from "./ipc";
import { useAccounts, useGroups } from "./hooks/use-accounts";
import { useHistoryEvents, useHistorySeries, useHistoryStats } from "./hooks/use-history";
import { useProviders } from "./hooks/use-providers";
import { useServiceMetadata } from "./hooks/use-service-metadata";
import { useSloMutations, useSloStatus } from "./hooks/use-slos";
import { downloadCsv } from "./utils/csv";
import type { Account, HistoryEvent, HistorySample, HistorySampleAccount, Provider, ServiceMetadata, ServiceTier, SloDefinition, SloStatus } from "./types";

const FILTER_KEY = "insights.filters.v2";
const FILTER_PRESET_KEY = `${FILTER_KEY}.presets`;
const ACCOUNT_SELECT_KEY = "accounts.select.v1";

interface InsightsFilters {
  dateRange: ReturnType<typeof defaultDateRange>;
  group: string;
  provider: "all" | Provider;
  account: string;
  owner: string;
  tier: "all" | ServiceTier;
  dependency: string;
}

const DEFAULT_FILTERS: InsightsFilters = {
  dateRange: defaultDateRange("24h"),
  group: ALL,
  provider: "all",
  account: ALL,
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

function timeLabel(ts: string): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function metadataForAccount(
  accountId: string,
  row: Pick<HistorySampleAccount, "groupId"> | undefined,
  accountsById: Map<string, Account>,
  metadataByService: Map<string, ServiceMetadata>,
): ServiceMetadata | undefined {
  const account = accountsById.get(accountId);
  const serviceId = row?.groupId ?? account?.groupId ?? `account:${accountId}`;
  return metadataByService.get(serviceId);
}

function sampleAccountGroupId(accountId: string, row: Pick<HistorySampleAccount, "groupId">, accountsById: Map<string, Account>): string | undefined {
  return row.groupId ?? accountsById.get(accountId)?.groupId;
}

function matchesMetadataFilters(
  metadata: ServiceMetadata | undefined,
  filters: Pick<InsightsFilters, "owner" | "tier" | "dependency">,
): boolean {
  if (filters.owner !== ALL && metadata?.owner !== filters.owner) return false;
  if (filters.tier !== "all" && metadata?.tier !== filters.tier) return false;
  if (filters.dependency !== ALL && !metadata?.dependencies?.includes(filters.dependency)) return false;
  return true;
}

function eventMetadata(
  event: HistoryEvent,
  accountsById: Map<string, Account>,
  metadataByService: Map<string, ServiceMetadata>,
): ServiceMetadata | undefined {
  const account = accountsById.get(event.accountId);
  const serviceId = event.groupId ?? account?.groupId ?? `account:${event.accountId}`;
  return metadataByService.get(serviceId);
}

function sloMetadata(
  slo: SloDefinition,
  accountsById: Map<string, Account>,
  metadataByService: Map<string, ServiceMetadata>,
): ServiceMetadata | undefined {
  if (slo.scope.groupId) return metadataByService.get(slo.scope.groupId);
  if (slo.scope.accountId) {
    const account = accountsById.get(slo.scope.accountId);
    return metadataByService.get(account?.groupId ?? `account:${slo.scope.accountId}`);
  }
  return undefined;
}

function countsFor(
  sample: HistorySample,
  filters: InsightsFilters,
  accountsById: Map<string, Account>,
  metadataByService: Map<string, ServiceMetadata>,
) {
  let success = 0;
  let failure = 0;
  for (const [accountId, row] of Object.entries(sample.perAccount)) {
    if (filters.account !== ALL && accountId !== filters.account) continue;
    if (filters.group !== ALL && sampleAccountGroupId(accountId, row, accountsById) !== filters.group) continue;
    if (filters.provider !== ALL && row.provider !== filters.provider) continue;
    if (!matchesMetadataFilters(metadataForAccount(accountId, row, accountsById, metadataByService), filters)) continue;
    success += row.counts.success;
    failure += row.counts.failure;
  }
  return { success, failure };
}

function pct(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(2)}%`;
}

function sloScopeLabel(slo: SloDefinition, accountsById: Map<string, Account>, groupsById: Map<string, string>): string {
  if (slo.scope.accountId) return `Account · ${accountsById.get(slo.scope.accountId)?.label ?? slo.scope.accountId}`;
  if (slo.scope.groupId) return `Group · ${groupsById.get(slo.scope.groupId) ?? slo.scope.groupId}`;
  if (slo.scope.provider) return `Provider · ${providerLabel(slo.scope.provider)}`;
  return "All activity";
}

function downloadSloCsv(
  statuses: SloStatus[],
  accountsById: Map<string, Account>,
  groupsById: Map<string, string>,
  metadataByService: Map<string, ServiceMetadata>,
): void {
  const columns = [
    "id",
    "name",
    "scope",
    "scopeType",
    "target",
    "windowDays",
    "compliance",
    "remainingBudget",
    "burnRate",
    "atRisk",
    "successCount",
    "failureCount",
    "owner",
    "tier",
    "dependencies",
    "createdAt",
    "updatedAt",
  ];
  const rows = statuses.map((status) => {
    const metadata = sloMetadata(status.slo, accountsById, metadataByService);
    const scopeType = status.slo.scope.accountId ? "account" : status.slo.scope.groupId ? "group" : status.slo.scope.provider ? "provider" : "all";
    return [
      status.slo.id,
      status.slo.name,
      sloScopeLabel(status.slo, accountsById, groupsById),
      scopeType,
      status.slo.target,
      status.slo.windowDays,
      status.compliance ?? "",
      status.remainingBudget ?? "",
      status.burnRate ?? "",
      status.atRisk ? "yes" : "no",
      status.successCount,
      status.failureCount,
      metadata?.owner ?? "",
      metadata?.tier ?? "",
      (metadata?.dependencies ?? []).join("; "),
      status.slo.createdAt,
      status.slo.updatedAt,
    ];
  });
  downloadCsv(`slos-${new Date().toISOString().slice(0, 10)}.csv`, columns, rows);
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="px-2">
        <Text variant="strong">{title}</Text>
      </div>
      <div className="rounded-lg border border-separator p-3 flex flex-col gap-3">{children}</div>
    </section>
  );
}

function StatCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-lg border border-separator p-3">
      <Text variant="small" color="tertiary">{label}</Text>
      <Text variant="title">{value}</Text>
      {detail ? <Text variant="small" color="secondary">{detail}</Text> : null}
    </div>
  );
}

function SloDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: SloDefinition | null;
}) {
  const accountsQuery = useAccounts();
  const groupsQuery = useGroups();
  const providersQuery = useProviders();
  const { save } = useSloMutations();
  const [name, setName] = useState("");
  const [scopeType, setScopeType] = useState<"all" | "group" | "account" | "provider">("all");
  const [scopeValue, setScopeValue] = useState(ALL);
  const [target, setTarget] = useState("99");
  const [windowDays, setWindowDays] = useState("7");

  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? "");
    setTarget(String(editing?.target ?? 99));
    setWindowDays(String(editing?.windowDays ?? 7));
    if (editing?.scope.accountId) {
      setScopeType("account");
      setScopeValue(editing.scope.accountId);
    } else if (editing?.scope.groupId) {
      setScopeType("group");
      setScopeValue(editing.scope.groupId);
    } else if (editing?.scope.provider) {
      setScopeType("provider");
      setScopeValue(editing.scope.provider);
    } else {
      setScopeType("all");
      setScopeValue(ALL);
    }
  }, [editing, open]);

  const saveSlo = async () => {
    const scope: SloDefinition["scope"] = {};
    if (scopeType === "account") scope.accountId = scopeValue;
    if (scopeType === "group") scope.groupId = scopeValue;
    if (scopeType === "provider") scope.provider = scopeValue as Provider;
    try {
      await save.mutateAsync({
        id: editing?.id,
        name: name.trim(),
        scope,
        target: Number(target),
        windowDays: Number(windowDays),
      });
      toast.success(editing ? "SLO updated" : "SLO created");
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const scopeOptions = scopeType === "group"
    ? (groupsQuery.data ?? []).map((group) => ({ value: group.id, label: group.name }))
    : scopeType === "account"
    ? (accountsQuery.data ?? []).map((account) => ({ value: account.id, label: account.label }))
    : scopeType === "provider"
    ? (providersQuery.data ?? []).map((provider) => ({ value: provider.id, label: provider.label }))
    : [{ value: ALL, label: "All monitored activity" }];

  useEffect(() => {
    if (scopeType === "all") {
      setScopeValue(ALL);
      return;
    }
    if (!scopeOptions.some((option) => option.value === scopeValue)) setScopeValue(scopeOptions[0]?.value ?? ALL);
  }, [scopeOptions, scopeType, scopeValue]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Edit SLO" : "Create SLO"}
      confirmLabel="Save"
      confirmDisabled={name.trim() === ""}
      onConfirm={saveSlo}
      size="medium"
    >
      <FieldSet>
        <Field label="Name" orientation="vertical" className="p-0">
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Production availability" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Target %" orientation="vertical" className="p-0">
            <Input value={target} onChange={(event) => setTarget(event.target.value)} placeholder="99" />
          </Field>
          <Field label="Window days" orientation="vertical" className="p-0">
            <Input value={windowDays} onChange={(event) => setWindowDays(event.target.value)} placeholder="7" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Scope" orientation="vertical" className="p-0">
            <Select value={scopeType} onValueChange={(value) => setScopeType(value as typeof scopeType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="group">Group</SelectItem>
                <SelectItem value="account">Account</SelectItem>
                <SelectItem value="provider">Provider</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Target" orientation="vertical" className="p-0">
            <Select value={scopeValue} onValueChange={setScopeValue} disabled={scopeType === "all"}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {scopeOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      </FieldSet>
    </Dialog>
  );
}

function SloCard({ status, onEdit }: { status: SloStatus; onEdit: () => void }) {
  const { remove } = useSloMutations();
  const navigate = useNavigate();
  const points: ChartPoint[] = status.series.map((point) => ({
    label: timeLabel(point.ts),
    value: point.compliance === null ? 0 : point.compliance * 100,
    secondary: point.remainingBudget === null ? 0 : point.remainingBudget * 100,
  }));
  const scope = status.slo.scope.accountId
    ? "Account"
    : status.slo.scope.groupId
    ? "Group"
    : status.slo.scope.provider
    ? providerLabel(status.slo.scope.provider)
    : "All activity";
  const deleteSlo = async () => {
    if (!window.confirm(`Delete SLO "${status.slo.name}"?`)) return;
    try {
      await remove.mutateAsync(status.slo.id);
      toast.success("SLO deleted.");
    } catch (error) {
      toast.error(String(error));
    }
  };
  const targetPayload = status.slo.scope.accountId
    ? { accountId: status.slo.scope.accountId }
    : status.slo.scope.groupId
    ? { filters: { group: status.slo.scope.groupId } }
    : status.slo.scope.provider
    ? { filters: { provider: status.slo.scope.provider } }
    : null;
  const openTarget = () => {
    if (!targetPayload) return;
    localStorage.setItem(ACCOUNT_SELECT_KEY, JSON.stringify(targetPayload));
    void navigate({ to: "/accounts" });
  };

  return (
    <div className="rounded-lg border border-separator p-3 flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Text variant="strong" truncate>{status.slo.name}</Text>
          <Text variant="small" color="secondary">{scope} · {status.slo.target}% over {status.slo.windowDays}d</Text>
        </div>
        <Badge color={status.atRisk ? "red" : "secondary"}>{status.atRisk ? "At risk" : "Tracking"}</Badge>
        {targetPayload ? (
          <Button variant="transparent" size="small" iconOnly aria-label="Open SLO target" onClick={openTarget}>
            <ExternalLink className="size-4" />
          </Button>
        ) : null}
        <Button variant="transparent" size="small" iconOnly aria-label="Edit SLO" onClick={onEdit}>
          <Edit3 className="size-4" />
        </Button>
        <Button
          variant="transparent"
          size="small"
          iconOnly
          aria-label="Delete SLO"
          onClick={() => void deleteSlo()}
        >
          <Trash2 className="size-4 text-support-red" />
        </Button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <StatCard label="Compliance" value={pct(status.compliance)} />
        <StatCard label="Budget left" value={pct(status.remainingBudget)} />
        <StatCard label="Burn rate" value={status.burnRate === null ? "n/a" : `${status.burnRate.toFixed(2)}x`} />
      </div>
      <ProgressBar value={status.remainingBudget} danger={status.atRisk} />
      <LineChart points={points} label="Compliance" secondaryLabel="Budget" />
    </div>
  );
}

export function InsightsView() {
  const [storedFilters, setFilters, resetFilters] = useStoredState<InsightsFilters>(FILTER_KEY, DEFAULT_FILTERS);
  const filters: InsightsFilters = { ...DEFAULT_FILTERS, ...storedFilters, dateRange: storedFilters.dateRange ?? DEFAULT_FILTERS.dateRange };
  const historyStatsQuery = useHistoryStats();
  const dateBounds = retainedHistoryDateBounds(historyStatsQuery.data);
  const [sloOpen, setSloOpen] = useState(false);
  const [editingSlo, setEditingSlo] = useState<SloDefinition | null>(null);
  const seriesQuery = useHistorySeries(filters.dateRange, {
    groupId: filters.group === ALL ? undefined : filters.group,
    accountId: filters.account === ALL ? undefined : filters.account,
    provider: filters.provider === ALL ? undefined : filters.provider,
  });
  const eventsQuery = useHistoryEvents({
    range: filters.dateRange,
    groupId: filters.group === ALL ? undefined : filters.group,
    accountId: filters.account === ALL ? undefined : filters.account,
    provider: filters.provider === "all" ? undefined : filters.provider,
    types: ["deploy", "failure", "recovery", "alert", "incident"],
  });
  const sloStatusQuery = useSloStatus();
  const groupsQuery = useGroups();
  const providersQuery = useProviders();
  const accountsQuery = useAccounts();
  const serviceMetadataQuery = useServiceMetadata();

  const setFilter = <K extends keyof InsightsFilters>(key: K, value: InsightsFilters[K]) => setFilters({ ...filters, [key]: value });

  const series = seriesQuery.data ?? [];
  const accountsById = useMemo(() => new Map((accountsQuery.data ?? []).map((account) => [account.id, account])), [accountsQuery.data]);
  const groupsById = useMemo(() => new Map((groupsQuery.data ?? []).map((group) => [group.id, group.name])), [groupsQuery.data]);
  const serviceMetadataById = useMemo(() => new Map((serviceMetadataQuery.data ?? []).map((metadata) => [metadata.serviceId, metadata])), [serviceMetadataQuery.data]);
  const filteredEvents = useMemo(() => (eventsQuery.data ?? []).filter((event) =>
    matchesMetadataFilters(eventMetadata(event, accountsById, serviceMetadataById), filters)
  ), [accountsById, eventsQuery.data, filters, serviceMetadataById]);
  const filteredSloStatuses = useMemo(() => (sloStatusQuery.data ?? []).filter((status) =>
    matchesMetadataFilters(sloMetadata(status.slo, accountsById, serviceMetadataById), filters)
  ), [accountsById, filters, serviceMetadataById, sloStatusQuery.data]);
  const trendPoints = useMemo<ChartPoint[]>(() => series.map((sample) => {
    const counts = countsFor(sample, filters, accountsById, serviceMetadataById);
    return { label: timeLabel(sample.ts), value: counts.success, secondary: counts.failure };
  }), [accountsById, filters, series, serviceMetadataById]);
  const deployPoints = useMemo<ChartPoint[]>(() => series.map((sample) => ({
    label: timeLabel(sample.ts),
    value: Object.entries(sample.perAccount)
      .filter(([accountId, row]) =>
        (filters.account === ALL || accountId === filters.account) &&
        (filters.group === ALL || sampleAccountGroupId(accountId, row, accountsById) === filters.group) &&
        (filters.provider === ALL || row.provider === filters.provider) &&
        matchesMetadataFilters(metadataForAccount(accountId, row, accountsById, serviceMetadataById), filters)
      )
      .reduce((sum, [, row]) => sum + row.counts.success + row.counts.failure, 0),
  })), [accountsById, filters, series, serviceMetadataById]);
  const alertPoints = useMemo<ChartPoint[]>(() => {
    const { start, end } = dateRangeBounds(filters.dateRange);
    const bucketMs = Math.max(60 * 1000, Math.ceil(Math.max(60 * 1000, end - start) / 120));
    const buckets = new Map<number, number>();
    for (const event of filteredEvents) {
      if (event.type !== "alert") continue;
      const bucket = Math.floor(new Date(event.ts).getTime() / bucketMs) * bucketMs;
      buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
    }
    return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([bucket, value]) => ({ label: timeLabel(new Date(bucket).toISOString()), value }));
  }, [filteredEvents, filters.dateRange]);

  const totals = trendPoints.reduce((sum, point) => ({
    success: sum.success + point.value,
    failure: sum.failure + (point.secondary ?? 0),
  }), { success: 0, failure: 0 });
  const totalAttempts = totals.success + totals.failure;
  const successRate = totalAttempts > 0 ? totals.success / totalAttempts : null;

  const exportEvents = async () => {
    try {
      const result = await monitorApi.exportHistory({
        dataset: "events",
        format: "csv",
        dateRange: filters.dateRange,
        groupId: filters.group === ALL ? undefined : filters.group,
        accountId: filters.account === ALL ? undefined : filters.account,
        provider: filters.provider === "all" ? undefined : filters.provider,
        types: ["deploy", "failure", "recovery", "alert", "incident"],
      });
      if (result.ok) toast.success("History exported.");
    } catch (error) {
      toast.error(String(error));
    }
  };
  const exportSlos = () => {
    downloadSloCsv(filteredSloStatuses, accountsById, groupsById, serviceMetadataById);
    toast.success(`Exported ${filteredSloStatuses.length} ${filteredSloStatuses.length === 1 ? "SLO" : "SLOs"}`);
  };

  const groupOptions = [{ value: ALL, label: "All groups" }, ...(groupsQuery.data ?? []).map((group) => ({ value: group.id, label: group.name }))];
  const providerOptions = [{ value: ALL, label: "All providers" }, ...(providersQuery.data ?? []).map((provider) => ({ value: provider.id, label: provider.label }))];
  const accountOptions = [{ value: ALL, label: "All accounts" }, ...(accountsQuery.data ?? []).map((account) => ({ value: account.id, label: account.label }))];
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
  const hasRetainedHistory = Boolean(
    historyStatsQuery.data &&
    (historyStatsQuery.data.sampleCount > 0 || historyStatsQuery.data.eventCount > 0 || historyStatsQuery.data.checkSampleCount > 0),
  );

  const actions = (
    <div className="flex min-w-0 items-center gap-2 flex-wrap justify-end">
      <FilterMenu
        filters={activeFilters}
        onReset={resetFilters}
        presetKey={FILTER_PRESET_KEY}
        presetValue={filters}
        onApplyPreset={(value) => setFilters({ ...DEFAULT_FILTERS, ...value, dateRange: value.dateRange ?? DEFAULT_FILTERS.dateRange })}
      >
        <FilterDateRangeField label="Range" value={filters.dateRange} onChange={(value) => setFilter("dateRange", value)} bounds={dateBounds} />
        <FilterSelectField label="Group" value={filters.group} onChange={(value) => setFilter("group", value)} options={groupOptions} />
        <FilterSelectField label="Provider" value={filters.provider} onChange={(value) => setFilter("provider", value as InsightsFilters["provider"])} options={providerOptions} />
        <FilterSelectField label="Account" value={filters.account} onChange={(value) => setFilter("account", value)} options={accountOptions} />
        <FilterSelectField label="Owner" value={filters.owner} onChange={(value) => setFilter("owner", value)} options={ownerOptions} />
        <FilterSelectField label="Tier" value={filters.tier} onChange={(value) => setFilter("tier", value as InsightsFilters["tier"])} options={tierOptions} />
        <FilterSelectField label="Dependency" value={filters.dependency} onChange={(value) => setFilter("dependency", value)} options={dependencyOptions} />
      </FilterMenu>
      <Button variant="glass" size="large" onClick={exportEvents}>
        <Download className="size-4" /> Export
      </Button>
    </div>
  );

  return (
    <ScrollArea title="Insights" actions={actions} className="h-full">
      <div className="px-2 pb-8 flex flex-col gap-6">
        {series.length === 0 ? (
          hasRetainedHistory ? (
            <EmptyState title="No history matches filters" description="Adjust the range or reset filters to show retained samples.">
              {activeFilters.length > 0 ? <Button variant="glass" size="small" onClick={resetFilters}>Reset filters</Button> : null}
            </EmptyState>
          ) : (
            <EmptyState title="No history yet" description="History starts accumulating after the next polling cycle." />
          )
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <StatCard label="Success rate" value={pct(successRate)} detail={`${totals.success} successful / ${totals.failure} failed`} />
              <StatCard label="Incident events" value={String(filteredEvents.filter((event) => event.type === "incident").length)} />
              <StatCard label="Alerts in range" value={String(filteredEvents.filter((event) => event.type === "alert").length)} />
            </div>
            <div className="grid grid-cols-1 2xl:grid-cols-2 gap-6">
              <Section title="Success vs failure">
                <LineChart points={trendPoints} label="Success" secondaryLabel="Failure" />
              </Section>
              <Section title="Deploy and run frequency">
                <BarChart points={deployPoints} label="Deploy and run frequency" />
              </Section>
              <Section title="Alert volume">
                <LineChart points={alertPoints} label="Alerts" />
              </Section>
            </div>
          </>
        )}

        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2 px-2">
            <Text variant="strong">SLOs</Text>
            <div className="ml-auto flex items-center gap-2">
              <Button
                variant="glass"
                size="small"
                onClick={exportSlos}
                disabled={filteredSloStatuses.length === 0}
              >
                <Download className="size-4" />
                Export SLOs
              </Button>
              <Button
                variant="glass"
                size="small"
                onClick={() => {
                  setEditingSlo(null);
                  setSloOpen(true);
                }}
              >
                <Plus className="size-4" />
                Add SLO
              </Button>
            </div>
          </div>
          {(sloStatusQuery.data ?? []).length === 0 ? (
            <Callout color="secondary">Create an SLO to track compliance and error budget from persisted samples.</Callout>
          ) : filteredSloStatuses.length === 0 ? (
            <Callout color="secondary">
              <div className="flex items-center justify-between gap-3">
                <Text variant="small">No SLOs match the current filters.</Text>
                <Button variant="glass" size="small" onClick={resetFilters}>Reset filters</Button>
              </div>
            </Callout>
          ) : (
            <div className="grid grid-cols-1 2xl:grid-cols-2 gap-4">
              {filteredSloStatuses.map((status) => (
                <SloCard
                  key={status.slo.id}
                  status={status}
                  onEdit={() => {
                    setEditingSlo(status.slo);
                    setSloOpen(true);
                  }}
                />
              ))}
            </div>
          )}
        </section>
      </div>
      <SloDialog open={sloOpen} onOpenChange={setSloOpen} editing={editingSlo} />
    </ScrollArea>
  );
}
