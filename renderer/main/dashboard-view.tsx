import { useState } from "react";
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
  toast,
} from "@glaze/core/components";

import { AccountSection } from "./components/account-section";
import { useMonitorData } from "./hooks/use-monitor-data";
import { useAccounts } from "./hooks/use-accounts";
import { useProviders } from "./hooks/use-providers";
import { monitorApi } from "./ipc";
import type { MonitorItem, NormalizedStatus, Provider } from "./types";

type ProviderFilter = "all" | Provider;
type StatusFilter = "all" | "failure" | "running" | "success";

const PROVIDER_FILTER_KEY = "dashboard.providerFilter";
const STATUS_FILTER_KEY = "dashboard.statusFilter";

function matchesStatus(status: NormalizedStatus, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "running") return status === "running" || status === "queued";
  return status === filter;
}

export function DashboardView() {
  const navigate = useNavigate();
  const snapshotQuery = useMonitorData();
  const accountsQuery = useAccounts();
  const providersQuery = useProviders();

  const [providerFilter, setProviderFilter] = useState<ProviderFilter>(
    () => (localStorage.getItem(PROVIDER_FILTER_KEY) as ProviderFilter) ?? "all",
  );
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(
    () => (localStorage.getItem(STATUS_FILTER_KEY) as StatusFilter) ?? "all",
  );
  const [refreshing, setRefreshing] = useState(false);

  const setProvider = (v: ProviderFilter) => {
    setProviderFilter(v);
    localStorage.setItem(PROVIDER_FILTER_KEY, v);
  };
  const setStatus = (v: StatusFilter) => {
    setStatusFilter(v);
    localStorage.setItem(STATUS_FILTER_KEY, v);
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
  const snapshot = snapshotQuery.data;

  const visibleAccounts = accounts.filter((a) => providerFilter === "all" || a.provider === providerFilter);

  const itemsByAccount = new Map<string, MonitorItem[]>();
  for (const item of snapshot?.items ?? []) {
    if (!matchesStatus(item.status, statusFilter)) continue;
    const list = itemsByAccount.get(item.accountId) ?? [];
    list.push(item);
    itemsByAccount.set(item.accountId, list);
  }

  const actions = (
    <div className="flex items-center gap-2">
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
        ) : (
          visibleAccounts.map((account) => (
            <AccountSection
              key={account.id}
              account={account}
              status={snapshot?.perAccount[account.id]}
              items={itemsByAccount.get(account.id) ?? []}
              onOpen={handleOpen}
            />
          ))
        )}

        {accounts.length > 0 && !snapshot ? (
          <Callout color="secondary">Fetching the latest runs and deployments…</Callout>
        ) : null}
      </div>
    </ScrollArea>
  );
}
