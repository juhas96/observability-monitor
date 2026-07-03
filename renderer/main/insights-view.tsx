import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Download, Edit3, Plus, Trash2 } from "lucide-react";
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
import { providerLabel } from "./components/provider-meta";
import { monitorApi } from "./ipc";
import { useAccounts, useGroups } from "./hooks/use-accounts";
import { useHistorySeries } from "./hooks/use-history";
import { useProviders } from "./hooks/use-providers";
import { useSloMutations, useSloStatus } from "./hooks/use-slos";
import type { HistoryRange, HistorySample, Provider, SloDefinition, SloStatus } from "./types";

const RANGE_OPTIONS: { value: HistoryRange; label: string }[] = [
  { value: "15m", label: "15 minutes" },
  { value: "1h", label: "1 hour" },
  { value: "6h", label: "6 hours" },
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "14d", label: "14 days" },
];

const ALL = "all";
const GROUP_FILTER_KEY = "insights.groupFilter";
const PROVIDER_FILTER_KEY = "insights.providerFilter";

function timeLabel(ts: string): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function countsFor(sample: HistorySample, groupId: string, provider: string) {
  let success = 0;
  let failure = 0;
  for (const row of Object.values(sample.perAccount)) {
    if (groupId !== ALL && row.groupId !== groupId) continue;
    if (provider !== ALL && row.provider !== provider) continue;
    success += row.counts.success;
    failure += row.counts.failure;
  }
  return { success, failure };
}

function pct(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(2)}%`;
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

  return (
    <div className="rounded-lg border border-separator p-3 flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Text variant="strong" truncate>{status.slo.name}</Text>
          <Text variant="small" color="secondary">{scope} · {status.slo.target}% over {status.slo.windowDays}d</Text>
        </div>
        <Badge color={status.atRisk ? "red" : "secondary"}>{status.atRisk ? "At risk" : "Tracking"}</Badge>
        <Button variant="transparent" size="small" iconOnly aria-label="Edit SLO" onClick={onEdit}>
          <Edit3 className="size-4" />
        </Button>
        <Button
          variant="transparent"
          size="small"
          iconOnly
          aria-label="Delete SLO"
          onClick={() => void remove.mutateAsync(status.slo.id).catch((error) => toast.error(String(error)))}
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
  const [range, setRange] = useState<HistoryRange>("24h");
  const [groupFilter, setGroupFilter] = useState(() => localStorage.getItem(GROUP_FILTER_KEY) ?? ALL);
  const [providerFilter, setProviderFilter] = useState(() => localStorage.getItem(PROVIDER_FILTER_KEY) ?? ALL);
  const [sloOpen, setSloOpen] = useState(false);
  const [editingSlo, setEditingSlo] = useState<SloDefinition | null>(null);
  const seriesQuery = useHistorySeries(range);
  const sloStatusQuery = useSloStatus();
  const groupsQuery = useGroups();
  const providersQuery = useProviders();

  const setGroup = (value: string) => {
    setGroupFilter(value);
    localStorage.setItem(GROUP_FILTER_KEY, value);
  };
  const setProvider = (value: string) => {
    setProviderFilter(value);
    localStorage.setItem(PROVIDER_FILTER_KEY, value);
  };

  const series = seriesQuery.data ?? [];
  const trendPoints = useMemo<ChartPoint[]>(() => series.map((sample) => {
    const counts = countsFor(sample, groupFilter, providerFilter);
    return { label: timeLabel(sample.ts), value: counts.success, secondary: counts.failure };
  }), [groupFilter, providerFilter, series]);
  const deployPoints = useMemo<ChartPoint[]>(() => series.map((sample) => ({
    label: timeLabel(sample.ts),
    value: Object.values(sample.perAccount)
      .filter((row) => (groupFilter === ALL || row.groupId === groupFilter) && (providerFilter === ALL || row.provider === providerFilter))
      .reduce((sum, row) => sum + row.counts.success + row.counts.failure, 0),
  })), [groupFilter, providerFilter, series]);
  const alertPoints = useMemo<ChartPoint[]>(() => series.map((sample) => ({
    label: timeLabel(sample.ts),
    value: groupFilter === ALL && providerFilter === ALL ? sample.alertCount : 0,
  })), [groupFilter, providerFilter, series]);

  const totals = trendPoints.reduce((sum, point) => ({
    success: sum.success + point.value,
    failure: sum.failure + (point.secondary ?? 0),
  }), { success: 0, failure: 0 });
  const totalAttempts = totals.success + totals.failure;
  const successRate = totalAttempts > 0 ? totals.success / totalAttempts : null;

  const exportEvents = async () => {
    try {
      const result = await monitorApi.exportHistory({ dataset: "events", format: "csv" });
      if (result.ok) toast.success("History exported.");
    } catch (error) {
      toast.error(String(error));
    }
  };

  const actions = (
    <div className="flex items-center gap-2">
      <Button variant="glass" size="large" onClick={exportEvents}>
        <Download className="size-4" /> Export
      </Button>
      <Select value={range} onValueChange={(value) => setRange(value as HistoryRange)}>
        <SelectTrigger variant="glass" size="large"><SelectValue /></SelectTrigger>
        <SelectContent>
          {RANGE_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={groupFilter} onValueChange={setGroup}>
        <SelectTrigger variant="glass" size="large"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All groups</SelectItem>
          {(groupsQuery.data ?? []).map((group) => <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={providerFilter} onValueChange={setProvider}>
        <SelectTrigger variant="glass" size="large"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All providers</SelectItem>
          {(providersQuery.data ?? []).map((provider) => <SelectItem key={provider.id} value={provider.id}>{provider.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <ScrollArea title="Insights" actions={actions} className="h-full">
      <div className="px-2 pb-8 flex flex-col gap-6">
        {series.length === 0 ? (
          <EmptyState title="No history yet" description="History starts accumulating after the next polling cycle." />
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <StatCard label="Success rate" value={pct(successRate)} detail={`${totals.success} successful / ${totals.failure} failed`} />
              <StatCard label="Open incidents" value={String(series[series.length - 1]?.openIncidentCount ?? 0)} />
              <StatCard label="Alerts in range" value={String(series.reduce((sum, sample) => sum + sample.alertCount, 0))} />
            </div>
            <div className="grid grid-cols-1 2xl:grid-cols-2 gap-6">
              <Section title="Success vs failure">
                <LineChart points={trendPoints} label="Success" secondaryLabel="Failure" />
              </Section>
              <Section title="Deploy and run frequency">
                <BarChart points={deployPoints} label="Deploy and run frequency" />
              </Section>
              <Section title="Alert volume">
                {groupFilter === ALL && providerFilter === ALL ? (
                  <LineChart points={alertPoints} label="Alerts" />
                ) : (
                  <Callout color="secondary">Alert volume is stored globally in this version.</Callout>
                )}
              </Section>
            </div>
          </>
        )}

        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2 px-2">
            <Text variant="strong">SLOs</Text>
            <div className="ml-auto">
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
          ) : (
            <div className="grid grid-cols-1 2xl:grid-cols-2 gap-4">
              {(sloStatusQuery.data ?? []).map((status) => (
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
