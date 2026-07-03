import { useMemo, useState } from "react";
import { CheckCircle2, Clock3, ExternalLink, VolumeX } from "lucide-react";
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

import { formatRelativeTime } from "./components/relative-time";
import { StatusBadge } from "./components/status-badge";
import { providerIcon, providerLabel } from "./components/provider-meta";
import { useAccounts, useGroups } from "./hooks/use-accounts";
import { useHistoryEvents } from "./hooks/use-history";
import { useMonitorData } from "./hooks/use-monitor-data";
import { useProviders } from "./hooks/use-providers";
import { useTriage, useTriageMutations } from "./hooks/use-triage";
import { monitorApi } from "./ipc";
import type {
  Account,
  HistoryEvent,
  ObservabilityIncident,
  ObservabilitySeverity,
  ObservabilitySignal,
  NormalizedStatus,
  ProjectGroup,
  Provider,
  TriageState,
} from "./types";

const ALL = "all";
type SeverityFilter = "all" | ObservabilitySeverity;
type StatusFilter = "all" | "open" | "acknowledged" | "silenced";

interface TriageItem {
  uid: string;
  sourceUid?: string;
  accountId: string;
  provider: Provider;
  title: string;
  subtitle: string;
  status: string;
  severity: ObservabilitySeverity;
  updatedAt: string;
  url: string;
  kind: "signal" | "incident";
}

function accountMap(accounts: Account[]): Map<string, Account> {
  return new Map(accounts.map((account) => [account.id, account]));
}

function groupMap(groups: ProjectGroup[]): Map<string, ProjectGroup> {
  return new Map(groups.map((group) => [group.id, group]));
}

function toItems(signals: ObservabilitySignal[], incidents: ObservabilityIncident[]): TriageItem[] {
  return [
    ...incidents.map((incident): TriageItem => ({
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
    })),
    ...signals.map((signal): TriageItem => ({
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
    })),
  ].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

function isSilenced(state: TriageState | undefined): boolean {
  return state?.silencedUntil ? new Date(state.silencedUntil).getTime() > Date.now() : false;
}

function isNormalizedStatus(status: string): status is NormalizedStatus {
  return ["success", "failure", "warning", "running", "queued", "cancelled", "info", "unknown"].includes(status);
}

function matchesStatus(item: TriageItem, state: TriageState | undefined, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "acknowledged") return Boolean(state?.acknowledgedAt);
  if (filter === "silenced") return isSilenced(state);
  return item.status === "open" || item.status === "failure" || item.status === "warning";
}

function eventIcon(event: HistoryEvent): string {
  switch (event.type) {
    case "deploy":
      return "Deploy";
    case "failure":
      return "Failure";
    case "recovery":
      return "Recovery";
    case "alert":
      return "Alert";
    case "incident":
      return "Incident";
    case "check":
      return "Check";
  }
}

function openUrl(url: string): void {
  void monitorApi.openExternal(url).catch((error) => toast.error(error instanceof Error ? error.message : String(error)));
}

function TriageRow({
  item,
  state,
  selected,
  account,
  onSelect,
}: {
  item: TriageItem;
  state: TriageState | undefined;
  selected: boolean;
  account: Account | undefined;
  onSelect: () => void;
}) {
  const Icon = providerIcon(item.provider);
  const silenced = isSilenced(state);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`text-left rounded-lg border p-3 flex flex-col gap-2 ${
        selected ? "border-accent bg-control-subtle" : "border-separator hover:bg-control-subtle"
      }`}
    >
      <div className="flex items-start gap-2">
        <Icon className="size-4 text-tertiary mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <Text variant="strong" truncate>{item.title}</Text>
          <Text variant="small" color="secondary" truncate>{account?.label ?? "Unknown account"} · {item.subtitle}</Text>
        </div>
        <Badge color={item.severity === "critical" || item.severity === "high" ? "red" : "yellow"}>{item.severity}</Badge>
      </div>
      <div className="flex items-center gap-2">
        {item.kind === "signal" && isNormalizedStatus(item.status) ? (
          <StatusBadge status={item.status} />
        ) : (
          <Badge color="secondary">{item.status}</Badge>
        )}
        {state?.acknowledgedAt ? <Badge color="secondary">Acknowledged</Badge> : null}
        {silenced ? <Badge color="secondary">Silenced</Badge> : null}
        <Text variant="small" color="tertiary" className="ml-auto tabular-nums">{formatRelativeTime(item.updatedAt)}</Text>
      </div>
    </button>
  );
}

function DetailPanel({
  item,
  state,
  events,
  account,
}: {
  item: TriageItem | undefined;
  state: TriageState | undefined;
  events: HistoryEvent[];
  account: Account | undefined;
}) {
  const triage = useTriageMutations();
  if (!item) {
    return (
      <div className="rounded-lg border border-separator p-4">
        <Text variant="strong">No item selected</Text>
        <Text variant="small" color="secondary">Select an alert or incident to inspect its timeline.</Text>
      </div>
    );
  }
  const scopedEvents = events.filter((event) =>
    event.accountId === item.accountId && (!item.sourceUid || event.sourceUid === item.sourceUid || event.sourceUid === item.uid)
  );

  return (
    <div className="rounded-lg border border-separator p-3 flex flex-col gap-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Text variant="title" truncate>{item.title}</Text>
          <Text variant="small" color="secondary">{account?.label ?? "Unknown account"} · {providerLabel(item.provider)}</Text>
        </div>
        <Button variant="glass" size="small" onClick={() => openUrl(item.url)}>
          <ExternalLink className="size-4" />
          Open
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="filled"
          size="small"
          onClick={() => void triage.acknowledge.mutateAsync(item.uid).catch((error) => toast.error(String(error)))}
          disabled={Boolean(state?.acknowledgedAt)}
        >
          <CheckCircle2 className="size-4" />
          Acknowledge
        </Button>
        <Button
          variant="glass"
          size="small"
          onClick={() => void triage.silence.mutateAsync({ uid: item.uid, minutes: 60 }).catch((error) => toast.error(String(error)))}
        >
          <VolumeX className="size-4" />
          Silence 1h
        </Button>
        <Button
          variant="transparent"
          size="small"
          onClick={() => void triage.clear.mutateAsync(item.uid).catch((error) => toast.error(String(error)))}
        >
          Clear
        </Button>
      </div>
      <div className="flex flex-col gap-1">
        <Text variant="strong">Timeline</Text>
        {scopedEvents.length === 0 ? (
          <Callout color="secondary">No persisted events match this item yet.</Callout>
        ) : (
          <div className="flex flex-col">
            {scopedEvents.slice(0, 20).map((event) => (
              <div key={event.id} className="grid grid-cols-[6rem_5rem_1fr] gap-3 py-2 border-t border-separator first:border-t-0">
                <Text variant="small" color="tertiary" className="tabular-nums">{formatRelativeTime(event.ts)}</Text>
                <Badge color={event.type === "failure" || event.type === "incident" ? "red" : "secondary"}>{eventIcon(event)}</Badge>
                <Text variant="small" truncate>{event.title}</Text>
              </div>
            ))}
          </div>
        )}
      </div>
      {state?.silencedUntil ? (
        <Callout color="secondary" icon={<Clock3 />}>Silenced until {new Date(state.silencedUntil).toLocaleString()}.</Callout>
      ) : null}
    </div>
  );
}

export function IncidentsView() {
  const snapshotQuery = useMonitorData();
  const accountsQuery = useAccounts();
  const groupsQuery = useGroups();
  const providersQuery = useProviders();
  const triageQuery = useTriage();
  const historyQuery = useHistoryEvents({ range: "24h", types: ["deploy", "failure", "recovery", "alert", "incident"] });
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [groupFilter, setGroupFilter] = useState(ALL);
  const [providerFilter, setProviderFilter] = useState(ALL);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);

  const accounts = accountsQuery.data ?? [];
  const groups = groupsQuery.data ?? [];
  const accountsById = useMemo(() => accountMap(accounts), [accounts]);
  const groupsById = useMemo(() => groupMap(groups), [groups]);
  const triage = triageQuery.data ?? {};
  const items = toItems(snapshotQuery.data?.signals ?? [], snapshotQuery.data?.incidents ?? []);
  const visible = items.filter((item) => {
    const account = accountsById.get(item.accountId);
    const groupId = account?.groupId && groupsById.has(account.groupId) ? account.groupId : undefined;
    if (severityFilter !== "all" && item.severity !== severityFilter) return false;
    if (providerFilter !== ALL && item.provider !== providerFilter) return false;
    if (groupFilter !== ALL && groupId !== groupFilter) return false;
    return matchesStatus(item, triage[item.uid], statusFilter);
  });
  const selected = visible.find((item) => item.uid === selectedUid) ?? visible[0];

  return (
    <ScrollArea
      title="Incidents"
      actions={
        <div className="flex items-center gap-2">
          <Select value={severityFilter} onValueChange={(value) => setSeverityFilter(value as SeverityFilter)}>
            <SelectTrigger variant="glass" size="large"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All severities</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="info">Info</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
            <SelectTrigger variant="glass" size="large"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All states</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="acknowledged">Acknowledged</SelectItem>
              <SelectItem value="silenced">Silenced</SelectItem>
            </SelectContent>
          </Select>
          <Select value={groupFilter} onValueChange={setGroupFilter}>
            <SelectTrigger variant="glass" size="large"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All groups</SelectItem>
              {groups.map((group) => <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={providerFilter} onValueChange={setProviderFilter}>
            <SelectTrigger variant="glass" size="large"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All providers</SelectItem>
              {(providersQuery.data ?? []).map((provider) => <SelectItem key={provider.id} value={provider.id}>{provider.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      }
      className="h-full"
    >
      <div className="px-2 pb-8 grid grid-cols-1 2xl:grid-cols-[minmax(22rem,28rem)_1fr] gap-6">
        {items.length === 0 ? (
          <EmptyState title="No active alerts or incidents" description="The incident center fills from live provider signals and incidents." />
        ) : (
          <>
            <div className="flex flex-col gap-2">
              {visible.length === 0 ? (
                <Callout color="secondary">No alerts or incidents match the current filters.</Callout>
              ) : (
                visible.map((item) => (
                  <TriageRow
                    key={item.uid}
                    item={item}
                    state={triage[item.uid]}
                    account={accountsById.get(item.accountId)}
                    selected={selected?.uid === item.uid}
                    onSelect={() => setSelectedUid(item.uid)}
                  />
                ))
              )}
            </div>
            <DetailPanel
              item={selected}
              state={selected ? triage[selected.uid] : undefined}
              events={historyQuery.data ?? []}
              account={selected ? accountsById.get(selected.accountId) : undefined}
            />
          </>
        )}
      </div>
    </ScrollArea>
  );
}
