import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Bell, Edit3, Plus, RefreshCw, Trash2, ArrowUp, ArrowDown, ExternalLink, Copy, Download, Upload, LayoutTemplate } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
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

import { useAccounts, useGroups } from "./hooks/use-accounts";
import { useChecks } from "./hooks/use-checks";
import { useDashboardCapabilities, useDashboardMutations, useDashboardPanel, useDashboards } from "./hooks/use-dashboards";
import { useProviders } from "./hooks/use-providers";
import { useServiceMetadata } from "./hooks/use-service-metadata";
import { ALL, type AppliedFilter, FilterMenu, FilterSelectField, optionLabel, useStoredState } from "./components/filters";
import { monitorApi } from "./ipc";
import { downloadCsv } from "./utils/csv";
import type {
  AlertRuleInput,
  DashboardDefinition,
  DashboardLocalMetric,
  DashboardPanel,
  DashboardPanelTemplate,
  DashboardPanelResult,
  DashboardQueryCapability,
  DashboardTableRow,
  DashboardVariables,
  DashboardVisualization,
  HistoryEventType,
  HistoryRange,
  Provider,
  ServiceTier,
} from "./types";

const NONE = "none";
const FILTER_KEY = "customDashboards.filters.v2";
const FILTER_PRESET_KEY = `${FILTER_KEY}.presets`;
const TIMELINE_DRILLDOWN_KEY = "timeline.drilldown.v1";
const INCIDENTS_DRILLDOWN_KEY = "incidents.drilldown.v1";
const INCIDENT_CREATE_KEY = "incidents.create.v1";
const UPTIME_DRILLDOWN_KEY = "uptime.drilldown.v1";
const DASHBOARD_SELECT_KEY = "dashboards.select.v1";
const DASHBOARD_CREATE_KEY = "dashboards.create.v1";
const ALERT_RULE_DRAFT_KEY = "alerts.draft.v1";
const ACCOUNT_SELECT_KEY = "accounts.select.v1";

interface DashboardRuntimeFilters {
  group: string;
  provider: string;
  account: string;
  check: string;
  owner: string;
  tier: "all" | ServiceTier;
  dependency: string;
}

const DEFAULT_RUNTIME_FILTERS: DashboardRuntimeFilters = {
  group: ALL,
  provider: ALL,
  account: ALL,
  check: ALL,
  owner: ALL,
  tier: "all",
  dependency: ALL,
};

function variablesToRuntimeFilters(variables: DashboardVariables | undefined): DashboardRuntimeFilters {
  return {
    group: variables?.groupId ?? ALL,
    provider: variables?.provider ?? ALL,
    account: variables?.accountId ?? ALL,
    check: variables?.checkId ?? ALL,
    owner: variables?.owner ?? ALL,
    tier: variables?.tier ?? "all",
    dependency: variables?.dependency ?? ALL,
  };
}

function runtimeFiltersToVariables(filters: DashboardRuntimeFilters): DashboardVariables | undefined {
  const variables: DashboardVariables = {
    groupId: filters.group === ALL ? undefined : filters.group,
    provider: filters.provider === ALL ? undefined : filters.provider as Provider,
    accountId: filters.account === ALL ? undefined : filters.account,
    checkId: filters.check === ALL ? undefined : filters.check,
    owner: filters.owner === ALL ? undefined : filters.owner,
    tier: filters.tier === "all" ? undefined : filters.tier,
    dependency: filters.dependency === ALL ? undefined : filters.dependency,
  };
  return Object.values(variables).some(Boolean) ? variables : undefined;
}

function mergeDashboardVariables(variables: DashboardVariables | undefined, filters: DashboardRuntimeFilters): DashboardRuntimeFilters {
  const base = variablesToRuntimeFilters(variables);
  return {
    group: filters.group === ALL ? base.group : filters.group,
    provider: filters.provider === ALL ? base.provider : filters.provider,
    account: filters.account === ALL ? base.account : filters.account,
    check: filters.check === ALL ? base.check : filters.check,
    owner: filters.owner === ALL ? base.owner : filters.owner,
    tier: filters.tier === "all" ? base.tier : filters.tier,
    dependency: filters.dependency === ALL ? base.dependency : filters.dependency,
  };
}

const RANGE_OPTIONS: { value: HistoryRange; label: string }[] = [
  { value: "15m", label: "15 minutes" },
  { value: "1h", label: "1 hour" },
  { value: "6h", label: "6 hours" },
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "14d", label: "14 days" },
];

const LOCAL_METRIC_BY_CAPABILITY: Record<string, DashboardLocalMetric> = {
  "local.successFailure": "successFailure",
  "local.statusCounts": "statusCounts",
  "local.incidentsAlerts": "incidentsAlerts",
  "local.events": "events",
  "local.snapshotCounts": "snapshotCounts",
  "local.checkLatency": "checkLatency",
  "local.checkUptime": "checkUptime",
};

const SERVICE_TIERS: { value: ServiceTier; label: string }[] = [
  { value: "critical", label: "Critical" },
  { value: "standard", label: "Standard" },
  { value: "internal", label: "Internal" },
  { value: "experimental", label: "Experimental" },
];

const LOCAL_EVENT_TYPE_OPTIONS: { value: HistoryEventType; label: string }[] = [
  { value: "deploy", label: "Deploys" },
  { value: "failure", label: "Failures" },
  { value: "recovery", label: "Recoveries" },
  { value: "alert", label: "Alerts" },
  { value: "incident", label: "Incidents" },
];

const CHART_COLORS = [
  "var(--accent)",
  "var(--red)",
  "var(--green)",
  "var(--orange)",
  "var(--blue)",
  "var(--purple)",
  "var(--color-text-secondary)",
  "var(--color-text-tertiary)",
];

const LOCAL_METRIC_LABELS: Record<DashboardLocalMetric, string> = {
  successFailure: "Success/failure",
  statusCounts: "Status counts",
  incidentsAlerts: "Incidents/alerts",
  events: "Events",
  snapshotCounts: "Current health",
  checkLatency: "Check latency",
  checkUptime: "Check uptime",
};

interface DashboardTemplateDefinition {
  id: string;
  name: string;
  description: string;
  range: HistoryRange;
  refreshSeconds?: number;
  buildPanels: (context: { checkId?: string }) => DashboardPanelTemplate[];
}

const DASHBOARD_TEMPLATES: DashboardTemplateDefinition[] = [
  {
    id: "executive-health",
    name: "Executive health",
    description: "High-level health, status trend, incidents, and recent activity.",
    range: "24h",
    refreshSeconds: 60,
    buildPanels: () => [
      { title: "Current health", source: { kind: "local", metric: "snapshotCounts" }, visualization: "stat", width: "half", height: "small" },
      { title: "Open incidents and alerts", source: { kind: "local", metric: "incidentsAlerts" }, visualization: "line", width: "half", height: "small" },
      { title: "Status counts", source: { kind: "local", metric: "statusCounts" }, visualization: "bar", width: "full", height: "medium" },
      { title: "Recent activity", source: { kind: "local", metric: "events" }, visualization: "table", width: "full", height: "medium" },
    ],
  },
  {
    id: "deployment-reliability",
    name: "Deployment reliability",
    description: "Deploy/release activity, failures, and success/failure trends.",
    range: "7d",
    refreshSeconds: 120,
    buildPanels: () => [
      { title: "Success/failure trend", source: { kind: "local", metric: "successFailure" }, visualization: "line", width: "full", height: "medium" },
      { title: "Deploys and releases", source: { kind: "local", metric: "events", eventTypes: ["deploy"] }, visualization: "table", width: "half", height: "medium" },
      { title: "Recent failures", source: { kind: "local", metric: "events", eventTypes: ["failure"] }, visualization: "table", width: "half", height: "medium" },
      { title: "Status counts", source: { kind: "local", metric: "statusCounts" }, visualization: "bar", width: "full", height: "medium" },
    ],
  },
  {
    id: "incident-response",
    name: "Incident response",
    description: "Response-focused incidents, alerts, failures, and current health.",
    range: "24h",
    refreshSeconds: 60,
    buildPanels: () => [
      { title: "Current health", source: { kind: "local", metric: "snapshotCounts" }, visualization: "stat", width: "half", height: "small" },
      { title: "Open incidents and alerts", source: { kind: "local", metric: "incidentsAlerts" }, visualization: "line", width: "half", height: "small" },
      { title: "Alerts and incidents", source: { kind: "local", metric: "events", eventTypes: ["alert", "incident"] }, visualization: "table", width: "full", height: "medium" },
      { title: "Recent failures", source: { kind: "local", metric: "events", eventTypes: ["failure"] }, visualization: "table", width: "full", height: "medium" },
    ],
  },
  {
    id: "uptime-slo",
    name: "Uptime and SLO",
    description: "Synthetic check health with local status and reliability trends.",
    range: "7d",
    refreshSeconds: 120,
    buildPanels: ({ checkId }) => [
      { title: "Check uptime", source: { kind: "local", metric: "checkUptime", checkId }, visualization: "stat", width: "half", height: "small" },
      { title: "Check latency", source: { kind: "local", metric: "checkLatency", checkId }, visualization: "line", width: "half", height: "small" },
      { title: "Success/failure trend", source: { kind: "local", metric: "successFailure" }, visualization: "line", width: "full", height: "medium" },
      { title: "Open incidents and alerts", source: { kind: "local", metric: "incidentsAlerts" }, visualization: "area", width: "full", height: "medium" },
    ],
  },
  {
    id: "provider-observability",
    name: "Provider observability",
    description: "All-provider observability using normalized local monitor history.",
    range: "24h",
    refreshSeconds: 60,
    buildPanels: () => [
      { title: "Current health", source: { kind: "local", metric: "snapshotCounts" }, visualization: "stat", width: "half", height: "small" },
      { title: "Status counts", source: { kind: "local", metric: "statusCounts" }, visualization: "bar", width: "half", height: "small" },
      { title: "Recent activity", source: { kind: "local", metric: "events" }, visualization: "table", width: "full", height: "medium" },
      { title: "Alerts and incidents", source: { kind: "local", metric: "events", eventTypes: ["alert", "incident"] }, visualization: "table", width: "full", height: "medium" },
    ],
  },
  {
    id: "team-ownership",
    name: "Team and service ownership",
    description: "A service-filterable dashboard for owners, tiers, and dependencies.",
    range: "7d",
    refreshSeconds: 120,
    buildPanels: () => [
      { title: "Current health", source: { kind: "local", metric: "snapshotCounts" }, visualization: "stat", width: "half", height: "small" },
      { title: "Success/failure trend", source: { kind: "local", metric: "successFailure" }, visualization: "line", width: "half", height: "small" },
      { title: "Open incidents and alerts", source: { kind: "local", metric: "incidentsAlerts" }, visualization: "area", width: "full", height: "medium" },
      { title: "Recent activity", source: { kind: "local", metric: "events" }, visualization: "table", width: "full", height: "medium" },
    ],
  },
];

function timeValue(ts: string): number {
  return new Date(ts).getTime();
}

function formatTime(value: number): string {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function annotationColor(type: HistoryEventType): string {
  if (type === "failure" || type === "incident") return "var(--red)";
  if (type === "recovery") return "var(--green)";
  if (type === "alert") return "var(--orange)";
  if (type === "deploy") return "var(--blue)";
  return "var(--color-text-tertiary)";
}

function toDateTimeLocal(value: number): string {
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function drilldownDateRange(ts: number) {
  const windowMs = 30 * 60 * 1000;
  return {
    mode: "custom" as const,
    from: toDateTimeLocal(ts - windowMs),
    to: toDateTimeLocal(ts + windowMs),
  };
}

function panelHeight(height: DashboardPanel["height"]): string {
  if (height === "small") return "h-44";
  if (height === "large") return "h-96";
  return "h-64";
}

function capabilityLabel(capability: DashboardQueryCapability): string {
  return capability.accountLabel ? `${capability.accountLabel} · ${capability.label}` : capability.label;
}

function localCapabilityId(source: Extract<DashboardPanel["source"], { kind: "local" }>): string {
  if (source.metric === "events") {
    const types = source.eventTypes ?? [];
    if (types.length === 1 && types[0] === "failure") return "local.failures";
    if (types.length === 1 && types[0] === "deploy") return "local.deploys";
    if (types.includes("alert") && types.includes("incident")) return "local.alertEvents";
  }
  return Object.entries(LOCAL_METRIC_BY_CAPABILITY).find(([, metric]) => metric === source.metric)?.[0] ?? "local.successFailure";
}

function withDefaultCheckId(panel: DashboardPanel, checkId: string | undefined): DashboardPanel {
  if (!checkId || panel.source.kind !== "local") return panel;
  if (panel.source.checkId || (panel.source.metric !== "checkLatency" && panel.source.metric !== "checkUptime")) return panel;
  return { ...panel, source: { ...panel.source, checkId } };
}

function panelFromTemplate(capability: DashboardQueryCapability, defaultCheckId?: string): DashboardPanel | null {
  if (!capability.defaultPanel) return null;
  return withDefaultCheckId({
    id: globalThis.crypto.randomUUID(),
    ...capability.defaultPanel,
    order: 0,
  }, defaultCheckId);
}

function dashboardPanelFromTemplate(template: DashboardPanelTemplate, order: number): DashboardPanel {
  return {
    id: globalThis.crypto.randomUUID(),
    ...template,
    order,
  };
}

function chartClickPoint(value: unknown): { ts: number; series?: string } | null {
  if (!value || typeof value !== "object") return null;
  const event = value as {
    activeLabel?: unknown;
    activePayload?: Array<{ dataKey?: unknown; name?: unknown }>;
  };
  const ts = typeof event.activeLabel === "number" ? event.activeLabel : Number(event.activeLabel);
  if (!Number.isFinite(ts)) return null;
  const payload = event.activePayload?.[0];
  const series = typeof payload?.dataKey === "string"
    ? payload.dataKey
    : typeof payload?.name === "string"
      ? payload.name
      : undefined;
  return { ts, series };
}

function emptyPanel(capability: DashboardQueryCapability | undefined, useDefault = true, defaultCheckId?: string): DashboardPanel {
  if (capability && useDefault) {
    const templated = panelFromTemplate(capability, defaultCheckId);
    if (templated) return templated;
  }
  const localMetric = capability ? LOCAL_METRIC_BY_CAPABILITY[capability.id] : "successFailure";
  const source = localMetric
    ? { kind: "local" as const, metric: localMetric }
    : {
      kind: "provider" as const,
      accountId: capability?.accountId ?? "",
      capabilityId: capability?.id ?? "",
      query: "",
      params: Object.fromEntries((capability?.params ?? []).map((param) => [param.key, param.defaultValue ?? ""])),
    };
  return withDefaultCheckId({
    id: globalThis.crypto.randomUUID(),
    title: capability?.label ?? "New panel",
    source,
    visualization: capability?.defaultVisualization ?? "line",
    width: "half",
    height: "medium",
    order: 0,
  }, defaultCheckId);
}

function clonePanel(panel: DashboardPanel, order: number): DashboardPanel {
  return {
    ...panel,
    id: globalThis.crypto.randomUUID(),
    title: `${panel.title} copy`,
    order,
  };
}

function alertRuleScopeFromLocalSource(source: Extract<DashboardPanel["source"], { kind: "local" }>, allowCheck: boolean) {
  if (allowCheck && source.checkId) return { checkId: source.checkId };
  if (source.accountId) return { accountId: source.accountId };
  if (source.groupId) return { groupId: source.groupId };
  if (source.provider) return { provider: source.provider };
  return {};
}

function alertRuleDraftFromPanel(panel: DashboardPanel): AlertRuleInput | null {
  if (panel.source.kind !== "local") return null;
  if (panel.source.metric === "successFailure") {
    return {
      name: `High failure rate: ${panel.title}`,
      metric: "failureRate",
      operator: "gt",
      threshold: 10,
      scope: alertRuleScopeFromLocalSource(panel.source, false),
      enabled: true,
      forMinutes: 5,
      cooldownMinutes: 15,
      dedupeMinutes: 30,
    };
  }
  if (panel.source.metric === "incidentsAlerts") {
    return {
      name: `Open incidents: ${panel.title}`,
      metric: "openIncidents",
      operator: "gt",
      threshold: 0,
      scope: alertRuleScopeFromLocalSource(panel.source, false),
      enabled: true,
      forMinutes: 0,
      cooldownMinutes: 15,
      dedupeMinutes: 30,
    };
  }
  if (panel.source.metric === "checkLatency" && panel.source.checkId) {
    return {
      name: `High latency: ${panel.title}`,
      metric: "latency",
      operator: "gt",
      threshold: 1000,
      scope: { checkId: panel.source.checkId },
      enabled: true,
      forMinutes: 5,
      cooldownMinutes: 15,
      dedupeMinutes: 30,
    };
  }
  if (panel.source.metric === "checkUptime" && panel.source.checkId) {
    return {
      name: `Uptime down: ${panel.title}`,
      metric: "checkDown",
      operator: "gt",
      threshold: 0,
      scope: { checkId: panel.source.checkId },
      enabled: true,
      forMinutes: 2,
      cooldownMinutes: 15,
      dedupeMinutes: 30,
    };
  }
  return null;
}

interface DashboardPanelLookups {
  groups: Map<string, string>;
  accounts: Map<string, { label: string; provider: Provider }>;
  providers: Map<string, string>;
  checks: Map<string, string>;
  capabilities: DashboardQueryCapability[];
}

function panelCapability(panel: DashboardPanel, lookups: DashboardPanelLookups): DashboardQueryCapability | undefined {
  if (panel.source.kind !== "provider") return undefined;
  const source = panel.source;
  return lookups.capabilities.find((capability) =>
    capability.id === source.capabilityId && capability.accountId === source.accountId,
  );
}

function panelMetadata(panel: DashboardPanel, dashboard: DashboardDefinition, lookups: DashboardPanelLookups): string[] {
  const source = panel.source;
  const labels = [`Range ${source.range ?? dashboard.range}`, panel.visualization, panel.height];
  if (panel.refreshSeconds) labels.push(`Refresh ${panel.refreshSeconds}s`);
  if (source.kind === "local") {
    labels.unshift(`Local · ${LOCAL_METRIC_LABELS[source.metric]}`);
    if (source.groupId) labels.push(`Group ${lookups.groups.get(source.groupId) ?? source.groupId}`);
    if (source.provider) labels.push(lookups.providers.get(source.provider) ?? source.provider);
    if (source.accountId) labels.push(`Account ${lookups.accounts.get(source.accountId)?.label ?? source.accountId}`);
    if (source.checkId) labels.push(`Check ${lookups.checks.get(source.checkId) ?? source.checkId}`);
    if (source.owner) labels.push(`Owner ${source.owner}`);
    if (source.tier) labels.push(`Tier ${source.tier}`);
    if (source.dependency) labels.push(`Depends on ${source.dependency}`);
    if (source.eventTypes?.length) labels.push(`Events ${source.eventTypes.join(", ")}`);
    return labels;
  }
  const capability = panelCapability(panel, lookups);
  const account = lookups.accounts.get(source.accountId);
  const provider = capability?.provider ?? account?.provider;
  labels.unshift(`${provider ? lookups.providers.get(provider) ?? provider : "Provider"} · ${capability?.label ?? source.capabilityId}`);
  labels.push(`Account ${capability?.accountLabel ?? account?.label ?? source.accountId}`);
  if (!capability) labels.push("Capability unavailable");
  if (capability?.queryLanguage) labels.push(capability.queryLanguage);
  if (source.xField || source.yField) labels.push(`Map ${source.xField ?? "x"} → ${source.yField ?? "y"}`);
  return labels;
}

function capabilityMatchesPanel(capability: DashboardQueryCapability, panel: DashboardPanel): boolean {
  const source = panel.source;
  if (source.kind === "local") return capability.id === localCapabilityId(source);
  return capability.id === source.capabilityId && capability.accountId === source.accountId;
}

function capabilityKey(capability: DashboardQueryCapability): string {
  return `${capability.accountId ?? "local"}:${capability.id}`;
}

function isDefaultPanelInstance(panel: DashboardPanel, capability: DashboardQueryCapability | undefined): boolean {
  if (!capability?.defaultPanel) return false;
  const source = panel.source;
  const defaultSource = capability.defaultPanel.source;
  if (source.kind !== defaultSource.kind) return false;
  if (source.kind === "local" && defaultSource.kind === "local") {
    return localCapabilityId(source) === localCapabilityId(defaultSource);
  }
  if (source.kind !== "provider" || defaultSource.kind !== "provider") return false;
  if (source.capabilityId !== defaultSource.capabilityId || source.accountId !== defaultSource.accountId) return false;
  if (!capability.requiresQuery) return true;
  return (source.query ?? "").trim() === (defaultSource.query ?? "").trim();
}

function DashboardDialog({
  open,
  editing,
  onOpenChange,
}: {
  open: boolean;
  editing: DashboardDefinition | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { save } = useDashboardMutations();
  const groupsQuery = useGroups();
  const accountsQuery = useAccounts();
  const providersQuery = useProviders();
  const checksQuery = useChecks();
  const serviceMetadataQuery = useServiceMetadata();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [range, setRange] = useState<HistoryRange>("24h");
  const [refreshSeconds, setRefreshSeconds] = useState("");
  const [variables, setVariables] = useState<DashboardRuntimeFilters>(DEFAULT_RUNTIME_FILTERS);

  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? "");
    setDescription(editing?.description ?? "");
    setRange(editing?.range ?? "24h");
    setRefreshSeconds(editing?.refreshSeconds ? String(editing.refreshSeconds) : "");
    setVariables(variablesToRuntimeFilters(editing?.variables));
  }, [editing, open]);

  const setVariable = <K extends keyof DashboardRuntimeFilters>(key: K, value: DashboardRuntimeFilters[K]) => {
    setVariables((current) => ({ ...current, [key]: value }));
  };

  const onConfirm = async () => {
    const refresh = Number(refreshSeconds);
    try {
      await save.mutateAsync({
        id: editing?.id,
        name,
        description,
        range,
        refreshSeconds: Number.isFinite(refresh) && refresh >= 15 ? refresh : undefined,
        variables: runtimeFiltersToVariables(variables),
        panels: editing?.panels ?? [],
      });
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const groupOptions = [{ value: ALL, label: "All groups" }, ...(groupsQuery.data ?? []).map((group) => ({ value: group.id, label: group.name }))];
  const providerOptions = [{ value: ALL, label: "All providers" }, ...(providersQuery.data ?? []).map((provider) => ({ value: provider.id, label: provider.label }))];
  const accountOptions = [{ value: ALL, label: "All accounts" }, ...(accountsQuery.data ?? []).map((account) => ({ value: account.id, label: account.label }))];
  const checkOptions = [{ value: ALL, label: "All checks" }, ...(checksQuery.data ?? []).map((check) => ({ value: check.id, label: check.name }))];
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

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Edit dashboard" : "Create dashboard"}
      confirmLabel="Save"
      confirmDisabled={name.trim() === ""}
      onConfirm={onConfirm}
      size="medium"
    >
      <FieldSet>
        <Field label="Name" orientation="vertical" className="p-0">
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Production overview" />
        </Field>
        <Field label="Description" orientation="vertical" className="p-0">
          <Input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Default range" orientation="vertical" className="p-0">
            <Select value={range} onValueChange={(value) => setRange(value as HistoryRange)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {RANGE_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Refresh seconds" orientation="vertical" className="p-0">
            <Input value={refreshSeconds} onChange={(event) => setRefreshSeconds(event.target.value)} placeholder="Optional, min 15" />
          </Field>
        </div>
        <Field label="Dashboard variables" orientation="vertical" className="p-0">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Select value={variables.group} onValueChange={(value) => setVariable("group", value)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {groupOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={variables.provider} onValueChange={(value) => setVariable("provider", value)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {providerOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={variables.account} onValueChange={(value) => setVariable("account", value)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {accountOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={variables.check} onValueChange={(value) => setVariable("check", value)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {checkOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={variables.owner} onValueChange={(value) => setVariable("owner", value)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ownerOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={variables.tier} onValueChange={(value) => setVariable("tier", value as DashboardRuntimeFilters["tier"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {tierOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={variables.dependency} onValueChange={(value) => setVariable("dependency", value)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {dependencyOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Text variant="small" color="tertiary">
            Variables apply to local dashboard panels that do not already define a narrower scope.
          </Text>
        </Field>
      </FieldSet>
    </Dialog>
  );
}

function PanelDialog({
  open,
  dashboard,
  editing,
  onOpenChange,
}: {
  open: boolean;
  dashboard: DashboardDefinition | null;
  editing: DashboardPanel | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { save } = useDashboardMutations();
  const capabilitiesQuery = useDashboardCapabilities();
  const accountsQuery = useAccounts();
  const groupsQuery = useGroups();
  const providersQuery = useProviders();
  const checksQuery = useChecks();
  const serviceMetadataQuery = useServiceMetadata();
  const capabilities = useMemo(() => capabilitiesQuery.data ?? [], [capabilitiesQuery.data]);
  const defaultCapabilities = useMemo(() => capabilities.filter((capability) => capability.defaultPanel), [capabilities]);
  const customCapabilities = useMemo(() => capabilities.filter((capability) => capability.requiresQuery), [capabilities]);
  const defaultCheckId = checksQuery.data?.[0]?.id;
  const [panel, setPanel] = useState<DashboardPanel>(() => emptyPanel(undefined));
  const [mode, setMode] = useState<"default" | "custom">("default");
  const [capabilitySearch, setCapabilitySearch] = useState("");
  const [capabilitySource, setCapabilitySource] = useState<"all" | "local" | "provider">("all");
  const [capabilityProvider, setCapabilityProvider] = useState<string>(ALL);
  const [capabilityResultKind, setCapabilityResultKind] = useState<string>(ALL);
  const selectedCapabilityId = (() => {
    const source = panel.source;
    return source.kind === "local" ? localCapabilityId(source) : source.capabilityId;
  })();
  const selectedCapability = capabilities.find((capability) => capability.id === selectedCapabilityId && (panel.source.kind === "local" || capability.accountId === panel.source.accountId));
  const mappingParams = (selectedCapability?.params ?? []).filter((param) => param.key === "xField" || param.key === "yField");
  const providerParams = (selectedCapability?.params ?? []).filter((param) => param.key !== "xField" && param.key !== "yField");
  const showMappingFields = panel.source.kind === "provider" && mode === "custom" &&
    (mappingParams.length > 0 || ["line", "area", "bar"].includes(panel.visualization));
  const showProviderParams = panel.source.kind === "provider" && providerParams.length > 0;

  useEffect(() => {
    if (!open) return;
    const editingCapability = editing
      ? capabilities.find((capability) => capabilityMatchesPanel(capability, editing))
      : undefined;
    setMode(editing?.source.kind === "provider" && editingCapability?.requiresQuery && !isDefaultPanelInstance(editing, editingCapability) ? "custom" : "default");
    const firstDefault = defaultCapabilities[0] ?? capabilities[0];
    setPanel(editing ?? emptyPanel(firstDefault, true, defaultCheckId));
  }, [capabilities, defaultCapabilities, defaultCheckId, editing, open]);

  const setCapability = (capabilityKey: string) => {
    const capability = capabilities.find((candidate) => `${candidate.accountId ?? "local"}:${candidate.id}` === capabilityKey);
    if (!capability) return;
    const next = emptyPanel(capability, mode === "default", defaultCheckId);
    setPanel((current) => ({
      ...next,
      id: current.id,
      title: mode === "default" || current.title === "" || current.title === "New panel" ? next.title : current.title,
      order: current.order,
    }));
  };

  const switchMode = (nextMode: "default" | "custom") => {
    setMode(nextMode);
    const selectedCanStay = selectedCapability && capabilityMatchesPanel(selectedCapability, panel) &&
      (nextMode === "default" ? Boolean(selectedCapability.defaultPanel) : selectedCapability.requiresQuery);
    if (selectedCanStay) return;
    const capability = nextMode === "default" ? defaultCapabilities[0] : customCapabilities[0];
    if (!capability) return;
    setPanel((current) => ({
      ...emptyPanel(capability, nextMode === "default", defaultCheckId),
      id: current.id,
      order: current.order,
      title: current.title || capability.label,
    }));
  };

  const updateLocalScope = (key: "groupId" | "accountId" | "provider" | "checkId" | "owner" | "tier" | "dependency", value: string) => {
    if (panel.source.kind !== "local") return;
    setPanel({
      ...panel,
      source: {
        ...panel.source,
        [key]: value === ALL || value === NONE ? undefined : value,
      },
    });
  };

  const toggleLocalEventType = (eventType: HistoryEventType) => {
    if (panel.source.kind !== "local" || panel.source.metric !== "events") return;
    const current = panel.source.eventTypes ?? [];
    const next = current.includes(eventType)
      ? current.filter((candidate) => candidate !== eventType)
      : [...current, eventType];
    const ordered = LOCAL_EVENT_TYPE_OPTIONS.map((option) => option.value).filter((candidate) => next.includes(candidate));
    setPanel({
      ...panel,
      source: {
        ...panel.source,
        eventTypes: ordered.length > 0 ? ordered : undefined,
      },
    });
  };

  const clearLocalEventTypes = () => {
    if (panel.source.kind !== "local" || panel.source.metric !== "events") return;
    setPanel({
      ...panel,
      source: {
        ...panel.source,
        eventTypes: undefined,
      },
    });
  };

  const updateProviderParam = (key: string, value: string) => {
    if (panel.source.kind !== "provider") return;
    const nextParams = { ...(panel.source.params ?? {}) };
    const trimmed = value.trim();
    if (trimmed === "") delete nextParams[key];
    else nextParams[key] = trimmed;
    setPanel({
      ...panel,
      source: {
        ...panel.source,
        params: Object.keys(nextParams).length > 0 ? nextParams : undefined,
      },
    });
  };

  const updateProviderMapping = (key: "xField" | "yField", value: string) => {
    if (panel.source.kind !== "provider") return;
    setPanel({
      ...panel,
      source: {
        ...panel.source,
        [key]: value.trim() === "" ? undefined : value,
      },
    });
  };

  const updatePanelRange = (value: string) => {
    setPanel({
      ...panel,
      source: {
        ...panel.source,
        range: value === NONE ? undefined : value as HistoryRange,
      },
    });
  };

  const updatePanelRefresh = (value: string) => {
    const refresh = Number(value);
    setPanel({
      ...panel,
      refreshSeconds: Number.isFinite(refresh) && refresh >= 15 ? refresh : undefined,
    });
  };

  const onConfirm = async () => {
    if (!dashboard) return;
    const existing = dashboard.panels.filter((candidate) => candidate.id !== panel.id);
    const nextPanel = { ...panel, order: editing?.order ?? existing.length };
    try {
      await save.mutateAsync({
        ...dashboard,
        panels: [...existing, nextPanel].sort((a, b) => a.order - b.order).map((candidate, index) => ({ ...candidate, order: index })),
      });
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const capabilityValue = panel.source.kind === "local"
    ? `local:${selectedCapabilityId}`
    : `${panel.source.accountId}:${panel.source.capabilityId}`;
  const selectableCapabilities = mode === "default" ? defaultCapabilities : customCapabilities;
  const providerOptions = [
    { value: ALL, label: "All providers" },
    ...(providersQuery.data ?? []).map((provider) => ({ value: provider.id, label: provider.label })),
  ];
  const resultKindOptions = [
    { value: ALL, label: "All result types" },
    ...[...new Set(selectableCapabilities.map((capability) => capability.resultKind))]
      .sort()
      .map((kind) => ({ value: kind, label: kind })),
  ];
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
  const filteredCapabilities = selectableCapabilities.filter((capability) => {
    const sourceKind = capability.accountId ? "provider" : "local";
    const search = capabilitySearch.trim().toLowerCase();
    if (search) {
      const haystack = [
        capability.label,
        capability.description,
        capability.accountLabel,
        capability.provider,
        capability.queryLanguage,
        capability.resultKind,
        capability.requiresQuery ? "custom query" : "default panel",
      ].filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    if (capabilitySource !== "all" && sourceKind !== capabilitySource) return false;
    if (capabilityProvider !== ALL && capability.provider !== capabilityProvider) return false;
    if (capabilityResultKind !== ALL && capability.resultKind !== capabilityResultKind) return false;
    return true;
  });
  const selectedInMode = selectedCapability && selectableCapabilities.some((capability) => capability.id === selectedCapability.id && capability.accountId === selectedCapability.accountId);
  const visibleCapabilities = selectedInMode && !filteredCapabilities.some((capability) => capability.id === selectedCapability.id && capability.accountId === selectedCapability.accountId)
    ? [selectedCapability, ...filteredCapabilities]
    : filteredCapabilities;
  const capabilityFiltersActive = capabilitySearch.trim() !== "" || capabilitySource !== "all" || capabilityProvider !== ALL || capabilityResultKind !== ALL;
  const clearCapabilityFilters = () => {
    setCapabilitySearch("");
    setCapabilitySource("all");
    setCapabilityProvider(ALL);
    setCapabilityResultKind(ALL);
  };
  const selectedProviderCapabilityMissing = panel.source.kind === "provider" && panel.source.accountId !== "" && panel.source.capabilityId !== "" && !selectedCapability;
  const validationErrors = (() => {
    const errors: string[] = [];
    if (panel.title.trim() === "") errors.push("Panel title is required.");
    if (panel.source.kind === "provider") {
      if (!panel.source.accountId || !panel.source.capabilityId) errors.push("Choose a provider query source.");
      if (selectedCapability?.requiresQuery && (panel.source.query ?? "").trim() === "") {
        errors.push(`${selectedCapability.queryLanguage ?? "Query"} is required for this panel.`);
      }
      for (const param of selectedCapability?.params ?? []) {
        if (!param.required) continue;
        const value = param.key === "xField"
          ? panel.source.xField
          : param.key === "yField"
            ? panel.source.yField
            : panel.source.params?.[param.key];
        if ((value ?? "").trim() === "") errors.push(`${param.label} is required.`);
      }
    }
    return errors;
  })();
  const localEventTypes = panel.source.kind === "local" && panel.source.metric === "events" ? (panel.source.eventTypes ?? []) : [];
  const isLocalEventPanel = panel.source.kind === "local" && panel.source.metric === "events";

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Edit panel" : "Add panel"}
      confirmLabel="Save"
      confirmDisabled={validationErrors.length > 0}
      onConfirm={onConfirm}
      size="large"
    >
      <FieldSet>
        <div className="flex items-center gap-2">
          <Button variant={mode === "default" ? "accent" : "transparent"} size="small" onClick={() => switchMode("default")}>
            Default panels
          </Button>
          <Button variant={mode === "custom" ? "accent" : "transparent"} size="small" onClick={() => switchMode("custom")}>
            Custom query
          </Button>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Field label="Find panel" orientation="vertical" className="p-0">
            <Input
              value={capabilitySearch}
              onChange={(event) => setCapabilitySearch(event.target.value)}
              placeholder="Name, account, language..."
            />
          </Field>
          <Field label="Source" orientation="vertical" className="p-0">
            <Select value={capabilitySource} onValueChange={(value) => setCapabilitySource(value as typeof capabilitySource)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                <SelectItem value="local">Local normalized</SelectItem>
                <SelectItem value="provider">Provider live</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Provider" orientation="vertical" className="p-0">
            <Select value={capabilityProvider} onValueChange={setCapabilityProvider}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {providerOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Result" orientation="vertical" className="p-0">
            <Select value={capabilityResultKind} onValueChange={setCapabilityResultKind}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {resultKindOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Panel title" orientation="vertical" className="p-0">
            <Input value={panel.title} onChange={(event) => setPanel({ ...panel, title: event.target.value })} />
          </Field>
          <Field label={mode === "default" ? "Default panel" : "Query source"} orientation="vertical" className="p-0">
            <Select value={capabilityValue} onValueChange={setCapability}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {visibleCapabilities.length === 0 ? <SelectItem value="none">No options match</SelectItem> : null}
                {selectedProviderCapabilityMissing && panel.source.kind === "provider" ? (
                  <SelectItem value={capabilityValue}>
                    Unavailable: {panel.source.capabilityId}
                  </SelectItem>
                ) : null}
                {visibleCapabilities.map((capability) => (
                  <SelectItem key={capabilityKey(capability)} value={capabilityKey(capability)}>
                    {capabilityLabel(capability)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center justify-between gap-2">
              <Text variant="small" color="tertiary">
                {filteredCapabilities.length} of {selectableCapabilities.length} {mode === "default" ? "default panels" : "custom query sources"}
              </Text>
              {capabilityFiltersActive ? (
                <Button variant="transparent" size="small" onClick={clearCapabilityFilters}>
                  Clear filters
                </Button>
              ) : null}
            </div>
          </Field>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <Field label="Visualization" orientation="vertical" className="p-0">
            <Select value={panel.visualization} onValueChange={(value) => setPanel({ ...panel, visualization: value as DashboardVisualization })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["line", "area", "bar", "stat", "table", "logs", "traces"].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Panel range" orientation="vertical" className="p-0">
            <Select value={panel.source.range ?? NONE} onValueChange={updatePanelRange}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Use dashboard range</SelectItem>
                {RANGE_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Panel refresh" orientation="vertical" className="p-0">
            <Input
              value={panel.refreshSeconds ? String(panel.refreshSeconds) : ""}
              onChange={(event) => updatePanelRefresh(event.target.value)}
              placeholder="Use dashboard"
            />
          </Field>
          <Field label="Width" orientation="vertical" className="p-0">
            <Select value={panel.width} onValueChange={(value) => setPanel({ ...panel, width: value as DashboardPanel["width"] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="half">Half</SelectItem>
                <SelectItem value="full">Full</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Height" orientation="vertical" className="p-0">
            <Select value={panel.height} onValueChange={(value) => setPanel({ ...panel, height: value as DashboardPanel["height"] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="small">Small</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="large">Large</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>

        {validationErrors.length > 0 ? (
          <Callout color="red">{validationErrors.join(" ")}</Callout>
        ) : null}
        {selectedProviderCapabilityMissing && panel.source.kind === "provider" ? (
          <Callout color="secondary">
            This saved live capability is not currently available. The account may be disabled, missing credentials, or unable to load live dashboard capabilities; choose another source to replace it.
          </Callout>
        ) : null}

        {panel.source.kind === "local" ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Field label="Group" orientation="vertical" className="p-0">
              <Select value={panel.source.groupId ?? ALL} onValueChange={(value) => updateLocalScope("groupId", value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All groups</SelectItem>
                  {(groupsQuery.data ?? []).map((group) => <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Account" orientation="vertical" className="p-0">
              <Select value={panel.source.accountId ?? ALL} onValueChange={(value) => updateLocalScope("accountId", value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All accounts</SelectItem>
                  {(accountsQuery.data ?? []).map((account) => <SelectItem key={account.id} value={account.id}>{account.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Provider" orientation="vertical" className="p-0">
              <Select value={panel.source.provider ?? ALL} onValueChange={(value) => updateLocalScope("provider", value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All providers</SelectItem>
                  {(providersQuery.data ?? []).map((provider) => <SelectItem key={provider.id} value={provider.id}>{provider.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Check" orientation="vertical" className="p-0">
              <Select value={panel.source.checkId ?? NONE} onValueChange={(value) => updateLocalScope("checkId", value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No check</SelectItem>
                  {(checksQuery.data ?? []).map((check) => <SelectItem key={check.id} value={check.id}>{check.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Owner" orientation="vertical" className="p-0">
              <Select value={panel.source.owner ?? ALL} onValueChange={(value) => updateLocalScope("owner", value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ownerOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Tier" orientation="vertical" className="p-0">
              <Select value={panel.source.tier ?? "all"} onValueChange={(value) => updateLocalScope("tier", value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {tierOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Dependency" orientation="vertical" className="p-0">
              <Select value={panel.source.dependency ?? ALL} onValueChange={(value) => updateLocalScope("dependency", value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {dependencyOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            {isLocalEventPanel ? (
              <div className="col-span-2 lg:col-span-4 flex flex-col gap-2">
                <Text variant="small" color="secondary">Event types</Text>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant={localEventTypes.length === 0 ? "accent" : "transparent"}
                    size="small"
                    onClick={clearLocalEventTypes}
                  >
                    All events
                  </Button>
                  {LOCAL_EVENT_TYPE_OPTIONS.map((option) => (
                    <Button
                      key={option.value}
                      variant={localEventTypes.includes(option.value) ? "accent" : "transparent"}
                      size="small"
                      onClick={() => toggleLocalEventType(option.value)}
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : mode === "custom" ? (
          <>
            <Field label={`${selectedCapability?.queryLanguage ?? "Query"} query`} orientation="vertical" className="p-0">
              <textarea
                value={panel.source.query ?? ""}
                onChange={(event) => {
                  if (panel.source.kind !== "provider") return;
                  setPanel({ ...panel, source: { ...panel.source, query: event.target.value } });
                }}
                className="min-h-28 w-full resize-y rounded-md border border-separator bg-transparent px-3 py-2 text-sm text-primary outline-none focus:border-accent"
                placeholder={selectedCapability?.requiresQuery ? "Enter query" : "No query required"}
                disabled={!selectedCapability?.requiresQuery}
              />
            </Field>
            {showMappingFields ? (
              <div className="grid grid-cols-2 gap-3">
                <Field label={mappingParams.find((param) => param.key === "xField")?.label ?? "X field"} orientation="vertical" className="p-0">
                  <Input
                    value={panel.source.kind === "provider" ? (panel.source.xField ?? "") : ""}
                    onChange={(event) => updateProviderMapping("xField", event.target.value)}
                    placeholder={mappingParams.find((param) => param.key === "xField")?.placeholder ?? "timestamp"}
                  />
                </Field>
                <Field label={mappingParams.find((param) => param.key === "yField")?.label ?? "Y field"} orientation="vertical" className="p-0">
                  <Input
                    value={panel.source.kind === "provider" ? (panel.source.yField ?? "") : ""}
                    onChange={(event) => updateProviderMapping("yField", event.target.value)}
                    placeholder={mappingParams.find((param) => param.key === "yField")?.placeholder ?? "count"}
                  />
                </Field>
              </div>
            ) : null}
            {showProviderParams ? (
              <div className="grid grid-cols-2 gap-3">
                {providerParams.map((param) => (
                  <Field key={param.key} label={param.label} orientation="vertical" className="p-0">
                    <Input
                      value={panel.source.kind === "provider" ? (panel.source.params?.[param.key] ?? "") : ""}
                      onChange={(event) => updateProviderParam(param.key, event.target.value)}
                      placeholder={param.placeholder ?? param.defaultValue}
                    />
                  </Field>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <>
            <Callout color="secondary">{selectedCapability?.description ?? "This default panel is ready to run."}</Callout>
            {showProviderParams ? (
              <div className="grid grid-cols-2 gap-3">
                {providerParams.map((param) => (
                  <Field key={param.key} label={param.label} orientation="vertical" className="p-0">
                    <Input
                      value={panel.source.kind === "provider" ? (panel.source.params?.[param.key] ?? "") : ""}
                      onChange={(event) => updateProviderParam(param.key, event.target.value)}
                      placeholder={param.placeholder ?? param.defaultValue}
                    />
                  </Field>
                ))}
              </div>
            ) : null}
            {panel.source.kind === "provider" && selectedCapability?.requiresQuery ? (
              <Button variant="glass" size="small" onClick={() => switchMode("custom")}>
                Edit query
              </Button>
            ) : null}
          </>
        )}
      </FieldSet>
    </Dialog>
  );
}

function ChartPanel({
  result,
  visualization,
  height,
  onPointClick,
}: {
  result: DashboardPanelResult;
  visualization: DashboardVisualization;
  height: DashboardPanel["height"];
  onPointClick?: (point: { ts: number; series?: string }) => void;
}) {
  const rowsByTs = new Map<number, Record<string, number | string>>();
  const series = new Set<string>();
  for (const point of result.points ?? []) {
    const key = timeValue(point.ts);
    const name = point.series ?? "value";
    series.add(name);
    const row = rowsByTs.get(key) ?? { ts: key };
    row[name] = point.value;
    rowsByTs.set(key, row);
  }
  const data = [...rowsByTs.values()].sort((a, b) => Number(a.ts) - Number(b.ts));
  const seriesNames = [...series];
  const annotations = result.annotations ?? [];
  if (data.length === 0) return <Text variant="small" color="tertiary">No data returned for this range.</Text>;
  const annotationLines = annotations.slice(0, 12);
  const common = (
    <>
      <CartesianGrid stroke="var(--color-border-separator)" strokeDasharray="3 3" vertical={false} />
      <XAxis dataKey="ts" tickFormatter={(value) => formatTime(Number(value))} tick={{ fill: "var(--color-text-tertiary)", fontSize: 11 }} tickLine={false} axisLine={false} />
      <YAxis tick={{ fill: "var(--color-text-tertiary)", fontSize: 11 }} tickLine={false} axisLine={false} />
      <Tooltip
        labelFormatter={(value) => new Date(Number(value)).toLocaleString()}
        contentStyle={{ background: "var(--background)", border: "1px solid var(--color-border-separator)", borderRadius: 8 }}
      />
      <Legend wrapperStyle={{ color: "var(--color-text-secondary)", fontSize: 12 }} />
      {annotationLines.map((annotation, index) => (
        <ReferenceLine
          key={`${annotation.ts}:${annotation.type}:${index}`}
          x={timeValue(annotation.ts)}
          stroke={annotationColor(annotation.type)}
          strokeDasharray="3 3"
          strokeOpacity={0.72}
        />
      ))}
    </>
  );
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className={`${panelHeight(height)} min-w-0`}>
        <ResponsiveContainer width="100%" height="100%">
          {visualization === "bar" ? (
            <BarChart
              data={data}
              margin={{ top: 8, right: 12, bottom: 0, left: -20 }}
              onClick={(event) => {
                const point = chartClickPoint(event);
                if (point) onPointClick?.(point);
              }}
            >
              {common}
              {seriesNames.map((name, index) => <Bar key={name} dataKey={name} fill={CHART_COLORS[index % CHART_COLORS.length]} radius={[3, 3, 0, 0]} />)}
            </BarChart>
          ) : visualization === "area" ? (
            <AreaChart
              data={data}
              margin={{ top: 8, right: 12, bottom: 0, left: -20 }}
              onClick={(event) => {
                const point = chartClickPoint(event);
                if (point) onPointClick?.(point);
              }}
            >
              {common}
              {seriesNames.map((name, index) => (
                <Area key={name} type="monotone" dataKey={name} stroke={CHART_COLORS[index % CHART_COLORS.length]} fill={CHART_COLORS[index % CHART_COLORS.length]} fillOpacity={0.14} strokeWidth={2} dot={false} />
              ))}
            </AreaChart>
          ) : (
            <LineChart
              data={data}
              margin={{ top: 8, right: 12, bottom: 0, left: -20 }}
              onClick={(event) => {
                const point = chartClickPoint(event);
                if (point) onPointClick?.(point);
              }}
            >
              {common}
              {seriesNames.map((name, index) => <Line key={name} type="monotone" dataKey={name} stroke={CHART_COLORS[index % CHART_COLORS.length]} strokeWidth={2} dot={false} />)}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
      {annotations.length > 0 ? (
        <div className="flex min-w-0 flex-wrap gap-1">
          {annotations.slice(-8).map((annotation, index) => (
            <button
              key={`${annotation.ts}:${annotation.type}:chip:${index}`}
              type="button"
              onClick={() => annotation.url ? void monitorApi.openExternal(annotation.url).catch((error) => toast.error(String(error))) : undefined}
              className="min-w-0 max-w-full rounded-md border border-separator px-2 py-1 text-left text-xs text-secondary hover:bg-control-hover disabled:opacity-60"
              disabled={!annotation.url}
              title={annotation.title}
            >
              <span className="font-medium" style={{ color: annotationColor(annotation.type) }}>{annotation.type}</span>
              <span className="ml-1 text-tertiary">{formatTime(timeValue(annotation.ts))}</span>
            </button>
          ))}
          {annotations.length > 8 ? <Text variant="small" color="tertiary">+{annotations.length - 8} more</Text> : null}
        </div>
      ) : null}
    </div>
  );
}

function StatsPanel({ result }: { result: DashboardPanelResult }) {
  const stats = result.stats ?? [];
  if (stats.length === 0) return <Text variant="small" color="tertiary">No stats returned.</Text>;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
      {stats.map((stat) => (
        <div key={stat.label} className="rounded-md border border-separator p-3">
          <Text variant="small" color="tertiary">{stat.label}</Text>
          <Text variant="title">{stat.value}{stat.unit ? ` ${stat.unit}` : ""}</Text>
        </div>
      ))}
    </div>
  );
}

function downloadRowsCsv(filename: string, columns: string[], rows: DashboardPanelResult["rows"]) {
  downloadCsv(filename, columns, (rows ?? []).map((row) => columns.map((column) => row[column])));
}

function TablePanel({ result }: { result: DashboardPanelResult }) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ column: string; direction: "asc" | "desc" } | null>(null);
  const rows = result.rows ?? [];
  const columns = (result.columns?.length ? result.columns : Object.keys(rows[0] ?? {})).filter((column) => !column.startsWith("__"));
  const filteredRows = rows.filter((row) => {
    const query = search.trim().toLowerCase();
    if (!query) return true;
    const haystack = [
      ...columns.map((column) => row[column]),
      row.__urlLabel,
    ]
      .filter((value) => value !== null && value !== undefined)
      .map((value) => String(value))
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });
  const sortedRows = [...filteredRows].sort((a, b) => {
    if (!sort) return 0;
    const left = a[sort.column];
    const right = b[sort.column];
    if (left === right) return 0;
    if (left === null || left === undefined) return 1;
    if (right === null || right === undefined) return -1;
    const leftNumber = typeof left === "number" ? left : Number(left);
    const rightNumber = typeof right === "number" ? right : Number(right);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
      return sort.direction === "asc" ? leftNumber - rightNumber : rightNumber - leftNumber;
    }
    const leftDate = typeof left === "string" ? new Date(left).getTime() : NaN;
    const rightDate = typeof right === "string" ? new Date(right).getTime() : NaN;
    if (Number.isFinite(leftDate) && Number.isFinite(rightDate)) {
      return sort.direction === "asc" ? leftDate - rightDate : rightDate - leftDate;
    }
    const comparison = String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
    return sort.direction === "asc" ? comparison : -comparison;
  });
  const toggleSort = (column: string) => {
    setSort((current) => current?.column === column
      ? { column, direction: current.direction === "asc" ? "desc" : "asc" }
      : { column, direction: "asc" });
  };
  const hasLinks = rows.some((row) => typeof row.__url === "string" && row.__url.trim() !== "");
  const hasIncidentActions = rows.some((row) => typeof row.__eventId === "string" && row.__eventId.trim() !== "");
  const openRow = (url: string) => {
    void monitorApi.openExternal(url).catch((error) => toast.error(error instanceof Error ? error.message : String(error)));
  };
  const createIncident = (row: DashboardTableRow) => {
    if (
      typeof row.__eventId !== "string" ||
      typeof row.__eventTs !== "string" ||
      typeof row.__eventType !== "string" ||
      typeof row.__eventProvider !== "string" ||
      typeof row.__eventAccountId !== "string" ||
      typeof row.title !== "string" ||
      typeof row.__eventStatus !== "string" ||
      typeof row.__eventSeverity !== "string" ||
      typeof row.__url !== "string"
    ) {
      return;
    }
    localStorage.setItem(INCIDENT_CREATE_KEY, JSON.stringify({
      event: {
        id: row.__eventId,
        ts: row.__eventTs,
        type: row.__eventType,
        provider: row.__eventProvider,
        accountId: row.__eventAccountId,
        groupId: typeof row.__eventGroupId === "string" ? row.__eventGroupId : undefined,
        sourceUid: typeof row.__eventSourceUid === "string" ? row.__eventSourceUid : undefined,
        title: row.title,
        status: row.__eventStatus,
        severity: row.__eventSeverity,
        url: row.__url,
      },
    }));
    void navigate({ to: "/incidents" });
  };
  const exportRows = () => {
    const safeTitle = (result.title ?? result.kind ?? "dashboard-panel").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-|-$/g, "") || "dashboard-panel";
    downloadRowsCsv(`${safeTitle}-rows.csv`, columns, sortedRows);
  };
  if (rows.length === 0) return <Text variant="small" color="tertiary">No rows returned.</Text>;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Filter rows..."
          size="small"
          variant="filled"
          className="max-w-xs"
        />
        <Text variant="small" color="tertiary">
          {filteredRows.length} of {rows.length} rows
        </Text>
        <Button variant="glass" size="small" onClick={exportRows} disabled={sortedRows.length === 0} className="ml-auto">
          <Download className="size-4" />
          Export CSV
        </Button>
      </div>
      {filteredRows.length === 0 ? (
        <Text variant="small" color="tertiary">No rows match the current filter.</Text>
      ) : (
        <div className="overflow-auto rounded-md border border-separator">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="bg-control-subtle text-tertiary">
              <tr>
                {hasIncidentActions ? <th className="w-10 px-3 py-2 font-medium">Investigate</th> : null}
                {hasLinks ? <th className="w-10 px-3 py-2 font-medium">Open</th> : null}
                {columns.map((column) => (
                  <th key={column} className="px-3 py-2 font-medium">
                    <button
                      type="button"
                      className="inline-flex max-w-full items-center gap-1 text-left hover:text-primary"
                      onClick={() => toggleSort(column)}
                      aria-label={`Sort by ${column}`}
                    >
                      <span className="truncate">{column}</span>
                      {sort?.column === column ? (
                        <span className="text-xs">{sort.direction === "asc" ? "↑" : "↓"}</span>
                      ) : null}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedRows.slice(0, 100).map((row, index) => (
                <tr key={index} className="border-t border-separator">
                  {hasIncidentActions ? (
                    <td className="px-3 py-2 align-top">
                      {typeof row.__eventId === "string" && row.__eventId.trim() !== "" ? (
                        <Button
                          variant="transparent"
                          size="small"
                          iconOnly
                          aria-label="Create incident from event"
                          onClick={() => createIncident(row)}
                        >
                          <Plus className="size-4" />
                        </Button>
                      ) : null}
                    </td>
                  ) : null}
                  {hasLinks ? (
                    <td className="px-3 py-2 align-top">
                      {typeof row.__url === "string" && row.__url.trim() !== "" ? (
                        <Button
                          variant="transparent"
                          size="small"
                          iconOnly
                          aria-label={typeof row.__urlLabel === "string" ? row.__urlLabel : "Open row"}
                          onClick={() => openRow(row.__url ?? "")}
                        >
                          <ExternalLink className="size-4" />
                        </Button>
                      ) : null}
                    </td>
                  ) : null}
                  {columns.map((column) => <td key={column} className="px-3 py-2 align-top text-secondary">{String(row[column] ?? "")}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {sortedRows.length > 100 ? (
        <Text variant="small" color="tertiary">Showing first 100 matching rows.</Text>
      ) : null}
    </div>
  );
}

function scopedPanel(panel: DashboardPanel, filters: DashboardRuntimeFilters): DashboardPanel {
  if (panel.source.kind !== "local") return panel;
  const supportsCheckFilter = panel.source.metric === "checkLatency" || panel.source.metric === "checkUptime";
  return {
    ...panel,
    source: {
      ...panel.source,
      groupId: panel.source.groupId ?? (filters.group === ALL ? undefined : filters.group),
      provider: panel.source.provider ?? (filters.provider === ALL ? undefined : filters.provider as Provider),
      accountId: panel.source.accountId ?? (filters.account === ALL ? undefined : filters.account),
      checkId: panel.source.checkId ?? (supportsCheckFilter && filters.check !== ALL ? filters.check : undefined),
      owner: panel.source.owner ?? (filters.owner === ALL ? undefined : filters.owner),
      tier: panel.source.tier ?? (filters.tier === "all" ? undefined : filters.tier),
      dependency: panel.source.dependency ?? (filters.dependency === ALL ? undefined : filters.dependency),
    },
  };
}

function PanelBody({ panel, dashboard, filters }: { panel: DashboardPanel; dashboard: DashboardDefinition; filters: DashboardRuntimeFilters }) {
  const navigate = useNavigate();
  const effectivePanel = scopedPanel(panel, filters);
  const query = useDashboardPanel(effectivePanel, effectivePanel.source.range ?? dashboard.range, panel.refreshSeconds ?? dashboard.refreshSeconds);
  const openDrilldown = (point: { ts: number; series?: string }) => {
    if (effectivePanel.source.kind !== "local") return;
    const series = point.series?.toLowerCase() ?? "";
    const baseFilters = {
      dateRange: drilldownDateRange(point.ts),
      group: effectivePanel.source.groupId ?? ALL,
      provider: effectivePanel.source.provider ?? ALL,
      account: effectivePanel.source.accountId ?? ALL,
      owner: effectivePanel.source.owner ?? ALL,
      tier: effectivePanel.source.tier ?? "all",
      dependency: effectivePanel.source.dependency ?? ALL,
    };
    if (effectivePanel.source.metric === "checkLatency" || effectivePanel.source.metric === "checkUptime") {
      localStorage.setItem(UPTIME_DRILLDOWN_KEY, JSON.stringify({
        dateRange: baseFilters.dateRange,
        group: baseFilters.group,
        search: effectivePanel.source.checkId ?? "",
        owner: baseFilters.owner,
        tier: baseFilters.tier,
        dependency: baseFilters.dependency,
      }));
      void navigate({ to: "/uptime" });
      return;
    }
    if (effectivePanel.source.metric === "incidentsAlerts" && (series.includes("incident") || series.includes("alert"))) {
      localStorage.setItem(INCIDENTS_DRILLDOWN_KEY, JSON.stringify({
        ...baseFilters,
        kind: series.includes("incident") ? "incident" : "signal",
        status: "open",
      }));
      void navigate({ to: "/incidents" });
      return;
    }
    localStorage.setItem(TIMELINE_DRILLDOWN_KEY, JSON.stringify({
      ...baseFilters,
      type: series.includes("failure") ? "failure" : "all",
      status: ["failure", "warning", "running", "queued", "success", "info", "cancelled", "unknown"].includes(series) ? series : "all",
      category: "all",
      severity: "all",
    }));
    void navigate({ to: "/timeline" });
  };
  if (query.isLoading) return <Text variant="small" color="tertiary">Loading panel…</Text>;
  if (query.error) return <Callout color="red">{query.error instanceof Error ? query.error.message : String(query.error)}</Callout>;
  const result = query.data;
  if (!result) return <Text variant="small" color="tertiary">No result.</Text>;
  return (
    <div className="flex flex-col gap-3">
      {result.warnings?.map((warning) => <Callout key={warning} color="secondary">{warning}</Callout>)}
      {panel.visualization === "stat" || result.kind === "stat" ? (
        <StatsPanel result={result} />
      ) : panel.visualization === "table" || result.kind === "table" || result.kind === "events" || result.kind === "logs" || result.kind === "traces" ? (
        <TablePanel result={result} />
      ) : (
        <ChartPanel result={result} visualization={panel.visualization} height={panel.height} onPointClick={openDrilldown} />
      )}
      <Text variant="small" color="tertiary">
        Updated {new Date(result.generatedAt).toLocaleTimeString()}
        {query.isFetching ? " · Refreshing" : query.isStale ? " · Stale" : ""}
      </Text>
    </div>
  );
}

function DashboardPanelCard({
  panel,
  dashboard,
  onEdit,
  onDuplicate,
  onCopyToDashboard,
  onMove,
  canMoveUp,
  canMoveDown,
  canCopyToDashboard,
  filters,
  lookups,
}: {
  panel: DashboardPanel;
  dashboard: DashboardDefinition;
  onEdit: () => void;
  onDuplicate: () => void;
  onCopyToDashboard: () => void;
  onMove: (direction: -1 | 1) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canCopyToDashboard: boolean;
  filters: DashboardRuntimeFilters;
  lookups: DashboardPanelLookups;
}) {
  const { save } = useDashboardMutations();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const metadata = panelMetadata(panel, dashboard, lookups);
  const effectivePanel = scopedPanel(panel, filters);
  const effectiveRange = effectivePanel.source.range ?? dashboard.range;
  const effectiveAccountId = effectivePanel.source.accountId;
  const effectiveProvider = effectivePanel.source.kind === "local"
    ? effectivePanel.source.provider ?? (effectiveAccountId ? lookups.accounts.get(effectiveAccountId)?.provider : undefined)
    : effectiveAccountId ? lookups.accounts.get(effectiveAccountId)?.provider : undefined;
  const openAccountContext = () => {
    const payload = effectiveAccountId
      ? {
        accountId: effectiveAccountId,
        filters: {
          provider: effectiveProvider ?? ALL,
          group: effectivePanel.source.kind === "local" ? effectivePanel.source.groupId ?? ALL : ALL,
        },
      }
      : {
        filters: {
          provider: effectiveProvider ?? ALL,
          group: effectivePanel.source.kind === "local" ? effectivePanel.source.groupId ?? ALL : ALL,
        },
      };
    localStorage.setItem(ACCOUNT_SELECT_KEY, JSON.stringify(payload));
    void navigate({ to: "/accounts" });
  };
  const alertDraft = alertRuleDraftFromPanel(effectivePanel);
  const createAlertRule = () => {
    if (!alertDraft) return;
    localStorage.setItem(ALERT_RULE_DRAFT_KEY, JSON.stringify(alertDraft));
    void navigate({ to: "/alerts" });
  };
  const remove = async () => {
    if (!window.confirm(`Delete panel "${panel.title}" from "${dashboard.name}"?`)) return;
    try {
      await save.mutateAsync({
        ...dashboard,
        panels: dashboard.panels.filter((candidate) => candidate.id !== panel.id).map((candidate, index) => ({ ...candidate, order: index })),
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <section className={`rounded-lg border border-separator p-3 flex flex-col gap-3 ${panel.width === "full" ? "lg:col-span-2" : ""}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Text variant="strong" truncate>{panel.title}</Text>
          <div className="mt-1 flex min-w-0 flex-wrap gap-1">
            {metadata.map((label, index) => (
              <Badge key={`${label}-${index}`} color={index === 0 && panel.source.kind === "provider" ? "blue" : "secondary"}>
                {label}
              </Badge>
            ))}
          </div>
        </div>
        <Badge color="secondary">{panel.width}</Badge>
        <Button variant="transparent" size="small" iconOnly aria-label="Move up" onClick={() => onMove(-1)} disabled={!canMoveUp}>
          <ArrowUp className="size-4" />
        </Button>
        <Button variant="transparent" size="small" iconOnly aria-label="Move down" onClick={() => onMove(1)} disabled={!canMoveDown}>
          <ArrowDown className="size-4" />
        </Button>
        <Button
          variant="transparent"
          size="small"
          iconOnly
          aria-label="Refresh panel"
          onClick={() => void queryClient.invalidateQueries({ queryKey: ["dashboards", "panel", effectivePanel, effectiveRange] })}
        >
          <RefreshCw className="size-4" />
        </Button>
        <Button variant="transparent" size="small" iconOnly aria-label="Edit panel" onClick={onEdit}>
          <Edit3 className="size-4" />
        </Button>
        <Button variant="transparent" size="small" iconOnly aria-label="Duplicate panel" onClick={onDuplicate}>
          <Copy className="size-4" />
        </Button>
        <Button variant="transparent" size="small" iconOnly aria-label="Copy panel to another dashboard" onClick={onCopyToDashboard} disabled={!canCopyToDashboard}>
          <Copy className="size-4" />
        </Button>
        {effectiveAccountId || effectiveProvider ? (
          <Button variant="transparent" size="small" iconOnly aria-label="Open account context" onClick={openAccountContext}>
            <ExternalLink className="size-4" />
          </Button>
        ) : null}
        {alertDraft ? (
          <Button variant="transparent" size="small" iconOnly aria-label="Create alert rule from panel" onClick={createAlertRule}>
            <Bell className="size-4" />
          </Button>
        ) : null}
        <Button variant="transparent" size="small" iconOnly aria-label="Delete panel" onClick={() => void remove()}>
          <Trash2 className="size-4 text-support-red" />
        </Button>
      </div>
      <PanelBody panel={panel} dashboard={dashboard} filters={filters} />
    </section>
  );
}

function DashboardTemplateDialog({
  open,
  selectedId,
  hasChecks,
  onSelect,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  selectedId: string;
  hasChecks: boolean;
  onSelect: (id: string) => void;
  onOpenChange: (open: boolean) => void;
  onCreate: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Create from template"
      confirmLabel="Create dashboard"
      confirmDisabled={!selectedId}
      onConfirm={onCreate}
      size="large"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {DASHBOARD_TEMPLATES.map((template) => {
          const selected = template.id === selectedId;
          return (
            <button
              key={template.id}
              type="button"
              onClick={() => onSelect(template.id)}
              className={`rounded-lg border p-3 text-left transition-colors ${selected ? "border-accent bg-accent/10" : "border-separator bg-transparent hover:bg-control-hover"}`}
            >
              <div className="flex items-start gap-2">
                <LayoutTemplate className="mt-0.5 size-4 shrink-0 text-tertiary" />
                <div className="min-w-0">
                  <Text variant="strong">{template.name}</Text>
                  <Text variant="small" color="secondary">{template.description}</Text>
                  <Text variant="small" color="tertiary">
                    {template.buildPanels({}).length} panels · {template.range}{template.refreshSeconds ? ` · refresh ${template.refreshSeconds}s` : ""}
                  </Text>
                </div>
              </div>
            </button>
          );
        })}
      </div>
      {!hasChecks ? (
        <Callout color="secondary">Uptime templates can be created now; their check panels will ask for a check until one exists.</Callout>
      ) : null}
    </Dialog>
  );
}

function CopyPanelDialog({
  open,
  panel,
  targetDashboardId,
  dashboards,
  currentDashboardId,
  onTargetChange,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  panel: DashboardPanel | null;
  targetDashboardId: string;
  dashboards: DashboardDefinition[];
  currentDashboardId: string;
  onTargetChange: (dashboardId: string) => void;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const targets = dashboards.filter((dashboard) => dashboard.id !== currentDashboardId);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Copy panel"
      description={panel ? `Copy "${panel.title}" into another dashboard.` : undefined}
      confirmLabel="Copy panel"
      confirmDisabled={!panel || !targetDashboardId || targets.length === 0}
      onConfirm={onConfirm}
      size="medium"
    >
      <FieldSet>
        {targets.length === 0 ? (
          <Callout color="secondary">Create another dashboard before copying panels between dashboards.</Callout>
        ) : (
          <Field label="Target dashboard" orientation="vertical" className="p-0">
            <Select value={targetDashboardId || NONE} onValueChange={(value) => onTargetChange(value === NONE ? "" : value)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Select dashboard</SelectItem>
                {targets.map((dashboard) => (
                  <SelectItem key={dashboard.id} value={dashboard.id}>
                    {dashboard.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
      </FieldSet>
    </Dialog>
  );
}

export function DashboardsView() {
  const queryClient = useQueryClient();
  const dashboardsQuery = useDashboards();
  const { remove, save, exportOne, importOne } = useDashboardMutations();
  const capabilitiesQuery = useDashboardCapabilities();
  const dashboards = dashboardsQuery.data ?? [];
  const groupsQuery = useGroups();
  const accountsQuery = useAccounts();
  const providersQuery = useProviders();
  const checksQuery = useChecks();
  const serviceMetadataQuery = useServiceMetadata();
  const [runtimeFilters, setRuntimeFilters, resetRuntimeFilters] = useStoredState<DashboardRuntimeFilters>(FILTER_KEY, DEFAULT_RUNTIME_FILTERS);
  const [dashboardId, setDashboardId] = useState("");
  const [dashboardSearch, setDashboardSearch] = useState("");
  const [panelSearch, setPanelSearch] = useState("");
  const [dashboardDialogOpen, setDashboardDialogOpen] = useState(false);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState(DASHBOARD_TEMPLATES[0]?.id ?? "");
  const [panelDialogOpen, setPanelDialogOpen] = useState(false);
  const [editingDashboard, setEditingDashboard] = useState<DashboardDefinition | null>(null);
  const [editingPanel, setEditingPanel] = useState<DashboardPanel | null>(null);
  const [copyingPanel, setCopyingPanel] = useState<DashboardPanel | null>(null);
  const [copyTargetDashboardId, setCopyTargetDashboardId] = useState("");

  useEffect(() => {
    if (!dashboardsQuery.data) return;
    const raw = localStorage.getItem(DASHBOARD_SELECT_KEY);
    if (!raw) return;
    localStorage.removeItem(DASHBOARD_SELECT_KEY);
    try {
      const parsed = JSON.parse(raw) as { dashboardId?: unknown };
      const selectedId = typeof parsed.dashboardId === "string" ? parsed.dashboardId : "";
      if (selectedId && dashboards.some((dashboard) => dashboard.id === selectedId)) setDashboardId(selectedId);
    } catch {
      // Ignore stale command-palette selection payloads.
    }
  }, [dashboards, dashboardsQuery.data]);

  useEffect(() => {
    const raw = localStorage.getItem(DASHBOARD_CREATE_KEY);
    if (!raw) return;
    localStorage.removeItem(DASHBOARD_CREATE_KEY);
    setSelectedTemplateId(DASHBOARD_TEMPLATES[0]?.id ?? "");
    setTemplateDialogOpen(true);
  }, []);

  useEffect(() => {
    if (dashboardId && dashboards.some((dashboard) => dashboard.id === dashboardId)) return;
    setDashboardId(dashboards[0]?.id ?? "");
  }, [dashboardId, dashboards]);

  const dashboard = dashboards.find((candidate) => candidate.id === dashboardId) ?? null;
  const filteredDashboards = dashboards.filter((item) => {
    const query = dashboardSearch.trim().toLowerCase();
    if (!query) return true;
    const haystack = [
      item.name,
      item.description,
      item.range,
      item.refreshSeconds ? `refresh ${item.refreshSeconds}` : undefined,
      ...item.panels.flatMap((panel) => [
        panel.title,
        panel.visualization,
        panel.source.kind === "local" ? panel.source.metric : panel.source.capabilityId,
      ]),
    ].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(query);
  });
  const visibleDashboards = dashboard && dashboardSearch.trim() && !filteredDashboards.some((item) => item.id === dashboard.id)
    ? [dashboard, ...filteredDashboards]
    : filteredDashboards;
  const panels = useMemo(() => [...(dashboard?.panels ?? [])].sort((a, b) => a.order - b.order), [dashboard]);
  const panelLookups = useMemo<DashboardPanelLookups>(() => ({
    groups: new Map((groupsQuery.data ?? []).map((group) => [group.id, group.name])),
    accounts: new Map((accountsQuery.data ?? []).map((account) => [account.id, { label: account.label, provider: account.provider }])),
    providers: new Map((providersQuery.data ?? []).map((provider) => [provider.id, provider.label])),
    checks: new Map((checksQuery.data ?? []).map((check) => [check.id, check.name])),
    capabilities: capabilitiesQuery.data ?? [],
  }), [accountsQuery.data, capabilitiesQuery.data, checksQuery.data, groupsQuery.data, providersQuery.data]);
  const visiblePanels = useMemo(() => {
    if (!dashboard) return [];
    const query = panelSearch.trim().toLowerCase();
    if (!query) return panels;
    return panels.filter((panel) => {
      const sourceValues = panel.source.kind === "local"
        ? [panel.source.metric, panel.source.provider, panel.source.accountId, panel.source.groupId, panel.source.checkId, ...(panel.source.eventTypes ?? [])]
        : [panel.source.capabilityId, panel.source.accountId, panel.source.query, panel.source.xField, panel.source.yField, ...Object.values(panel.source.params ?? {})];
      const haystack = [
        panel.title,
        panel.visualization,
        panel.width,
        panel.height,
        ...panelMetadata(panel, dashboard, panelLookups),
        ...sourceValues,
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(query);
    });
  }, [dashboard, panelLookups, panels, panelSearch]);
  const setRuntimeFilter = <K extends keyof DashboardRuntimeFilters>(key: K, value: DashboardRuntimeFilters[K]) =>
    setRuntimeFilters({ ...runtimeFilters, [key]: value });

  const savePanelOrder = async (panel: DashboardPanel, direction: -1 | 1) => {
    if (!dashboard) return;
    const next = [...panels];
    const index = next.findIndex((candidate) => candidate.id === panel.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    try {
      await save.mutateAsync({ ...dashboard, panels: next.map((candidate, order) => ({ ...candidate, order })) });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const duplicateDashboard = async () => {
    if (!dashboard) return;
    try {
      const copy = await save.mutateAsync({
        name: `${dashboard.name} copy`,
        description: dashboard.description,
        range: dashboard.range,
        refreshSeconds: dashboard.refreshSeconds,
        variables: dashboard.variables,
        panels: panels.map((panel, order) => clonePanel(panel, order)),
      });
      setDashboardId(copy.id);
      toast.success("Dashboard duplicated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const duplicatePanel = async (panel: DashboardPanel) => {
    if (!dashboard) return;
    try {
      await save.mutateAsync({
        ...dashboard,
        panels: [...panels, clonePanel(panel, panels.length)].map((candidate, order) => ({ ...candidate, order })),
      });
      toast.success("Panel duplicated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const openCopyPanel = (panel: DashboardPanel) => {
    setCopyingPanel(panel);
    setCopyTargetDashboardId(dashboards.find((candidate) => candidate.id !== dashboard?.id)?.id ?? "");
  };

  const copyPanelToDashboard = async () => {
    if (!copyingPanel) return;
    const targetDashboard = dashboards.find((candidate) => candidate.id === copyTargetDashboardId);
    if (!targetDashboard) return;
    const targetPanels = [...targetDashboard.panels].sort((a, b) => a.order - b.order);
    try {
      const updated = await save.mutateAsync({
        ...targetDashboard,
        panels: [...targetPanels, clonePanel(copyingPanel, targetPanels.length)].map((candidate, order) => ({ ...candidate, order })),
      });
      setCopyingPanel(null);
      setCopyTargetDashboardId("");
      setDashboardId(updated.id);
      toast.success("Panel copied");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const exportDashboard = async () => {
    if (!dashboard) return;
    try {
      const result = await exportOne.mutateAsync(dashboard.id);
      if (result.ok) toast.success("Dashboard exported");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const importDashboard = async () => {
    try {
      const result = await importOne.mutateAsync();
      if (!result.filePath) return;
      toast.success(`Imported ${result.imported} dashboard${result.imported === 1 ? "" : "s"}${result.panelsSkipped ? `, skipped ${result.panelsSkipped} unmatched panels` : ""}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const createDashboardFromTemplate = async () => {
    const template = DASHBOARD_TEMPLATES.find((candidate) => candidate.id === selectedTemplateId);
    if (!template) return;
    const firstCheck = (checksQuery.data ?? [])[0];
    try {
      const created = await save.mutateAsync({
        name: template.name,
        description: template.description,
        range: template.range,
        refreshSeconds: template.refreshSeconds,
        panels: template.buildPanels({ checkId: firstCheck?.id }).map((panel, order) => dashboardPanelFromTemplate(panel, order)),
      });
      setDashboardId(created.id);
      setTemplateDialogOpen(false);
      toast.success("Dashboard created from template");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const groupOptions = [{ value: ALL, label: "All groups" }, ...(groupsQuery.data ?? []).map((group) => ({ value: group.id, label: group.name }))];
  const providerOptions = [{ value: ALL, label: "All providers" }, ...(providersQuery.data ?? []).map((provider) => ({ value: provider.id, label: provider.label }))];
  const accountOptions = [{ value: ALL, label: "All accounts" }, ...(accountsQuery.data ?? []).map((account) => ({ value: account.id, label: account.label }))];
  const checkOptions = [{ value: ALL, label: "All checks" }, ...(checksQuery.data ?? []).map((check) => ({ value: check.id, label: check.name }))];
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
  const effectiveRuntimeFilters = useMemo(
    () => mergeDashboardVariables(dashboard?.variables, runtimeFilters),
    [dashboard?.variables, runtimeFilters],
  );
  const dashboardVariableFilters = variablesToRuntimeFilters(dashboard?.variables);
  const variableBadges = [
    dashboardVariableFilters.group !== DEFAULT_RUNTIME_FILTERS.group
      ? { id: "group", label: "Group", value: optionLabel(groupOptions, dashboardVariableFilters.group) }
      : null,
    dashboardVariableFilters.provider !== DEFAULT_RUNTIME_FILTERS.provider
      ? { id: "provider", label: "Provider", value: optionLabel(providerOptions, dashboardVariableFilters.provider) }
      : null,
    dashboardVariableFilters.account !== DEFAULT_RUNTIME_FILTERS.account
      ? { id: "account", label: "Account", value: optionLabel(accountOptions, dashboardVariableFilters.account) }
      : null,
    dashboardVariableFilters.check !== DEFAULT_RUNTIME_FILTERS.check
      ? { id: "check", label: "Check", value: optionLabel(checkOptions, dashboardVariableFilters.check) }
      : null,
    dashboardVariableFilters.owner !== DEFAULT_RUNTIME_FILTERS.owner
      ? { id: "owner", label: "Owner", value: optionLabel(ownerOptions, dashboardVariableFilters.owner) }
      : null,
    dashboardVariableFilters.tier !== DEFAULT_RUNTIME_FILTERS.tier
      ? { id: "tier", label: "Tier", value: optionLabel(tierOptions, dashboardVariableFilters.tier) }
      : null,
    dashboardVariableFilters.dependency !== DEFAULT_RUNTIME_FILTERS.dependency
      ? { id: "dependency", label: "Dependency", value: optionLabel(dependencyOptions, dashboardVariableFilters.dependency) }
      : null,
  ].filter((filter): filter is { id: string; label: string; value: string } => filter !== null);
  const activeFilters: AppliedFilter[] = [
    runtimeFilters.group !== DEFAULT_RUNTIME_FILTERS.group
      ? { id: "group", label: "Group", value: optionLabel(groupOptions, runtimeFilters.group), onClear: () => setRuntimeFilter("group", DEFAULT_RUNTIME_FILTERS.group) }
      : null,
    runtimeFilters.provider !== DEFAULT_RUNTIME_FILTERS.provider
      ? { id: "provider", label: "Provider", value: optionLabel(providerOptions, runtimeFilters.provider), onClear: () => setRuntimeFilter("provider", DEFAULT_RUNTIME_FILTERS.provider) }
      : null,
    runtimeFilters.account !== DEFAULT_RUNTIME_FILTERS.account
      ? { id: "account", label: "Account", value: optionLabel(accountOptions, runtimeFilters.account), onClear: () => setRuntimeFilter("account", DEFAULT_RUNTIME_FILTERS.account) }
      : null,
    runtimeFilters.check !== DEFAULT_RUNTIME_FILTERS.check
      ? { id: "check", label: "Check", value: optionLabel(checkOptions, runtimeFilters.check), onClear: () => setRuntimeFilter("check", DEFAULT_RUNTIME_FILTERS.check) }
      : null,
    runtimeFilters.owner !== DEFAULT_RUNTIME_FILTERS.owner
      ? { id: "owner", label: "Owner", value: optionLabel(ownerOptions, runtimeFilters.owner), onClear: () => setRuntimeFilter("owner", DEFAULT_RUNTIME_FILTERS.owner) }
      : null,
    runtimeFilters.tier !== DEFAULT_RUNTIME_FILTERS.tier
      ? { id: "tier", label: "Tier", value: optionLabel(tierOptions, runtimeFilters.tier), onClear: () => setRuntimeFilter("tier", DEFAULT_RUNTIME_FILTERS.tier) }
      : null,
    runtimeFilters.dependency !== DEFAULT_RUNTIME_FILTERS.dependency
      ? { id: "dependency", label: "Dependency", value: optionLabel(dependencyOptions, runtimeFilters.dependency), onClear: () => setRuntimeFilter("dependency", DEFAULT_RUNTIME_FILTERS.dependency) }
      : null,
  ].filter((filter): filter is AppliedFilter => filter !== null);
  const hasProviderPanels = panels.some((panel) => panel.source.kind === "provider");
  const hasLocalScope = activeFilters.length > 0 || variableBadges.length > 0;

  const actions = (
    <div className="flex min-w-0 items-center gap-2 flex-wrap justify-end">
      <div className="flex items-center gap-2">
        <Input
          value={dashboardSearch}
          onChange={(event) => setDashboardSearch(event.target.value)}
          placeholder="Find dashboard..."
          variant="filled"
          size="small"
          className="w-48"
        />
        {dashboardSearch.trim() ? (
          <>
            <Text variant="small" color="tertiary">
              {filteredDashboards.length}/{dashboards.length}
            </Text>
            <Button variant="transparent" size="small" onClick={() => setDashboardSearch("")}>
              Clear
            </Button>
          </>
        ) : null}
      </div>
      <Select value={dashboardId || NONE} onValueChange={(value) => setDashboardId(value === NONE ? "" : value)}>
        <SelectTrigger variant="glass" size="large"><SelectValue /></SelectTrigger>
        <SelectContent>
          {dashboards.length === 0 ? <SelectItem value={NONE}>No dashboards</SelectItem> : null}
          {dashboards.length > 0 && visibleDashboards.length === 0 ? <SelectItem value={NONE}>No dashboards match</SelectItem> : null}
          {visibleDashboards.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <FilterMenu
        filters={activeFilters}
        onReset={resetRuntimeFilters}
        presetKey={FILTER_PRESET_KEY}
        presetValue={runtimeFilters}
        onApplyPreset={(value) => setRuntimeFilters({ ...DEFAULT_RUNTIME_FILTERS, ...value })}
      >
        <FilterSelectField label="Group" value={runtimeFilters.group} onChange={(value) => setRuntimeFilter("group", value)} options={groupOptions} />
        <FilterSelectField label="Provider" value={runtimeFilters.provider} onChange={(value) => setRuntimeFilter("provider", value)} options={providerOptions} />
        <FilterSelectField label="Account" value={runtimeFilters.account} onChange={(value) => setRuntimeFilter("account", value)} options={accountOptions} />
        <FilterSelectField label="Check" value={runtimeFilters.check} onChange={(value) => setRuntimeFilter("check", value)} options={checkOptions} />
        <FilterSelectField label="Owner" value={runtimeFilters.owner} onChange={(value) => setRuntimeFilter("owner", value)} options={ownerOptions} />
        <FilterSelectField label="Tier" value={runtimeFilters.tier} onChange={(value) => setRuntimeFilter("tier", value as DashboardRuntimeFilters["tier"])} options={tierOptions} />
        <FilterSelectField label="Dependency" value={runtimeFilters.dependency} onChange={(value) => setRuntimeFilter("dependency", value)} options={dependencyOptions} />
      </FilterMenu>
      <Button variant="transparent" size="large" iconOnly aria-label="Refresh panels" onClick={() => void queryClient.invalidateQueries({ queryKey: ["dashboards", "panel"] })}>
        <RefreshCw className="size-4" />
      </Button>
      <Button variant="transparent" size="large" onClick={() => { setEditingDashboard(dashboard); setDashboardDialogOpen(true); }} disabled={!dashboard}>
        <Edit3 className="size-4" /> Edit
      </Button>
      <Button variant="transparent" size="large" onClick={duplicateDashboard} disabled={!dashboard}>
        <Copy className="size-4" /> Duplicate
      </Button>
      <Button variant="transparent" size="large" onClick={() => void exportDashboard()} disabled={!dashboard || exportOne.isPending}>
        <Download className="size-4" /> Export
      </Button>
      <Button variant="transparent" size="large" onClick={() => void importDashboard()} disabled={importOne.isPending}>
        <Upload className="size-4" /> Import
      </Button>
      <Button variant="transparent" size="large" onClick={() => setTemplateDialogOpen(true)}>
        <LayoutTemplate className="size-4" /> Templates
      </Button>
      <Button variant="accent" size="large" onClick={() => { setEditingDashboard(null); setDashboardDialogOpen(true); }}>
        <Plus className="size-4" /> Dashboard
      </Button>
    </div>
  );

  const deleteDashboard = async () => {
    if (!dashboard) return;
    const panelText = dashboard.panels.length === 1 ? "1 panel" : `${dashboard.panels.length} panels`;
    if (!window.confirm(`Delete dashboard "${dashboard.name}" and its ${panelText}?`)) return;
    try {
      await remove.mutateAsync(dashboard.id);
      setDashboardId("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <ScrollArea title="Dashboards" actions={actions} className="h-full">
      <div className="px-2 pb-8 flex flex-col gap-4">
        {!dashboard ? (
          <EmptyState
            title="No custom dashboards"
            description="Create a dashboard and add local monitor panels or live provider query panels."
            actions={
              <div className="flex items-center gap-2">
                <Button variant="glass" onClick={() => setTemplateDialogOpen(true)}>
                  <LayoutTemplate className="size-4" />
                  Use template
                </Button>
                <Button variant="accent" onClick={() => { setEditingDashboard(null); setDashboardDialogOpen(true); }}>
                  <Plus className="size-4" />
                  Create dashboard
                </Button>
              </div>
            }
          />
        ) : (
          <>
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <Text variant="title">{dashboard.name}</Text>
                {dashboard.description ? <Text variant="small" color="secondary">{dashboard.description}</Text> : null}
                <Text variant="small" color="tertiary">Default range {dashboard.range}{dashboard.refreshSeconds ? ` · refresh ${dashboard.refreshSeconds}s` : ""}</Text>
                {variableBadges.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {variableBadges.map((filter) => (
                      <Badge key={filter.id} color="secondary">
                        {filter.label}: {filter.value}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>
              {panels.length > 0 ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={panelSearch}
                    onChange={(event) => setPanelSearch(event.target.value)}
                    placeholder="Find panel..."
                    variant="filled"
                    size="small"
                    className="w-44"
                  />
                  <Text variant="small" color="tertiary">
                    {visiblePanels.length}/{panels.length} panels
                  </Text>
                  {panelSearch.trim() ? (
                    <Button variant="transparent" size="small" onClick={() => setPanelSearch("")}>
                      Clear
                    </Button>
                  ) : null}
                </div>
              ) : null}
              <Button variant="transparent" size="large" onClick={deleteDashboard}>
                <Trash2 className="size-4 text-support-red" /> Delete
              </Button>
              <Button variant="accent" size="large" onClick={() => { setEditingPanel(null); setPanelDialogOpen(true); }}>
                <Plus className="size-4" /> Panel
              </Button>
            </div>

            {hasLocalScope && hasProviderPanels ? (
              <Callout color="secondary">
                Dashboard variables and runtime filters apply to local monitor panels only. Live provider query panels keep their configured provider parameters.
              </Callout>
            ) : null}

            {panels.length === 0 ? (
              <EmptyState title="No panels" description="Add a chart, stat, table, log, or trace panel." />
            ) : visiblePanels.length === 0 ? (
              <EmptyState
                title="No panels match"
                description="Adjust the panel search to show more panels."
                actions={<Button variant="glass" onClick={() => setPanelSearch("")}>Clear search</Button>}
              />
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {visiblePanels.map((panel) => {
                  const orderIndex = panels.findIndex((candidate) => candidate.id === panel.id);
                  return (
                    <DashboardPanelCard
                      key={panel.id}
                      panel={panel}
                      dashboard={dashboard}
                      onEdit={() => { setEditingPanel(panel); setPanelDialogOpen(true); }}
                      onDuplicate={() => void duplicatePanel(panel)}
                      onCopyToDashboard={() => openCopyPanel(panel)}
                      onMove={(direction) => void savePanelOrder(panel, direction)}
                      canMoveUp={orderIndex > 0}
                      canMoveDown={orderIndex >= 0 && orderIndex < panels.length - 1}
                      canCopyToDashboard={dashboards.length > 1}
                      filters={effectiveRuntimeFilters}
                      lookups={panelLookups}
                    />
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
      <DashboardDialog open={dashboardDialogOpen} editing={editingDashboard} onOpenChange={setDashboardDialogOpen} />
      <DashboardTemplateDialog
        open={templateDialogOpen}
        selectedId={selectedTemplateId}
        hasChecks={(checksQuery.data ?? []).length > 0}
        onSelect={setSelectedTemplateId}
        onOpenChange={setTemplateDialogOpen}
        onCreate={() => void createDashboardFromTemplate()}
      />
      <PanelDialog open={panelDialogOpen} dashboard={dashboard} editing={editingPanel} onOpenChange={setPanelDialogOpen} />
      <CopyPanelDialog
        open={Boolean(copyingPanel)}
        panel={copyingPanel}
        targetDashboardId={copyTargetDashboardId}
        dashboards={dashboards}
        currentDashboardId={dashboard?.id ?? ""}
        onTargetChange={setCopyTargetDashboardId}
        onOpenChange={(open) => {
          if (!open) {
            setCopyingPanel(null);
            setCopyTargetDashboardId("");
          }
        }}
        onConfirm={() => void copyPanelToDashboard()}
      />
    </ScrollArea>
  );
}
