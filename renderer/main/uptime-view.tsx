import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Bell, Download, Edit3, ExternalLink, Plus, Search, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
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
  Switch,
  Text,
  toast,
} from "@glaze/core/components";

import { LineChart, type ChartPoint } from "./components/charts";
import { openInvestigation } from "./components/investigation";
import {
  ALL,
  type AppliedFilter,
  FilterDateRangeField,
  FilterMenu,
  FilterSearchField,
  FilterSelectField,
  dateRangeLabel,
  defaultDateRange,
  optionLabel,
  retainedHistoryDateBounds,
  sameDateRange,
  useStoredState,
} from "./components/filters";
import { useGroups } from "./hooks/use-accounts";
import { useChecks, useCheckLatency, useCheckMutations } from "./hooks/use-checks";
import { useHistoryStats } from "./hooks/use-history";
import { useMonitorData } from "./hooks/use-monitor-data";
import { useServiceMetadata } from "./hooks/use-service-metadata";
import { monitorApi } from "./ipc";
import { downloadCsv } from "./utils/csv";
import type { HistoryDateRange, HistoryRange, HttpCheck, HttpCheckResult, ServiceMetadata, ServiceTier } from "./types";

const NONE = "none";
const METHODS = ["GET", "HEAD", "POST"];
const FILTER_KEY = "uptime.filters.v1";
const FILTER_PRESET_KEY = `${FILTER_KEY}.presets`;
const UPTIME_DRILLDOWN_KEY = "uptime.drilldown.v1";
const UPTIME_CREATE_KEY = "uptime.create.v1";
const ALERT_RULE_DRAFT_KEY = "alerts.draft.v1";

interface UptimeFilters {
  dateRange: HistoryDateRange;
  group: string;
  status: "all" | "up" | "down" | "pending";
  enabled: "all" | "enabled" | "disabled";
  method: "all" | string;
  search: string;
  owner: string;
  tier: "all" | ServiceTier;
  dependency: string;
}

const DEFAULT_FILTERS: UptimeFilters = {
  dateRange: defaultDateRange("24h"),
  group: ALL,
  status: "all",
  enabled: "all",
  method: "all",
  search: "",
  owner: ALL,
  tier: "all",
  dependency: ALL,
};

function uptimeDrilldownFilters(value: unknown): Partial<UptimeFilters> | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<UptimeFilters>;
  return {
    dateRange: candidate.dateRange,
    group: typeof candidate.group === "string" ? candidate.group : undefined,
    status: typeof candidate.status === "string" ? candidate.status as UptimeFilters["status"] : undefined,
    enabled: typeof candidate.enabled === "string" ? candidate.enabled as UptimeFilters["enabled"] : undefined,
    method: typeof candidate.method === "string" ? candidate.method : undefined,
    search: typeof candidate.search === "string" ? candidate.search : undefined,
    owner: typeof candidate.owner === "string" ? candidate.owner : undefined,
    tier: typeof candidate.tier === "string" ? candidate.tier as UptimeFilters["tier"] : undefined,
    dependency: typeof candidate.dependency === "string" ? candidate.dependency : undefined,
  };
}

const SERVICE_TIERS: { value: ServiceTier; label: string }[] = [
  { value: "critical", label: "Critical" },
  { value: "standard", label: "Standard" },
  { value: "internal", label: "Internal" },
  { value: "experimental", label: "Experimental" },
];

function timeLabel(ts: string): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function pct(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${(value * 100).toFixed(2)}%`;
}

function metadataForCheck(check: HttpCheck, metadataByService: Map<string, ServiceMetadata>): ServiceMetadata | undefined {
  return check.groupId ? metadataByService.get(check.groupId) : undefined;
}

function uptimeExportFilename(rangeLabel: string): string {
  const safeRange = rangeLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "filtered";
  return `uptime-${safeRange}-${new Date().toISOString().slice(0, 10)}.csv`;
}

function downloadUptimeCsv({
  checks,
  resultsByCheck,
  groupsById,
  metadataByService,
  rangeLabel,
}: {
  checks: HttpCheck[];
  resultsByCheck: Map<string, HttpCheckResult>;
  groupsById: Map<string, { name: string }>;
  metadataByService: Map<string, ServiceMetadata>;
  rangeLabel: string;
}): void {
  const columns = [
    "id",
    "name",
    "url",
    "method",
    "expectedStatus",
    "enabled",
    "group",
    "groupId",
    "status",
    "lastCheckedAt",
    "lastStatusCode",
    "lastLatencyMs",
    "lastError",
    "owner",
    "tier",
    "dependencies",
    "createdAt",
  ];
  const rows = checks.map((check) => {
    const result = resultsByCheck.get(check.id);
    const metadata = metadataForCheck(check, metadataByService);
    return [
      check.id,
      check.name,
      check.url,
      check.method,
      check.expectedStatus ?? "",
      check.enabled ? "enabled" : "disabled",
      check.groupId ? groupsById.get(check.groupId)?.name ?? "" : "",
      check.groupId ?? "",
      result ? (result.ok ? "up" : "down") : "pending",
      result?.checkedAt ?? "",
      result?.statusCode ?? "",
      result?.latencyMs ?? "",
      result?.error ?? "",
      metadata?.owner ?? "",
      metadata?.tier ?? "",
      (metadata?.dependencies ?? []).join("; "),
      check.createdAt,
    ];
  });
  downloadCsv(uptimeExportFilename(rangeLabel), columns, rows);
}

function StatCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-separator p-3">
      <Text variant="small" color="tertiary" className="block">{label}</Text>
      <Text variant="strong" className="block">{value}</Text>
      {detail ? <Text variant="small" color="secondary" className="block">{detail}</Text> : null}
    </div>
  );
}

function CheckDialog({
  open,
  editing,
  onOpenChange,
}: {
  open: boolean;
  editing: HttpCheck | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { save } = useCheckMutations();
  const groupsQuery = useGroups();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [method, setMethod] = useState("GET");
  const [expectedStatus, setExpectedStatus] = useState("");
  const [groupId, setGroupId] = useState(NONE);
  const [enabled, setEnabled] = useState(true);

  // Seed the form whenever the dialog opens for a (new or existing) check.
  useMemo(() => {
    if (!open) return;
    setName(editing?.name ?? "");
    setUrl(editing?.url ?? "");
    setMethod(editing?.method ?? "GET");
    setExpectedStatus(editing?.expectedStatus ? String(editing.expectedStatus) : "");
    setGroupId(editing?.groupId ?? NONE);
    setEnabled(editing?.enabled ?? true);
  }, [open, editing]);

  const saveCheck = async () => {
    const expected = Number(expectedStatus);
    try {
      await save.mutateAsync({
        id: editing?.id,
        name: name.trim(),
        url: url.trim(),
        method,
        expectedStatus: expectedStatus.trim() !== "" && Number.isFinite(expected) ? expected : undefined,
        groupId: groupId === NONE ? undefined : groupId,
        enabled,
      });
      onOpenChange(false);
    } catch (error) {
      toast.error(String(error));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Edit check" : "Add check"}
      confirmLabel="Save"
      confirmDisabled={name.trim() === "" || url.trim() === ""}
      onConfirm={saveCheck}
      size="medium"
    >
      <FieldSet>
        <Field label="Name" orientation="vertical" className="p-0">
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="API health" />
        </Field>
        <Field label="URL" orientation="vertical" className="p-0">
          <Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://api.example.com/health" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Method" orientation="vertical" className="p-0">
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Expected status (optional)" orientation="vertical" className="p-0">
            <Input value={expectedStatus} onChange={(event) => setExpectedStatus(event.target.value)} placeholder="200" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Group" orientation="vertical" className="p-0">
            <Select value={groupId} onValueChange={setGroupId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No group</SelectItem>
                {(groupsQuery.data ?? []).map((group) => <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Enabled" orientation="vertical" className="p-0">
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </Field>
        </div>
      </FieldSet>
    </Dialog>
  );
}

function CheckCard({
  check,
  result,
  range,
  onEdit,
}: {
  check: HttpCheck;
  result: HttpCheckResult | undefined;
  range: HistoryRange | HistoryDateRange;
  onEdit: () => void;
}) {
  const { remove } = useCheckMutations();
  const navigate = useNavigate();
  const latencyQuery = useCheckLatency(check.id, range);
  const points: ChartPoint[] = (latencyQuery.data?.points ?? []).map((point) => ({
    label: timeLabel(point.ts),
    value: point.latencyMs ?? 0,
  }));
  const deleteCheck = async () => {
    if (!window.confirm(`Delete uptime check "${check.name}"?`)) return;
    try {
      await remove.mutateAsync(check.id);
      toast.success("Check deleted.");
    } catch (error) {
      toast.error(String(error));
    }
  };

  const status = result === undefined
    ? { color: "secondary" as const, label: "Pending" }
    : result.ok
    ? { color: "green" as const, label: "Up" }
    : { color: "red" as const, label: "Down" };
  const detail = result
    ? [result.statusCode ? `HTTP ${result.statusCode}` : undefined, result.error, `${result.latencyMs} ms`]
        .filter(Boolean)
        .join(" · ")
    : "Awaiting first check";
  const createDownAlert = () => {
    localStorage.setItem(ALERT_RULE_DRAFT_KEY, JSON.stringify({
      name: `Uptime down: ${check.name}`,
      metric: "checkDown",
      operator: "gt",
      threshold: 0,
      scope: { checkId: check.id },
      enabled: true,
      forMinutes: 2,
      cooldownMinutes: 15,
      dedupeMinutes: 30,
    }));
    void navigate({ to: "/alerts" });
  };
  const openEndpoint = () => {
    void monitorApi.openExternal(check.url).catch((error) => toast.error(error instanceof Error ? error.message : String(error)));
  };
  const investigate = () => openInvestigation({ kind: "manual", groupId: check.groupId, title: check.name, subtitle: result?.error ?? check.url, ts: result?.checkedAt, url: check.url });

  return (
    <div className="rounded-lg border border-separator p-3 flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Text variant="strong" truncate className="block">{check.name}</Text>
          <Text variant="small" color="secondary" truncate className="block">{check.method} · {check.url}</Text>
        </div>
        <Badge color={status.color}>{status.label}</Badge>
        {!check.enabled ? <Badge color="secondary">Disabled</Badge> : null}
        <Button variant="transparent" size="small" iconOnly aria-label="Open endpoint" title="Open endpoint" onClick={openEndpoint}>
          <ExternalLink className="size-4" />
        </Button>
        {result && !result.ok ? (
          <Button variant="transparent" size="small" iconOnly aria-label="Investigate check" title="Investigate check" onClick={investigate}>
            <Search className="size-4" />
          </Button>
        ) : null}
        <Button variant="transparent" size="small" iconOnly aria-label="Create uptime alert" onClick={createDownAlert}>
          <Bell className="size-4" />
        </Button>
        <Button variant="transparent" size="small" iconOnly aria-label="Edit check" onClick={onEdit}>
          <Edit3 className="size-4" />
        </Button>
        <Button
          variant="transparent"
          size="small"
          iconOnly
          aria-label="Delete check"
          onClick={() => void deleteCheck()}
        >
          <Trash2 className="size-4 text-support-red" />
        </Button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <StatCard label="Status" value={status.label} detail={detail} />
        <StatCard label="Uptime" value={pct(latencyQuery.data?.uptime)} />
        <StatCard
          label="Avg latency"
          value={latencyQuery.data?.avgLatencyMs != null ? `${latencyQuery.data.avgLatencyMs} ms` : "—"}
        />
      </div>
      <LineChart points={points} label="Latency (ms)" />
    </div>
  );
}

export function UptimeView() {
  const [storedFilters, setFilters, resetFilters] = useStoredState<UptimeFilters>(FILTER_KEY, DEFAULT_FILTERS);
  const filters: UptimeFilters = { ...DEFAULT_FILTERS, ...storedFilters, dateRange: storedFilters.dateRange ?? DEFAULT_FILTERS.dateRange };
  const historyStatsQuery = useHistoryStats();
  const dateBounds = retainedHistoryDateBounds(historyStatsQuery.data);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<HttpCheck | null>(null);
  const checksQuery = useChecks();
  const groupsQuery = useGroups();
  const snapshotQuery = useMonitorData();
  const serviceMetadataQuery = useServiceMetadata();
  const setFilter = <K extends keyof UptimeFilters>(key: K, value: UptimeFilters[K]) => setFilters({ ...filters, [key]: value });

  useEffect(() => {
    const raw = localStorage.getItem(UPTIME_DRILLDOWN_KEY);
    if (!raw) return;
    localStorage.removeItem(UPTIME_DRILLDOWN_KEY);
    try {
      const parsed = uptimeDrilldownFilters(JSON.parse(raw));
      if (!parsed) return;
      setFilters({ ...DEFAULT_FILTERS, ...parsed, dateRange: parsed.dateRange ?? DEFAULT_FILTERS.dateRange });
    } catch {
      // Ignore stale drilldown payloads.
    }
  }, []);

  const resultsByCheck = useMemo(() => {
    const map = new Map<string, HttpCheckResult>();
    for (const result of snapshotQuery.data?.checks ?? []) map.set(result.checkId, result);
    return map;
  }, [snapshotQuery.data]);
  const serviceMetadataById = useMemo(() => new Map((serviceMetadataQuery.data ?? []).map((metadata) => [metadata.serviceId, metadata])), [serviceMetadataQuery.data]);
  const groupsById = useMemo(() => new Map((groupsQuery.data ?? []).map((group) => [group.id, group])), [groupsQuery.data]);

  const openNew = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (check: HttpCheck) => {
    setEditing(check);
    setDialogOpen(true);
  };

  useEffect(() => {
    const raw = localStorage.getItem(UPTIME_CREATE_KEY);
    if (!raw) return;
    localStorage.removeItem(UPTIME_CREATE_KEY);
    openNew();
  }, []);

  const checks = (checksQuery.data ?? []).filter((check) => {
    const result = resultsByCheck.get(check.id);
    const metadata = metadataForCheck(check, serviceMetadataById);
    const text = `${check.id} ${check.name} ${check.url}`.toLowerCase();
    if (filters.group !== ALL && check.groupId !== filters.group) return false;
    if (filters.enabled === "enabled" && !check.enabled) return false;
    if (filters.enabled === "disabled" && check.enabled) return false;
    if (filters.method !== "all" && check.method !== filters.method) return false;
    if (filters.owner !== ALL && metadata?.owner !== filters.owner) return false;
    if (filters.tier !== "all" && metadata?.tier !== filters.tier) return false;
    if (filters.dependency !== ALL && !metadata?.dependencies?.includes(filters.dependency)) return false;
    if (filters.search.trim() !== "" && !text.includes(filters.search.trim().toLowerCase())) return false;
    if (filters.status === "up" && !result?.ok) return false;
    if (filters.status === "down" && (!result || result.ok)) return false;
    if (filters.status === "pending" && result) return false;
    return true;
  });

  const groupOptions = [{ value: ALL, label: "All groups" }, ...(groupsQuery.data ?? []).map((group) => ({ value: group.id, label: group.name }))];
  const statusOptions = [{ value: "all", label: "All statuses" }, { value: "up", label: "Up" }, { value: "down", label: "Down" }, { value: "pending", label: "Pending" }];
  const enabledOptions = [{ value: "all", label: "All checks" }, { value: "enabled", label: "Enabled" }, { value: "disabled", label: "Disabled" }];
  const methodOptions = [{ value: "all", label: "All methods" }, ...METHODS.map((method) => ({ value: method, label: method }))];
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
    filters.status !== DEFAULT_FILTERS.status
      ? { id: "status", label: "Status", value: optionLabel(statusOptions, filters.status), onClear: () => setFilter("status", DEFAULT_FILTERS.status) }
      : null,
    filters.enabled !== DEFAULT_FILTERS.enabled
      ? { id: "enabled", label: "Enabled", value: optionLabel(enabledOptions, filters.enabled), onClear: () => setFilter("enabled", DEFAULT_FILTERS.enabled) }
      : null,
    filters.method !== DEFAULT_FILTERS.method
      ? { id: "method", label: "Method", value: optionLabel(methodOptions, filters.method), onClear: () => setFilter("method", DEFAULT_FILTERS.method) }
      : null,
    filters.search.trim() !== DEFAULT_FILTERS.search
      ? { id: "search", label: "Search", value: filters.search.trim(), onClear: () => setFilter("search", DEFAULT_FILTERS.search) }
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
  const exportChecks = () => {
    downloadUptimeCsv({
      checks,
      resultsByCheck,
      groupsById,
      metadataByService: serviceMetadataById,
      rangeLabel: dateRangeLabel(filters.dateRange),
    });
    toast.success(`Exported ${checks.length} uptime ${checks.length === 1 ? "check" : "checks"}`);
  };

  const actions = (
    <div className="flex min-w-0 items-center gap-2 flex-wrap justify-end">
      <Button variant="glass" size="small" onClick={exportChecks} disabled={checks.length === 0}>
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
        <FilterSelectField label="Status" value={filters.status} onChange={(value) => setFilter("status", value as UptimeFilters["status"])} options={statusOptions} />
        <FilterSelectField label="Enabled" value={filters.enabled} onChange={(value) => setFilter("enabled", value as UptimeFilters["enabled"])} options={enabledOptions} />
        <FilterSelectField label="Method" value={filters.method} onChange={(value) => setFilter("method", value)} options={methodOptions} />
        <FilterSelectField label="Owner" value={filters.owner} onChange={(value) => setFilter("owner", value)} options={ownerOptions} />
        <FilterSelectField label="Tier" value={filters.tier} onChange={(value) => setFilter("tier", value as UptimeFilters["tier"])} options={tierOptions} />
        <FilterSelectField label="Dependency" value={filters.dependency} onChange={(value) => setFilter("dependency", value)} options={dependencyOptions} />
        <FilterSearchField label="Search" value={filters.search} onChange={(value) => setFilter("search", value)} placeholder="Search checks" />
      </FilterMenu>
      <Button variant="accent" size="large" onClick={openNew}>
        <Plus className="size-4" /> Add check
      </Button>
    </div>
  );

  return (
    <ScrollArea title="Uptime" actions={actions} className="h-full">
      <div className="px-2 pb-8 flex flex-col gap-4">
        {checks.length === 0 ? (
          <EmptyState
            title={(checksQuery.data ?? []).length === 0 ? "No uptime checks" : "No checks match filters"}
            description={(checksQuery.data ?? []).length === 0 ? "Add an HTTP endpoint to monitor its availability and response time." : "Adjust or reset filters to show more checks."}
          >
            {(checksQuery.data ?? []).length > 0 ? (
              <Button variant="glass" size="small" onClick={resetFilters}>Reset filters</Button>
            ) : null}
          </EmptyState>
        ) : (
          checks.map((check) => (
            <CheckCard
              key={check.id}
              check={check}
              result={resultsByCheck.get(check.id)}
              range={filters.dateRange}
              onEdit={() => openEdit(check)}
            />
          ))
        )}
      </div>
      <CheckDialog open={dialogOpen} editing={editing} onOpenChange={setDialogOpen} />
    </ScrollArea>
  );
}
