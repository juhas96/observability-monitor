import { useNavigate } from "@tanstack/react-router";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@glaze/core/components";
import { BookOpen, GitBranch, LayoutDashboard } from "lucide-react";

import { providerIcon, providerLabel } from "./provider-meta";
import { useAccounts } from "../hooks/use-accounts";
import { useChecks } from "../hooks/use-checks";
import { useDashboards } from "../hooks/use-dashboards";
import { useLocalIncidents } from "../hooks/use-local-incidents";
import { useMonitorData } from "../hooks/use-monitor-data";
import { useRules } from "../hooks/use-rules";
import { useServiceMetadata } from "../hooks/use-service-metadata";
import { monitorApi } from "../ipc";

const NAV_ITEMS: { path: string; label: string; shortcut: string }[] = [
  { path: "/", label: "Command Center", shortcut: "⌘1" },
  { path: "/dashboard", label: "Dashboard", shortcut: "⌘2" },
  { path: "/apps", label: "Apps", shortcut: "⌘3" },
  { path: "/insights", label: "Insights", shortcut: "⌘4" },
  { path: "/incidents", label: "Incidents", shortcut: "⌘5" },
  { path: "/timeline", label: "Timeline", shortcut: "⌘6" },
  { path: "/uptime", label: "Uptime", shortcut: "⌘7" },
  { path: "/alerts", label: "Alert rules", shortcut: "⌘8" },
  { path: "/dashboards", label: "Dashboards", shortcut: "⌘9" },
  { path: "/accounts", label: "Accounts", shortcut: "⌘0" },
];

const MAX_ITEMS = 25;
const ACCOUNT_CREATE_KEY = "accounts.create.v1";
const ACCOUNT_SELECT_KEY = "accounts.select.v1";
const ACCOUNT_VERIFY_KEY = "accounts.verify.v1";
const ALERT_RULE_DRAFT_KEY = "alerts.draft.v1";
const ALERT_RULE_SELECT_KEY = "alerts.select.v1";
const APP_SELECT_KEY = "apps.select.v1";
const DASHBOARD_ITEM_SELECT_EVENT = "dashboard:item-select";
const DASHBOARD_ITEM_SELECT_KEY = "dashboard.item.select.v1";
const DASHBOARD_CREATE_KEY = "dashboards.create.v1";
const DASHBOARD_SELECT_KEY = "dashboards.select.v1";
const INCIDENT_CREATE_KEY = "incidents.create.v1";
const INCIDENT_SELECT_KEY = "incidents.select.v1";
const UPTIME_CREATE_KEY = "uptime.create.v1";
const UPTIME_DRILLDOWN_KEY = "uptime.drilldown.v1";

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const snapshotQuery = useMonitorData();
  const accountsQuery = useAccounts();
  const checksQuery = useChecks();
  const dashboardsQuery = useDashboards();
  const localIncidentsQuery = useLocalIncidents();
  const rulesQuery = useRules();
  const serviceMetadataQuery = useServiceMetadata();

  const run = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };
  const go = (path: string) => run(() => void navigate({ to: path }));
  const openUrl = (url: string) =>
    run(() => void monitorApi.openExternal(url).catch(() => undefined));
  const refreshAll = () => run(() => void monitorApi.refresh().catch(() => undefined));
  const openSettings = () => run(() => void monitorApi.openSettings().catch(() => undefined));
  const runVerification = () =>
    run(() => {
      localStorage.setItem(ACCOUNT_VERIFY_KEY, JSON.stringify({ run: true }));
      void navigate({ to: "/accounts" });
    });
  const openAccount = (accountId: string) =>
    run(() => {
      localStorage.setItem(ACCOUNT_SELECT_KEY, JSON.stringify({ accountId }));
      void navigate({ to: "/accounts" });
    });
  const createAccount = () =>
    run(() => {
      localStorage.setItem(ACCOUNT_CREATE_KEY, JSON.stringify({ create: true }));
      void navigate({ to: "/accounts" });
    });
  const openRule = (ruleId: string) =>
    run(() => {
      localStorage.setItem(ALERT_RULE_SELECT_KEY, JSON.stringify({ ruleId }));
      void navigate({ to: "/alerts" });
    });
  const createRule = () =>
    run(() => {
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
    });
  const openService = (serviceId: string) =>
    run(() => {
      localStorage.setItem(APP_SELECT_KEY, JSON.stringify({ serviceId }));
      void navigate({ to: "/apps" });
    });
  const openDashboard = (dashboardId: string) =>
    run(() => {
      localStorage.setItem(DASHBOARD_SELECT_KEY, JSON.stringify({ dashboardId }));
      void navigate({ to: "/dashboards" });
    });
  const createDashboard = () =>
    run(() => {
      localStorage.setItem(DASHBOARD_CREATE_KEY, JSON.stringify({ create: true }));
      void navigate({ to: "/dashboards" });
    });
  const openLocalIncident = (incidentId: string) =>
    run(() => {
      localStorage.setItem(INCIDENT_SELECT_KEY, JSON.stringify({ kind: "local", id: incidentId }));
      void navigate({ to: "/incidents" });
    });
  const createIncident = () =>
    run(() => {
      localStorage.setItem(INCIDENT_CREATE_KEY, JSON.stringify({ manual: true }));
      void navigate({ to: "/incidents" });
    });
  const openCheck = (checkId: string) =>
    run(() => {
      localStorage.setItem(UPTIME_DRILLDOWN_KEY, JSON.stringify({ search: checkId }));
      void navigate({ to: "/uptime" });
    });
  const createCheck = () =>
    run(() => {
      localStorage.setItem(UPTIME_CREATE_KEY, JSON.stringify({ create: true }));
      void navigate({ to: "/uptime" });
    });
  const openDashboardItemLogs = (itemUid: string) =>
    run(() => {
      const payload = { itemUid, action: "logs" };
      localStorage.setItem(DASHBOARD_ITEM_SELECT_KEY, JSON.stringify(payload));
      window.dispatchEvent(new CustomEvent(DASHBOARD_ITEM_SELECT_EVENT, { detail: payload }));
      void navigate({ to: "/dashboard" });
    });

  const snapshot = snapshotQuery.data;
  const items = (snapshot?.items ?? []).slice(0, MAX_ITEMS);
  const incidents = (snapshot?.incidents ?? []).filter((i) => i.status !== "resolved").slice(0, MAX_ITEMS);
  const providerLinks = (snapshot?.deepLinks ?? []).slice(0, MAX_ITEMS);
  const services = (snapshot?.services ?? []).slice(0, MAX_ITEMS);
  const accounts = accountsQuery.data ?? [];
  const checks = checksQuery.data ?? [];
  const dashboards = dashboardsQuery.data ?? [];
  const localIncidents = (localIncidentsQuery.data ?? []).slice(0, MAX_ITEMS);
  const rules = rulesQuery.data ?? [];
  const servicesById = new Map((snapshot?.services ?? []).map((service) => [service.id, service]));
  const serviceLinks = (serviceMetadataQuery.data ?? []).flatMap((metadata) => {
    const service = servicesById.get(metadata.serviceId);
    const serviceName = service?.name ?? metadata.serviceId;
    return [
      metadata.runbookUrl ? { id: `${metadata.serviceId}:runbook`, label: `${serviceName} runbook`, url: metadata.runbookUrl, icon: BookOpen, value: `service runbook ${serviceName} ${metadata.owner ?? ""}` } : null,
      metadata.dashboardUrl ? { id: `${metadata.serviceId}:dashboard`, label: `${serviceName} dashboard`, url: metadata.dashboardUrl, icon: LayoutDashboard, value: `service dashboard ${serviceName} ${metadata.owner ?? ""}` } : null,
      metadata.repositoryUrl ? { id: `${metadata.serviceId}:repository`, label: `${serviceName} repository`, url: metadata.repositoryUrl, icon: GitBranch, value: `service repository repo ${serviceName} ${metadata.owner ?? ""}` } : null,
    ];
  }).filter((link): link is { id: string; label: string; url: string; icon: typeof BookOpen; value: string } => link !== null).slice(0, MAX_ITEMS);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search" description="Jump to anything">
      <CommandInput placeholder="Search views, accounts, items, checks, rules…" showIcon />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Actions">
          <CommandItem value="action refresh reload poll sync" onSelect={refreshAll}>
            Refresh all accounts
            <CommandShortcut>Refresh</CommandShortcut>
          </CommandItem>
          <CommandItem value="action verify smoke test diagnostics accounts checks dashboards health" onSelect={runVerification}>
            Run smoke verification
            <CommandShortcut>Check</CommandShortcut>
          </CommandItem>
          <CommandItem value="action add connect account provider token setup" onSelect={createAccount}>
            Add provider account
            <CommandShortcut>New</CommandShortcut>
          </CommandItem>
          <CommandItem value="action create dashboard template new panel" onSelect={createDashboard}>
            Create dashboard
            <CommandShortcut>New</CommandShortcut>
          </CommandItem>
          <CommandItem value="action add uptime check synthetic monitor endpoint" onSelect={createCheck}>
            Add uptime check
            <CommandShortcut>New</CommandShortcut>
          </CommandItem>
          <CommandItem value="action create incident new investigation manual local" onSelect={createIncident}>
            Create local incident
            <CommandShortcut>New</CommandShortcut>
          </CommandItem>
          <CommandItem value="action create alert rule new notification threshold" onSelect={createRule}>
            Create alert rule
            <CommandShortcut>New</CommandShortcut>
          </CommandItem>
          <CommandItem value="action settings preferences notifications" onSelect={openSettings}>
            Open settings
            <CommandShortcut>⌘,</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading="Go to">
          {NAV_ITEMS.map((nav) => (
            <CommandItem key={nav.path} value={`go ${nav.label}`} onSelect={() => go(nav.path)}>
              {nav.label}
              <CommandShortcut>{nav.shortcut}</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>

        {accounts.length > 0 ? (
          <CommandGroup heading="Accounts">
            {accounts.map((account) => {
              const Icon = providerIcon(account.provider);
              return (
                <CommandItem
                  key={account.id}
                  value={`account ${account.label} ${account.identity ?? ""} ${providerLabel(account.provider)}`}
                  onSelect={() => openAccount(account.id)}
                >
                  <Icon className="size-4" />
                  {account.label}
                  <CommandShortcut>Edit</CommandShortcut>
                </CommandItem>
              );
            })}
          </CommandGroup>
        ) : null}

        {services.length > 0 ? (
          <CommandGroup heading="Apps">
            {services.map((service) => (
              <CommandItem
                key={service.id}
                value={`service app ${service.name} ${service.providerIds.map(providerLabel).join(" ")} ${service.status}`}
                onSelect={() => openService(service.id)}
              >
                {service.name}
                <CommandShortcut>Open</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {dashboards.length > 0 ? (
          <CommandGroup heading="Dashboards">
            {dashboards.map((dashboard) => (
              <CommandItem
                key={dashboard.id}
                value={`dashboard ${dashboard.name} ${dashboard.description ?? ""}`}
                onSelect={() => openDashboard(dashboard.id)}
              >
                {dashboard.name}
                <CommandShortcut>Open</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {checks.length > 0 ? (
          <CommandGroup heading="Uptime checks">
            {checks.map((check) => (
              <CommandItem key={check.id} value={`check ${check.name} ${check.url}`} onSelect={() => openCheck(check.id)}>
                {check.name}
                <CommandShortcut>Filter</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {rules.length > 0 ? (
          <CommandGroup heading="Alert rules">
            {rules.map((rule) => (
              <CommandItem key={rule.id} value={`rule ${rule.name}`} onSelect={() => openRule(rule.id)}>
                {rule.name}
                <CommandShortcut>Edit</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {incidents.length > 0 ? (
          <CommandGroup heading="Incidents">
            {incidents.map((incident) => {
              const Icon = providerIcon(incident.provider);
              return (
                <CommandItem
                  key={incident.uid}
                  value={`incident ${incident.title} ${incident.subtitle}`}
                  onSelect={() => openUrl(incident.url)}
                >
                  <Icon className="size-4" />
                  {incident.title}
                </CommandItem>
              );
            })}
          </CommandGroup>
        ) : null}

        {localIncidents.length > 0 ? (
          <CommandGroup heading="Local incidents">
            {localIncidents.map((incident) => {
              const Icon = incident.provider ? providerIcon(incident.provider) : undefined;
              return (
                <CommandItem
                  key={incident.id}
                  value={`local incident ${incident.title} ${incident.description ?? ""} ${incident.assignee ?? ""}`}
                  onSelect={() => openLocalIncident(incident.id)}
                >
                  {Icon ? <Icon className="size-4" /> : null}
                  {incident.title}
                  <CommandShortcut>Open</CommandShortcut>
                </CommandItem>
              );
            })}
          </CommandGroup>
        ) : null}

        {providerLinks.length > 0 ? (
          <CommandGroup heading="Provider links">
            {providerLinks.map((link) => {
              const Icon = providerIcon(link.provider);
              return (
                <CommandItem
                  key={`${link.accountId}:${link.category}:${link.url}`}
                  value={`provider link ${link.label} ${providerLabel(link.provider)} ${link.category}`}
                  onSelect={() => openUrl(link.url)}
                >
                  <Icon className="size-4" />
                  {link.label}
                </CommandItem>
              );
            })}
          </CommandGroup>
        ) : null}

        {serviceLinks.length > 0 ? (
          <CommandGroup heading="Service links">
            {serviceLinks.map((link) => {
              const Icon = link.icon;
              return (
                <CommandItem key={link.id} value={link.value} onSelect={() => openUrl(link.url)}>
                  <Icon className="size-4" />
                  {link.label}
                </CommandItem>
              );
            })}
          </CommandGroup>
        ) : null}

        {items.length > 0 ? (
          <CommandGroup heading="Recent items">
            {items.map((item) => {
              const Icon = providerIcon(item.provider);
              const hasLogsAction = item.logAvailable || item.logFallbackUrl;
              return (
                <CommandItem
                  key={item.uid}
                  value={`item ${item.title} ${item.subtitle}`}
                  onSelect={() => hasLogsAction ? openDashboardItemLogs(item.uid) : openUrl(item.url)}
                >
                  <Icon className="size-4" />
                  {item.title}
                  <CommandShortcut>{hasLogsAction ? "Logs" : "Open"}</CommandShortcut>
                </CommandItem>
              );
            })}
          </CommandGroup>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}
