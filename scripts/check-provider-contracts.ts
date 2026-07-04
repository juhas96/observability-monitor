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
  const registry = await readRepoFile("main/services/providers/registry.ts");
  const dashboardStore = await readRepoFile("main/services/dashboard-store.ts");
  const dashboardHandlers = await readRepoFile("main/handlers/dashboards.ts");
  const dashboardRunner = await readRepoFile("main/services/dashboard-query-runner.ts");
  const dashboardsView = await readRepoFile("renderer/main/dashboards-view.tsx");
  const dashboardsHook = await readRepoFile("renderer/main/hooks/use-dashboards.ts");
  const filtersComponent = await readRepoFile("renderer/main/components/filters.tsx");
  const historyHandlers = await readRepoFile("main/handlers/history.ts");
  const historyStore = await readRepoFile("main/services/history-store.ts");
  const alertsView = await readRepoFile("renderer/main/alerts-view.tsx");
  const insightsView = await readRepoFile("renderer/main/insights-view.tsx");
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
  check(dashboardStore.includes("variables: Object.keys(normalizeScopeFields(asRecord(input.variables)))"), "dashboard-store.ts must normalize persisted dashboard variables through scope-field validation");
  check(dashboardStore.includes("raw.refreshSeconds") && dashboardStore.includes("raw.refreshSeconds >= 15"), "dashboard-store.ts must normalize panel-level refreshSeconds with the same minimum as dashboard refresh");
  check(dashboardStore.includes("shouldPersistMigration") && dashboardStore.includes("initial.dashboards.length === 0"), "dashboard-store.ts must persist Grafana preset migration only on the first empty-dashboard migration pass");
  check(dashboardHandlers.includes("secretsIncluded: false"), "dashboard export/import handlers must declare secretsIncluded: false");
  check(dashboardHandlers.includes("sourcePanels.length > 0 && panels.length === 0"), "dashboard import must preserve intentionally empty dashboards while skipping only dashboards whose provided panels all fail remapping");
  check(dashboardHandlers.includes("addSourceRefs(dashboard.variables") && dashboardHandlers.includes("function remapVariables") && dashboardHandlers.includes("variables: remapVariables"), "dashboard export/import must include and remap dashboard variable account/group/check references");
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
  check(filtersComponent.includes("min={bounds?.min}") && filtersComponent.includes("max={bounds?.max}"), "DateRangeFilter must pass retained-history bounds to datetime inputs");
  check(filtersComponent.includes("max: toDateTimeLocal(now)"), "retained history date bounds must allow current custom date ranges up to now");
  check(filtersComponent.includes("if (from !== value.from || to !== value.to) onChange({ ...value, from, to })"), "DateRangeFilter must normalize stored custom ranges when retained-history bounds change");
  check(historyHandlers.includes("req.dateRange ? historyDateRange(req.dateRange) : historyRange(req.range)"), "history handlers must accept custom dateRange payloads");
  for (const field of ["accountId", "status", "severity", "category", "types"]) {
    check(historyHandlers.includes(`${field}:`), `history:getEvents must support ${field} filtering`);
  }
  check(dashboardRunner.includes("__url: event.url"), "local dashboard event rows must carry hidden __url metadata");
  check(dashboardRunner.includes('__urlLabel: "Open event"'), "local dashboard event rows must label hidden links");
  check(dashboardsView.includes("!column.startsWith(\"__\")"), "dashboard table renderer must hide hidden __ metadata columns");
  check(dashboardsView.includes("row.__url") && dashboardsView.includes("monitorApi.openExternal"), "dashboard table renderer must open row links through monitorApi.openExternal");
  check(dashboardsHook.includes("retry: false"), "dashboard panel queries must not retry invalid custom provider queries automatically");
  check(dashboardsView.includes("scopedPanel") && dashboardsView.includes("panel.source.kind !== \"local\""), "dashboard runtime filters must only rewrite local panels");
  check(dashboardsView.includes("runtimeFiltersToVariables") && dashboardsView.includes("mergeDashboardVariables") && dashboardsView.includes("Variables apply to local dashboard panels"), "dashboards-view.tsx must let users persist dashboard variables and apply them to local panels");
  check(dashboardsView.includes("Panel refresh") && dashboardsView.includes("panel.refreshSeconds ?? dashboard.refreshSeconds"), "dashboards-view.tsx must expose and use panel-level refresh overrides");
  check(dashboardsView.includes("panel.source.groupId ??") && dashboardsView.includes("panel.source.accountId ??") && dashboardsView.includes("panel.source.checkId ??"), "dashboard runtime filters must respect narrower saved local panel scope");
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
  check(commandCenterView.includes("allFailedItems") && commandCenterView.includes("visibleFailedItems") && commandCenterView.includes("Showing {visibleRecentActivity.length} of {allRecentActivity.length}"), "command-center-view.tsx must count full issue/activity totals separately from capped visible rows");
  check(monitorDataHook.includes("useMonitorSettings") && monitorDataHook.includes("settings:monitor-changed") && commandCenterView.includes("SuppressionStatus") && commandCenterView.includes("Notification suppression") && commandCenterView.includes("activeMaintenanceWindows"), "command-center-view.tsx must surface active notification suppression from monitor settings");
  check(commandCenterView.includes("AlertRuleRow") && commandCenterView.includes("visibleFiringRules") && commandCenterView.includes("Firing alert rules") && commandCenterView.includes("current {formatRuleValue"), "command-center-view.tsx must show row-level firing alert-rule evidence in the current issue surface");
  check(commandCenterView.includes("useSloStatus") && commandCenterView.includes("allAtRiskSlos") && commandCenterView.includes("SLO risk") && commandCenterView.includes("insights.filters.v2"), "command-center-view.tsx must surface retained-history SLO risk and route it to Insights");
  check(commandCenterView.includes("SloRiskRow") && commandCenterView.includes("visibleAtRiskSlos") && commandCenterView.includes("SLOs at risk") && commandCenterView.includes("burn {formatBurnRate"), "command-center-view.tsx must show row-level SLO risk evidence in the current issue surface");
  check(commandPalette.includes("Run smoke verification"), "command-palette.tsx must expose smoke verification");
  check(commandPalette.includes("accounts.verify.v1"), "command-palette.tsx must write the smoke verification handoff key");

  for (const view of FILTERED_VIEWS) {
    const source = view === "renderer/main/dashboards-view.tsx" ? dashboardsView : await readRepoFile(view);
    check(source.includes("FilterMenu"), `${view} must use the shared FilterMenu`);
    check(source.includes("useStoredState"), `${view} must persist its filter state`);
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
    check(source.includes("Math.min(Math.max(Number(raw)") && (source.includes("limit") || source.includes("LIMIT")), `${provider}.ts must cap custom dashboard query LIMIT values`);
  }
  for (const provider of PROVIDERS_WITH_DASHBOARD_ROW_LINKS) {
    const source = await readRepoFile(`main/services/providers/${provider}.ts`);
    check(source.includes("__url") && source.includes("__urlLabel"), `${provider}.ts dashboard rows must include direct row-link metadata where stable provider URLs exist`);
  }
  const betterstackSource = await readRepoFile("main/services/providers/betterstack.ts");
  check(betterstackSource.includes("out.__url = DASH_URL") && betterstackSource.includes("out.__urlLabel = \"Open Better Stack\""), "betterstack.ts dashboard rows must include direct row links");
  const grafanaSource = await readRepoFile("main/services/providers/grafana.ts");
  check(grafanaSource.includes("hasLokiSource") && grafanaSource.includes("config.lokiDataSourceUid") && grafanaSource.includes('source.type === "loki"'), "grafana.ts must gate Loki dashboard capabilities by configured or discovered datasource support");
  check(grafanaSource.includes("hasTempoSource") && grafanaSource.includes("config.tempoDataSourceUid") && grafanaSource.includes('source.type === "tempo"'), "grafana.ts must gate Tempo dashboard capabilities by configured or discovered datasource support");
  check(grafanaSource.includes("if (hasTempoSource)") && grafanaSource.includes('id: "grafana.tempo-services"'), "grafana.ts must expose Tempo default panels only from the Tempo datasource gate");
  check(grafanaSource.includes("function grafanaTraceUrl") && grafanaSource.includes('queryType: "traceql"') && grafanaSource.includes("__url: trace.traceID ? grafanaTraceUrl"), "grafana.ts Tempo trace rows must include direct Grafana Explore trace links");
  check(grafanaSource.includes('const alertUrl = `${normalizeBase(baseUrl)}/alerting/list`;') && grafanaSource.includes('__urlLabel: "Open alerting"'), "grafana.ts alert rows must include direct Grafana alerting links");
  check(grafanaSource.includes("/connections/datasources/edit/") && grafanaSource.includes('__urlLabel: "Open data source"'), "grafana.ts datasource rows must include direct Grafana datasource links");

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
