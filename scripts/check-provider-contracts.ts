import * as fs from "node:fs/promises";
import * as path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const EXPECTED_PROVIDERS = [
  "github",
  "cloudflare",
  "supabase",
  "netlify",
  "resend",
  "grafana",
  "heroku",
  "sentry",
  "pagerduty",
  "statuspage",
  "datadog",
  "honeycomb",
  "posthog",
  "betterstack",
] as const;

const FILTERED_VIEWS = [
  "renderer/main/dashboard-view.tsx",
  "renderer/main/apps-view.tsx",
  "renderer/main/insights-view.tsx",
  "renderer/main/incidents-view.tsx",
  "renderer/main/timeline-view.tsx",
  "renderer/main/uptime-view.tsx",
  "renderer/main/alerts-view.tsx",
  "renderer/main/dashboards-view.tsx",
] as const;

const FILTER_PRESET_VIEWS = [
  "renderer/main/accounts-view.tsx",
  ...FILTERED_VIEWS,
  "renderer/settings/notification-channels.tsx",
] as const;

const DATE_FILTERED_VIEWS = [
  "renderer/main/dashboard-view.tsx",
  "renderer/main/apps-view.tsx",
  "renderer/main/insights-view.tsx",
  "renderer/main/incidents-view.tsx",
  "renderer/main/timeline-view.tsx",
  "renderer/main/uptime-view.tsx",
] as const;

const PROVIDERS_WITH_DASHBOARD_ROW_LINKS = [
  "github",
  "cloudflare",
  "netlify",
  "resend",
  "heroku",
  "sentry",
  "pagerduty",
  "statuspage",
  "datadog",
  "honeycomb",
  "posthog",
  "betterstack",
] as const;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors: string[] = [];

function check(condition: unknown, message: string): void {
  if (!condition) errors.push(message);
}

async function readRepoFile(relativePath: string): Promise<string> {
  return await fs.readFile(path.join(repoRoot, relativePath), "utf-8");
}

async function listSourceFiles(relativeDir: string): Promise<string[]> {
  const root = path.join(repoRoot, relativeDir);
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (!entry.isFile() || !/\.(ts|tsx)$/.test(entry.name)) continue;
      out.push(path.relative(repoRoot, absolute));
    }
  }
  await walk(root);
  return out;
}

function countMatches(source: string, pattern: RegExp): number {
  return [...source.matchAll(pattern)].length;
}

function checkIncludesAll(source: string, snippets: string[], message: string): void {
  const missing = snippets.filter((snippet) => !source.includes(snippet));
  check(missing.length === 0, missing.length === 0 ? message : `${message}; missing ${missing.map((snippet) => JSON.stringify(snippet)).join(", ")}`);
}

function providerVariableName(provider: string): string {
  return `${provider.replace(/(^|-)([a-z])/g, (_match: string, _prefix: string, letter: string) => letter.toUpperCase()).replace(/^./, (letter) => letter.toLowerCase())}Provider`;
}

async function checkProviderModule(provider: string): Promise<void> {
  const source = await readRepoFile(`main/services/providers/${provider}.ts`);
  check(source.includes(`id: "${provider}"`), `${provider}.ts missing ProviderDefinition id "${provider}"`);
  check(source.includes("label:"), `${provider}.ts missing label`);
  check(source.includes("scopeHint:"), `${provider}.ts missing scopeHint`);
  check(source.includes("fields:"), `${provider}.ts missing credential fields`);
  check(source.includes("validate(") || source.includes("validate:"), `${provider}.ts missing validate implementation`);
  check(source.includes("fetch(") || source.includes("fetch:"), `${provider}.ts missing fetch implementation`);

  const secretCount = countMatches(source, /secret:\s*true/g);
  check(secretCount === 1, `${provider}.ts expected exactly one secret credential field, found ${secretCount}`);
  check(/type:\s*"password"[\s\S]*?secret:\s*true|secret:\s*true[\s\S]*?type:\s*"password"/.test(source), `${provider}.ts secret field must use password input`);

  const hasCapabilityLoader = source.includes("getDashboardQueryCapabilities");
  const hasQueryRunner = source.includes("runDashboardQuery");
  check(hasCapabilityLoader === hasQueryRunner, `${provider}.ts dashboard capability loader and query runner must be declared together`);
}

async function main(): Promise<void> {
  const providerIndex = await readRepoFile("main/services/providers/index.ts");
  const backendTypes = await readRepoFile("main/services/types.ts");
  const rendererTypes = await readRepoFile("renderer/main/types.ts");
  const providerMeta = await readRepoFile("renderer/main/components/provider-meta.tsx");
  const readme = await readRepoFile("README.md");
  const agentsDoc = await readRepoFile("AGENTS.md");
  const registry = await readRepoFile("main/services/providers/registry.ts");
  const dashboardStore = await readRepoFile("main/services/dashboard-store.ts");
  const dashboardHandlers = await readRepoFile("main/handlers/dashboards.ts");
  const dashboardRunner = await readRepoFile("main/services/dashboard-query-runner.ts");
  const accountsView = await readRepoFile("renderer/main/accounts-view.tsx");
  const mainDashboardView = await readRepoFile("renderer/main/dashboard-view.tsx");
  const appsView = await readRepoFile("renderer/main/apps-view.tsx");
  const dashboardsView = await readRepoFile("renderer/main/dashboards-view.tsx");
  const dashboardsHook = await readRepoFile("renderer/main/hooks/use-dashboards.ts");
  const filtersComponent = await readRepoFile("renderer/main/components/filters.tsx");
  const historyHandlers = await readRepoFile("main/handlers/history.ts");
  const historyStore = await readRepoFile("main/services/history-store.ts");
  const alertsView = await readRepoFile("renderer/main/alerts-view.tsx");
  const insightsView = await readRepoFile("renderer/main/insights-view.tsx");
  const incidentsView = await readRepoFile("renderer/main/incidents-view.tsx");
  const timelineView = await readRepoFile("renderer/main/timeline-view.tsx");
  const uptimeView = await readRepoFile("renderer/main/uptime-view.tsx");
  const rendererIpc = await readRepoFile("renderer/main/ipc.ts");
  const settingsView = await readRepoFile("renderer/settings/settings-view.tsx");
  const notificationChannelsView = await readRepoFile("renderer/settings/notification-channels.tsx");
  const handlersIndex = await readRepoFile("main/handlers/index.ts");
  const setupHandlers = await readRepoFile("main/handlers/setup.ts");
  const router = await readRepoFile("renderer/main/router.tsx");
  const rootView = await readRepoFile("renderer/main/root-view.tsx");
  const commandCenterView = await readRepoFile("renderer/main/command-center-view.tsx");
  const commandPalette = await readRepoFile("renderer/main/components/command-palette.tsx");
  const monitorDataHook = await readRepoFile("renderer/main/hooks/use-monitor-data.ts");

  check(registry.includes("secretField"), "registry.ts must expose secretField() for the token-store boundary");
  check(registry.includes("publicList"), "registry.ts must expose publicList() for renderer-safe provider metadata");
  check(!registry.includes("getToken("), "registry.ts must not read provider tokens");
  check(!/from\s+["']\.\/token-store\.js["']/.test(dashboardStore), "dashboard-store.ts must not import token-store");
  check(!dashboardStore.includes("getToken("), "dashboard-store.ts must not read provider tokens");
  check(dashboardStore.includes('new DataStore<DashboardsFile>("dashboards.json"'), "dashboard-store.ts must persist dashboards to dashboards.json");
  check(backendTypes.includes("interface DashboardVariables") && rendererTypes.includes("interface DashboardVariables"), "dashboard types must include persisted DashboardVariables on both backend and renderer");
  check(backendTypes.includes("refreshSeconds?: number;\n  order: number;") && rendererTypes.includes("refreshSeconds?: number;\n  order: number;"), "dashboard panel types must include optional panel-level refreshSeconds");
  check(dashboardStore.includes("function hasScopeFields") && dashboardStore.includes("const variables = normalizeScopeFields(asRecord(input.variables))") && dashboardStore.includes("variables: hasScopeFields(variables) ? variables : undefined"), "dashboard-store.ts must normalize persisted dashboard variables and omit empty variable objects");
  check(dashboardStore.includes("raw.refreshSeconds") && dashboardStore.includes("raw.refreshSeconds >= 15"), "dashboard-store.ts must normalize panel-level refreshSeconds with the same minimum as dashboard refresh");
  check(dashboardStore.includes("shouldPersistMigration") && dashboardStore.includes("initial.dashboards.length === 0"), "dashboard-store.ts must persist Grafana preset migration only on the first empty-dashboard migration pass");
  check(dashboardStore.includes("parseObservabilityConfig(account.config?.grafanaObservability)") && dashboardStore.includes("importedGrafanaPanels(account.id, account.config?.grafanaObservability)"), "dashboard-store.ts must migrate saved Grafana observability presets without deleting account config");
  check(dashboardStore.includes("for (const preset of config.logPresets)") && dashboardStore.includes('capabilityId: "grafana.loki"') && dashboardStore.includes('visualization: "logs"') && dashboardStore.includes("query: preset.query"), "dashboard-store.ts must migrate Grafana LogQL presets into Loki log panels with the saved query");
  check(dashboardStore.includes("for (const preset of config.tracePresets)") && dashboardStore.includes('capabilityId: "grafana.tempo"') && dashboardStore.includes('visualization: "traces"') && dashboardStore.includes("query: preset.query"), "dashboard-store.ts must migrate Grafana TraceQL presets into Tempo trace panels with the saved query");
  check(dashboardStore.includes("preset.datasourceUid ? { datasourceUid: preset.datasourceUid } : {}"), "dashboard-store.ts must preserve optional Grafana preset datasource UIDs in migrated dashboard panels");
  check(dashboardHandlers.includes("secretsIncluded: false"), "dashboard export/import handlers must declare secretsIncluded: false");
  check(dashboardHandlers.includes("sourcePanels.length > 0 && panels.length === 0"), "dashboard import must preserve intentionally empty dashboards while skipping only dashboards whose provided panels all fail remapping");
  check(dashboardHandlers.includes("addSourceRefs(dashboard.variables") && dashboardHandlers.includes("function remapVariables") && dashboardHandlers.includes("variables: remapVariables"), "dashboard export/import must include and remap dashboard variable account/group/check references");
  check(setupHandlers.includes("customDashboards.filters.v2") && setupHandlers.includes("notificationChannels.filters.v1") && setupHandlers.includes("sanitizedFilters"), "setup import/export must allowlist current persisted filter keys without copying arbitrary localStorage");
  check(setupHandlers.includes("function remapDashboardVariables") && setupHandlers.includes("variables: remapDashboardVariables"), "portable setup import must remap persisted dashboard variables");
  check(setupHandlers.includes("dashboard.variables && !scopeCompatible") && setupHandlers.includes("dashboard.variables?.groupId"), "portable setup export must include only compatible dashboard variables and their referenced groups");
  check(setupHandlers.includes("sourcePanels.length > 0 && panels.length === 0"), "portable setup import must preserve intentionally empty dashboards while skipping only dashboards whose provided panels all fail remapping");
  for (const localCapability of ["local.successFailure", "local.statusCounts", "local.incidentsAlerts", "local.events", "local.failures", "local.deploys", "local.alertEvents", "local.snapshotCounts", "local.checkLatency", "local.checkUptime"]) {
    check(dashboardRunner.includes(`id: "${localCapability}"`) && dashboardRunner.includes("defaultPanel"), `dashboard-query-runner.ts must expose default local dashboard panel ${localCapability}`);
  }
  check(dashboardRunner.includes('source: { kind: "local", metric: "events", eventTypes: ["failure"] }'), "dashboard-query-runner.ts must expose a one-click recent failures default panel");
  check(dashboardRunner.includes('source: { kind: "local", metric: "events", eventTypes: ["deploy"] }'), "dashboard-query-runner.ts must expose a one-click deploys/releases default panel");
  check(dashboardRunner.includes('source: { kind: "local", metric: "events", eventTypes: ["alert", "incident"] }'), "dashboard-query-runner.ts must expose a one-click alerts/incidents default panel");
  check(dashboardRunner.includes("function aggregateCounts") && dashboardRunner.includes("const rows = Object.values(sample.perAccount)") && dashboardRunner.includes("for (const status of STATUSES) counts[status] += row.counts[status]") && dashboardRunner.includes("return aggregateCounts(sample)"), "dashboard-query-runner.ts must preserve all normalized statuses in unscoped local status-count panels");
  check(dashboardRunner.includes("const matchingAccounts = accounts.filter((account) => accountMatchesSource(account, source, metadataByService))") && dashboardRunner.includes("const providers = new Set(matchingAccounts.map((account) => account.provider))"), "dashboard-query-runner.ts snapshot count panels must count scoped providers/accounts even when there are no current items");
  check(dashboardRunner.includes("appendCountBreakdown(stats, \"Provider\", providerCounts, providerLabels)") && dashboardRunner.includes("appendCountBreakdown(stats, \"Group\", groupCounts, groupLabels)") && dashboardRunner.includes("appendCountBreakdown(stats, \"Account\", accountCounts, accountLabels)"), "dashboard-query-runner.ts snapshot count panels must include capped provider/group/account breakdown stats");
  check(historyHandlers.includes('"history:clear"'), "history handlers must register history:clear");
  check(historyHandlers.includes("clearRetainedHistory"), "history:clear must delegate to clearRetainedHistory()");
  check(historyHandlers.includes('"history:prune"'), "history handlers must register history:prune");
  check(historyHandlers.includes("pruneRetainedHistory"), "history:prune must delegate to pruneRetainedHistory()");
  check(historyHandlers.includes('"sourceUid"') && historyHandlers.includes('"category"'), "history event CSV export must include filter evidence columns sourceUid and category");
  check(historyStore.includes("export async function clearRetainedHistory"), "history-store.ts must expose clearRetainedHistory()");
  check(historyStore.includes("export async function pruneRetainedHistory"), "history-store.ts must expose pruneRetainedHistory()");
  check(historyStore.includes("samples: [], events: [], checkSamples: []"), "clearRetainedHistory() must clear samples, events, and check samples");
  check(historyStore.includes("store.sizeBytes()"), "history stats must include history.json storage size");
  check(filtersComponent.includes("export function DateRangeFilter"), "filters.tsx must expose shared DateRangeFilter");
  check(filtersComponent.includes("export function FilterDateRangeField"), "filters.tsx must expose FilterDateRangeField");
  for (const range of ["15m", "1h", "6h", "24h", "7d", "14d"]) {
    check(filtersComponent.includes(`value: "${range}"`), `filters.tsx missing ${range} date range preset`);
  }
  check(filtersComponent.includes('value="custom"'), "DateRangeFilter must expose a custom range option");
  check(filtersComponent.includes('type="datetime-local"'), "DateRangeFilter must use native custom from/to datetime inputs");
  check(filtersComponent.includes("retainedHistoryDateBounds"), "filters.tsx must expose retained history date bounds");
  check(filtersComponent.includes("clampDateTimeLocal"), "DateRangeFilter must clamp custom values to provided bounds");
  checkIncludesAll(filtersComponent, [
    "function useFilterPresets",
    "const defaultStorageKey = storageKey ? `${storageKey}.default` : undefined;",
    "savePreset:",
    "renamePreset:",
    "updatePreset:",
    "deletePreset:",
    "setDefaultPreset",
    "const didApplyDefault = useRef(false);",
    "filterStorageKey && localStorage.getItem(filterStorageKey)",
    "onApplyPreset(defaultPreset.value)",
  ], "filters.tsx must persist saved filter presets, pinned defaults, update/rename/delete actions, and apply pinned defaults only when no tab filter state exists");
  checkIncludesAll(setupHandlers, [
    "accounts.filters.v1.presets.default",
    "dashboard.filters.v2.presets.default",
    "apps.filters.v1.presets.default",
    "insights.filters.v2.presets.default",
    "incidents.filters.v1.presets.default",
    "timeline.filters.v1.presets.default",
    "uptime.filters.v1.presets.default",
    "alerts.filters.v1.presets.default",
    "customDashboards.filters.v2.presets.default",
    "notificationChannels.filters.v1.presets.default",
  ], "setup import/export must allowlist saved filter preset arrays and pinned default preset ids for every filter surface");
  check(filtersComponent.includes("min={bounds?.min}") && filtersComponent.includes("max={bounds?.max}"), "DateRangeFilter must pass retained-history bounds to datetime inputs");
  check(filtersComponent.includes("max: toDateTimeLocal(now)"), "retained history date bounds must allow current custom date ranges up to now");
  check(filtersComponent.includes("if (from !== value.from || to !== value.to) onChange({ ...value, from, to })"), "DateRangeFilter must normalize stored custom ranges when retained-history bounds change");
  check(historyHandlers.includes("req.dateRange ? historyDateRange(req.dateRange) : historyRange(req.range)"), "history handlers must accept custom dateRange payloads");
  check(historyHandlers.includes('"history:getSeries"') && historyHandlers.includes("groupId: asOptionalString(req.groupId)") && historyHandlers.includes("accountId: asOptionalString(req.accountId)") && historyHandlers.includes("provider: asOptionalString(req.provider)"), "history:getSeries must support group/provider/account scoping");
  for (const field of ["groupId", "provider", "accountId", "status", "severity", "category", "types"]) {
    check(historyHandlers.includes(`${field}:`), `history:getEvents must support ${field} filtering`);
  }
  check(historyHandlers.includes("const groupId = asOptionalString(req.groupId)") && historyHandlers.includes("const provider = asOptionalString(req.provider)") && historyHandlers.includes("await getSeries(range, { groupId, accountId, provider })") && historyHandlers.includes("await getEvents({"), "history:export must preserve retained-history scope filters");
  check(historyStore.includes('import { listAccounts } from "./accounts-store.js"') && historyStore.includes("async function currentAccountGroups()") && historyStore.includes("event.groupId ?? accountGroups?.get(event.accountId)") && historyStore.includes("row.groupId ?? accountGroups?.get(accountId)"), "history-store.ts must use current account groups as fallback for retained rows missing groupId");
  check(historyStore.includes("sampleAccountGroupId(accountId, row, filters.accountGroups) !== filters.groupId"), "history-store.ts getSeries must apply group filters with account-derived group fallback");
  check(historyStore.includes("eventGroupId(event, accountGroups) === filters.groupId"), "history-store.ts getEvents must apply group filters with account-derived group fallback");
  check(historyStore.includes("data.slos.some((slo) => Boolean(slo.scope.groupId)) ? await currentAccountGroups() : undefined"), "history-store.ts SLO status must use account-derived group fallback for group-scoped SLOs");
  check(dashboardRunner.includes("row.groupId ?? accountsById.get(accountId)?.groupId") && dashboardRunner.includes("const groupId = event.groupId ?? accountsById.get(event.accountId)?.groupId"), "dashboard-query-runner.ts local panels must use account-derived group fallback for scoped history rows and event metadata");
  for (const predicate of ["event.provider === filters.provider", "event.accountId === filters.accountId", "event.status === filters.status", "event.severity === filters.severity", "(event.category ?? typeCategory(event.type)) === filters.category", "filters.types.includes(event.type)"]) {
    check(historyStore.includes(predicate), `history-store.ts getEvents must apply predicate ${predicate}`);
  }
  check(dashboardRunner.includes("__url: event.url"), "local dashboard event rows must carry hidden __url metadata");
  check(dashboardRunner.includes('__urlLabel: "Open event"'), "local dashboard event rows must label hidden links");
  check(dashboardsView.includes("!column.startsWith(\"__\")"), "dashboard table renderer must hide hidden __ metadata columns");
  check(dashboardsView.includes("row.__url") && dashboardsView.includes("monitorApi.openExternal"), "dashboard table renderer must open row links through monitorApi.openExternal");
  check(dashboardsView.includes('result.kind === "table" || result.kind === "events" || result.kind === "logs" || result.kind === "traces"') && dashboardsView.includes("<TablePanel result={result} />"), "dashboards-view.tsx must render table, event, log, and trace results through the shared row-link table renderer");
  check(dashboardsView.includes("downloadRowsCsv(`${safeTitle}-rows.csv`, columns, sortedRows)") && dashboardsView.includes("(rows ?? []).map((row) => columns.map((column) => row[column]))"), "dashboard table CSV export must use visible columns and omit hidden row-link metadata");
  check(dashboardsView.includes("row.__urlLabel") && dashboardsView.includes("aria-label={typeof row.__urlLabel === \"string\" ? row.__urlLabel : \"Open row\"}"), "dashboard row open actions must use hidden row-link labels when present");
  check(dashboardsHook.includes("retry: false"), "dashboard panel queries must not retry invalid custom provider queries automatically");
  check(dashboardsView.includes("scopedPanel") && dashboardsView.includes("panel.source.kind !== \"local\""), "dashboard runtime filters must only rewrite local panels");
  check(dashboardsView.includes("runtimeFiltersToVariables") && dashboardsView.includes("mergeDashboardVariables") && dashboardsView.includes("Variables apply to local dashboard panels"), "dashboards-view.tsx must let users persist dashboard variables and apply them to local panels");
  check(dashboardsView.includes("Panel refresh") && dashboardsView.includes("panel.refreshSeconds ?? dashboard.refreshSeconds"), "dashboards-view.tsx must expose and use panel-level refresh overrides");
  check(dashboardsView.includes("panel.source.groupId ??") && dashboardsView.includes("panel.source.accountId ??") && dashboardsView.includes("panel.source.checkId ??"), "dashboard runtime filters must respect narrower saved local panel scope");
  check(dashboardsView.includes('const supportsCheckFilter = panel.source.metric === "checkLatency" || panel.source.metric === "checkUptime"') &&
    dashboardsView.includes("supportsCheckFilter && filters.check !== ALL ? filters.check : undefined"),
  "dashboard runtime check filters must only scope local uptime check panels that can actually honor check IDs");
  check(dashboardsView.includes('if (types.length === 1 && types[0] === "failure") return "local.failures"') &&
    dashboardsView.includes('if (types.length === 1 && types[0] === "deploy") return "local.deploys"') &&
    dashboardsView.includes('if (types.includes("alert") && types.includes("incident")) return "local.alertEvents"') &&
    dashboardsView.includes("capability.id === localCapabilityId(source)") &&
    dashboardsView.includes("localCapabilityId(source) === localCapabilityId(defaultSource)"),
  "dashboards-view.tsx must preserve event-specific local default panel identity when selecting and reopening failures/deploys/alert-event panels");
  checkIncludesAll(dashboardsView, [
    "function DashboardDialog",
    "function PanelDialog",
    "Default panels",
    "Custom query",
    "defaultCapabilities",
    "customCapabilities",
    "function withDefaultCheckId",
    "panel.source.metric !== \"checkLatency\" && panel.source.metric !== \"checkUptime\"",
    "const defaultCheckId = checksQuery.data?.[0]?.id",
    "emptyPanel(capability, mode === \"default\", defaultCheckId)",
    "const updateLocalScope",
    "const updateProviderParam",
    "const updateProviderMapping",
    "const updatePanelRange",
    "const updatePanelRefresh",
    "Panel title",
    "Visualization",
    "Panel range",
    "Panel refresh",
    'SelectItem value="half">Half',
    'SelectItem value="full">Full',
    'SelectItem value="small">Small',
    'SelectItem value="medium">Medium',
    'SelectItem value="large">Large',
    "queryLanguage ?? \"Query\"",
    "xField",
    "yField",
    "providerParams.map",
    "eventTypes: ordered.length > 0 ? ordered : undefined",
    "panels: [...existing, nextPanel].sort((a, b) => a.order - b.order).map((candidate, index) => ({ ...candidate, order: index }))",
    "const savePanelOrder = async",
    "[next[index], next[target]] = [next[target], next[index]]",
    "canMoveUp={orderIndex > 0}",
    "canMoveDown={orderIndex >= 0 && orderIndex < panels.length - 1}",
    'panel.width === "full" ? "lg:col-span-2" : ""',
    'aria-label="Edit panel"',
    'aria-label="Delete panel"',
    'aria-label="Duplicate panel"',
    'aria-label="Copy panel to another dashboard"',
    "Create another dashboard before copying panels between dashboards.",
    "deleteDashboard",
    "duplicateDashboard",
    "Dashboard created from template",
  ], "dashboards-view.tsx must preserve the v1 fixed-grid dashboard builder: dashboard CRUD/templates, panel add/edit/delete, reordering, layout, range/refresh, default panels, custom queries, mappings, and copy/duplicate actions");
  check(alertsView.includes("simulateRuleFromSamples") && alertsView.includes("24h tuning context") && alertsView.includes("historyBreaches24h"), "alerts-view.tsx must surface retained-history tuning context for alert rules and exports");
  check(alertsView.includes("suggestThreshold") && alertsView.includes("Use suggestion") && alertsView.includes("suggestionBasis"), "alerts-view.tsx must offer retained-history threshold suggestions in the rule editor");
  check(alertsView.includes("historySuggestedThreshold24h") && alertsView.includes("Suggest {formatRuleValue"), "alerts-view.tsx must surface retained-history threshold suggestions in the rule list and export");
  check(alertsView.includes("applySuggestedThreshold") && alertsView.includes('Update "${rule.name}" threshold'), "alerts-view.tsx must let rule rows apply retained-history threshold suggestions with confirmation");
  check(insightsView.includes("No history matches filters") && insightsView.includes("No history yet"), "insights-view.tsx must distinguish no retained history from filter misses");
  check(!router.includes('path: "/grafana"'), "router.tsx must not expose the old /grafana route");
  check(!rootView.includes('path: "/grafana"'), "root-view.tsx must not expose the old Grafana sidebar item");
  check(!commandPalette.includes('"/grafana"') && !commandPalette.includes("'/grafana'"), "command-palette.tsx must not expose the old Grafana route");
  check(router.includes("CommandCenterView") && router.includes('path: "/"') && router.includes('path: "/dashboard"'), "router.tsx must expose Command Center at / and preserve the live Dashboard at /dashboard");
  check(rootView.includes('label: "Command Center"') && rootView.includes('path: "/dashboard"'), "root-view.tsx must expose Command Center and the preserved Dashboard route");
  check(commandPalette.includes('label: "Command Center"') && commandPalette.includes('to: "/dashboard"'), "command-palette.tsx must expose Command Center and send dashboard item logs to /dashboard");
  check(commandCenterView.includes("useMonitorData") && commandCenterView.includes("useHistoryEvents") && commandCenterView.includes("useRuleStates"), "command-center-view.tsx must summarize real monitor, retained-history, and alert-rule state");
  check(commandCenterView.includes("openFirstIssue") && commandCenterView.includes("accounts.select.v1") && commandCenterView.includes("uptime.drilldown.v1") && commandCenterView.includes("alerts.select.v1") && commandCenterView.includes("dashboard.item.select.v1") && commandCenterView.includes("incidents.drilldown.v1") && commandCenterView.includes("timeline.drilldown.v1"), "command-center-view.tsx must hand off suggested actions and issue rows to scoped destination views");
  check(commandCenterView.includes("const groupId = event.groupId ?? accountsById.get(event.accountId)?.groupId") && commandCenterView.includes("group: groupId ?? \"all\""), "command-center-view.tsx retained-history activity drilldowns must use account-derived group fallback");
  check(commandCenterView.includes("allFailedItems") && commandCenterView.includes("visibleFailedItems") && commandCenterView.includes("Showing {visibleRecentActivity.length} of {allRecentActivity.length}"), "command-center-view.tsx must count full issue/activity totals separately from capped visible rows");
  check(monitorDataHook.includes("useMonitorSettings") && monitorDataHook.includes("settings:monitor-changed") && commandCenterView.includes("SuppressionStatus") && commandCenterView.includes("Notification suppression") && commandCenterView.includes("activeMaintenanceWindows") && commandCenterView.includes("activeRuleSnoozes") && commandCenterView.includes("Rule snoozed until"), "command-center-view.tsx must surface active notification suppression from monitor settings and per-rule snoozes");
  check(commandCenterView.includes("AlertRuleRow") && commandCenterView.includes("visibleFiringRules") && commandCenterView.includes("Firing alert rules") && commandCenterView.includes("current {formatRuleValue"), "command-center-view.tsx must show row-level firing alert-rule evidence in the current issue surface");
  check(commandCenterView.includes("useSloStatus") && commandCenterView.includes("allAtRiskSlos") && commandCenterView.includes("SLO risk") && commandCenterView.includes("insights.filters.v2"), "command-center-view.tsx must surface retained-history SLO risk and route it to Insights");
  check(commandCenterView.includes("SloRiskRow") && commandCenterView.includes("visibleAtRiskSlos") && commandCenterView.includes("SLOs at risk") && commandCenterView.includes("burn {formatBurnRate"), "command-center-view.tsx must show row-level SLO risk evidence in the current issue surface");
  check(commandPalette.includes("Run smoke verification"), "command-palette.tsx must expose smoke verification");
  check(commandPalette.includes("accounts.verify.v1"), "command-palette.tsx must write the smoke verification handoff key");
  checkIncludesAll(readme, [
    "Command Center at `/`",
    "detailed grouped live account dashboard at `/dashboard`",
    "Custom Dashboards at `/dashboards`",
    "local normalized data panels",
    "provider-declared live query panels",
    "row links",
    "persisted per-tab filters and saved filter presets",
    "old dedicated Grafana tab and `/grafana` route have been replaced",
    "Grafana account config and saved Loki/Tempo presets are preserved",
    "npm run test:contracts",
    "npm run type-check",
    "npm run lint",
    "npm run build",
    "renderer `localStorage`: per-tab filter state, saved filter presets, and one-shot navigation/deep-link payloads",
  ], "README.md must describe the current Command Center, Custom Dashboards, filters, Grafana replacement, validation commands, and runtime data boundaries");
  checkIncludesAll(handlersIndex, [
    "registerAccountHandlers();",
    "registerChannelHandlers();",
    "registerCheckHandlers();",
    "registerDashboardHandlers();",
    "registerDiagnosticHandlers();",
    "registerGrafanaHandlers();",
    "registerHistoryHandlers();",
    "registerLocalIncidentHandlers();",
    "registerMonitorHandlers();",
    "registerProviderHandlers();",
    "registerRuleHandlers();",
    "registerServiceHandlers();",
    "registerSetupHandlers();",
    "registerTriageHandlers();",
    "registerVerificationHandlers();",
  ], "main/handlers/index.ts must register every implemented IPC handler group");
  checkIncludesAll(rendererIpc, [
    'invoke<AccountDiagnostic[]>("diagnostics:listAccounts")',
    'invoke<AccountDiagnostic>("diagnostics:runAccount"',
    'invoke<VerificationReport>("verification:run"',
    'invoke<ServiceMetadata[]>("services:listMetadata")',
    'invoke<ServiceMetadata>("services:saveMetadata"',
    'invoke<{ ok: true }>("services:deleteMetadata"',
    'invoke<DashboardDefinition[]>("dashboards:list")',
    'invoke<DashboardDefinition>("dashboards:save"',
    'invoke<{ ok: true }>("dashboards:delete"',
    'invoke<{ ok: boolean; filePath?: string }>("dashboards:export"',
    'invoke<{ imported: number; skipped: number; panelsSkipped: number; filePath?: string }>("dashboards:import")',
    'invoke<DashboardQueryCapability[]>("dashboards:listCapabilities")',
    'invoke<DashboardPanelResult>("dashboards:runPanel"',
    'invoke<HistorySample[]>("history:getSeries"',
    'invoke<HistoryEvent[]>("history:getEvents"',
    'invoke<HistoryStats>("history:getStats")',
    'invoke<SloDefinition[]>("history:listSlos")',
    'invoke<SloDefinition>("history:saveSlo"',
    'invoke<{ ok: true }>("history:deleteSlo"',
    'invoke<SloStatus[]>("history:getSloStatus")',
    'invoke<{ ok: boolean; filePath?: string }>("history:export"',
    'invoke<HistoryStats>("history:clear")',
    'invoke<HistoryStats>("history:prune")',
    'invoke<HttpCheck[]>("checks:list")',
    'invoke<HttpCheck>("checks:save"',
    'invoke<{ ok: true }>("checks:delete"',
    'invoke<CheckSeries>("checks:getLatencySeries"',
    'invoke<AlertRule[]>("rules:list")',
    'invoke<AlertRule>("rules:save"',
    'invoke<{ ok: true }>("rules:delete"',
    'invoke<RuleState[]>("rules:getState")',
    'invoke<RulePreview>("rules:preview"',
    'invoke<RulePreview>("rules:testDelivery"',
    'invoke<Record<string, TriageState>>("triage:list")',
    'invoke<TriageState>("triage:acknowledge"',
    'invoke<TriageState>("triage:silence"',
    'invoke<{ ok: true }>("triage:clear"',
    'invoke<LocalIncident[]>("localIncidents:list")',
    'invoke<LocalIncident>("localIncidents:save"',
    'invoke<LocalIncident>("localIncidents:updateStatus"',
    'invoke<{ ok: true }>("localIncidents:delete"',
    'invoke<{ ok: boolean; filePath?: string }>("localIncidents:export"',
    'invoke<{ ok: true }>("monitor:openExternal"',
  ], "renderer/main/ipc.ts must expose typed wrappers for dashboard/history/check/rule/triage/local-incident/service IPC and safe external opening");
  checkIncludesAll(settingsView, [
    'window.glazeAPI.glaze.ipc.invoke("window:closeSettings")',
    'invoke<HistoryStats>("history:getStats")',
    'invoke<MonitorSettings>("monitor:getSettings")',
    'invoke<AccountOption[]>("accounts:list")',
    'invoke<GroupOption[]>("groups:list")',
    'invoke<ProviderOption[]>("providers:list")',
    'invoke<CheckOption[]>("checks:list")',
    'invoke<MonitorSettings>("monitor:updateSettings"',
    'invoke<HistoryStats>("history:clear")',
    'invoke<HistoryStats>("history:prune")',
  ], "settings-view.tsx must wire its separate settings bundle to settings/history/scope-option IPC channels");
  checkIncludesAll(notificationChannelsView, [
    'invoke<ChannelView[]>("channels:list")',
    'invoke<ChannelView>("channels:save"',
    'invoke("channels:test"',
    'invoke("channels:delete"',
    "hasUrl",
  ], "notification-channels.tsx must wire channel list/save/test/delete without reading webhook URLs");
  checkIncludesAll(accountsView, [
    'const FILTER_KEY = "accounts.filters.v1";',
    'const FILTER_PRESET_KEY = `${FILTER_KEY}.presets`;',
    "search: string;",
    "provider: string;",
    "group: string;",
    'enabled: "all" | "enabled" | "disabled";',
    'diagnostic: DiagnosticStatus | "all";',
    'token: "all" | "present" | "missing";',
    'dashboardSupport: "all" | "liveSupported" | "localOnly" | "liveAvailable" | "liveUnavailable";',
    "const filteredAccounts = accounts.filter",
    "if (!haystack.includes(search)) return false;",
    "filters.provider !== ALL && account.provider !== filters.provider",
    "filters.group !== ALL && groupId !== filters.group",
    "filters.enabled === \"enabled\" && !account.enabled",
    "filters.diagnostic !== \"all\" && diagnostic?.status !== filters.diagnostic",
    "filters.token === \"present\" && !diagnostic?.hasToken",
    "filters.dashboardSupport === \"liveSupported\" && !dashboardSupport?.providerSupportsLive",
    "filters.dashboardSupport === \"liveAvailable\" && !dashboardSupport?.available",
    "collectSetupFilters()",
    "restoreSetupFilters(result.uiFilters)",
  ], "accounts-view.tsx must persist account filters, apply diagnostics/token/dashboard-support predicates, and include filter presets in portable setup");
  checkIncludesAll(notificationChannelsView, [
    'const FILTER_KEY = "notificationChannels.filters.v1";',
    'const FILTER_PRESET_KEY = `${FILTER_KEY}.presets`;',
    "search: string;",
    'type: "all" | ChannelType;',
    'enabled: "all" | "enabled" | "disabled";',
    'url: "all" | "configured" | "missing";',
    'event: "all" | DispatchEventKind;',
    "const filteredChannels = channels.filter",
    "if (!haystack.includes(search)) return false;",
    "filters.type !== ALL && channel.type !== filters.type",
    "filters.enabled === \"enabled\" && !channel.enabled",
    "filters.url === \"configured\" && !channel.hasUrl",
    "filters.event !== \"all\" && !channel.events.includes(filters.event)",
    "downloadChannelsCsv(filteredChannels)",
  ], "notification-channels.tsx must persist and apply search/type/state/url/event filters without exporting webhook URLs");
  checkIncludesAll(agentsDoc, [
    "app:getInfo/getProjectPath",
    "setup:export/import",
    "remaps dashboard panel sources/variables",
    "preserves intentionally empty dashboards",
    "channels:list/save/delete/test",
    "window:openSettings/closeSettings",
    "group filters fall back to current local account group metadata",
    "history:listSlos/saveSlo/deleteSlo/getSloStatus",
    "checks:list/save/delete/getLatencySeries",
    "rules:list/save/delete/getState/preview/testDelivery",
    "triage:list/acknowledge/silence/clear",
    "dashboards:list/save/delete/export/import/listCapabilities/runPanel",
  ], "AGENTS.md must keep the current IPC summary in sync with registered handlers");

  checkIncludesAll(mainDashboardView, [
    "dateRange: ReturnType<typeof defaultDateRange>;",
    "account: string;",
    "status: StatusFilter;",
    'category: "all" | MonitorCategory;',
    "range: filters.dateRange",
    "groupId: undefined,",
    "matchesDateRange(item.updatedAt, filters.dateRange)",
    "function matchesEventGroup",
    "const groupId = event.groupId ?? account?.groupId",
    "matchesEventGroup(event, account, groupsById, filters.group)",
    "const activityEvents = (eventQuery.data ?? []).filter",
    "Activity in range",
  ], "dashboard-view.tsx must implement main Dashboard date/account/status/category filters plus history-backed activity with account-derived group fallback");
  checkIncludesAll(appsView, [
    "dateRange: ReturnType<typeof defaultDateRange>;",
    'provider: "all" | Provider;',
    "account: string;",
    'health: "all" | NormalizedStatus;',
    'stale: "all" | "stale" | "fresh";',
    "filters.stale === \"stale\"",
    "matchesDateRange(incident.updatedAt, filters.dateRange)",
    "matchesDateRange(signal.updatedAt, filters.dateRange)",
    "matchesDateRange(summary.updatedAt, filters.dateRange)",
    "matchesDateRange(item.updatedAt, filters.dateRange)",
  ], "apps-view.tsx must implement group/provider/account/health/stale filters and date-filter live sections");
  checkIncludesAll(insightsView, [
    "dateRange: ReturnType<typeof defaultDateRange>;",
    'provider: "all" | Provider;',
    "account: string;",
    "useHistorySeries(filters.dateRange, {",
    "groupId: filters.group === ALL ? undefined : filters.group",
    "accountId: filters.account === ALL ? undefined : filters.account",
    "provider: filters.provider === ALL ? undefined : filters.provider",
    "useHistoryEvents({",
    "function sampleAccountGroupId",
    "row.groupId ?? accountsById.get(accountId)?.groupId",
    "sampleAccountGroupId(accountId, row, accountsById) !== filters.group",
    "No history matches filters",
  ], "insights-view.tsx must use shared date ranges and scoped retained-history series/events with account-derived group fallback");
  checkIncludesAll(incidentsView, [
    "dateRange: ReturnType<typeof defaultDateRange>;",
    "severity: SeverityFilter;",
    "status: StatusFilter;",
    'kind: KindFilter;',
    "range: filters.dateRange",
    "matchesDateRange(incident.updatedAt, filters.dateRange)",
    "matchesDateRange(item.updatedAt, filters.dateRange)",
    "const groupId = event.groupId ?? accountsById.get(event.accountId)?.groupId",
    "group: groupId ?? ALL",
    "events={historyQuery.data ?? []}",
  ], "incidents-view.tsx must implement date/severity/status/kind/scope filters and use the selected range for detail timelines with account-derived group fallback");
  checkIncludesAll(timelineView, [
    "dateRange: ReturnType<typeof defaultDateRange>;",
    'type: "all" | HistoryEventType;',
    'status: "all" | NormalizedStatus | IncidentStatus;',
    'severity: "all" | ObservabilitySeverity;',
    'category: "all" | MonitorCategory;',
    "types: toSingleEventType(filters.type)",
    "status: filters.status === ALL ? undefined : filters.status",
    "severity: filters.severity === ALL ? undefined : filters.severity",
    "category: filters.category === ALL ? undefined : filters.category",
    "accountsById: Map<string, Account>;",
    "event.groupId ?? accountsById.get(event.accountId)?.groupId ?? \"ungrouped\"",
  ], "timeline-view.tsx must expose shared date range plus account/event/status/severity/category filters with account-derived group lanes");
  checkIncludesAll(uptimeView, [
    "dateRange: HistoryDateRange;",
    'status: "all" | "up" | "down" | "pending";',
    'enabled: "all" | "enabled" | "disabled";',
    'method: "all" | string;',
    "search: string;",
    "filters.enabled === \"enabled\"",
    "filters.method !== \"all\"",
    "filters.search.trim() !== \"\"",
    "range={filters.dateRange}",
    "useCheckLatency(check.id, range)",
  ], "uptime-view.tsx must expose range/group/enabled/status/method/search filters and scope check latency by range");
  checkIncludesAll(alertsView, [
    'enabled: "all" | "enabled" | "disabled";',
    'state: "all" | "firing" | "pending" | "ok" | "nodata";',
    'metric: "all" | RuleMetric;',
    "scopeType: ScopeType;",
    "filters.metric !== \"all\" && rule.metric !== filters.metric",
    "filters.scopeType !== \"all\" && scopeTypeOf(rule.scope) !== filters.scopeType",
    "filters.group !== ALL && rule.scope.groupId !== filters.group",
    "filters.account !== ALL && rule.scope.accountId !== filters.account",
    "filters.provider !== \"all\" && rule.scope.provider !== filters.provider",
    "filters.check !== ALL && rule.scope.checkId !== filters.check",
    "filters.state === \"firing\" && !state?.firing",
    "filters.state === \"pending\" && (!state?.breaching || state.firing)",
    "filters.state === \"ok\" && (!state || state.value === null || state.firing || state.breaching)",
    "function sampleAccountGroupId",
    "row.groupId ?? accountsById.get(accountId)?.groupId",
    "sampleAccountGroupId(accountId, row, accountsById) !== rule.scope.groupId",
    "simulateRuleFromSamples(rule, ruleHistoryQuery.data ?? [], accountsById)",
  ], "alerts-view.tsx must implement enabled/state/metric/scope/target alert-rule filters and retained-history tuning fallback without adding a date filter");

  for (const view of FILTERED_VIEWS) {
    const cachedSources: Partial<Record<(typeof FILTERED_VIEWS)[number], string>> = {
      "renderer/main/dashboard-view.tsx": mainDashboardView,
      "renderer/main/apps-view.tsx": appsView,
      "renderer/main/insights-view.tsx": insightsView,
      "renderer/main/incidents-view.tsx": incidentsView,
      "renderer/main/timeline-view.tsx": timelineView,
      "renderer/main/uptime-view.tsx": uptimeView,
      "renderer/main/alerts-view.tsx": alertsView,
      "renderer/main/dashboards-view.tsx": dashboardsView,
    };
    const source = cachedSources[view] ?? await readRepoFile(view);
    check(source.includes("FilterMenu"), `${view} must use the shared FilterMenu`);
    check(source.includes("useStoredState"), `${view} must persist its filter state`);
  }
  for (const view of FILTER_PRESET_VIEWS) {
    const cachedSources: Partial<Record<(typeof FILTER_PRESET_VIEWS)[number], string>> = {
      "renderer/main/accounts-view.tsx": accountsView,
      "renderer/main/dashboard-view.tsx": mainDashboardView,
      "renderer/main/apps-view.tsx": appsView,
      "renderer/main/insights-view.tsx": insightsView,
      "renderer/main/incidents-view.tsx": incidentsView,
      "renderer/main/timeline-view.tsx": timelineView,
      "renderer/main/uptime-view.tsx": uptimeView,
      "renderer/main/alerts-view.tsx": alertsView,
      "renderer/main/dashboards-view.tsx": dashboardsView,
      "renderer/settings/notification-channels.tsx": notificationChannelsView,
    };
    const source = cachedSources[view] ?? await readRepoFile(view);
    check(source.includes("FILTER_PRESET_KEY"), `${view} must define a saved-filter preset storage key`);
    check(source.includes("presetKey={FILTER_PRESET_KEY}"), `${view} must wire saved-filter presets into FilterMenu`);
    check(source.includes("presetValue="), `${view} must pass the current filter value for saved-filter presets`);
    check(source.includes("onApplyPreset="), `${view} must apply saved-filter presets back into tab filter state`);
  }
  for (const view of DATE_FILTERED_VIEWS) {
    const source = await readRepoFile(view);
    check(source.includes("FilterDateRangeField"), `${view} must expose the shared date range filter`);
    check(source.includes("dateRange"), `${view} must carry a dateRange filter`);
    check(source.includes("useHistoryStats"), `${view} must load retained-history stats for custom date bounds`);
    check(source.includes("retainedHistoryDateBounds"), `${view} must compute retained-history date bounds`);
    check(source.includes("bounds={dateBounds}"), `${view} must pass retained-history bounds to the date filter`);
  }

  const rendererFiles = await listSourceFiles("renderer");
  for (const file of rendererFiles) {
    const source = await readRepoFile(file);
    const isPreload = file === "renderer/preload.ts";
    check(isPreload || !source.includes("@glaze/core/preload"), `${file}: only renderer/preload.ts may import @glaze/core/preload`);
    check(isPreload || !/\bipcRenderer\b/.test(source), `${file}: only renderer/preload.ts may reference ipcRenderer`);
  }
  const grafanaViewPath = path.join(repoRoot, "renderer/main/grafana-view.tsx");
  await fs.access(grafanaViewPath).then(
    () => check(false, "renderer/main/grafana-view.tsx should remain removed"),
    () => undefined,
  );

  for (const provider of EXPECTED_PROVIDERS) {
    check(providerIndex.includes(`./${provider}.js`), `providers/index.ts missing import for "${provider}"`);
    check(providerIndex.includes(providerVariableName(provider)), `providers/index.ts missing registration variable for "${provider}"`);
    check(backendTypes.includes(`"${provider}"`), `main/services/types.ts missing Provider union member "${provider}"`);
    check(rendererTypes.includes(`"${provider}"`), `renderer/main/types.ts missing Provider union member "${provider}"`);
    check(providerMeta.includes(`${provider}:`), `provider-meta.tsx missing provider metadata for "${provider}"`);
    await checkProviderModule(provider);
  }
  for (const provider of ["supabase", "posthog", "betterstack"]) {
    const source = await readRepoFile(`main/services/providers/${provider}.ts`);
    check(source.includes("must start with SELECT") && source.includes("cannot contain semicolons"), `${provider}.ts must enforce read-only SELECT dashboard queries`);
    check(source.includes("Math.min(Math.max(Number(raw)") && (source.includes("limit") || source.includes("LIMIT")), `${provider}.ts must cap custom dashboard query LIMIT values`);
  }
  for (const provider of PROVIDERS_WITH_DASHBOARD_ROW_LINKS) {
    const source = await readRepoFile(`main/services/providers/${provider}.ts`);
    check(source.includes("__url") && source.includes("__urlLabel"), `${provider}.ts dashboard rows must include direct row-link metadata where stable provider URLs exist`);
  }
  const betterstackSource = await readRepoFile("main/services/providers/betterstack.ts");
  check(betterstackSource.includes("out.__url = DASH_URL") && betterstackSource.includes("out.__urlLabel = \"Open Better Stack\""), "betterstack.ts dashboard rows must include direct row links");
  const grafanaSource = await readRepoFile("main/services/providers/grafana.ts");
  check(grafanaSource.includes('title: "Active Grafana alerts"') && grafanaSource.includes('capabilityId: "grafana.alerts"'), "grafana.ts must expose an active alerts default dashboard panel");
  check(grafanaSource.includes('title: "Grafana data source health"') && grafanaSource.includes('capabilityId: "grafana.datasources"'), "grafana.ts must expose a datasource health default dashboard panel");
  check(grafanaSource.includes("function firstDatasourceUid") && grafanaSource.includes('firstDatasourceUid(dataSources, "loki")') && grafanaSource.includes('firstDatasourceUid(dataSources, "tempo")'), "grafana.ts must choose discovered Loki/Tempo datasource UIDs when no saved default UID exists");
  check(grafanaSource.includes('title: "Recent traces"') && grafanaSource.includes('query: "{}"') && grafanaSource.includes('params: { datasourceUid: defaultTempoUid ?? "", limit: "50" }'), "grafana.ts must expose a no-query Recent traces default using TraceQL {}, limit 50, and the selected Tempo datasource UID");
  check(grafanaSource.includes('title: "Trace service names"') && grafanaSource.includes('capabilityId: "grafana.tempo-services"') && grafanaSource.includes('params: { datasourceUid: defaultTempoUid ?? "", limit: "100" }'), "grafana.ts must expose a trace service names default dashboard panel with the selected Tempo datasource UID");
  check(grafanaSource.includes("hasLokiSource") && grafanaSource.includes("const defaultLokiUid = config.lokiDataSourceUid || firstDatasourceUid") && grafanaSource.includes("defaultValue: defaultLokiUid"), "grafana.ts must gate Loki dashboard capabilities by configured or discovered datasource support and prefill the selected datasource UID");
  check(grafanaSource.includes("hasTempoSource") && grafanaSource.includes("const defaultTempoUid = config.tempoDataSourceUid || firstDatasourceUid") && grafanaSource.includes("defaultValue: defaultTempoUid"), "grafana.ts must gate Tempo dashboard capabilities by configured or discovered datasource support and prefill the selected datasource UID");
  check(grafanaSource.includes("async function selectedDashboardDatasource") && grafanaSource.includes("firstDatasourceUid(await dashboardDataSources(baseUrl, token), type)") && grafanaSource.includes('await selectedDashboardDatasource(baseUrl, token, query, creds, "grafana.loki", "loki", "loki")') && grafanaSource.includes('await selectedDashboardDatasource(baseUrl, token, query, creds, "grafana.tempo", "tempo", "tempo")'), "grafana.ts must discover Loki/Tempo datasource UIDs at runtime for migrated panels without saved datasource params");
  check(grafanaSource.includes('source.type === "prometheus"') && grafanaSource.includes('id: `grafana.prometheus:${dataSource.uid}`') && grafanaSource.includes('queryLanguage: "PromQL"'), "grafana.ts must expose Prometheus dashboard capabilities only for discovered Prometheus datasources");
  check(grafanaSource.includes("async function runDashboardPrometheus") && grafanaSource.includes("/api/datasources/proxy/uid/${encodeURIComponent(datasourceUid)}/api/v1/query_range") && grafanaSource.includes('kind: "timeseries"'), "grafana.ts must run PromQL panels through Grafana datasource proxy query_range and return timeseries results");
  check(grafanaSource.includes("if (hasTempoSource)") && grafanaSource.includes('id: "grafana.tempo-services"'), "grafana.ts must expose Tempo default panels only from the Tempo datasource gate");
  check(grafanaSource.includes("function grafanaTraceUrl") && grafanaSource.includes('queryType: "traceql"') && grafanaSource.includes("__url: trace.traceID ? grafanaTraceUrl"), "grafana.ts Tempo trace rows must include direct Grafana Explore trace links");
  check(grafanaSource.includes("function grafanaLogsUrl") && grafanaSource.includes('queryType: "range"') && grafanaSource.includes("__url: url") && grafanaSource.includes('__urlLabel: "Open in Grafana"'), "grafana.ts Loki log rows must include direct Grafana Explore links");
  check(grafanaSource.includes('const alertUrl = `${normalizeBase(baseUrl)}/alerting/list`;') && grafanaSource.includes('__urlLabel: "Open alerting"'), "grafana.ts alert rows must include direct Grafana alerting links");
  check(grafanaSource.includes("/connections/datasources/edit/") && grafanaSource.includes('__urlLabel: "Open data source"'), "grafana.ts datasource rows must include direct Grafana datasource links");
  const posthogSource = await readRepoFile("main/services/providers/posthog.ts");
  check(posthogSource.includes('title: "Recent PostHog exceptions"') && posthogSource.includes("RECENT_EXCEPTIONS_HOGQL") && posthogSource.includes('capabilityId: "posthog.hogql"'), "posthog.ts must expose a recent exceptions default dashboard panel");
  const supabaseSource = await readRepoFile("main/services/providers/supabase.ts");
  check(supabaseSource.includes('title: "Recent Supabase error logs"') && supabaseSource.includes("RECENT_ERROR_LOGS_SQL") && supabaseSource.includes('capabilityId: "supabase.logs-sql"'), "supabase.ts must expose a recent error logs default dashboard panel");

  const providerImports = EXPECTED_PROVIDERS.filter((provider) => providerIndex.includes(`from "./${provider}.js"`)).length;
  check(providerImports === EXPECTED_PROVIDERS.length, `providers/index.ts expected ${EXPECTED_PROVIDERS.length} provider imports, found ${providerImports}`);
}

await main();

if (errors.length > 0) {
  process.stderr.write(`Provider contract check failed with ${errors.length} issue${errors.length === 1 ? "" : "s"}:\n`);
  for (const error of errors) process.stderr.write(`- ${error}\n`);
  process.exit(1);
}

process.stdout.write(`Provider contract check passed for ${EXPECTED_PROVIDERS.length} providers.\n`);
