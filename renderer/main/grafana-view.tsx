import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, ExternalLink, RefreshCw, Save, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  Callout,
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
import { monitorApi } from "./ipc";
import { ACCOUNTS_KEY, useAccounts } from "./hooks/use-accounts";
import type {
  Account,
  GrafanaDataSourceSummary,
  GrafanaLogPreset,
  GrafanaLogResult,
  GrafanaObservabilityConfig,
  GrafanaOverview,
  GrafanaRange,
  GrafanaTracePreset,
  GrafanaTraceResult,
} from "./types";

const RANGE_OPTIONS: { value: GrafanaRange; label: string }[] = [
  { value: "15m", label: "15 minutes" },
  { value: "1h", label: "1 hour" },
  { value: "6h", label: "6 hours" },
  { value: "24h", label: "24 hours" },
];

const NO_DATA_SOURCE = "__none__";

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`;
}

function emptyConfig(): GrafanaObservabilityConfig {
  return { logPresets: [], tracePresets: [] };
}

function sourceLabel(source: GrafanaDataSourceSummary): string {
  return `${source.name} (${source.uid})`;
}

function labelsText(labels: Record<string, string>): string {
  const parts = Object.entries(labels).map(([key, value]) => `${key}=${value}`);
  return parts.length > 0 ? parts.join(" ") : "no labels";
}

function selectedValue(value: string | undefined): string {
  return value ?? NO_DATA_SOURCE;
}

function fromSelectedValue(value: string): string | undefined {
  return value === NO_DATA_SOURCE ? undefined : value;
}

function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2 px-2">
        <Text variant="strong">{title}</Text>
        <div className="ml-auto flex items-center gap-2">{actions}</div>
      </div>
      <div className="border border-separator rounded-lg p-3 flex flex-col gap-3 bg-background/40">{children}</div>
    </section>
  );
}

function DataSourceSelect({
  value,
  sources,
  placeholder,
  onChange,
}: {
  value: string | undefined;
  sources: GrafanaDataSourceSummary[];
  placeholder: string;
  onChange: (value: string | undefined) => void;
}) {
  return (
    <Select value={selectedValue(value)} onValueChange={(next) => onChange(fromSelectedValue(next))}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_DATA_SOURCE}>{placeholder}</SelectItem>
        {sources.map((source) => (
          <SelectItem key={source.uid} value={source.uid}>
            {sourceLabel(source)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function PresetShell({
  title,
  emptyTitle,
  presets,
  activePresetId,
  onRun,
  children,
}: {
  title: string;
  emptyTitle: string;
  presets: { id: string; name: string; query: string }[];
  activePresetId: string | null;
  onRun: (id: string) => void;
  children: ReactNode;
}) {
  return (
    <Section title={title}>
      {presets.length === 0 ? (
        <Callout color="secondary">{emptyTitle}</Callout>
      ) : (
        <div className="flex flex-wrap gap-2">
          {presets.map((preset) => (
            <Button
              key={preset.id}
              variant={activePresetId === preset.id ? "filled" : "glass"}
              size="small"
              onClick={() => onRun(preset.id)}
            >
              <Activity className="size-4" />
              {preset.name}
            </Button>
          ))}
        </div>
      )}
      {children}
    </Section>
  );
}

function LogPresetEditor({
  config,
  sources,
  onSave,
  onDelete,
}: {
  config: GrafanaObservabilityConfig;
  sources: GrafanaDataSourceSummary[];
  onSave: (config: GrafanaObservabilityConfig) => void;
  onDelete: (config: GrafanaObservabilityConfig) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = config.logPresets.find((preset) => preset.id === editingId);
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [datasourceUid, setDatasourceUid] = useState<string | undefined>();
  const [limit, setLimit] = useState("100");

  useEffect(() => {
    setName(editing?.name ?? "");
    setQuery(editing?.query ?? "");
    setDatasourceUid(editing?.datasourceUid);
    setLimit(String(editing?.limit ?? 100));
  }, [editing]);

  const save = () => {
    if (name.trim() === "" || query.trim() === "") {
      toast.error("Log preset name and query are required.");
      return;
    }
    const preset: GrafanaLogPreset = {
      id: editing?.id ?? newId(),
      name: name.trim(),
      query: query.trim(),
      datasourceUid,
      limit: Number(limit) || 100,
    };
    const next = editing
      ? config.logPresets.map((candidate) => candidate.id === editing.id ? preset : candidate)
      : [...config.logPresets, preset];
    onSave({ ...config, logPresets: next });
    setEditingId(null);
  };

  return (
    <FieldSet title={editing ? "Edit log preset" : "Add log preset"}>
      <Field label="Preset" orientation="vertical" className="p-0">
        <Select value={editingId ?? "__new__"} onValueChange={(value) => setEditingId(value === "__new__" ? null : value)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__new__">New log preset</SelectItem>
            {config.logPresets.map((preset) => (
              <SelectItem key={preset.id} value={preset.id}>
                {preset.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name" orientation="vertical" className="p-0">
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Errors by service" />
        </Field>
        <Field label="Limit" orientation="vertical" className="p-0">
          <Input value={limit} onChange={(event) => setLimit(event.target.value)} placeholder="100" />
        </Field>
      </div>
      <Field label="Loki data source" orientation="vertical" className="p-0">
        <DataSourceSelect value={datasourceUid} sources={sources} placeholder="Use default Loki data source" onChange={setDatasourceUid} />
      </Field>
      <Field label="LogQL" orientation="vertical" className="p-0">
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder='{app="api"} |= "error"' />
      </Field>
      <div className="flex items-center gap-2">
        <Button variant="filled" size="small" onClick={save}>
          <Save className="size-4" />
          Save preset
        </Button>
        {editing ? (
          <Button
            variant="transparent"
            size="small"
            onClick={() => {
              onDelete({ ...config, logPresets: config.logPresets.filter((preset) => preset.id !== editing.id) });
              setEditingId(null);
            }}
          >
            <Trash2 className="size-4 text-support-red" />
            Delete
          </Button>
        ) : null}
      </div>
    </FieldSet>
  );
}

function TracePresetEditor({
  config,
  sources,
  onSave,
  onDelete,
}: {
  config: GrafanaObservabilityConfig;
  sources: GrafanaDataSourceSummary[];
  onSave: (config: GrafanaObservabilityConfig) => void;
  onDelete: (config: GrafanaObservabilityConfig) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = config.tracePresets.find((preset) => preset.id === editingId);
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [datasourceUid, setDatasourceUid] = useState<string | undefined>();
  const [limit, setLimit] = useState("50");
  const [minDuration, setMinDuration] = useState("");
  const [maxDuration, setMaxDuration] = useState("");

  useEffect(() => {
    setName(editing?.name ?? "");
    setQuery(editing?.query ?? "");
    setDatasourceUid(editing?.datasourceUid);
    setLimit(String(editing?.limit ?? 50));
    setMinDuration(editing?.minDuration ?? "");
    setMaxDuration(editing?.maxDuration ?? "");
  }, [editing]);

  const save = () => {
    if (name.trim() === "" || query.trim() === "") {
      toast.error("Trace preset name and query are required.");
      return;
    }
    const preset: GrafanaTracePreset = {
      id: editing?.id ?? newId(),
      name: name.trim(),
      query: query.trim(),
      datasourceUid,
      minDuration: minDuration.trim() || undefined,
      maxDuration: maxDuration.trim() || undefined,
      limit: Number(limit) || 50,
    };
    const next = editing
      ? config.tracePresets.map((candidate) => candidate.id === editing.id ? preset : candidate)
      : [...config.tracePresets, preset];
    onSave({ ...config, tracePresets: next });
    setEditingId(null);
  };

  return (
    <FieldSet title={editing ? "Edit trace preset" : "Add trace preset"}>
      <Field label="Preset" orientation="vertical" className="p-0">
        <Select value={editingId ?? "__new__"} onValueChange={(value) => setEditingId(value === "__new__" ? null : value)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__new__">New trace preset</SelectItem>
            {config.tracePresets.map((preset) => (
              <SelectItem key={preset.id} value={preset.id}>
                {preset.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name" orientation="vertical" className="p-0">
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Slow errors" />
        </Field>
        <Field label="Limit" orientation="vertical" className="p-0">
          <Input value={limit} onChange={(event) => setLimit(event.target.value)} placeholder="50" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Min duration" orientation="vertical" className="p-0">
          <Input value={minDuration} onChange={(event) => setMinDuration(event.target.value)} placeholder="500ms" />
        </Field>
        <Field label="Max duration" orientation="vertical" className="p-0">
          <Input value={maxDuration} onChange={(event) => setMaxDuration(event.target.value)} placeholder="Optional" />
        </Field>
      </div>
      <Field label="Tempo data source" orientation="vertical" className="p-0">
        <DataSourceSelect value={datasourceUid} sources={sources} placeholder="Use default Tempo data source" onChange={setDatasourceUid} />
      </Field>
      <Field label="TraceQL" orientation="vertical" className="p-0">
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="{ status = error }" />
      </Field>
      <div className="flex items-center gap-2">
        <Button variant="filled" size="small" onClick={save}>
          <Save className="size-4" />
          Save preset
        </Button>
        {editing ? (
          <Button
            variant="transparent"
            size="small"
            onClick={() => {
              onDelete({ ...config, tracePresets: config.tracePresets.filter((preset) => preset.id !== editing.id) });
              setEditingId(null);
            }}
          >
            <Trash2 className="size-4 text-support-red" />
            Delete
          </Button>
        ) : null}
      </div>
    </FieldSet>
  );
}

function OverviewSection({ overview }: { overview: GrafanaOverview }) {
  return (
    <Section
      title="Overview"
      actions={<Text variant="small" color="tertiary">{formatRelativeTime(overview.generatedAt)}</Text>}
    >
      {overview.errors.map((error) => (
        <Callout key={error.area} color="red">
          {error.area}: {error.message}
        </Callout>
      ))}
      <div className="grid grid-cols-4 gap-3">
        <div className="flex flex-col gap-1 rounded-md border border-separator p-3">
          <Text variant="small" color="tertiary">Active alerts</Text>
          <Text variant="title">{overview.alerts.length}</Text>
        </div>
        <div className="flex flex-col gap-1 rounded-md border border-separator p-3">
          <Text variant="small" color="tertiary">Data sources</Text>
          <Text variant="title">{overview.dataSources.length}</Text>
        </div>
        <div className="flex flex-col gap-1 rounded-md border border-separator p-3">
          <Text variant="small" color="tertiary">Loki</Text>
          <Text variant="title">{overview.lokiDataSources.length}</Text>
        </div>
        <div className="flex flex-col gap-1 rounded-md border border-separator p-3">
          <Text variant="small" color="tertiary">Tempo</Text>
          <Text variant="title">{overview.tempoDataSources.length}</Text>
        </div>
      </div>
      {overview.alerts.length > 0 ? (
        <div className="flex flex-col">
          {overview.alerts.map((alert) => (
            <div key={`${alert.group}:${alert.name}`} className="flex items-center gap-3 py-2 border-t border-separator first:border-t-0">
              <Badge color={alert.state === "firing" ? "red" : "yellow"}>{alert.state}</Badge>
              <div className="min-w-0 flex-1">
                <Text variant="strong" truncate>{alert.name}</Text>
                <Text variant="small" color="secondary" truncate>{alert.group}</Text>
              </div>
              {alert.lastEvaluation ? <Text variant="small" color="tertiary">{formatRelativeTime(alert.lastEvaluation)}</Text> : null}
            </div>
          ))}
        </div>
      ) : (
        <Callout color="secondary">No firing or pending Grafana alerts.</Callout>
      )}
      <div className="flex flex-col">
        {overview.dataSources.slice(0, 12).map((source) => (
          <div key={source.uid} className="flex items-center gap-3 py-2 border-t border-separator first:border-t-0">
            <div className="min-w-0 flex-1">
              <Text variant="strong" truncate>{source.name}</Text>
              <Text variant="small" color="secondary" truncate>{source.type} · {source.uid}</Text>
            </div>
            {source.status ? <StatusBadge status={source.status} /> : null}
          </div>
        ))}
      </div>
    </Section>
  );
}

function LogsResult({ result, error, loading }: { result: GrafanaLogResult | undefined; error: unknown; loading: boolean }) {
  if (loading) return <Callout color="secondary">Running log preset…</Callout>;
  if (error) return <Callout color="red">{error instanceof Error ? error.message : String(error)}</Callout>;
  if (!result) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Text variant="strong">{result.preset.name}</Text>
        <Badge color="secondary">{result.rows.length}</Badge>
      </div>
      {result.rows.length === 0 ? (
        <Callout color="secondary">No matching log lines.</Callout>
      ) : (
        <div className="flex flex-col border border-separator rounded-md overflow-hidden">
          {result.rows.map((row, index) => (
            <div key={`${row.timestamp}:${index}`} className="grid grid-cols-[8rem_12rem_1fr] gap-3 px-2 py-2 border-t border-separator first:border-t-0">
              <Text variant="small" color="tertiary" className="tabular-nums">{formatRelativeTime(row.timestamp)}</Text>
              <Text variant="small" color="secondary" truncate>{labelsText(row.labels)}</Text>
              <Text variant="small" truncate>{row.line}</Text>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TracesResult({ result, error, loading }: { result: GrafanaTraceResult | undefined; error: unknown; loading: boolean }) {
  if (loading) return <Callout color="secondary">Running trace preset…</Callout>;
  if (error) return <Callout color="red">{error instanceof Error ? error.message : String(error)}</Callout>;
  if (!result) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Text variant="strong">{result.preset.name}</Text>
        <Badge color="secondary">{result.rows.length}</Badge>
      </div>
      {result.rows.length === 0 ? (
        <Callout color="secondary">No matching traces.</Callout>
      ) : (
        <div className="flex flex-col border border-separator rounded-md overflow-hidden">
          {result.rows.map((row) => (
            <div key={row.traceId} className="grid grid-cols-[8rem_8rem_1fr_9rem] gap-3 px-2 py-2 border-t border-separator first:border-t-0">
              <Text variant="small" color="tertiary" className="tabular-nums">{row.startTime ? formatRelativeTime(row.startTime) : "unknown"}</Text>
              <Text variant="small" color="secondary">{row.durationMs !== undefined ? `${Math.round(row.durationMs)} ms` : "unknown"}</Text>
              <div className="min-w-0">
                <Text variant="strong" truncate>{row.rootTraceName ?? row.traceId}</Text>
                <Text variant="small" color="secondary" truncate>{row.rootServiceName ?? "unknown service"}</Text>
              </div>
              <Text variant="small" color="tertiary">{row.matchedSpanCount ?? 0} spans</Text>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function GrafanaView() {
  const queryClient = useQueryClient();
  const accountsQuery = useAccounts();
  const grafanaAccounts = useMemo(() => (accountsQuery.data ?? []).filter((account) => account.provider === "grafana"), [accountsQuery.data]);
  const [accountId, setAccountId] = useState("");
  const [range, setRange] = useState<GrafanaRange>("1h");
  const [activeLogPresetId, setActiveLogPresetId] = useState<string | null>(null);
  const [activeTracePresetId, setActiveTracePresetId] = useState<string | null>(null);

  useEffect(() => {
    if (accountId && grafanaAccounts.some((account) => account.id === accountId)) return;
    setAccountId(grafanaAccounts[0]?.id ?? "");
  }, [accountId, grafanaAccounts]);

  const overviewQuery = useQuery({
    queryKey: ["grafana", "overview", accountId, range],
    queryFn: () => monitorApi.getGrafanaOverview({ accountId, range }),
    enabled: accountId !== "",
  });

  const config = overviewQuery.data?.config ?? emptyConfig();
  const selectedAccount: Account | undefined = grafanaAccounts.find((account) => account.id === accountId);

  const updateConfig = useMutation({
    mutationFn: (next: GrafanaObservabilityConfig) => monitorApi.updateGrafanaObservabilityConfig({ accountId, config: next }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY });
      void queryClient.invalidateQueries({ queryKey: ["grafana", "overview", accountId, range] });
      toast.success("Grafana observability settings saved");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  });

  const logQuery = useQuery({
    queryKey: ["grafana", "logs", accountId, activeLogPresetId, range],
    queryFn: () => monitorApi.runGrafanaLogPreset({ accountId, presetId: activeLogPresetId ?? "", range }),
    enabled: accountId !== "" && activeLogPresetId !== null,
    retry: false,
  });

  const traceQuery = useQuery({
    queryKey: ["grafana", "traces", accountId, activeTracePresetId, range],
    queryFn: () => monitorApi.runGrafanaTracePreset({ accountId, presetId: activeTracePresetId ?? "", range }),
    enabled: accountId !== "" && activeTracePresetId !== null,
    retry: false,
  });

  const actions = (
    <div className="flex items-center gap-2">
      <Select value={accountId || "__none__"} onValueChange={(value) => setAccountId(value === "__none__" ? "" : value)}>
        <SelectTrigger variant="glass" size="large">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {grafanaAccounts.length === 0 ? <SelectItem value="__none__">No Grafana accounts</SelectItem> : null}
          {grafanaAccounts.map((account) => (
            <SelectItem key={account.id} value={account.id}>
              {account.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={range} onValueChange={(value) => setRange(value as GrafanaRange)}>
        <SelectTrigger variant="glass" size="large">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {RANGE_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button variant="glass" size="large" iconOnly aria-label="Refresh" onClick={() => overviewQuery.refetch()}>
        <RefreshCw className={`size-4.5 ${overviewQuery.isFetching ? "animate-spin" : ""}`} />
      </Button>
    </div>
  );

  const openGrafanaExplore = () => {
    const baseUrl = overviewQuery.data?.baseUrl ?? selectedAccount?.config?.baseUrl;
    if (!baseUrl) return;
    void monitorApi.openExternal(`${baseUrl.replace(/\/+$/, "")}/explore`).catch((error) => toast.error(String(error)));
  };

  return (
    <ScrollArea title="Grafana" actions={actions} className="h-full">
      <div className="px-2 pb-8 flex flex-col gap-6">
        {grafanaAccounts.length === 0 ? (
          <EmptyState
            title="No Grafana accounts"
            description="Connect a Grafana account before using the incident console."
          />
        ) : overviewQuery.error ? (
          <Callout color="red">{overviewQuery.error instanceof Error ? overviewQuery.error.message : String(overviewQuery.error)}</Callout>
        ) : overviewQuery.data ? (
          <>
            <div className="flex items-center gap-2 px-2">
              <Text variant="strong">{selectedAccount?.label}</Text>
              <Text variant="small" color="tertiary">{overviewQuery.data.baseUrl}</Text>
              <Button variant="transparent" size="small" className="ml-auto" onClick={openGrafanaExplore}>
                <ExternalLink className="size-4" />
                Open in Grafana
              </Button>
            </div>

            <Section title="Defaults">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Default Loki data source" orientation="vertical" className="p-0">
                  <DataSourceSelect
                    value={config.lokiDataSourceUid}
                    sources={overviewQuery.data.lokiDataSources}
                    placeholder="No default Loki data source"
                    onChange={(lokiDataSourceUid) => updateConfig.mutate({ ...config, lokiDataSourceUid })}
                  />
                </Field>
                <Field label="Default Tempo data source" orientation="vertical" className="p-0">
                  <DataSourceSelect
                    value={config.tempoDataSourceUid}
                    sources={overviewQuery.data.tempoDataSources}
                    placeholder="No default Tempo data source"
                    onChange={(tempoDataSourceUid) => updateConfig.mutate({ ...config, tempoDataSourceUid })}
                  />
                </Field>
              </div>
            </Section>

            <OverviewSection overview={overviewQuery.data} />

            <PresetShell
              title="Logs"
              emptyTitle="No log presets yet. Add a LogQL preset to query Loki from this console."
              presets={config.logPresets}
              activePresetId={activeLogPresetId}
              onRun={setActiveLogPresetId}
            >
              <LogsResult result={logQuery.data} error={logQuery.error} loading={logQuery.isFetching} />
              <LogPresetEditor
                config={config}
                sources={overviewQuery.data.lokiDataSources}
                onSave={(next) => updateConfig.mutate(next)}
                onDelete={(next) => updateConfig.mutate(next)}
              />
            </PresetShell>

            <PresetShell
              title="Traces"
              emptyTitle="No trace presets yet. Add a TraceQL preset to query Tempo from this console."
              presets={config.tracePresets}
              activePresetId={activeTracePresetId}
              onRun={setActiveTracePresetId}
            >
              <TracesResult result={traceQuery.data} error={traceQuery.error} loading={traceQuery.isFetching} />
              <TracePresetEditor
                config={config}
                sources={overviewQuery.data.tempoDataSources}
                onSave={(next) => updateConfig.mutate(next)}
                onDelete={(next) => updateConfig.mutate(next)}
              />
            </PresetShell>
          </>
        ) : (
          <Callout color="secondary">Loading Grafana observability…</Callout>
        )}
      </div>
    </ScrollArea>
  );
}
