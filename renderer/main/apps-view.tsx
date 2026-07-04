import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Bell, BookOpen, Download, ExternalLink, Gauge, GitBranch, LayoutDashboard, Link2, Network, Pencil, RadioTower, RefreshCw, Search, Server, Siren, TimerReset } from "lucide-react";
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

import { StatusBadge } from "./components/status-badge";
import { formatRelativeTime } from "./components/relative-time";
import { providerIcon, providerLabel } from "./components/provider-meta";
import {
  ALL,
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
import { useAccounts, useGroups } from "./hooks/use-accounts";
import { useHistoryStats } from "./hooks/use-history";
import { useMonitorData } from "./hooks/use-monitor-data";
import { useProviders } from "./hooks/use-providers";
import { useServiceMetadata, useServiceMetadataMutations } from "./hooks/use-service-metadata";
import { monitorApi } from "./ipc";
import { downloadCsv } from "./utils/csv";
import type {
  Account,
  AlertRuleInput,
  HttpCheckResult,
  MetricsSummary,
  MonitorItem,
  NormalizedStatus,
  ObservabilityIncident,
  ObservabilitySignal,
  Provider,
  ProviderDeepLink,
  ProjectGroup,
  ServiceHealth,
  ServiceMetadata,
  ServiceTier,
} from "./types";

const ALL_APPS = "all";
const FILTER_KEY = "apps.filters.v1";
const FILTER_PRESET_KEY = `${FILTER_KEY}.presets`;
const APP_SELECT_KEY = "apps.select.v1";
const ACCOUNT_SELECT_KEY = "accounts.select.v1";
const INCIDENT_CREATE_KEY = "incidents.create.v1";
const ALERT_RULE_DRAFT_KEY = "alerts.draft.v1";
const SERVICE_TIER_NONE = "none";
const SERVICE_TIERS: { value: ServiceTier; label: string }[] = [
  { value: "critical", label: "Critical" },
  { value: "standard", label: "Standard" },
  { value: "internal", label: "Internal" },
  { value: "experimental", label: "Experimental" },
];

interface AppsFilters {
  dateRange: ReturnType<typeof defaultDateRange>;
  group: string;
  provider: "all" | Provider;
  account: string;
  health: "all" | NormalizedStatus;
  stale: "all" | "stale" | "fresh";
  owner: string;
  tier: "all" | ServiceTier;
  dependency: string;
}

const DEFAULT_FILTERS: AppsFilters = {
  dateRange: defaultDateRange("24h"),
  group: ALL,
  provider: "all",
  account: ALL,
  health: "all",
  stale: "all",
  owner: ALL,
  tier: "all",
  dependency: ALL,
};

function accountMap(accounts: Account[]): Map<string, Account> {
  return new Map(accounts.map((account) => [account.id, account]));
}

function groupMap(groups: ProjectGroup[]): Map<string, ProjectGroup> {
  return new Map(groups.map((group) => [group.id, group]));
}

function serviceLabel(service: ServiceHealth, groupsById: Map<string, ProjectGroup>): string {
  return service.groupId ? groupsById.get(service.groupId)?.name ?? service.name : service.name;
}

function accountLabel(accountId: string, accountsById: Map<string, Account>): string {
  return accountsById.get(accountId)?.label ?? "Unknown account";
}

function openUrl(url: string): void {
  void monitorApi.openExternal(url).catch((error) => toast.error(error instanceof Error ? error.message : String(error)));
}

function downloadAppsCsv({
  services,
  filteredAccountIds,
  accountsById,
  groupsById,
  metadataByService,
  staleness,
}: {
  services: ServiceHealth[];
  filteredAccountIds: Set<string>;
  accountsById: Map<string, Account>;
  groupsById: Map<string, ProjectGroup>;
  metadataByService: Map<string, ServiceMetadata>;
  staleness: Record<string, { stale?: boolean; lastSyncAt?: string; ageSeconds?: number; reason?: string }> | undefined;
}): void {
  const columns = [
    "id",
    "name",
    "group",
    "groupId",
    "status",
    "providers",
    "visibleAccountCount",
    "totalAccountCount",
    "visibleAccounts",
    "openIncidents",
    "alerts",
    "signals",
    "staleVisibleAccounts",
    "lastDeployAt",
    "updatedAt",
    "owner",
    "tier",
    "dependencies",
    "runbookUrl",
    "dashboardUrl",
    "repositoryUrl",
    "deepLinkCount",
  ];
  const rows = services.map((service) => {
    const metadata = metadataByService.get(service.id);
    const visibleAccountIds = service.accountIds.filter((accountId) => filteredAccountIds.has(accountId));
    const staleVisibleAccounts = visibleAccountIds.filter((accountId) => staleness?.[accountId]?.stale).length;
    return [
      service.id,
      serviceLabel(service, groupsById),
      service.groupId ? groupsById.get(service.groupId)?.name ?? "" : "",
      service.groupId ?? "",
      service.status,
      service.providerIds.map(providerLabel).join("; "),
      visibleAccountIds.length,
      service.accountIds.length,
      visibleAccountIds.map((accountId) => accountLabel(accountId, accountsById)).join("; "),
      service.openIncidentCount,
      service.alertCount,
      service.signalCount,
      staleVisibleAccounts,
      service.lastDeployAt ?? "",
      service.updatedAt,
      metadata?.owner ?? "",
      metadata?.tier ?? "",
      (metadata?.dependencies ?? []).join("; "),
      metadata?.runbookUrl ?? "",
      metadata?.dashboardUrl ?? "",
      metadata?.repositoryUrl ?? "",
      service.deepLinks.length,
    ];
  });
  downloadCsv(`apps-${new Date().toISOString().slice(0, 10)}.csv`, columns, rows);
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

function alertRuleDraftFromSource(
  source: Pick<ObservabilityIncident | ObservabilitySignal, "accountId" | "provider" | "severity">,
  account: Account | undefined,
): AlertRuleInput {
  return {
    name: `Open incidents: ${account?.label ?? providerLabel(source.provider)}`,
    metric: "openIncidents",
    operator: "gt",
    threshold: 0,
    scope: source.accountId ? { accountId: source.accountId } : { provider: source.provider },
    enabled: true,
    minSeverity: source.severity,
    forMinutes: 0,
    cooldownMinutes: 15,
    dedupeMinutes: 30,
  };
}

function ServiceTile({
  service,
  metadata,
  groupsById,
  selected,
  onSelect,
}: {
  service: ServiceHealth;
  metadata?: ServiceMetadata;
  groupsById: Map<string, ProjectGroup>;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`text-left rounded-lg border p-3 flex flex-col gap-3 transition-colors ${
        selected ? "border-accent bg-control-subtle" : "border-separator hover:bg-control-subtle"
      }`}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Text variant="strong" truncate>{serviceLabel(service, groupsById)}</Text>
          <Text variant="small" color="secondary" truncate>
            {service.providerIds.map(providerLabel).join(" · ")}
          </Text>
        </div>
        <StatusBadge status={service.status} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <Text variant="small" color="tertiary">Incidents</Text>
          <Text variant="strong">{service.openIncidentCount}</Text>
        </div>
        <div>
          <Text variant="small" color="tertiary">Signals</Text>
          <Text variant="strong">{service.signalCount}</Text>
        </div>
        <div>
          <Text variant="small" color="tertiary">Stale</Text>
          <Text variant="strong">{service.staleAccountCount}</Text>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {metadata?.tier ? (
          <Badge color="secondary">{SERVICE_TIERS.find((option) => option.value === metadata.tier)?.label ?? metadata.tier}</Badge>
        ) : null}
        {metadata?.owner ? <Badge color="secondary">{metadata.owner}</Badge> : null}
        {service.providerIds.map((provider) => {
          const Icon = providerIcon(provider);
          return (
            <Badge key={provider} color="secondary">
              <Icon className="size-3" />
              {providerLabel(provider)}
            </Badge>
          );
        })}
      </div>
    </button>
  );
}

function IncidentRow({ incident, accountsById }: { incident: ObservabilityIncident; accountsById: Map<string, Account> }) {
  const navigate = useNavigate();
  const Icon = providerIcon(incident.provider);
  const account = accountsById.get(incident.accountId);
  const createIncident = () => {
    localStorage.setItem(INCIDENT_CREATE_KEY, JSON.stringify({
      source: {
        uid: incident.uid,
        sourceUid: incident.sourceItemUid,
        accountId: incident.accountId,
        provider: incident.provider,
        title: incident.title,
        subtitle: incident.subtitle,
        status: incident.status,
        severity: incident.severity,
        updatedAt: incident.updatedAt,
        url: incident.url,
        kind: "incident",
      },
    }));
    void navigate({ to: "/incidents" });
  };
  const createAlertRule = () => {
    localStorage.setItem(ALERT_RULE_DRAFT_KEY, JSON.stringify(alertRuleDraftFromSource(incident, account)));
    void navigate({ to: "/alerts" });
  };
  return (
    <div className="flex items-center gap-3 py-2 border-t border-separator first:border-t-0 group">
      <Icon className="size-4 text-tertiary shrink-0" />
      <div className="min-w-0 flex-1">
        <Text variant="strong" truncate>{incident.title}</Text>
        <Text variant="small" color="secondary" truncate>
          {accountLabel(incident.accountId, accountsById)} · {incident.subtitle}
        </Text>
      </div>
      <Badge color={incident.severity === "critical" || incident.severity === "high" ? "red" : "yellow"}>
        {incident.status}
      </Badge>
      <Text variant="small" color="tertiary" className="tabular-nums shrink-0">
        {formatRelativeTime(incident.updatedAt)}
      </Text>
      <Button
        variant="transparent"
        size="small"
        iconOnly
        aria-label="Create local incident"
        title="Create local incident"
        className="opacity-0 group-hover:opacity-100"
        onClick={createIncident}
      >
        <Search className="size-4" />
      </Button>
      <Button
        variant="transparent"
        size="small"
        iconOnly
        aria-label="Create alert rule"
        title="Create alert rule"
        className="opacity-0 group-hover:opacity-100"
        onClick={createAlertRule}
      >
        <Bell className="size-4" />
      </Button>
      <Button variant="transparent" size="small" iconOnly aria-label="Open incident" onClick={() => openUrl(incident.url)}>
        <ExternalLink className="size-4" />
      </Button>
    </div>
  );
}

function SignalRow({ signal, accountsById }: { signal: ObservabilitySignal; accountsById: Map<string, Account> }) {
  const navigate = useNavigate();
  const Icon = providerIcon(signal.provider);
  const account = accountsById.get(signal.accountId);
  const createIncident = () => {
    localStorage.setItem(INCIDENT_CREATE_KEY, JSON.stringify({
      source: {
        uid: signal.uid,
        sourceUid: signal.sourceItemUid,
        accountId: signal.accountId,
        provider: signal.provider,
        title: signal.title,
        subtitle: signal.subtitle,
        status: signal.status,
        severity: signal.severity,
        updatedAt: signal.updatedAt,
        url: signal.url,
        kind: "signal",
      },
    }));
    void navigate({ to: "/incidents" });
  };
  const createAlertRule = () => {
    localStorage.setItem(ALERT_RULE_DRAFT_KEY, JSON.stringify(alertRuleDraftFromSource(signal, account)));
    void navigate({ to: "/alerts" });
  };
  return (
    <div className="flex items-center gap-3 py-2 border-t border-separator first:border-t-0 group">
      <Icon className="size-4 text-tertiary shrink-0" />
      <div className="min-w-0 flex-1">
        <Text variant="strong" truncate>{signal.title}</Text>
        <Text variant="small" color="secondary" truncate>
          {accountLabel(signal.accountId, accountsById)} · {signal.subtitle}
        </Text>
      </div>
      <StatusBadge status={signal.status} />
      <Text variant="small" color="tertiary" className="tabular-nums shrink-0">
        {formatRelativeTime(signal.updatedAt)}
      </Text>
      <Button
        variant="transparent"
        size="small"
        iconOnly
        aria-label="Create local incident"
        title="Create local incident"
        className="opacity-0 group-hover:opacity-100"
        onClick={createIncident}
      >
        <Search className="size-4" />
      </Button>
      <Button
        variant="transparent"
        size="small"
        iconOnly
        aria-label="Create alert rule"
        title="Create alert rule"
        className="opacity-0 group-hover:opacity-100"
        onClick={createAlertRule}
      >
        <Bell className="size-4" />
      </Button>
      <Button variant="transparent" size="small" iconOnly aria-label="Open signal" onClick={() => openUrl(signal.url)}>
        <ExternalLink className="size-4" />
      </Button>
    </div>
  );
}

function MetricsRow({ summary, accountsById }: { summary: MetricsSummary; accountsById: Map<string, Account> }) {
  const navigate = useNavigate();
  const Icon = providerIcon(summary.provider);
  const account = accountsById.get(summary.accountId);
  const summaryUrl = summary.url;
  const canCreateAlertRule = summary.status !== "success";
  const createAlertRule = () => {
    localStorage.setItem(ALERT_RULE_DRAFT_KEY, JSON.stringify({
      name: `Metric issue: ${account?.label ?? providerLabel(summary.provider)}`,
      metric: "failureRate",
      operator: "gt",
      threshold: 0,
      scope: summary.accountId ? { accountId: summary.accountId } : { provider: summary.provider },
      enabled: true,
      forMinutes: 5,
      cooldownMinutes: 15,
      dedupeMinutes: 30,
    } satisfies AlertRuleInput));
    void navigate({ to: "/alerts" });
  };
  return (
    <div className="flex items-center gap-3 py-2 border-t border-separator first:border-t-0 group">
      <Icon className="size-4 text-tertiary shrink-0" />
      <div className="min-w-0 flex-1">
        <Text variant="strong" truncate>{summary.title}</Text>
        <Text variant="small" color="secondary" truncate>{accountLabel(summary.accountId, accountsById)}</Text>
      </div>
      <div className="flex flex-wrap justify-end gap-1.5">
        {summary.metrics.map((metric) => (
          <Badge key={metric.label} color="secondary">
            {metric.label}: {metric.value}{metric.unit ?? ""}
          </Badge>
        ))}
      </div>
      <StatusBadge status={summary.status} />
      {canCreateAlertRule ? (
        <Button
          variant="transparent"
          size="small"
          iconOnly
          aria-label="Create alert rule"
          title="Create alert rule"
          className="opacity-0 group-hover:opacity-100"
          onClick={createAlertRule}
        >
          <Bell className="size-4" />
        </Button>
      ) : null}
      {summaryUrl ? (
        <Button
          variant="transparent"
          size="small"
          iconOnly
          aria-label="Open metrics"
          title="Open metrics"
          className="opacity-0 group-hover:opacity-100"
          onClick={() => openUrl(summaryUrl)}
        >
          <ExternalLink className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}

function AccountCoverageRow({
  account,
  service,
  stale,
  lastSyncAt,
  lastError,
}: {
  account: Account;
  service: ServiceHealth | undefined;
  stale: boolean;
  lastSyncAt?: string;
  lastError?: string;
}) {
  const navigate = useNavigate();
  const [refreshing, setRefreshing] = useState(false);
  const Icon = providerIcon(account.provider);
  const status = stale || lastError ? "warning" : account.enabled ? service?.status ?? "unknown" : "info";
  const openAccount = () => {
    localStorage.setItem(ACCOUNT_SELECT_KEY, JSON.stringify({
      accountId: account.id,
      filters: {
        provider: account.provider,
        group: account.groupId ?? ALL,
      },
    }));
    void navigate({ to: "/accounts" });
  };
  const refreshAccount = () => {
    setRefreshing(true);
    void monitorApi.refresh(account.id)
      .then(() => toast.success("Account refreshed"))
      .catch((error) => toast.error(error instanceof Error ? error.message : String(error)))
      .finally(() => setRefreshing(false));
  };
  return (
    <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-3 py-2 border-t border-separator first:border-t-0 items-center group">
      <Icon className="size-4 text-tertiary" />
      <div className="min-w-0">
        <Text variant="strong" truncate>{account.label}</Text>
        <Text variant="small" color="secondary" truncate>
          {providerLabel(account.provider)}{account.identity ? ` · ${account.identity}` : ""}{lastError ? ` · ${lastError}` : ""}
        </Text>
      </div>
      <Text variant="small" color="tertiary" className="tabular-nums">
        {lastSyncAt ? formatRelativeTime(lastSyncAt) : account.enabled ? "Never synced" : "Disabled"}
      </Text>
      <StatusBadge status={status} />
      <div className="flex items-center justify-end gap-1">
        <Button
          variant="transparent"
          size="small"
          iconOnly
          aria-label="Edit account"
          title="Edit account"
          className="opacity-0 group-hover:opacity-100"
          onClick={openAccount}
        >
          <Pencil className="size-4" />
        </Button>
        <Button
          variant="transparent"
          size="small"
          iconOnly
          aria-label="Refresh account"
          title="Refresh account"
          className="opacity-0 group-hover:opacity-100"
          onClick={refreshAccount}
          disabled={refreshing}
        >
          <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} />
        </Button>
      </div>
    </div>
  );
}

function CheckRow({ check }: { check: HttpCheckResult }) {
  return (
    <div className="grid grid-cols-[1fr_auto_auto] gap-3 py-2 border-t border-separator first:border-t-0 items-center">
      <div className="min-w-0">
        <Text variant="strong" truncate>{check.name}</Text>
        <Text variant="small" color="secondary" truncate>{check.error ?? check.url}</Text>
      </div>
      <Text variant="small" color="tertiary" className="tabular-nums">
        {check.statusCode ? `HTTP ${check.statusCode}` : check.ok ? "OK" : "Down"} · {check.latencyMs}ms
      </Text>
      <StatusBadge status={check.ok ? "success" : "failure"} />
    </div>
  );
}

function DeepLinkList({ links }: { links: ProviderDeepLink[] }) {
  if (links.length === 0) return <Callout color="secondary">No provider links are available for this service.</Callout>;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
      {links.map((link) => {
        const Icon = providerIcon(link.provider);
        return (
          <Button
            key={`${link.accountId}:${link.category}:${link.url}`}
            variant="glass"
            size="small"
            className="justify-start"
            onClick={() => openUrl(link.url)}
          >
            <Icon className="size-4" />
            <span className="truncate">{providerLabel(link.provider)} · {link.label}</span>
          </Button>
        );
      })}
    </div>
  );
}

function TimelineRow({ item, accountsById }: { item: MonitorItem; accountsById: Map<string, Account> }) {
  const navigate = useNavigate();
  const Icon = providerIcon(item.provider);
  const account = accountsById.get(item.accountId);
  const canCreateAlertRule = item.status !== "success";
  const createIncident = () => {
    localStorage.setItem(INCIDENT_CREATE_KEY, JSON.stringify({ monitorItem: item }));
    void navigate({ to: "/incidents" });
  };
  const createAlertRule = () => {
    localStorage.setItem(ALERT_RULE_DRAFT_KEY, JSON.stringify(alertRuleDraftFromMonitorItem(item, account)));
    void navigate({ to: "/alerts" });
  };
  return (
    <div className="grid grid-cols-[7rem_1fr_auto] gap-3 py-2 border-t border-separator first:border-t-0 group">
      <Text variant="small" color="tertiary" className="tabular-nums">
        {formatRelativeTime(item.updatedAt)}
      </Text>
      <div className="min-w-0 flex items-center gap-2">
        <Icon className="size-4 text-tertiary shrink-0" />
        <div className="min-w-0">
          <Text variant="strong" truncate>{item.title}</Text>
          <Text variant="small" color="secondary" truncate>
            {accountLabel(item.accountId, accountsById)} · {item.subtitle}
          </Text>
        </div>
      </div>
      <div className="flex items-center justify-end gap-1">
        <StatusBadge status={item.status} />
        <Button
          variant="transparent"
          size="small"
          iconOnly
          aria-label="Start investigation"
          title="Start investigation"
          className="opacity-0 group-hover:opacity-100"
          onClick={createIncident}
        >
          <Search className="size-4" />
        </Button>
        {canCreateAlertRule ? (
          <Button
            variant="transparent"
            size="small"
            iconOnly
            aria-label="Create alert rule"
            title="Create alert rule"
            className="opacity-0 group-hover:opacity-100"
            onClick={createAlertRule}
          >
            <Bell className="size-4" />
          </Button>
        ) : null}
        <Button
          variant="transparent"
          size="small"
          iconOnly
          aria-label="Open activity"
          title="Open activity"
          className="opacity-0 group-hover:opacity-100"
          onClick={() => openUrl(item.url)}
        >
          <ExternalLink className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2 px-2">
        {icon}
        <Text variant="strong">{title}</Text>
      </div>
      <div className="rounded-lg border border-separator p-3">{children}</div>
    </section>
  );
}

function ServiceMetadataDialog({
  open,
  service,
  metadata,
  groupsById,
  onOpenChange,
}: {
  open: boolean;
  service: ServiceHealth | undefined;
  metadata: ServiceMetadata | undefined;
  groupsById: Map<string, ProjectGroup>;
  onOpenChange: (open: boolean) => void;
}) {
  const { save } = useServiceMetadataMutations();
  const [owner, setOwner] = useState("");
  const [tier, setTier] = useState<ServiceTier | typeof SERVICE_TIER_NONE>(SERVICE_TIER_NONE);
  const [runbookUrl, setRunbookUrl] = useState("");
  const [dashboardUrl, setDashboardUrl] = useState("");
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [dependencies, setDependencies] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    setOwner(metadata?.owner ?? "");
    setTier(metadata?.tier ?? SERVICE_TIER_NONE);
    setRunbookUrl(metadata?.runbookUrl ?? "");
    setDashboardUrl(metadata?.dashboardUrl ?? "");
    setRepositoryUrl(metadata?.repositoryUrl ?? "");
    setDependencies(metadata?.dependencies?.join(", ") ?? "");
    setNotes(metadata?.notes ?? "");
  }, [metadata, open]);

  if (!service) return null;

  const onConfirm = async () => {
    const parsedDependencies = dependencies.split(",").map((dependency) => dependency.trim()).filter(Boolean);
    try {
      await save.mutateAsync({
        serviceId: service.id,
        owner,
        tier: tier === SERVICE_TIER_NONE ? undefined : tier,
        runbookUrl,
        dashboardUrl,
        repositoryUrl,
        dependencies: parsedDependencies,
        notes,
      });
      toast.success("Service metadata saved.");
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Service metadata"
      confirmLabel="Save"
      onConfirm={onConfirm}
      size="medium"
    >
      <FieldSet>
        <Callout color="secondary">
          Local annotations for {serviceLabel(service, groupsById)}. This never stores provider credentials or changes account configuration.
        </Callout>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Owner" orientation="vertical" className="p-0">
            <Input value={owner} onChange={(event) => setOwner(event.target.value)} placeholder="Payments team" />
          </Field>
          <Field label="Tier" orientation="vertical" className="p-0">
            <Select value={tier} onValueChange={(value) => setTier(value as ServiceTier | typeof SERVICE_TIER_NONE)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={SERVICE_TIER_NONE}>No tier</SelectItem>
                {SERVICE_TIERS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <Field label="Runbook URL" orientation="vertical" className="p-0">
          <Input value={runbookUrl} onChange={(event) => setRunbookUrl(event.target.value)} placeholder="https://…" />
        </Field>
        <Field label="Dashboard URL" orientation="vertical" className="p-0">
          <Input value={dashboardUrl} onChange={(event) => setDashboardUrl(event.target.value)} placeholder="https://…" />
        </Field>
        <Field label="Repository URL" orientation="vertical" className="p-0">
          <Input value={repositoryUrl} onChange={(event) => setRepositoryUrl(event.target.value)} placeholder="https://…" />
        </Field>
        <Field label="Dependencies" orientation="vertical" className="p-0">
          <Input value={dependencies} onChange={(event) => setDependencies(event.target.value)} placeholder="Comma-separated services or systems" />
        </Field>
        <Field label="Notes" orientation="vertical" className="p-0">
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={4}
            className="min-h-24 w-full rounded-md border border-control-border bg-control-background px-3 py-2 text-sm outline-none focus:border-accent"
            placeholder="Operational context, ownership notes, escalation details"
          />
        </Field>
      </FieldSet>
    </Dialog>
  );
}

function ServiceMetadataPanel({
  metadata,
  onEdit,
}: {
  metadata: ServiceMetadata | undefined;
  onEdit: () => void;
}) {
  const { remove } = useServiceMetadataMutations();
  const links = [
    metadata?.runbookUrl ? { label: "Runbook", url: metadata.runbookUrl, icon: BookOpen } : null,
    metadata?.dashboardUrl ? { label: "Dashboard", url: metadata.dashboardUrl, icon: LayoutDashboard } : null,
    metadata?.repositoryUrl ? { label: "Repository", url: metadata.repositoryUrl, icon: GitBranch } : null,
  ].filter((link): link is { label: string; url: string; icon: typeof BookOpen } => link !== null);

  if (!metadata) {
    return (
      <div className="flex flex-col gap-3">
        <Callout color="secondary">No local metadata has been added for this service.</Callout>
        <div>
          <Button variant="glass" size="small" onClick={onEdit}>
            <Pencil className="size-4" />
            Edit metadata
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div className="rounded-md border border-separator p-2">
          <Text variant="small" color="tertiary">Owner</Text>
          <Text variant="strong" truncate>{metadata.owner ?? "Unassigned"}</Text>
        </div>
        <div className="rounded-md border border-separator p-2">
          <Text variant="small" color="tertiary">Tier</Text>
          <Text variant="strong">{SERVICE_TIERS.find((option) => option.value === metadata.tier)?.label ?? "No tier"}</Text>
        </div>
      </div>
      {links.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {links.map((link) => {
            const Icon = link.icon;
            return (
              <Button key={link.label} variant="glass" size="small" onClick={() => openUrl(link.url)}>
                <Icon className="size-4" />
                {link.label}
              </Button>
            );
          })}
        </div>
      ) : null}
      {metadata.dependencies && metadata.dependencies.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {metadata.dependencies.map((dependency) => (
            <Badge key={dependency} color="secondary">{dependency}</Badge>
          ))}
        </div>
      ) : null}
      {metadata.notes ? (
        <Text variant="small" color="secondary" className="whitespace-pre-wrap">{metadata.notes}</Text>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <Text variant="small" color="tertiary">Updated {formatRelativeTime(metadata.updatedAt)}</Text>
        <div className="flex gap-2">
          <Button variant="transparent" size="small" onClick={onEdit}>
            <Pencil className="size-4" />
            Edit
          </Button>
          <Button
            variant="transparent"
            size="small"
            disabled={remove.isPending}
            onClick={() => {
              if (!window.confirm(`Clear service metadata for "${metadata.serviceId}"?`)) return;
              void remove.mutateAsync(metadata.serviceId)
                .then(() => toast.success("Service metadata cleared."))
                .catch((error) => toast.error(error instanceof Error ? error.message : String(error)));
            }}
          >
            Clear
          </Button>
        </div>
      </div>
    </div>
  );
}

interface DependencyRow {
  service: ServiceHealth;
  metadata: ServiceMetadata;
  dependency: string;
}

function DependencyOverview({
  rows,
  groupsById,
  onSelectService,
}: {
  rows: DependencyRow[];
  groupsById: Map<string, ProjectGroup>;
  onSelectService: (serviceId: string) => void;
}) {
  if (rows.length === 0) {
    return <Callout color="secondary">No dependency metadata has been added for this selection.</Callout>;
  }

  return (
    <div className="flex flex-col">
      {rows.map((row) => (
        <div
          key={`${row.service.id}:${row.dependency}`}
          className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-3 py-2 border-t border-separator first:border-t-0 items-center"
        >
          <div className="min-w-0">
            <Text variant="strong" truncate>{serviceLabel(row.service, groupsById)}</Text>
            <Text variant="small" color="secondary" truncate>
              {[
                row.metadata.owner,
                SERVICE_TIERS.find((option) => option.value === row.metadata.tier)?.label,
              ].filter(Boolean).join(" · ") || "No owner or tier"}
            </Text>
          </div>
          <div className="min-w-0 flex items-center gap-2">
            <Network className="size-4 text-tertiary shrink-0" />
            <Badge color="secondary">{row.dependency}</Badge>
          </div>
          <Button variant="transparent" size="small" onClick={() => onSelectService(row.service.id)}>
            View
          </Button>
        </div>
      ))}
    </div>
  );
}

export function AppsView() {
  const snapshotQuery = useMonitorData();
  const accountsQuery = useAccounts();
  const groupsQuery = useGroups();
  const providersQuery = useProviders();
  const metadataQuery = useServiceMetadata();
  const historyStatsQuery = useHistoryStats();
  const [selectedServiceId, setSelectedServiceId] = useState(ALL_APPS);
  const [metadataDialogOpen, setMetadataDialogOpen] = useState(false);
  const [storedFilters, setFilters, resetFilters] = useStoredState<AppsFilters>(FILTER_KEY, DEFAULT_FILTERS);
  const filters: AppsFilters = { ...DEFAULT_FILTERS, ...storedFilters, dateRange: storedFilters.dateRange ?? DEFAULT_FILTERS.dateRange };
  const dateBounds = retainedHistoryDateBounds(historyStatsQuery.data);
  const [refreshing, setRefreshing] = useState(false);
  const setFilter = <K extends keyof AppsFilters>(key: K, value: AppsFilters[K]) => setFilters({ ...filters, [key]: value });

  const snapshot = snapshotQuery.data;
  const accounts = accountsQuery.data ?? [];
  const groups = groupsQuery.data ?? [];
  const accountsById = useMemo(() => accountMap(accounts), [accounts]);
  const groupsById = useMemo(() => groupMap(groups), [groups]);
  const metadataByService = useMemo(() => new Map((metadataQuery.data ?? []).map((metadata) => [metadata.serviceId, metadata])), [metadataQuery.data]);
  const allServices = snapshot?.services ?? [];

  useEffect(() => {
    if (!snapshot) return;
    const raw = localStorage.getItem(APP_SELECT_KEY);
    if (!raw) return;
    localStorage.removeItem(APP_SELECT_KEY);
    try {
      const parsed = JSON.parse(raw) as { serviceId?: unknown };
      const serviceId = typeof parsed.serviceId === "string" ? parsed.serviceId : "";
      const service = snapshot.services.find((candidate) => candidate.id === serviceId);
      if (!service) return;
      setFilters({
        ...DEFAULT_FILTERS,
        group: service.groupId ?? DEFAULT_FILTERS.group,
      });
      setSelectedServiceId(service.id);
    } catch {
      // Ignore stale command-palette selection payloads.
    }
  }, [snapshot, setFilters]);

  const filteredAccounts = accounts.filter((account) => {
    if (filters.group !== ALL && account.groupId !== filters.group) return false;
    if (filters.provider !== "all" && account.provider !== filters.provider) return false;
    if (filters.account !== ALL && account.id !== filters.account) return false;
    const stale = snapshot?.staleness[account.id]?.stale ?? false;
    if (filters.stale === "stale" && !stale) return false;
    if (filters.stale === "fresh" && stale) return false;
    return true;
  });
  const filteredAccountIds = useMemo(() => new Set(filteredAccounts.map((account) => account.id)), [filteredAccounts]);
  const services = allServices.filter((service) => {
    const metadata = metadataByService.get(service.id);
    if (filters.health !== "all" && service.status !== filters.health) return false;
    if (filters.owner !== ALL && metadata?.owner !== filters.owner) return false;
    if (filters.tier !== "all" && metadata?.tier !== filters.tier) return false;
    if (filters.dependency !== ALL && !metadata?.dependencies?.includes(filters.dependency)) return false;
    return service.accountIds.some((accountId) => filteredAccountIds.has(accountId));
  });
  const dependencyRows = services
    .flatMap((service): DependencyRow[] => {
      const metadata = metadataByService.get(service.id);
      if (!metadata?.dependencies?.length) return [];
      return [...new Set(metadata.dependencies)].map((dependency) => ({ service, metadata, dependency }));
    })
    .sort((a, b) =>
      a.dependency.localeCompare(b.dependency) ||
      serviceLabel(a.service, groupsById).localeCompare(serviceLabel(b.service, groupsById)));

  const selectedAccountIds = useMemo(() => {
    if (selectedServiceId === ALL_APPS) return filteredAccountIds;
    return new Set((services.find((service) => service.id === selectedServiceId)?.accountIds ?? []).filter((accountId) => filteredAccountIds.has(accountId)));
  }, [filteredAccountIds, selectedServiceId, services]);

  const selectedService = services.find((service) => service.id === selectedServiceId);
  const selectedMetadata = selectedService ? metadataByService.get(selectedService.id) : undefined;
  const selectedAccounts = accounts.filter((account) => selectedAccountIds.has(account.id));
  const selectedGroupIds = useMemo(() => new Set(selectedAccounts.map((account) => account.groupId).filter((id): id is string => Boolean(id))), [selectedAccounts]);
  const incidents = (snapshot?.incidents ?? []).filter((incident) => selectedAccountIds.has(incident.accountId) && incident.status !== "resolved" && matchesDateRange(incident.updatedAt, filters.dateRange));
  const signals = (snapshot?.signals ?? []).filter((signal) => selectedAccountIds.has(signal.accountId) && matchesDateRange(signal.updatedAt, filters.dateRange));
  const metrics = (snapshot?.metrics ?? []).filter((summary) => selectedAccountIds.has(summary.accountId) && matchesDateRange(summary.updatedAt, filters.dateRange));
  const timeline = (snapshot?.items ?? []).filter((item) => selectedAccountIds.has(item.accountId) && matchesDateRange(item.updatedAt, filters.dateRange)).slice(0, 24);
  const staleAccounts = accounts.filter((account) => selectedAccountIds.has(account.id) && snapshot?.staleness[account.id]?.stale);
  const serviceChecks = (snapshot?.checks ?? []).filter((check) => {
    if (selectedService?.groupId) return check.groupId === selectedService.groupId;
    if (selectedServiceId === ALL_APPS) return !check.groupId || selectedGroupIds.has(check.groupId);
    return !check.groupId;
  });
  const healthContributors = selectedService
    ? [
        { label: "Accounts", value: selectedAccounts.length, status: selectedService.staleAccountCount ? "warning" : selectedService.status },
        { label: "Open incidents", value: selectedService.openIncidentCount, status: selectedService.openIncidentCount ? "failure" : "success" },
        { label: "Alerts", value: selectedService.alertCount, status: selectedService.alertCount ? "warning" : "success" },
        { label: "Signals", value: selectedService.signalCount, status: selectedService.signalCount ? "warning" : "success" },
        { label: "Stale accounts", value: selectedService.staleAccountCount, status: selectedService.staleAccountCount ? "warning" : "success" },
      ] as { label: string; value: number; status: NormalizedStatus }[]
    : [];

  const refresh = async () => {
    setRefreshing(true);
    try {
      await monitorApi.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setRefreshing(false);
    }
  };

  const groupOptions = [{ value: ALL, label: "All groups" }, ...groups.map((group) => ({ value: group.id, label: group.name }))];
  const providerOptions = [{ value: "all", label: "All providers" }, ...(providersQuery.data ?? []).map((provider) => ({ value: provider.id, label: provider.label }))];
  const accountOptions = [{ value: ALL, label: "All accounts" }, ...accounts.map((account) => ({ value: account.id, label: account.label }))];
  const healthOptions = STATUS_FILTER_OPTIONS.map((option) => ({ value: option.value, label: option.value === "all" ? "All health" : option.label }));
  const staleOptions = [{ value: "all", label: "All freshness" }, { value: "stale", label: "Stale only" }, { value: "fresh", label: "Fresh only" }];
  const ownerOptions = [
    { value: ALL, label: "All owners" },
    ...[...new Set((metadataQuery.data ?? []).map((metadata) => metadata.owner).filter((owner): owner is string => Boolean(owner)))]
      .sort((a, b) => a.localeCompare(b))
      .map((owner) => ({ value: owner, label: owner })),
  ];
  const tierOptions = [{ value: "all", label: "All tiers" }, ...SERVICE_TIERS];
  const dependencyOptions = [
    { value: ALL, label: "All dependencies" },
    ...[...new Set((metadataQuery.data ?? []).flatMap((metadata) => metadata.dependencies ?? []))]
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
    filters.health !== DEFAULT_FILTERS.health
      ? { id: "health", label: "Health", value: optionLabel(healthOptions, filters.health), onClear: () => setFilter("health", DEFAULT_FILTERS.health) }
      : null,
    filters.stale !== DEFAULT_FILTERS.stale
      ? { id: "stale", label: "Freshness", value: optionLabel(staleOptions, filters.stale), onClear: () => setFilter("stale", DEFAULT_FILTERS.stale) }
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
  const exportApps = () => {
    downloadAppsCsv({
      services,
      filteredAccountIds,
      accountsById,
      groupsById,
      metadataByService,
      staleness: snapshot?.staleness,
    });
    toast.success(`Exported ${services.length} ${services.length === 1 ? "app" : "apps"}`);
  };

  const actions = (
    <div className="flex min-w-0 items-center gap-2 flex-wrap justify-end">
      <Button variant="glass" size="small" onClick={exportApps} disabled={services.length === 0}>
        <Download className="size-4" />
        Export CSV
      </Button>
      <Select value={selectedServiceId} onValueChange={setSelectedServiceId}>
        <SelectTrigger variant="glass" size="large">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_APPS}>All apps</SelectItem>
          {services.map((service) => (
            <SelectItem key={service.id} value={service.id}>
              {serviceLabel(service, groupsById)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FilterMenu
        filters={activeFilters}
        onReset={resetFilters}
        presetKey={FILTER_PRESET_KEY}
        presetValue={filters}
        onApplyPreset={(value) => setFilters({ ...DEFAULT_FILTERS, ...value, dateRange: value.dateRange ?? DEFAULT_FILTERS.dateRange })}
      >
        <FilterDateRangeField label="Range" value={filters.dateRange} onChange={(value) => setFilter("dateRange", value)} bounds={dateBounds} />
        <FilterSelectField label="Group" value={filters.group} onChange={(value) => setFilter("group", value)} options={groupOptions} />
        <FilterSelectField label="Provider" value={filters.provider} onChange={(value) => setFilter("provider", value as AppsFilters["provider"])} options={providerOptions} />
        <FilterSelectField label="Account" value={filters.account} onChange={(value) => setFilter("account", value)} options={accountOptions} />
        <FilterSelectField label="Health" value={filters.health} onChange={(value) => setFilter("health", value as AppsFilters["health"])} options={healthOptions} />
        <FilterSelectField label="Freshness" value={filters.stale} onChange={(value) => setFilter("stale", value as AppsFilters["stale"])} options={staleOptions} />
        <FilterSelectField label="Owner" value={filters.owner} onChange={(value) => setFilter("owner", value)} options={ownerOptions} />
        <FilterSelectField label="Tier" value={filters.tier} onChange={(value) => setFilter("tier", value as AppsFilters["tier"])} options={tierOptions} />
        <FilterSelectField label="Dependency" value={filters.dependency} onChange={(value) => setFilter("dependency", value)} options={dependencyOptions} />
      </FilterMenu>
      <Button variant="glass" size="large" iconOnly aria-label="Refresh" onClick={refresh} disabled={refreshing}>
        <RefreshCw className={`size-4.5 ${refreshing ? "animate-spin" : ""}`} />
      </Button>
    </div>
  );

  return (
    <ScrollArea title="Apps" actions={actions} className="h-full">
      <div className="px-2 pb-8 flex flex-col gap-6">
        {accounts.length === 0 ? (
          <EmptyState title="No accounts connected" description="Connect provider accounts before building app health views." />
        ) : allServices.length === 0 ? (
          <Callout color="secondary">Waiting for the next polling cycle to build app health.</Callout>
        ) : services.length === 0 ? (
          <EmptyState
            title="No apps match filters"
            description="Adjust or reset filters to show app health."
          >
            <Button variant="glass" size="small" onClick={resetFilters}>
              Reset filters
            </Button>
          </EmptyState>
        ) : (
          <>
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
              {services.map((service) => (
                <ServiceTile
                  key={service.id}
                  service={service}
                  metadata={metadataByService.get(service.id)}
                  groupsById={groupsById}
                  selected={selectedServiceId === service.id}
                  onSelect={() => setSelectedServiceId(service.id)}
                />
              ))}
            </div>

            {selectedService ? (
              <div className="flex items-center gap-2 px-2">
                <Text variant="title">{serviceLabel(selectedService, groupsById)}</Text>
                <Badge color="secondary">{selectedService.accountIds.length} accounts</Badge>
                <div className="ml-auto flex flex-wrap gap-2">
                  <Button variant="glass" size="small" onClick={() => setMetadataDialogOpen(true)}>
                    <Pencil className="size-4" />
                    Metadata
                  </Button>
                  {selectedService.deepLinks.slice(0, 4).map((link) => (
                    <Button key={`${link.accountId}:${link.url}`} variant="glass" size="small" onClick={() => openUrl(link.url)}>
                      <ExternalLink className="size-4" />
                      {link.label}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}

            {staleAccounts.length > 0 ? (
              <Callout color="yellow" icon={<TimerReset />}>
                {staleAccounts.length} account{staleAccounts.length === 1 ? "" : "s"} have stale polling data in this view.
              </Callout>
            ) : null}

            {selectedService ? (
              <div className="grid grid-cols-1 2xl:grid-cols-3 gap-6">
                <Section title="Service Metadata" icon={<BookOpen className="size-4 text-tertiary" />}>
                  <ServiceMetadataPanel metadata={selectedMetadata} onEdit={() => setMetadataDialogOpen(true)} />
                </Section>

                <Section title="Health Contributors" icon={<Gauge className="size-4 text-tertiary" />}>
                  <div className="grid grid-cols-2 gap-2">
                    {healthContributors.map((item) => (
                      <div key={item.label} className="rounded-md border border-separator p-2">
                        <Text variant="small" color="tertiary">{item.label}</Text>
                        <div className="flex items-center justify-between gap-2">
                          <Text variant="strong">{item.value}</Text>
                          <StatusBadge status={item.status} />
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>

                <Section title="Accounts" icon={<Server className="size-4 text-tertiary" />}>
                  <div className="flex flex-col">
                    {selectedAccounts.map((account) => (
                      <AccountCoverageRow
                        key={account.id}
                        account={account}
                        service={selectedService}
                        stale={snapshot?.staleness[account.id]?.stale ?? false}
                        lastSyncAt={snapshot?.perAccount[account.id]?.lastSyncAt}
                        lastError={snapshot?.perAccount[account.id]?.lastError ?? account.lastError}
                      />
                    ))}
                  </div>
                </Section>

                <Section title="Provider Links" icon={<Link2 className="size-4 text-tertiary" />}>
                  <DeepLinkList links={selectedService.deepLinks} />
                </Section>
              </div>
            ) : null}

            {selectedService && serviceChecks.length > 0 ? (
              <Section title="Uptime Checks" icon={<RadioTower className="size-4 text-tertiary" />}>
                <div className="flex flex-col">
                  {serviceChecks.map((check) => (
                    <CheckRow key={check.checkId} check={check} />
                  ))}
                </div>
              </Section>
            ) : null}

            <Section title="Dependency Overview" icon={<Network className="size-4 text-tertiary" />}>
              <DependencyOverview rows={dependencyRows} groupsById={groupsById} onSelectService={setSelectedServiceId} />
            </Section>

            <div className="grid grid-cols-1 2xl:grid-cols-2 gap-6">
              <Section title="Active Incidents" icon={<Siren className="size-4 text-tertiary" />}>
                {incidents.length === 0 ? (
                  <Callout color="secondary">No active incidents for this selection.</Callout>
                ) : (
                  <div className="flex flex-col">
                    {incidents.slice(0, 12).map((incident) => (
                      <IncidentRow key={incident.uid} incident={incident} accountsById={accountsById} />
                    ))}
                  </div>
                )}
              </Section>

              <Section title="Signals" icon={<RadioTower className="size-4 text-tertiary" />}>
                {signals.length === 0 ? (
                  <Callout color="secondary">No current alerts, warnings, issues, or SLO signals.</Callout>
                ) : (
                  <div className="flex flex-col">
                    {signals.slice(0, 14).map((signal) => (
                      <SignalRow key={signal.uid} signal={signal} accountsById={accountsById} />
                    ))}
                  </div>
                )}
              </Section>
            </div>

            {metrics.length > 0 ? (
              <Section title="Metric Summaries">
                <div className="flex flex-col">
                  {metrics.map((summary) => (
                    <MetricsRow key={summary.uid} summary={summary} accountsById={accountsById} />
                  ))}
                </div>
              </Section>
            ) : null}

            <Section title="Incident Timeline">
              {timeline.length === 0 ? (
                <Callout color="secondary">No recent provider activity for this selection.</Callout>
              ) : (
                <div className="flex flex-col">
                  {timeline.map((item) => (
                    <TimelineRow key={item.uid} item={item} accountsById={accountsById} />
                  ))}
                </div>
              )}
            </Section>
          </>
        )}
      </div>
      <ServiceMetadataDialog
        open={metadataDialogOpen}
        service={selectedService}
        metadata={selectedMetadata}
        groupsById={groupsById}
        onOpenChange={setMetadataDialogOpen}
      />
    </ScrollArea>
  );
}
