import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import {
  ScrollArea,
  Button,
  EmptyState,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Callout,
  Badge,
  Text,
  toast,
} from "@glaze/core/components";

import { AccountSection } from "./components/account-section";
import { useMonitorData } from "./hooks/use-monitor-data";
import { useAccounts, useGroups } from "./hooks/use-accounts";
import { useProviders } from "./hooks/use-providers";
import { monitorApi } from "./ipc";
import type { Account, MonitorItem, NormalizedStatus, ProjectGroup, Provider } from "./types";

type ProviderFilter = "all" | Provider;
type StatusFilter = "all" | "failure" | "running" | "success";

const PROVIDER_FILTER_KEY = "dashboard.providerFilter";
const STATUS_FILTER_KEY = "dashboard.statusFilter";
const GROUP_FILTER_KEY = "dashboard.groupFilter";
const ALL_GROUPS = "all";
const UNGROUPED = "ungrouped";

function matchesStatus(status: NormalizedStatus, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "running") return status === "running" || status === "queued";
  return status === filter;
}

function matchesGroup(account: Account, groupsById: Map<string, ProjectGroup>, filter: string): boolean {
  if (filter === ALL_GROUPS) return true;
  const groupId = account.groupId && groupsById.has(account.groupId) ? account.groupId : UNGROUPED;
  return groupId === filter;
}

export function DashboardView() {
  const navigate = useNavigate();
  const snapshotQuery = useMonitorData();
  const accountsQuery = useAccounts();
  const groupsQuery = useGroups();
  const providersQuery = useProviders();

  const [providerFilter, setProviderFilter] = useState<ProviderFilter>(
    () => (localStorage.getItem(PROVIDER_FILTER_KEY) as ProviderFilter) ?? "all",
  );
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(
    () => (localStorage.getItem(STATUS_FILTER_KEY) as StatusFilter) ?? "all",
  );
  const [groupFilter, setGroupFilter] = useState(() => localStorage.getItem(GROUP_FILTER_KEY) ?? ALL_GROUPS);
  const [refreshing, setRefreshing] = useState(false);

  const setProvider = (v: ProviderFilter) => {
    setProviderFilter(v);
    localStorage.setItem(PROVIDER_FILTER_KEY, v);
  };
  const setStatus = (v: StatusFilter) => {
    setStatusFilter(v);
    localStorage.setItem(STATUS_FILTER_KEY, v);
  };
  const setGroup = (v: string) => {
    setGroupFilter(v);
    localStorage.setItem(GROUP_FILTER_KEY, v);
  };

  const handleOpen = (item: MonitorItem) => {
    void monitorApi.openExternal(item.url).catch((err) => toast.error(String(err)));
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await monitorApi.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  };

  const accounts = accountsQuery.data ?? [];
  const groups = groupsQuery.data ?? [];
  const snapshot = snapshotQuery.data;
  const groupsById = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups]);

  useEffect(() => {
    if (groupFilter === ALL_GROUPS || groupFilter === UNGROUPED) return;
    if (groupsQuery.isSuccess && !groupsById.has(groupFilter)) setGroup(ALL_GROUPS);
  }, [groupFilter, groupsById, groupsQuery.isSuccess]);

  const itemsByAccount = new Map<string, MonitorItem[]>();
  for (const item of snapshot?.items ?? []) {
    if (!matchesStatus(item.status, statusFilter)) continue;
    const list = itemsByAccount.get(item.accountId) ?? [];
    list.push(item);
    itemsByAccount.set(item.accountId, list);
  }

  const visibleAccounts = accounts.filter(
    (a) =>
      (providerFilter === "all" || a.provider === providerFilter) &&
      matchesGroup(a, groupsById, groupFilter) &&
      (statusFilter === "all" || (itemsByAccount.get(a.id)?.length ?? 0) > 0),
  );

  const accountsByGroup = new Map<string, Account[]>();
  for (const account of visibleAccounts) {
    const groupId = account.groupId && groupsById.has(account.groupId) ? account.groupId : UNGROUPED;
    const list = accountsByGroup.get(groupId) ?? [];
    list.push(account);
    accountsByGroup.set(groupId, list);
  }

  const visibleGroups = [
    ...groups
      .map((group) => ({ id: group.id, title: group.name, accounts: accountsByGroup.get(group.id) ?? [] }))
      .filter((group) => group.accounts.length > 0),
    { id: UNGROUPED, title: "Ungrouped", accounts: accountsByGroup.get(UNGROUPED) ?? [] },
  ].filter((group) => group.accounts.length > 0);

  const actions = (
    <div className="flex items-center gap-2">
      <Select value={groupFilter} onValueChange={setGroup}>
        <SelectTrigger variant="glass" size="large">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_GROUPS}>All groups</SelectItem>
          <SelectItem value={UNGROUPED}>Ungrouped</SelectItem>
          {groups.map((group) => (
            <SelectItem key={group.id} value={group.id}>
              {group.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={providerFilter} onValueChange={(v) => setProvider(v as ProviderFilter)}>
        <SelectTrigger variant="glass" size="large">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All providers</SelectItem>
          {(providersQuery.data ?? []).map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={statusFilter} onValueChange={(v) => setStatus(v as StatusFilter)}>
        <SelectTrigger variant="glass" size="large">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All statuses</SelectItem>
          <SelectItem value="failure">Failed</SelectItem>
          <SelectItem value="running">Running</SelectItem>
          <SelectItem value="success">Passed</SelectItem>
        </SelectContent>
      </Select>
      <Button variant="glass" size="large" iconOnly aria-label="Refresh" onClick={handleRefresh} disabled={refreshing}>
        <RefreshCw className={`size-4.5 ${refreshing ? "animate-spin" : ""}`} />
      </Button>
    </div>
  );

  return (
    <ScrollArea title="Dashboard" actions={actions} className="h-full">
      <div className="px-2 pb-8 flex flex-col gap-6">
        {accounts.length === 0 ? (
          <EmptyState
            title="No accounts connected"
            description="Connect GitHub, Cloudflare, Supabase, Netlify, Resend, Grafana, or Heroku to start monitoring."
            actions={<Button variant="accent" onClick={() => navigate({ to: "/accounts" })}>Add account</Button>}
          />
        ) : visibleGroups.length === 0 ? (
          <Callout color="secondary">No accounts match the current filters.</Callout>
        ) : (
          visibleGroups.map((group) => (
            <section key={group.id} className="flex flex-col gap-3">
              <div className="flex items-center gap-2 px-2">
                <Text variant="strong">{group.title}</Text>
                <Badge color="secondary">{group.accounts.length}</Badge>
              </div>
              <div className="flex flex-col gap-6">
                {group.accounts.map((account) => (
                  <AccountSection
                    key={account.id}
                    account={account}
                    status={snapshot?.perAccount[account.id]}
                    items={itemsByAccount.get(account.id) ?? []}
                    onOpen={handleOpen}
                  />
                ))}
              </div>
            </section>
          ))
        )}

        {accounts.length > 0 && !snapshot ? (
          <Callout color="secondary">Fetching the latest runs and deployments…</Callout>
        ) : null}
      </div>
    </ScrollArea>
  );
}
