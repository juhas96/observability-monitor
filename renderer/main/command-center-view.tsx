import { useMemo, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, BellPlus, CheckCircle2, ExternalLink, Gauge, LayoutDashboard, Moon, Plug, Radio, RefreshCw, SearchCheck, Siren, Target } from "lucide-react";
import {
  Badge,
  Button,
  Callout,
  EmptyState,
  ScrollArea,
  Text,
  toast,
} from "@glaze/core/components";

import { formatRelativeTime } from "./components/relative-time";
import { providerIcon, providerLabel } from "./components/provider-meta";
import { StatusBadge } from "./components/status-badge";
import { useAccounts } from "./hooks/use-accounts";
import { useChecks } from "./hooks/use-checks";
import { useDashboards } from "./hooks/use-dashboards";
import { useHistoryEvents } from "./hooks/use-history";
import { useLocalIncidents } from "./hooks/use-local-incidents";
import { useMonitorData, useMonitorSettings } from "./hooks/use-monitor-data";
import { useRuleStates, useRules } from "./hooks/use-rules";
import { useSloStatus } from "./hooks/use-slos";
import { monitorApi } from "./ipc";
import type { Account, AlertRule, HistoryEvent, HttpCheck, HttpCheckResult, LocalIncident, MaintenanceWindow, MonitorItem, ObservabilityIncident, RuleState, SloStatus } from "./types";

const ACCOUNT_CREATE_KEY = "accounts.create.v1";
const ACCOUNT_SELECT_KEY = "accounts.select.v1";
const ACCOUNT_VERIFY_KEY = "accounts.verify.v1";
const ALERT_RULE_DRAFT_KEY = "alerts.draft.v1";
const ALERT_RULE_SELECT_KEY = "alerts.select.v1";
const ALERTS_FILTER_KEY = "alerts.filters.v1";
const DASHBOARD_CREATE_KEY = "dashboards.create.v1";
const DASHBOARD_ITEM_SELECT_EVENT = "dashboard:item-select";
const DASHBOARD_ITEM_SELECT_KEY = "dashboard.item.select.v1";
const INCIDENT_CREATE_KEY = "incidents.create.v1";
const INCIDENT_SELECT_KEY = "incidents.select.v1";
const INCIDENTS_DRILLDOWN_KEY = "incidents.drilldown.v1";
const INSIGHTS_FILTER_KEY = "insights.filters.v2";
const TIMELINE_DRILLDOWN_KEY = "timeline.drilldown.v1";
const UPTIME_CREATE_KEY = "uptime.create.v1";
const UPTIME_DRILLDOWN_KEY = "uptime.drilldown.v1";
const DRILLDOWN_PADDING_MS = 60 * 60 * 1000;

interface CommandAction {
  title: string;
  detail: string;
  action: string;
  icon: ReactNode;
  onClick: () => void;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatPercent(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function formatSloTarget(value: number): string {
  return `${value.toFixed(Number.isInteger(value) ? 0 : 2)}%`;
}

function formatBurnRate(value: number | null): string {
  return value === null ? "n/a" : `${value.toFixed(1)}x`;
}

function formatRuleMetric(metric: AlertRule["metric"]): string {
  switch (metric) {
    case "failureRate":
      return "Failure rate";
    case "latency":
      return "Latency";
    case "checkDown":
      return "Uptime down";
    case "openIncidents":
      return "Open incidents";
  }
}

function formatRuleValue(rule: AlertRule, state: RuleState | undefined): string {
  if (!state || state.value === null) return "No data";
  if (rule.metric === "checkDown") return state.value > 0 ? "Down" : "Up";
  if (rule.metric === "failureRate") return `${state.value.toFixed(0)}%`;
  if (rule.metric === "latency") return `${Math.round(state.value)}ms`;
  return formatNumber(Math.round(state.value));
}

function previousDay(day: number): number {
  return day === 0 ? 6 : day - 1;
}

function maintenanceWindowActive(window: MaintenanceWindow, at: Date): boolean {
  if (!window.enabled) return false;
  const day = at.getDay();
  const hour = at.getHours();
  if (window.startHour === window.endHour) return window.days.includes(day);
  if (window.startHour < window.endHour) return window.days.includes(day) && hour >= window.startHour && hour < window.endHour;
  return (window.days.includes(day) && hour >= window.startHour) || (window.days.includes(previousDay(day)) && hour < window.endHour);
}

function formatHour(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

function maintenanceScopeLabel(window: MaintenanceWindow, accountsById: Map<string, Account>, checksById: Map<string, HttpCheck>): string {
  if (!window.scope) return "All notifications";
  if (window.scope.accountId) return accountsById.get(window.scope.accountId)?.label ?? `Account ${window.scope.accountId}`;
  if (window.scope.checkId) return checksById.get(window.scope.checkId)?.name ?? `Check ${window.scope.checkId}`;
  if (window.scope.provider) return providerLabel(window.scope.provider);
  if (window.scope.groupId) return `Group ${window.scope.groupId}`;
  return "All notifications";
}

function openExternal(url: string) {
  void monitorApi.openExternal(url).catch((error) => toast.error(error instanceof Error ? error.message : String(error)));
}

function drilldownDateRange(ts: string) {
  const parsed = new Date(ts).getTime();
  if (!Number.isFinite(parsed)) return undefined;
  return {
    mode: "custom",
    from: new Date(parsed - DRILLDOWN_PADDING_MS).toISOString(),
    to: new Date(parsed + DRILLDOWN_PADDING_MS).toISOString(),
  };
}

function ProviderLabel({ account }: { account: Account }) {
  const Icon = providerIcon(account.provider);
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <Icon className="size-3.5 shrink-0 text-tertiary" />
      <span className="truncate">{providerLabel(account.provider)}</span>
    </span>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  detail,
  tone = "neutral",
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  tone?: "neutral" | "good" | "warn" | "bad";
  onClick?: () => void;
}) {
  const toneClass = tone === "bad" ? "text-red-500" : tone === "warn" ? "text-yellow-500" : tone === "good" ? "text-green-500" : "text-secondary";
  const content = (
    <>
      <div className={`mb-3 flex items-center gap-2 ${toneClass}`}>
        {icon}
        <Text variant="small" color="secondary">{label}</Text>
      </div>
      <div className="text-3xl font-semibold tracking-normal text-primary tabular-nums">{value}</div>
      <Text variant="small" color="tertiary" className="mt-1">{detail}</Text>
    </>
  );
  if (!onClick) {
    return <div className="rounded-lg border border-separator bg-background/60 p-4">{content}</div>;
  }
  return (
    <button className="rounded-lg border border-separator bg-background/60 p-4 text-left transition hover:bg-secondary/40" onClick={onClick}>
      {content}
    </button>
  );
}

function ActionRow({
  title,
  detail,
  action,
  icon,
  onClick,
}: {
  title: string;
  detail: string;
  action: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-t border-separator py-3 text-left first:border-t-0" onClick={onClick}>
      <span className="text-secondary">{icon}</span>
      <span className="min-w-0">
        <Text variant="strong" className="block truncate">{title}</Text>
        <Text variant="small" color="tertiary" className="block truncate">{detail}</Text>
      </span>
      <Badge color="secondary">{action}</Badge>
    </button>
  );
}

function IssueRow({
  item,
  account,
  onSelect,
}: {
  item: MonitorItem;
  account?: Account;
  onSelect: () => void;
}) {
  const Icon = providerIcon(item.provider);
  return (
    <div
      role="button"
      tabIndex={0}
      className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-t border-separator py-3 text-left first:border-t-0"
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <Icon className="size-4 text-tertiary" />
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <Text variant="strong" className="truncate">{item.title}</Text>
          <StatusBadge status={item.status} />
        </div>
        <Text variant="small" color="tertiary" className="truncate">
          {account?.label ?? providerLabel(item.provider)} · {item.subtitle} · {formatRelativeTime(item.updatedAt)}
        </Text>
      </div>
      <Button variant="transparent" size="small" iconOnly aria-label="Open provider item" onClick={(event) => {
        event.stopPropagation();
        openExternal(item.url);
      }}>
        <ExternalLink className="size-4" />
      </Button>
    </div>
  );
}

function IncidentRow({ item, account, onSelect }: { item: ObservabilityIncident | LocalIncident; account?: Account; onSelect: () => void }) {
  const provider = "provider" in item ? item.provider : undefined;
  const Icon = provider ? providerIcon(provider) : Siren;
  const updatedAt = item.updatedAt;
  const url = "url" in item ? item.url : item.sourceUrl;
  return (
    <div
      role="button"
      tabIndex={0}
      className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-t border-separator py-3 text-left first:border-t-0"
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <Icon className="size-4 text-tertiary" />
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <Text variant="strong" className="truncate">{item.title}</Text>
          <Badge color={item.severity === "critical" || item.severity === "high" ? "red" : "yellow"}>{item.severity}</Badge>
        </div>
        <Text variant="small" color="tertiary" className="truncate">
          {account?.label ?? (provider ? providerLabel(provider) : "Local incident")} · {item.status} · {formatRelativeTime(updatedAt)}
        </Text>
      </div>
      {url ? (
        <Button variant="transparent" size="small" iconOnly aria-label="Open incident source" onClick={(event) => {
          event.stopPropagation();
          openExternal(url);
        }}>
          <ExternalLink className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}

function ActivityRow({ event, account, onSelect }: { event: HistoryEvent; account?: Account; onSelect: () => void }) {
  const Icon = providerIcon(event.provider);
  const color = event.type === "failure" || event.type === "incident" ? "red" : event.type === "recovery" ? "green" : event.type === "alert" ? "yellow" : "secondary";
  return (
    <div
      role="button"
      tabIndex={0}
      className="grid grid-cols-[6rem_auto_minmax(0,1fr)_auto] items-center gap-3 border-t border-separator py-2 text-left first:border-t-0"
      onClick={onSelect}
      onKeyDown={(keyboardEvent) => {
        if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
          keyboardEvent.preventDefault();
          onSelect();
        }
      }}
    >
      <Text variant="small" color="tertiary" className="tabular-nums">{formatRelativeTime(event.ts)}</Text>
      <Icon className="size-4 text-tertiary" />
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <Badge color={color}>{event.type}</Badge>
          <Text variant="small" className="truncate">{event.title}</Text>
        </div>
        <Text variant="small" color="tertiary" className="truncate">
          {account?.label ?? providerLabel(event.provider)} · {event.category ?? "activity"}
        </Text>
      </div>
      {event.url ? (
        <Button variant="transparent" size="small" iconOnly aria-label="Open activity source" onClick={(clickEvent) => {
          clickEvent.stopPropagation();
          openExternal(event.url);
        }}>
          <ExternalLink className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}

function DownCheckRow({ check, onSelect }: { check: HttpCheckResult; onSelect: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-t border-separator py-3 text-left first:border-t-0"
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <Radio className="size-4 text-red-500" />
      <div className="min-w-0">
        <Text variant="strong" className="block truncate">{check.name}</Text>
        <Text variant="small" color="tertiary" className="block truncate">
          {check.error ?? `HTTP ${check.statusCode ?? "unknown"}`} · {formatRelativeTime(check.checkedAt)}
        </Text>
      </div>
      <Button variant="transparent" size="small" iconOnly aria-label="Open uptime endpoint" onClick={(event) => {
        event.stopPropagation();
        openExternal(check.url);
      }}>
        <ExternalLink className="size-4" />
      </Button>
    </div>
  );
}

function AlertRuleRow({ rule, state, account, onSelect }: { rule: AlertRule; state?: RuleState; account?: Account; onSelect: () => void }) {
  const scopeLabel = account?.label
    ?? (rule.scope.provider ? providerLabel(rule.scope.provider) : undefined)
    ?? (rule.scope.groupId ? `Group ${rule.scope.groupId}` : undefined)
    ?? (rule.scope.checkId ? `Check ${rule.scope.checkId}` : "All monitored providers");
  return (
    <button className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-t border-separator py-3 text-left first:border-t-0" onClick={onSelect}>
      <BellPlus className="size-4 text-red-500" />
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-2">
          <Text variant="strong" className="truncate">{rule.name}</Text>
          <Badge color="red">Firing</Badge>
        </span>
        <Text variant="small" color="tertiary" className="block truncate">
          {scopeLabel} · {formatRuleMetric(rule.metric)} · current {formatRuleValue(rule, state)} · threshold {formatRuleValue(rule, { ruleId: rule.id, firing: true, value: rule.threshold })}
          {state?.since ? ` · since ${formatRelativeTime(state.since)}` : ""}
        </Text>
      </span>
      <Badge color="secondary">Open</Badge>
    </button>
  );
}

function SloRiskRow({ status, account, onSelect }: { status: SloStatus; account?: Account; onSelect: () => void }) {
  const scopeLabel = account?.label
    ?? (status.slo.scope.provider ? providerLabel(status.slo.scope.provider) : undefined)
    ?? (status.slo.scope.groupId ? `Group ${status.slo.scope.groupId}` : "All monitored providers");
  const attempts = status.successCount + status.failureCount;
  return (
    <button className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-t border-separator py-3 text-left first:border-t-0" onClick={onSelect}>
      <Target className="size-4 text-red-500" />
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-2">
          <Text variant="strong" className="truncate">{status.slo.name}</Text>
          <Badge color="red">At risk</Badge>
        </span>
        <Text variant="small" color="tertiary" className="block truncate">
          {scopeLabel} · target {formatSloTarget(status.slo.target)} · budget {formatPercent(status.remainingBudget)} · burn {formatBurnRate(status.burnRate)} · {formatNumber(attempts)} samples
        </Text>
      </span>
      <Badge color="secondary">Open</Badge>
    </button>
  );
}

function SuppressionStatus({
  mutedUntil,
  activeWindows,
  accountsById,
  checksById,
  loading,
  onOpenSettings,
}: {
  mutedUntil?: string;
  activeWindows: MaintenanceWindow[];
  accountsById: Map<string, Account>;
  checksById: Map<string, HttpCheck>;
  loading: boolean;
  onOpenSettings: () => void;
}) {
  const mutedActive = mutedUntil ? new Date(mutedUntil).getTime() > Date.now() : false;
  const suppressed = mutedActive || activeWindows.length > 0;
  return (
    <section className="rounded-lg border border-separator bg-background/60 p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <Text variant="strong">Notification suppression</Text>
        <Badge color={suppressed ? "yellow" : "secondary"}>{loading ? "Loading" : suppressed ? "Active" : "Clear"}</Badge>
      </div>
      {loading ? (
        <Text variant="small" color="tertiary">Loading suppression state…</Text>
      ) : !suppressed ? (
        <Text variant="small" color="tertiary">Notifications and alert delivery are not currently suppressed.</Text>
      ) : (
        <div className="space-y-2">
          {mutedActive ? (
            <div className="flex items-start gap-2 rounded-md border border-separator bg-control-subtle p-2">
              <Moon className="mt-0.5 size-4 shrink-0 text-yellow-500" />
              <span className="min-w-0">
                <Text variant="small" className="block">Global snooze is active</Text>
                <Text variant="small" color="tertiary" className="block truncate">Until {new Date(mutedUntil as string).toLocaleString()}</Text>
              </span>
            </div>
          ) : null}
          {activeWindows.map((window) => (
            <div key={window.id} className="flex items-start gap-2 rounded-md border border-separator bg-control-subtle p-2">
              <Moon className="mt-0.5 size-4 shrink-0 text-yellow-500" />
              <span className="min-w-0">
                <Text variant="small" className="block truncate">{window.label}</Text>
                <Text variant="small" color="tertiary" className="block truncate">
                  {maintenanceScopeLabel(window, accountsById, checksById)} · {formatHour(window.startHour)}-{formatHour(window.endHour)}
                </Text>
              </span>
            </div>
          ))}
        </div>
      )}
      <Button variant="transparent" size="small" className="mt-3" onClick={onOpenSettings}>
        Open settings
      </Button>
    </section>
  );
}

export function CommandCenterView() {
  const navigate = useNavigate();
  const snapshotQuery = useMonitorData();
  const settingsQuery = useMonitorSettings();
  const accountsQuery = useAccounts();
  const checksQuery = useChecks();
  const dashboardsQuery = useDashboards();
  const localIncidentsQuery = useLocalIncidents();
  const rulesQuery = useRules();
  const ruleStatesQuery = useRuleStates();
  const sloStatusQuery = useSloStatus();
  const historyEventsQuery = useHistoryEvents({ range: "24h", types: ["deploy", "failure", "recovery", "alert", "incident"] });

  const snapshot = snapshotQuery.data;
  const accounts = accountsQuery.data ?? [];
  const accountsById = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts]);
  const checks = checksQuery.data ?? [];
  const checksById = useMemo(() => new Map(checks.map((check) => [check.id, check])), [checks]);
  const settings = settingsQuery.data;
  const activeMaintenanceWindows = (settings?.maintenanceWindows ?? []).filter((window) => maintenanceWindowActive(window, new Date()));
  const enabledAccounts = accounts.filter((account) => account.enabled);
  const allFailedItems = (snapshot?.items ?? []).filter((item) => item.status === "failure");
  const visibleFailedItems = allFailedItems.slice(0, 6);
  const allWarningItems = (snapshot?.items ?? []).filter((item) => item.status === "warning");
  const visibleWarningItems = allWarningItems.slice(0, 4);
  const allDownChecks = (snapshot?.checks ?? []).filter((check) => !check.ok);
  const visibleDownChecks = allDownChecks.slice(0, 5);
  const allActiveIncidents = [
    ...(snapshot?.incidents ?? []).filter((incident) => incident.status !== "resolved"),
    ...(localIncidentsQuery.data ?? []).filter((incident) => incident.status !== "resolved"),
  ];
  const visibleActiveIncidents = allActiveIncidents.slice(0, 6);
  const allStaleAccounts = accounts.filter((account) => snapshot?.staleness[account.id]?.stale);
  const allAccountsWithErrors = accounts.filter((account) => snapshot?.perAccount[account.id]?.lastError);
  const allAttentionAccounts = [
    ...allAccountsWithErrors,
    ...allStaleAccounts.filter((account) => !allAccountsWithErrors.some((candidate) => candidate.id === account.id)),
  ];
  const visibleAttentionAccounts = allAttentionAccounts.slice(0, 6);
  const ruleStates = ruleStatesQuery.data ?? [];
  const ruleStatesById = new Map(ruleStates.map((state) => [state.ruleId, state]));
  const firingRuleIds = new Set(ruleStates.filter((state) => state.firing).map((state) => state.ruleId));
  const allFiringRules = (rulesQuery.data ?? []).filter((rule) => firingRuleIds.has(rule.id));
  const visibleFiringRules = allFiringRules.slice(0, 5);
  const allSloStatuses = sloStatusQuery.data ?? [];
  const allAtRiskSlos = allSloStatuses.filter((status) => status.atRisk);
  const visibleAtRiskSlos = allAtRiskSlos.slice(0, 5);
  const allRecentActivity = historyEventsQuery.data ?? [];
  const visibleRecentActivity = allRecentActivity.slice(0, 8);
  const hasSetup = accounts.length > 0 || checks.length > 0 || (dashboardsQuery.data ?? []).length > 0;
  const issueCount = allFailedItems.length + allWarningItems.length + allDownChecks.length + allActiveIncidents.length + allAccountsWithErrors.length + allFiringRules.length + allAtRiskSlos.length;
  const attentionCount = allAttentionAccounts.length;
  const liveAttentionCount = allFailedItems.length + allWarningItems.length + allDownChecks.length;
  const firstActiveIncident = allActiveIncidents[0];
  const firstDownCheck = allDownChecks[0];
  const firstFiringRule = allFiringRules[0];
  const firstAtRiskSlo = allAtRiskSlos[0];
  const firstAttentionAccount = allAccountsWithErrors[0] ?? allStaleAccounts[0];
  const firstFailedItem = allFailedItems[0] ?? allWarningItems[0];

  const openAccount = (account: Account) => {
    localStorage.setItem(ACCOUNT_SELECT_KEY, JSON.stringify({ accountId: account.id }));
    void navigate({ to: "/accounts" });
  };
  const openDashboardItem = (item: MonitorItem) => {
    const payload = { itemUid: item.uid, action: "logs" };
    localStorage.setItem(DASHBOARD_ITEM_SELECT_KEY, JSON.stringify(payload));
    window.dispatchEvent(new CustomEvent(DASHBOARD_ITEM_SELECT_EVENT, { detail: payload }));
    void navigate({ to: "/dashboard" });
  };
  const openIncident = (incident: ObservabilityIncident | LocalIncident) => {
    if ("id" in incident && !("uid" in incident)) {
      localStorage.setItem(INCIDENT_SELECT_KEY, JSON.stringify({ kind: "local", id: incident.id }));
      void navigate({ to: "/incidents" });
      return;
    }
    const groupId = incident.accountId ? accountsById.get(incident.accountId)?.groupId : undefined;
    localStorage.setItem(INCIDENTS_DRILLDOWN_KEY, JSON.stringify({
      dateRange: drilldownDateRange(incident.updatedAt),
      severity: incident.severity,
      status: "open",
      group: groupId ?? "all",
      provider: incident.provider,
      account: incident.accountId ?? "all",
      kind: "incident",
    }));
    void navigate({ to: "/incidents" });
  };
  const openUptimeCheck = (check: HttpCheckResult) => {
    localStorage.setItem(UPTIME_DRILLDOWN_KEY, JSON.stringify({ search: check.checkId, status: check.ok ? "all" : "down" }));
    void navigate({ to: "/uptime" });
  };
  const openTimelineEvent = (event: HistoryEvent) => {
    localStorage.setItem(TIMELINE_DRILLDOWN_KEY, JSON.stringify({
      dateRange: drilldownDateRange(event.ts),
      group: event.groupId ?? "all",
      provider: event.provider,
      account: event.accountId,
      type: event.type,
      status: event.status,
      severity: event.severity,
      category: event.category ?? "all",
    }));
    void navigate({ to: "/timeline" });
  };
  const openInsightsForSlo = (status?: SloStatus) => {
    if (!status) {
      void navigate({ to: "/insights" });
      return;
    }
    localStorage.setItem(INSIGHTS_FILTER_KEY, JSON.stringify({
      dateRange: { mode: "relative", range: "24h" },
      group: status.slo.scope.groupId ?? "all",
      provider: status.slo.scope.provider ?? "all",
      account: status.slo.scope.accountId ?? "all",
      owner: "all",
      tier: "all",
      dependency: "all",
    }));
    void navigate({ to: "/insights" });
  };
  const openAlertRule = (ruleId: string) => {
    localStorage.setItem(ALERT_RULE_SELECT_KEY, JSON.stringify({ ruleId }));
    void navigate({ to: "/alerts" });
  };
  const openFiringRules = () => {
    if (allFiringRules.length === 1 && firstFiringRule) {
      openAlertRule(firstFiringRule.id);
      return;
    }
    localStorage.setItem(ALERTS_FILTER_KEY, JSON.stringify({ state: "firing" }));
    void navigate({ to: "/alerts" });
  };
  const openFirstIssue = () => {
    if (firstActiveIncident) {
      openIncident(firstActiveIncident);
      return;
    }
    if (firstDownCheck) {
      openUptimeCheck(firstDownCheck);
      return;
    }
    if (firstFiringRule) {
      openFiringRules();
      return;
    }
    if (firstAtRiskSlo) {
      openInsightsForSlo(firstAtRiskSlo);
      return;
    }
    if (firstAttentionAccount) {
      openAccount(firstAttentionAccount);
      return;
    }
    if (firstFailedItem) {
      openDashboardItem(firstFailedItem);
      return;
    }
    void navigate({ to: "/dashboard" });
  };

  const candidateActions: Array<CommandAction | null> = [
    accounts.length === 0
      ? {
          title: "Connect a provider account",
          detail: "Start monitoring CI/CD, incidents, status, and observability data.",
          action: "Add",
          icon: <Plug className="size-4" />,
          onClick: () => {
            localStorage.setItem(ACCOUNT_CREATE_KEY, JSON.stringify({ create: true }));
            void navigate({ to: "/accounts" });
          },
        }
      : null,
    accounts.length > 0
      ? {
          title: allAccountsWithErrors.length > 0 || allStaleAccounts.length > 0 ? "Review account diagnostics" : "Run smoke verification",
          detail: allAccountsWithErrors.length > 0 ? `${allAccountsWithErrors.length} accounts report sync errors.` : "Validate accounts, checks, dashboards, and local stores.",
          action: "Check",
          icon: <SearchCheck className="size-4" />,
          onClick: () => {
            if (firstAttentionAccount) {
              openAccount(firstAttentionAccount);
              return;
            }
            localStorage.setItem(ACCOUNT_VERIFY_KEY, JSON.stringify({ run: true }));
            void navigate({ to: "/accounts" });
          },
        }
      : null,
    allActiveIncidents.length > 0
      ? {
          title: "Triage active incidents",
          detail: `${allActiveIncidents.length} live or local incidents need review.`,
          action: "Triage",
          icon: <Siren className="size-4" />,
          onClick: () => {
            if (firstActiveIncident) openIncident(firstActiveIncident);
          },
        }
      : null,
    allDownChecks.length > 0
      ? {
          title: "Inspect failing uptime checks",
          detail: `${allDownChecks.length} endpoints are currently down or unreachable.`,
          action: "Open",
          icon: <Radio className="size-4" />,
          onClick: () => {
            if (firstDownCheck) openUptimeCheck(firstDownCheck);
          },
        }
      : null,
    allFiringRules.length > 0
      ? {
          title: "Review firing alert rules",
          detail: `${allFiringRules.length} alert rules are currently firing.`,
          action: "Open",
          icon: <BellPlus className="size-4" />,
          onClick: openFiringRules,
        }
      : null,
    allAtRiskSlos.length > 0
      ? {
          title: "Review SLO risk",
          detail: `${allAtRiskSlos.length} SLOs are burning error budget.`,
          action: "Open",
          icon: <Target className="size-4" />,
          onClick: () => openInsightsForSlo(firstAtRiskSlo),
        }
      : null,
    dashboardsQuery.data?.length === 0
      ? {
          title: "Create an operational dashboard",
          detail: "Use local provider data or live query defaults for one-click panels.",
          action: "Create",
          icon: <LayoutDashboard className="size-4" />,
          onClick: () => {
            localStorage.setItem(DASHBOARD_CREATE_KEY, JSON.stringify({ create: true }));
            void navigate({ to: "/dashboards" });
          },
        }
      : null,
    checks.length === 0
      ? {
          title: "Add an uptime check",
          detail: "Track availability and latency for important endpoints.",
          action: "Add",
          icon: <Radio className="size-4" />,
          onClick: () => {
            localStorage.setItem(UPTIME_CREATE_KEY, JSON.stringify({ create: true }));
            void navigate({ to: "/uptime" });
          },
        }
      : null,
  ];
  const actions = candidateActions.filter((action): action is CommandAction => action !== null).slice(0, 6);

  const refresh = async () => {
    try {
      await monitorApi.refresh();
      toast.success("Refresh started");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const openSettings = () => {
    void monitorApi.openSettings().catch((error) => toast.error(error instanceof Error ? error.message : String(error)));
  };

  const createIncident = () => {
    localStorage.setItem(INCIDENT_CREATE_KEY, JSON.stringify({ manual: true }));
    void navigate({ to: "/incidents" });
  };

  const createAlertRule = () => {
    localStorage.setItem(ALERT_RULE_DRAFT_KEY, JSON.stringify({
      name: "Failure rate spike",
      metric: "failureRate",
      operator: "gt",
      threshold: 20,
      scope: {},
      enabled: true,
      forMinutes: 5,
      cooldownMinutes: 30,
      dedupeMinutes: 30,
    }));
    void navigate({ to: "/alerts" });
  };

  return (
    <ScrollArea
      title="Command Center"
      actions={
        <div className="flex items-center gap-2">
          <Button variant="glass" size="small" onClick={createIncident}>
            <Siren className="size-4" />
            New incident
          </Button>
          <Button variant="glass" size="small" onClick={createAlertRule}>
            <BellPlus className="size-4" />
            New rule
          </Button>
          <Button variant="accent" size="small" onClick={refresh}>
            <RefreshCw className="size-4" />
            Refresh
          </Button>
        </div>
      }
      className="h-full"
    >
      <div className="px-2 pb-8 space-y-6">
        {snapshotQuery.error ? (
          <Callout color="red">{snapshotQuery.error instanceof Error ? snapshotQuery.error.message : String(snapshotQuery.error)}</Callout>
        ) : null}

        {!hasSetup ? (
          <EmptyState
            title="No monitoring setup yet"
            description="Connect a provider account, add an uptime check, or create a dashboard to start building an operations command center."
            actions={<Button variant="accent" onClick={() => {
              localStorage.setItem(ACCOUNT_CREATE_KEY, JSON.stringify({ create: true }));
              void navigate({ to: "/accounts" });
            }}>Add account</Button>}
          />
        ) : null}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            icon={issueCount === 0 ? <CheckCircle2 className="size-4" /> : <AlertTriangle className="size-4" />}
            label="Current issues"
            value={formatNumber(issueCount)}
            detail={issueCount === 0 ? "No active issues in the latest snapshot" : "Failures, warnings, incidents, alerts, SLO risk, down checks, or sync errors"}
            tone={issueCount === 0 ? "good" : "bad"}
            onClick={issueCount === 0 ? () => void navigate({ to: "/dashboard" }) : openFirstIssue}
          />
          <SummaryCard
            icon={<Plug className="size-4" />}
            label="Enabled accounts"
            value={formatNumber(enabledAccounts.length)}
            detail={`${accounts.length} configured provider accounts`}
            tone={allAccountsWithErrors.length > 0 || allStaleAccounts.length > 0 ? "warn" : "neutral"}
            onClick={() => void navigate({ to: "/accounts" })}
          />
          <SummaryCard
            icon={<Siren className="size-4" />}
            label="Active incidents"
            value={formatNumber(allActiveIncidents.length)}
            detail={`${snapshot?.signals.length ?? 0} live signals in the current snapshot`}
            tone={allActiveIncidents.length > 0 ? "bad" : "good"}
            onClick={firstActiveIncident ? () => openIncident(firstActiveIncident) : () => void navigate({ to: "/incidents" })}
          />
          <SummaryCard
            icon={<Target className="size-4" />}
            label="SLO risk"
            value={allSloStatuses.length === 0 ? "0" : `${formatNumber(allAtRiskSlos.length)}/${formatNumber(allSloStatuses.length)}`}
            detail={firstAtRiskSlo ? `${firstAtRiskSlo.slo.name} budget ${formatPercent(firstAtRiskSlo.remainingBudget)}` : allSloStatuses.length === 0 ? "No SLOs configured yet" : "No SLOs currently at risk"}
            tone={allAtRiskSlos.length > 0 ? "bad" : allSloStatuses.length > 0 ? "good" : "neutral"}
            onClick={() => openInsightsForSlo(firstAtRiskSlo)}
          />
          <SummaryCard
            icon={<Gauge className="size-4" />}
            label="Aggregate status"
            value={snapshot?.aggregateStatus ?? "unknown"}
            detail={snapshot?.generatedAt ? `Updated ${formatRelativeTime(snapshot.generatedAt)}` : "Waiting for first snapshot"}
            tone={snapshot?.aggregateStatus === "failure" ? "bad" : snapshot?.aggregateStatus === "warning" ? "warn" : snapshot?.aggregateStatus === "success" ? "good" : "neutral"}
            onClick={() => void navigate({ to: "/dashboard" })}
          />
        </div>

        <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[minmax(22rem,28rem)_1fr]">
          <div className="space-y-6">
            <section className="rounded-lg border border-separator bg-background/60 p-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <Text variant="strong">Suggested next actions</Text>
                <Badge color="secondary">{actions.length}</Badge>
              </div>
              {actions.length === 0 ? (
                <Callout color="green">No immediate setup or triage actions are needed.</Callout>
              ) : (
                actions.map((action) => <ActionRow key={action.title} {...action} />)
              )}
            </section>

            <SuppressionStatus
              mutedUntil={settings?.mutedUntil}
              activeWindows={activeMaintenanceWindows}
              accountsById={accountsById}
              checksById={checksById}
              loading={settingsQuery.isLoading}
              onOpenSettings={openSettings}
            />

            <section className="rounded-lg border border-separator bg-background/60 p-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <Text variant="strong">Account attention</Text>
                <Badge color="secondary">{attentionCount}</Badge>
              </div>
              {attentionCount === 0 ? (
                <Text variant="small" color="tertiary">No sync errors or stale account warnings in the latest snapshot.</Text>
              ) : (
                <>
                  {visibleAttentionAccounts.map((account) => {
                    const status = snapshot?.perAccount[account.id];
                    const stale = snapshot?.staleness[account.id];
                    return (
                      <button key={account.id} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-separator py-3 text-left first:border-t-0" onClick={() => openAccount(account)}>
                        <span className="min-w-0">
                          <Text variant="strong" className="block truncate">{account.label}</Text>
                          <Text variant="small" color="tertiary" className="block truncate">
                            <ProviderLabel account={account} /> · {status?.lastError ?? stale?.reason ?? "stale"}
                          </Text>
                        </span>
                        <Badge color={status?.lastError ? "red" : "yellow"}>{status?.lastError ? "Error" : "Stale"}</Badge>
                      </button>
                    );
                  })}
                  {attentionCount > visibleAttentionAccounts.length ? (
                    <Text variant="small" color="tertiary" className="block border-t border-separator pt-2">
                      Showing {visibleAttentionAccounts.length} of {attentionCount} accounts needing attention.
                    </Text>
                  ) : null}
                </>
              )}
            </section>
          </div>

          <div className="space-y-6">
            <section className="rounded-lg border border-separator bg-background/60 p-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <Text variant="strong">What needs attention</Text>
                <Badge color="secondary">{liveAttentionCount}</Badge>
              </div>
              {liveAttentionCount === 0 ? (
                <EmptyState title="No failing live rows" description="The latest provider snapshot and uptime checks do not contain active failures." />
              ) : (
                <>
                  {visibleFailedItems.map((item) => <IssueRow key={item.uid} item={item} account={accountsById.get(item.accountId)} onSelect={() => openDashboardItem(item)} />)}
                  {visibleWarningItems.map((item) => <IssueRow key={item.uid} item={item} account={accountsById.get(item.accountId)} onSelect={() => openDashboardItem(item)} />)}
                  {visibleDownChecks.map((check) => <DownCheckRow key={check.checkId} check={check} onSelect={() => openUptimeCheck(check)} />)}
                  {liveAttentionCount > visibleFailedItems.length + visibleWarningItems.length + visibleDownChecks.length ? (
                    <Text variant="small" color="tertiary" className="block border-t border-separator pt-2">
                      Showing {visibleFailedItems.length + visibleWarningItems.length + visibleDownChecks.length} of {liveAttentionCount} live rows needing attention.
                    </Text>
                  ) : null}
                </>
              )}
            </section>

            <section className="rounded-lg border border-separator bg-background/60 p-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <Text variant="strong">Firing alert rules</Text>
                <Badge color="secondary">{allFiringRules.length}</Badge>
              </div>
              {ruleStatesQuery.isLoading || rulesQuery.isLoading ? (
                <Text variant="small" color="tertiary">Loading alert-rule state…</Text>
              ) : allFiringRules.length === 0 ? (
                <Text variant="small" color="tertiary">No alert rules are currently firing.</Text>
              ) : (
                <>
                  {visibleFiringRules.map((rule) => (
                    <AlertRuleRow
                      key={rule.id}
                      rule={rule}
                      state={ruleStatesById.get(rule.id)}
                      account={rule.scope.accountId ? accountsById.get(rule.scope.accountId) : undefined}
                      onSelect={() => openAlertRule(rule.id)}
                    />
                  ))}
                  {allFiringRules.length > visibleFiringRules.length ? (
                    <Text variant="small" color="tertiary" className="block border-t border-separator pt-2">
                      Showing {visibleFiringRules.length} of {allFiringRules.length} firing alert rules.
                    </Text>
                  ) : null}
                </>
              )}
            </section>

            <section className="rounded-lg border border-separator bg-background/60 p-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <Text variant="strong">SLOs at risk</Text>
                <Badge color="secondary">{allAtRiskSlos.length}</Badge>
              </div>
              {sloStatusQuery.isLoading ? (
                <Text variant="small" color="tertiary">Loading SLO status…</Text>
              ) : allAtRiskSlos.length === 0 ? (
                <Text variant="small" color="tertiary">{allSloStatuses.length === 0 ? "No SLOs configured yet." : "No SLOs are currently burning through error budget."}</Text>
              ) : (
                <>
                  {visibleAtRiskSlos.map((status) => (
                    <SloRiskRow
                      key={status.slo.id}
                      status={status}
                      account={status.slo.scope.accountId ? accountsById.get(status.slo.scope.accountId) : undefined}
                      onSelect={() => openInsightsForSlo(status)}
                    />
                  ))}
                  {allAtRiskSlos.length > visibleAtRiskSlos.length ? (
                    <Text variant="small" color="tertiary" className="block border-t border-separator pt-2">
                      Showing {visibleAtRiskSlos.length} of {allAtRiskSlos.length} at-risk SLOs.
                    </Text>
                  ) : null}
                </>
              )}
            </section>

            <section className="rounded-lg border border-separator bg-background/60 p-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <Text variant="strong">Active incident queue</Text>
                <Badge color="secondary">{allActiveIncidents.length}</Badge>
              </div>
              {allActiveIncidents.length === 0 ? (
                <Text variant="small" color="tertiary">No open live or local incidents.</Text>
              ) : (
                <>
                  {visibleActiveIncidents.map((incident) => (
                    <IncidentRow
                      key={"uid" in incident ? incident.uid : incident.id}
                      item={incident}
                      account={accountsById.get(incident.accountId ?? "")}
                      onSelect={() => openIncident(incident)}
                    />
                  ))}
                  {allActiveIncidents.length > visibleActiveIncidents.length ? (
                    <Text variant="small" color="tertiary" className="block border-t border-separator pt-2">
                      Showing {visibleActiveIncidents.length} of {allActiveIncidents.length} active incidents.
                    </Text>
                  ) : null}
                </>
              )}
            </section>

            <section className="rounded-lg border border-separator bg-background/60 p-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <Text variant="strong">Retained activity, 24h</Text>
                <Badge color="secondary">{allRecentActivity.length}</Badge>
              </div>
              {historyEventsQuery.isLoading ? (
                <Text variant="small" color="tertiary">Loading retained activity…</Text>
              ) : allRecentActivity.length === 0 ? (
                <Text variant="small" color="tertiary">No retained deploy, failure, recovery, alert, or incident events in the last 24 hours.</Text>
              ) : (
                <>
                  {visibleRecentActivity.map((event) => (
                    <ActivityRow
                      key={event.id}
                      event={event}
                      account={accountsById.get(event.accountId)}
                      onSelect={() => openTimelineEvent(event)}
                    />
                  ))}
                  {allRecentActivity.length > visibleRecentActivity.length ? (
                    <Text variant="small" color="tertiary" className="block border-t border-separator pt-2">
                      Showing {visibleRecentActivity.length} of {allRecentActivity.length} retained events.
                    </Text>
                  ) : null}
                </>
              )}
            </section>
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}
