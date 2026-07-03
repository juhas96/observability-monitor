import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ExternalLink, RadioTower, RefreshCw, Siren, TimerReset } from "lucide-react";
import {
  Badge,
  Button,
  Callout,
  EmptyState,
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
import { useAccounts, useGroups } from "./hooks/use-accounts";
import { useMonitorData } from "./hooks/use-monitor-data";
import { monitorApi } from "./ipc";
import type {
  Account,
  MetricsSummary,
  MonitorItem,
  ObservabilityIncident,
  ObservabilitySignal,
  ProjectGroup,
  ServiceHealth,
} from "./types";

const ALL_APPS = "all";

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

function ServiceTile({
  service,
  groupsById,
  selected,
  onSelect,
}: {
  service: ServiceHealth;
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
  const Icon = providerIcon(incident.provider);
  return (
    <div className="flex items-center gap-3 py-2 border-t border-separator first:border-t-0">
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
      <Button variant="transparent" size="small" iconOnly aria-label="Open incident" onClick={() => openUrl(incident.url)}>
        <ExternalLink className="size-4" />
      </Button>
    </div>
  );
}

function SignalRow({ signal, accountsById }: { signal: ObservabilitySignal; accountsById: Map<string, Account> }) {
  const Icon = providerIcon(signal.provider);
  return (
    <div className="flex items-center gap-3 py-2 border-t border-separator first:border-t-0">
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
    </div>
  );
}

function MetricsRow({ summary, accountsById }: { summary: MetricsSummary; accountsById: Map<string, Account> }) {
  const Icon = providerIcon(summary.provider);
  return (
    <div className="flex items-center gap-3 py-2 border-t border-separator first:border-t-0">
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
    </div>
  );
}

function TimelineRow({ item, accountsById }: { item: MonitorItem; accountsById: Map<string, Account> }) {
  const Icon = providerIcon(item.provider);
  return (
    <div className="grid grid-cols-[7rem_1fr_7rem] gap-3 py-2 border-t border-separator first:border-t-0">
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
      <div className="flex justify-end">
        <StatusBadge status={item.status} />
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

export function AppsView() {
  const snapshotQuery = useMonitorData();
  const accountsQuery = useAccounts();
  const groupsQuery = useGroups();
  const [selectedServiceId, setSelectedServiceId] = useState(ALL_APPS);
  const [refreshing, setRefreshing] = useState(false);

  const snapshot = snapshotQuery.data;
  const accounts = accountsQuery.data ?? [];
  const groups = groupsQuery.data ?? [];
  const accountsById = useMemo(() => accountMap(accounts), [accounts]);
  const groupsById = useMemo(() => groupMap(groups), [groups]);
  const services = snapshot?.services ?? [];

  const selectedAccountIds = useMemo(() => {
    if (selectedServiceId === ALL_APPS) return new Set(accounts.map((account) => account.id));
    return new Set(services.find((service) => service.id === selectedServiceId)?.accountIds ?? []);
  }, [accounts, selectedServiceId, services]);

  const selectedService = services.find((service) => service.id === selectedServiceId);
  const incidents = (snapshot?.incidents ?? []).filter((incident) => selectedAccountIds.has(incident.accountId) && incident.status !== "resolved");
  const signals = (snapshot?.signals ?? []).filter((signal) => selectedAccountIds.has(signal.accountId));
  const metrics = (snapshot?.metrics ?? []).filter((summary) => selectedAccountIds.has(summary.accountId));
  const timeline = (snapshot?.items ?? []).filter((item) => selectedAccountIds.has(item.accountId)).slice(0, 24);
  const staleAccounts = accounts.filter((account) => selectedAccountIds.has(account.id) && snapshot?.staleness[account.id]?.stale);

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

  const actions = (
    <div className="flex items-center gap-2">
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
        ) : services.length === 0 ? (
          <Callout color="secondary">Waiting for the next polling cycle to build app health.</Callout>
        ) : (
          <>
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
              {services.map((service) => (
                <ServiceTile
                  key={service.id}
                  service={service}
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
    </ScrollArea>
  );
}
