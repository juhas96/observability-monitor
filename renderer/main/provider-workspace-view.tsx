import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BellPlus, Download, ExternalLink, GitBranch, RefreshCw, Search, TableProperties } from "lucide-react";
import {
  Badge,
  Button,
  Callout,
  EmptyState,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Text,
  toast,
} from "@glaze/core/components";

import { ALL, HISTORY_RANGE_OPTIONS, useStoredState } from "./components/filters";
import { formatRelativeTime } from "./components/relative-time";
import { providerIcon, providerLabel } from "./components/provider-meta";
import {
  ResponsiveGrid,
  ResponsiveMoreMenu,
  ResponsiveSectionNav,
  RouteBody,
  RouteHeader,
  RouteSurface,
  ScrollTable,
} from "./components/responsive-layout";
import { useAccounts } from "./hooks/use-accounts";
import { useProviderWorkspaceCapabilities, useProviderWorkspaceOverview, useProviders } from "./hooks/use-providers";
import { monitorApi } from "./ipc";
import type {
  DashboardTableRow,
  HistoryRange,
  Provider,
  ProviderWorkspaceAlertTemplate,
  ProviderWorkspaceEvidenceRow,
  ProviderWorkspaceResourceTable,
  ProviderWorkspaceSection,
  ProviderWorkspaceSeries,
  ProviderWorkspaceStat,
} from "./types";

const FILTER_KEY = "providerWorkspace.filters.v1";
const ALERT_RULE_DRAFT_KEY = "alerts.draft.v1";
const PIPELINE_DRILLDOWN_KEY = "pipelines.drilldown.v1";

interface ProviderWorkspaceFilters {
  provider: Provider | "all";
  accountId: string;
  range: HistoryRange;
  search: string;
}

const DEFAULT_FILTERS: ProviderWorkspaceFilters = {
  provider: "all",
  accountId: ALL,
  range: "24h",
  search: "",
};

const SERIES_COLORS = [
  "var(--accent)",
  "var(--red)",
  "var(--orange)",
  "var(--green)",
  "var(--blue)",
  "var(--purple)",
];
const GRID_COLOR = "var(--color-border-separator)";
const TEXT_COLOR = "var(--color-text-tertiary)";

function toneBadge(tone: ProviderWorkspaceStat["tone"]): "secondary" | "green" | "yellow" | "red" | "blue" {
  if (tone === "success") return "green";
  if (tone === "warning") return "yellow";
  if (tone === "danger") return "red";
  if (tone === "info") return "blue";
  return "secondary";
}

function rowText(row: DashboardTableRow, column: string): string {
  const value = row[column];
  if (value == null) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function seriesData(series: ProviderWorkspaceSeries): Array<Record<string, string | number>> {
  return series.points.map((point) => ({
    label: point.label,
    ...point.values,
  }));
}

function WorkspaceChart({ series }: { series: ProviderWorkspaceSeries }) {
  const data = seriesData(series);
  if (data.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center rounded-md border border-dashed border-separator">
        <Text variant="small" color="tertiary">No retained history for this chart yet.</Text>
      </div>
    );
  }

  const common = (
    <>
      <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" vertical={false} />
      <XAxis dataKey="label" tick={{ fill: TEXT_COLOR, fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={18} />
      <YAxis tick={{ fill: TEXT_COLOR, fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
      <Tooltip
        contentStyle={{
          background: "var(--background)",
          border: "1px solid var(--color-border-separator)",
          borderRadius: 8,
          color: "var(--color-text-primary)",
        }}
        labelStyle={{ color: "var(--color-text-secondary)" }}
      />
    </>
  );

  return (
    <div className="h-56 min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        {series.kind === "bar" ? (
          <BarChart data={data} margin={{ top: 10, right: 10, bottom: 0, left: -20 }}>
            {common}
            {series.fields.map((field, index) => (
              <Bar key={field.key} dataKey={field.key} name={field.label} fill={SERIES_COLORS[index % SERIES_COLORS.length]} radius={[3, 3, 0, 0]} />
            ))}
          </BarChart>
        ) : series.kind === "line" ? (
          <LineChart data={data} margin={{ top: 10, right: 10, bottom: 0, left: -20 }}>
            {common}
            {series.fields.map((field, index) => (
              <Line key={field.key} dataKey={field.key} name={field.label} type="monotone" stroke={SERIES_COLORS[index % SERIES_COLORS.length]} strokeWidth={2} dot={false} />
            ))}
          </LineChart>
        ) : (
          <AreaChart data={data} margin={{ top: 10, right: 10, bottom: 0, left: -20 }}>
            {common}
            {series.fields.map((field, index) => (
              <Area
                key={field.key}
                dataKey={field.key}
                name={field.label}
                type="monotone"
                stroke={SERIES_COLORS[index % SERIES_COLORS.length]}
                fill={SERIES_COLORS[index % SERIES_COLORS.length]}
                fillOpacity={0.12}
                strokeWidth={2}
                dot={false}
              />
            ))}
          </AreaChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

function SectionRail({
  sections,
  selected,
  onSelect,
}: {
  sections: ProviderWorkspaceSection[];
  selected: string;
  onSelect: (sectionId: string) => void;
}) {
  return <ResponsiveSectionNav items={sections.map((section) => ({ ...section, detail: section.detail ?? section.description }))} selected={selected} onSelect={onSelect} />;
}

function StatGrid({ stats }: { stats: ProviderWorkspaceStat[] }) {
  return (
    <ResponsiveGrid min="10rem">
      {stats.map((stat) => (
        <div key={stat.label} className="rounded-lg border border-separator p-3">
          <div className="flex items-start justify-between gap-2">
            <Text variant="small" color="secondary" className="block">{stat.label}</Text>
            <Badge color={toneBadge(stat.tone)}>{stat.tone ?? "neutral"}</Badge>
          </div>
          <Text variant="title" className="mt-2 block">{stat.value}</Text>
          {stat.detail ? <Text variant="small" color="tertiary" className="mt-1 block">{stat.detail}</Text> : null}
        </div>
      ))}
    </ResponsiveGrid>
  );
}

function ChartGrid({ series }: { series: ProviderWorkspaceSeries[] }) {
  return (
    <ResponsiveGrid min="20rem">
      {series.map((item) => (
        <section key={item.id} className="rounded-lg border border-separator p-3">
          <div className="mb-3 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <Text variant="strong" className="block truncate">{item.label}</Text>
              {item.description ? <Text variant="small" color="tertiary" className="block">{item.description}</Text> : null}
            </div>
            <Badge color="secondary">{item.kind}</Badge>
          </div>
          <WorkspaceChart series={item} />
        </section>
      ))}
    </ResponsiveGrid>
  );
}

function ResourceTable({ table }: { table: ProviderWorkspaceResourceTable }) {
  const visibleRows = table.rows.slice(0, 60);
  return (
    <section className="rounded-lg border border-separator">
      <div className="flex items-start gap-2 border-b border-separator p-3">
        <TableProperties className="mt-0.5 size-4 shrink-0 text-tertiary" />
        <div className="min-w-0 flex-1">
          <Text variant="strong" className="block">{table.label}</Text>
          {table.description ? <Text variant="small" color="tertiary" className="block">{table.description}</Text> : null}
        </div>
        <Badge color="secondary">{table.rows.length}</Badge>
      </div>
      {visibleRows.length === 0 ? (
        <div className="p-3">
          <Callout color="secondary">{table.emptyDetail ?? "No rows available."}</Callout>
        </div>
      ) : (
        <ScrollTable>
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase text-tertiary">
              <tr>
                {table.columns.map((column) => (
                  <th key={column} className="whitespace-nowrap border-b border-separator px-3 py-2 font-medium">{column}</th>
                ))}
                <th className="border-b border-separator px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row, index) => (
                <tr key={`${table.id}-${index}`} className="border-b border-separator/70 last:border-b-0">
                  {table.columns.map((column) => (
                    <td key={column} className="max-w-72 px-3 py-2 align-top text-secondary">
                      <span className="line-clamp-2 break-words">{rowText(row, column)}</span>
                    </td>
                  ))}
                  <td className="px-3 py-2 align-top">
                    {row.__url ? (
                      <Button variant="transparent" size="small" iconOnly aria-label={row.__urlLabel ?? "Open"} onClick={() => void monitorApi.openExternal(String(row.__url)).catch((error) => toast.error(String(error)))}>
                        <ExternalLink className="size-4" />
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollTable>
      )}
    </section>
  );
}

function EvidenceRow({ row }: { row: ProviderWorkspaceEvidenceRow }) {
  return (
    <div className="flex min-w-0 items-start gap-3 rounded-md border border-separator p-3">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Text variant="strong" className="block min-w-0 truncate">{row.title}</Text>
          <Badge color="secondary">{row.type}</Badge>
          {row.status ? <Badge color={row.status === "failure" || row.status === "open" ? "red" : row.status === "warning" ? "yellow" : "secondary"}>{row.status}</Badge> : null}
          {row.logAvailable ? <Badge color="blue">logs</Badge> : null}
        </div>
        <Text variant="small" color="secondary" className="mt-1 block">
          {[row.accountLabel, row.category, row.subtitle].filter(Boolean).join(" · ")}
        </Text>
        <Text variant="small" color="tertiary" className="mt-1 block">{formatRelativeTime(row.ts)}</Text>
      </div>
      {row.url ? (
        <Button variant="transparent" size="small" iconOnly aria-label="Open evidence" onClick={() => void monitorApi.openExternal(row.url ?? "").catch((error) => toast.error(String(error)))}>
          <ExternalLink className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}

function AlertTemplateRow({ template }: { template: ProviderWorkspaceAlertTemplate }) {
  const navigate = useNavigate();
  const createRule = () => {
    localStorage.setItem(ALERT_RULE_DRAFT_KEY, JSON.stringify(template.rule));
    void navigate({ to: "/alerts" });
  };
  return (
    <div className="flex min-w-0 items-start gap-3 rounded-md border border-separator p-3">
      <BellPlus className="mt-0.5 size-4 shrink-0 text-tertiary" />
      <div className="min-w-0 flex-1">
        <Text variant="strong" className="block">{template.label}</Text>
        <Text variant="small" color="secondary" className="block">{template.description}</Text>
        <Text variant="small" color="tertiary" className="block">
          {template.rule.metric} {template.rule.operator} {template.rule.threshold}
        </Text>
      </div>
      <Button variant="filled" size="small" onClick={createRule}>Use</Button>
    </div>
  );
}

export function ProviderWorkspaceView() {
  const [filters, setFilters] = useStoredState<ProviderWorkspaceFilters>(FILTER_KEY, DEFAULT_FILTERS);
  const [sectionId, setSectionId] = useState("overview");
  const navigate = useNavigate();
  const providersQuery = useProviders();
  const accountsQuery = useAccounts();
  const capabilitiesQuery = useProviderWorkspaceCapabilities();
  const providers = providersQuery.data ?? [];
  const accounts = accountsQuery.data ?? [];
  const provider = filters.provider === "all" ? providers[0]?.id : filters.provider;
  const providerAccounts = accounts.filter((account) => account.provider === provider);

  useEffect(() => {
    if (filters.provider !== "all" || !providers[0]) return;
    setFilters({ ...filters, provider: providers[0].id });
  }, [filters, providers, setFilters]);

  useEffect(() => {
    if (filters.accountId === ALL || providerAccounts.some((account) => account.id === filters.accountId)) return;
    setFilters({ ...filters, accountId: ALL });
  }, [filters, providerAccounts, setFilters]);

  const overviewQuery = useProviderWorkspaceOverview({
    provider: provider ?? "github",
    range: filters.range,
    accountId: filters.accountId === ALL ? undefined : filters.accountId,
  });
  const overview = overviewQuery.data;
  const capability = capabilitiesQuery.data?.find((item) => item.provider === provider);
  const providerMeta = providers.find((item) => item.id === provider);
  const search = filters.search.trim().toLowerCase();
  const filteredResources = useMemo(() => {
    const tables = overview?.resources ?? [];
    if (!search) return tables;
    return tables.map((table) => ({
      ...table,
      rows: table.rows.filter((row) => JSON.stringify(row).toLowerCase().includes(search)),
    }));
  }, [overview?.resources, search]);
  const filteredEvidence = useMemo(() => {
    const rows = overview?.evidence ?? [];
    if (!search) return rows;
    return rows.filter((row) => [row.title, row.subtitle, row.accountLabel, row.category, row.status].filter(Boolean).join(" ").toLowerCase().includes(search));
  }, [overview?.evidence, search]);
  const activitySeriesItems = (overview?.series ?? []).filter((item) => item.id === "activity");
  const analyticsSeriesItems = (overview?.series ?? []).filter((item) => item.id !== "activity");

  const setFilter = <K extends keyof ProviderWorkspaceFilters>(key: K, value: ProviderWorkspaceFilters[K]) => {
    setFilters({ ...filters, [key]: value });
  };
  const selectSection = (nextSectionId: string) => {
    setSectionId(nextSectionId);
    window.requestAnimationFrame(() => {
      document.getElementById(`provider-workspace-${nextSectionId}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  };
  const refresh = () => {
    if (!provider) return;
    void monitorApi.refresh(filters.accountId === ALL ? undefined : filters.accountId)
      .then(() => overviewQuery.refetch())
      .catch((error) => toast.error(error instanceof Error ? error.message : String(error)));
  };
  const exportWorkspace = (format: "csv" | "json") => {
    if (!provider) return;
    void monitorApi.exportProviderWorkspace({
      provider,
      range: filters.range,
      accountId: filters.accountId === ALL ? undefined : filters.accountId,
      format,
    })
      .then((result) => {
        if (result.ok) toast.success(`Workspace exported${result.filePath ? ` to ${result.filePath}` : ""}`);
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : String(error)));
  };
  const openPipelines = () => {
    if (!provider) return;
    localStorage.setItem(PIPELINE_DRILLDOWN_KEY, JSON.stringify({
      dateRange: { mode: "relative", range: filters.range },
      provider,
      account: filters.accountId,
      status: "all",
      category: "all",
      search: "",
    }));
    void navigate({ to: "/pipelines" });
  };

  if (!provider) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <EmptyState title="No providers registered" description="Provider metadata could not be loaded." />
      </div>
    );
  }

  const ProviderIcon = providerIcon(provider);

  return (
    <RouteSurface>
      <RouteHeader
        icon={<ProviderIcon className="size-5" />}
        title={`${providerLabel(provider)} workspace`}
        meta={capability ? <Badge color="secondary">{capability.enabledAccountCount}/{capability.accountCount} enabled</Badge> : null}
        subtitle="Read-only provider deep dive with native inventory, health, evidence, setup state, alert templates, and exports."
        controls={
          <>
            <Select value={provider} onValueChange={(value) => setFilters({ ...filters, provider: value as Provider, accountId: ALL })}>
              <SelectTrigger className="w-full sm:w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                {providers.map((item) => (
                  <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filters.accountId} onValueChange={(value) => setFilter("accountId", value)}>
              <SelectTrigger className="w-full sm:w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All accounts</SelectItem>
                {providerAccounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>{account.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filters.range} onValueChange={(value) => setFilter("range", value as HistoryRange)}>
              <SelectTrigger className="w-full sm:w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                {HISTORY_RANGE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="filled" size="small" onClick={refresh}>
              <RefreshCw className="size-4" />
              Refresh
            </Button>
            <Button variant="glass" size="small" onClick={openPipelines}>
              <GitBranch className="size-4" />
              Pipelines
            </Button>
            <ResponsiveMoreMenu label="Export">
              <Button variant="transparent" size="small" onClick={() => exportWorkspace("csv")}>
                <Download className="size-4" />
                CSV
              </Button>
              <Button variant="transparent" size="small" onClick={() => exportWorkspace("json")}>
                <Download className="size-4" />
                JSON
              </Button>
            </ResponsiveMoreMenu>
          </>
        }
        search={
          <div className="relative">
          <Search className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-tertiary" />
          <Input
            value={filters.search}
            onChange={(event) => setFilter("search", event.target.value)}
            placeholder="Search resources, evidence, accounts, statuses"
            className="pl-8"
          />
          </div>
        }
      />

      <RouteBody>
        <div className="flex min-w-0 flex-col gap-4 2xl:flex-row">
          <SectionRail sections={overview?.sections ?? capability?.sections ?? []} selected={sectionId} onSelect={selectSection} />
          <main className="min-w-0 flex-1 space-y-4">
            {overviewQuery.isLoading ? <Callout color="secondary">Loading provider workspace…</Callout> : null}
            {overview?.warnings?.map((warning) => <Callout key={warning} color="yellow">{warning}</Callout>)}

            <section id="provider-workspace-overview" className="scroll-mt-4 space-y-4">
              {overview ? <StatGrid stats={overview.stats} /> : null}
            </section>

            <section id="provider-workspace-activity" className="scroll-mt-4 space-y-3">
              <div>
                <Text variant="title" className="block">Activity</Text>
                <Text variant="small" color="secondary" className="block">Retained deploy, failure, recovery, alert, and incident volume for this provider.</Text>
              </div>
              {activitySeriesItems.length > 0 ? <ChartGrid series={activitySeriesItems} /> : <Callout color="secondary">No retained activity events match this provider and range.</Callout>}
            </section>

            <section id="provider-workspace-analytics" className="scroll-mt-4 space-y-3">
              <div>
                <Text variant="title" className="block">Health</Text>
                <Text variant="small" color="secondary" className="block">Retained status, incident, and alert history scoped to this provider, account, and range.</Text>
              </div>
              {analyticsSeriesItems.length > 0 ? <ChartGrid series={analyticsSeriesItems} /> : <Callout color="secondary">No retained history samples match this provider and range.</Callout>}
            </section>

            <section id="provider-workspace-resources" className="scroll-mt-4 space-y-3">
              <div>
                <Text variant="title" className="block">Inventory</Text>
                <Text variant="small" color="secondary" className="block">Provider-native tables are normalized and secret-free; links open vendor evidence in the browser.</Text>
              </div>
              {filteredResources.map((table) => <ResourceTable key={table.id} table={table} />)}
            </section>

            <section id="provider-workspace-evidence" className="scroll-mt-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <Text variant="title" className="block">Logs and evidence</Text>
                  <Text variant="small" color="secondary" className="block">Retained events, log-capable rows, active signals, incidents, and provider deep links.</Text>
                </div>
                <Badge color="secondary">{filteredEvidence.length}</Badge>
              </div>
              {filteredEvidence.length === 0 ? (
                <Callout color="secondary">No evidence rows match the current provider, range, and search.</Callout>
              ) : (
                <ResponsiveGrid min="20rem">
                  {filteredEvidence.map((row) => <EvidenceRow key={row.id} row={row} />)}
                </ResponsiveGrid>
              )}
            </section>

            <section id="provider-workspace-alerts" className="scroll-mt-4 space-y-3">
              <div>
                <Text variant="title" className="block">Alert templates</Text>
                <Text variant="small" color="secondary" className="block">Templates create normal alert-rule drafts scoped to this provider or selected account.</Text>
              </div>
              <ResponsiveGrid min="20rem">
                {(overview?.alertTemplates ?? []).map((template) => <AlertTemplateRow key={template.id} template={template} />)}
              </ResponsiveGrid>
            </section>

            <section id="provider-workspace-exports" className="scroll-mt-4 rounded-lg border border-separator p-3">
              <Text variant="title" className="block">Exports</Text>
              <Text variant="small" color="secondary" className="mt-1 block">
                Export the current provider workspace as secret-free CSV or JSON. Tokens, webhook URLs, and raw credential config are never included.
              </Text>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="filled" size="small" onClick={() => exportWorkspace("csv")}>
                  <Download className="size-4" />
                  CSV
                </Button>
                <Button variant="filled" size="small" onClick={() => exportWorkspace("json")}>
                  <Download className="size-4" />
                  JSON
                </Button>
              </div>
            </section>

            <section id="provider-workspace-setup" className="scroll-mt-4 space-y-3">
              <div>
                <Text variant="title" className="block">Setup</Text>
                <Text variant="small" color="secondary" className="block">Provider metadata and collection areas are registry-driven and secret-free.</Text>
              </div>
              {providerMeta ? (
                <div className="rounded-lg border border-separator p-3">
                  <Text variant="strong" className="block">Setup reference</Text>
                  <Text variant="small" color="secondary" className="mt-1 block">{providerMeta.scopeHint}</Text>
                  <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full text-left text-sm">
                      <thead className="text-xs uppercase text-tertiary">
                        <tr>
                          <th className="border-b border-separator px-3 py-2 font-medium">Area</th>
                          <th className="border-b border-separator px-3 py-2 font-medium">State</th>
                          <th className="border-b border-separator px-3 py-2 font-medium">Config</th>
                          <th className="border-b border-separator px-3 py-2 font-medium">What populates it</th>
                        </tr>
                      </thead>
                      <tbody>
                        {providerMeta.collectionAreas.map((area) => (
                          <tr key={area.id} className="border-b border-separator/70 last:border-b-0">
                            <td className="px-3 py-2 align-top">
                              <Text variant="small" className="block">{area.label}</Text>
                              <Text variant="small" color="tertiary" className="block">{area.category}</Text>
                            </td>
                            <td className="px-3 py-2 align-top">
                              <Badge color={area.defaultState === "always" ? "green" : area.defaultState === "configured" ? "blue" : "secondary"}>
                                {area.defaultState === "always" ? "Always on" : area.defaultState === "configured" ? "Configured" : "Disabled"}
                              </Badge>
                            </td>
                            <td className="px-3 py-2 align-top text-secondary">{area.configKey ?? ""}</td>
                            <td className="max-w-xl px-3 py-2 align-top text-secondary">{area.guidance}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1">
                    {providerMeta.collectionAreas.map((area) => (
                      <Badge key={area.id} color={area.requiresDashboardCapability ? "blue" : "secondary"}>{area.requiresDashboardCapability ? "dashboard-capable" : area.category}</Badge>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>
          </main>
        </div>
      </RouteBody>
    </RouteSurface>
  );
}
