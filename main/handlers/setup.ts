/**
 * Portable app setup import/export. This intentionally excludes all secrets,
 * runtime history, local incidents, and triage state.
 */

import * as fs from "fs/promises";
import { randomUUID } from "crypto";

import { dialog, ipcMain, logger } from "@glaze/core/backend";

import { addAccount, listAccounts, listGroups, resolveGroupAssignment } from "../services/accounts-store.js";
import { listChannels, saveChannel } from "../services/channels-store.js";
import { listChecks, saveCheck } from "../services/checks-store.js";
import { listDashboards, saveDashboard } from "../services/dashboard-store.js";
import { listSlos, saveSlo } from "../services/history-store.js";
import * as registry from "../services/providers/index.js";
import { listRules, saveRule } from "../services/rules-store.js";
import { listServiceMetadata, saveServiceMetadata } from "../services/service-metadata-store.js";
import { getSettings, updateSettings } from "../services/settings-store.js";
import type {
  Account,
  AlertRule,
  Channel,
  DashboardDefinition,
  DashboardInput,
  DashboardLocalSource,
  DashboardPanel,
  DashboardPanelScope,
  DashboardPanelSource,
  HttpCheck,
  MaintenanceWindow,
  MonitorSettings,
  ProjectGroup,
  Provider,
  RuleScope,
  ServiceMetadata,
  SloDefinition,
} from "../services/types.js";

const UI_FILTER_KEYS = new Set([
  "accounts.filters.v1",
  "accounts.filters.v1.presets",
  "accounts.filters.v1.presets.default",
  "dashboard.filters.v2",
  "dashboard.filters.v2.presets",
  "dashboard.filters.v2.presets.default",
  "apps.filters.v1",
  "apps.filters.v1.presets",
  "apps.filters.v1.presets.default",
  "providerWorkspace.filters.v1",
  "providerWorkspace.filters.v1.presets",
  "providerWorkspace.filters.v1.presets.default",
  "insights.filters.v2",
  "insights.filters.v2.presets",
  "insights.filters.v2.presets.default",
  "incidents.filters.v1",
  "incidents.filters.v1.presets",
  "incidents.filters.v1.presets.default",
  "timeline.filters.v1",
  "timeline.filters.v1.presets",
  "timeline.filters.v1.presets.default",
  "uptime.filters.v1",
  "uptime.filters.v1.presets",
  "uptime.filters.v1.presets.default",
  "alerts.filters.v1",
  "alerts.filters.v1.presets",
  "alerts.filters.v1.presets.default",
  "customDashboards.filters.v2",
  "customDashboards.filters.v2.presets",
  "customDashboards.filters.v2.presets.default",
  "notificationChannels.filters.v1",
  "notificationChannels.filters.v1.presets",
  "notificationChannels.filters.v1.presets.default",
]);
const DISPATCH_EVENT_KINDS = new Set(["failure", "success", "alert", "recovery", "digest"]);

type PortableSettings = Pick<
  MonitorSettings,
  "pollIntervalSeconds" | "notifyOnFailure" | "notifyOnSuccess" | "notifyOnlyOnChange" | "soundOnNotify" | "historyRetentionDays" | "digest" | "maintenanceWindows"
>;

type PortableAccount = Pick<Account, "id" | "provider" | "label" | "groupId" | "createdAt" | "enabled" | "identity" | "config">;

interface PortableSetupBundle {
  app: "multi-monitor";
  kind: "portable-setup";
  version: 1;
  exportedAt: string;
  secretsIncluded: false;
  accounts: PortableAccount[];
  groups: ProjectGroup[];
  settings: PortableSettings;
  dashboards: DashboardDefinition[];
  checks: HttpCheck[];
  rules: AlertRule[];
  slos: SloDefinition[];
  channels: Channel[];
  serviceMetadata?: ServiceMetadata[];
  uiFilters: Record<string, string>;
}

interface SetupImportSummary {
  accountsImported: number;
  accountsSkipped: number;
  groupsImported: number;
  dashboardsImported: number;
  dashboardsSkipped: number;
  checksImported: number;
  checksSkipped: number;
  rulesImported: number;
  rulesSkipped: number;
  slosImported: number;
  slosSkipped: number;
  channelsImported: number;
  channelsSkipped: number;
  serviceMetadataImported: number;
  serviceMetadataSkipped: number;
  filtersImported: number;
  filePath?: string;
  uiFilters: Record<string, string>;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) return {};
  return value as Record<string, unknown>;
}

function clean(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function normalizedKey(value: string): string {
  return value.trim().toLowerCase();
}

function isProvider(value: unknown): value is Provider {
  return typeof value === "string" && registry.has(value);
}

function portableHour(value: unknown, fallback = 9): number {
  const hour = Number(value);
  return Number.isFinite(hour) ? Math.min(23, Math.max(0, Math.round(hour))) : fallback;
}

function portableRetentionDays(value: unknown, fallback = 14): number {
  const days = Number(value);
  return Number.isFinite(days) ? Math.min(90, Math.max(1, Math.round(days))) : fallback;
}

function portableMaintenanceWindows(value: unknown): MaintenanceWindow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw, index): MaintenanceWindow[] => {
    const window = asRecord(raw);
    const days = Array.isArray(window.days)
      ? [...new Set(window.days.map((day) => Number(day)).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort()
      : [];
    if (days.length === 0) return [];
    return [{
      id: clean(window.id) ?? `maintenance-${index + 1}`,
      label: (clean(window.label) ?? "Maintenance window").slice(0, 80),
      enabled: window.enabled !== false,
      days,
      startHour: portableHour(window.startHour, 0),
      endHour: portableHour(window.endHour, 1),
      scope: portableRuleScope(window.scope),
    }];
  });
}

function portableRuleScope(value: unknown): RuleScope | undefined {
  const scope = asRecord(value);
  const next: RuleScope = {
    groupId: clean(scope.groupId),
    accountId: clean(scope.accountId),
    provider: isProvider(scope.provider) ? scope.provider : undefined,
    checkId: clean(scope.checkId),
  };
  return Object.values(next).some(Boolean) ? next : undefined;
}

function accountFingerprint(account: Pick<Account, "provider" | "label" | "identity" | "config">): string {
  return JSON.stringify({
    provider: account.provider,
    label: account.label.trim().toLowerCase(),
    identity: account.identity?.trim().toLowerCase() ?? "",
    config: account.config ?? {},
  });
}

function checkFingerprint(check: Pick<HttpCheck, "name" | "url" | "method" | "expectedStatus" | "timeoutMs" | "groupId">): string {
  return JSON.stringify({
    name: normalizedKey(check.name),
    url: check.url.trim(),
    method: check.method.toUpperCase(),
    expectedStatus: check.expectedStatus ?? null,
    timeoutMs: check.timeoutMs ?? null,
    groupId: check.groupId ?? null,
  });
}

function ruleFingerprint(rule: Pick<AlertRule, "name" | "metric" | "operator" | "threshold" | "scope" | "minSeverity">): string {
  return JSON.stringify({
    name: normalizedKey(rule.name),
    metric: rule.metric,
    operator: rule.operator,
    threshold: rule.threshold,
    scope: rule.scope,
    minSeverity: rule.minSeverity ?? null,
  });
}

function sloFingerprint(slo: Pick<SloDefinition, "name" | "scope" | "target" | "windowDays">): string {
  return JSON.stringify({
    name: normalizedKey(slo.name),
    scope: slo.scope,
    target: slo.target,
    windowDays: slo.windowDays,
  });
}

function channelFingerprint(channel: Pick<Channel, "type" | "name" | "events">): string {
  return JSON.stringify({
    type: channel.type,
    name: normalizedKey(channel.name),
    events: [...channel.events].sort(),
  });
}

function accountServiceId(accountId: string): string {
  return `account:${accountId}`;
}

function serviceMetadataCompatible(metadata: ServiceMetadata, selectedAccountIds: Set<string>, selectedGroupIds: Set<string>): boolean {
  if (selectedGroupIds.has(metadata.serviceId)) return true;
  if (!metadata.serviceId.startsWith("account:")) return false;
  return selectedAccountIds.has(metadata.serviceId.slice("account:".length));
}

function setupSettings(settings: MonitorSettings): PortableSettings {
  return {
    pollIntervalSeconds: settings.pollIntervalSeconds,
    notifyOnFailure: settings.notifyOnFailure,
    notifyOnSuccess: settings.notifyOnSuccess,
    notifyOnlyOnChange: settings.notifyOnlyOnChange,
    soundOnNotify: settings.soundOnNotify,
    historyRetentionDays: settings.historyRetentionDays,
    digest: settings.digest,
    maintenanceWindows: settings.maintenanceWindows,
  };
}

function remapSettings(settings: PortableSettings, maps: {
  accountIds: Map<string, string>;
  groupIds: Map<string, string>;
  checkIds: Map<string, string>;
}): PortableSettings {
  return {
    ...settings,
    maintenanceWindows: settings.maintenanceWindows.flatMap((window): MaintenanceWindow[] => {
      if (!window.scope) return [window];
      const scope = remapRuleScope(window.scope, maps);
      return scope ? [{ ...window, scope }] : [];
    }),
  };
}

function requestedAccountIds(value: unknown): Set<string> {
  const ids = Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && id.trim() !== "") : [];
  if (ids.length === 0) throw new Error("Select at least one account to export.");
  return new Set(ids);
}

function sanitizedFilters(value: unknown): Record<string, string> {
  const input = asRecord(value);
  const filters: Record<string, string> = {};
  for (const [key, raw] of Object.entries(input)) {
    if (!UI_FILTER_KEYS.has(key) || typeof raw !== "string") continue;
    try {
      JSON.parse(raw);
      filters[key] = raw;
    } catch {
      // Ignore invalid localStorage entries.
    }
  }
  return filters;
}

function scopeCompatible(
  scope: DashboardPanelScope | RuleScope | SloDefinition["scope"],
  selectedAccountIds: Set<string>,
  selectedGroupIds: Set<string>,
  selectedCheckIds: Set<string>,
): boolean {
  if (scope.accountId && !selectedAccountIds.has(scope.accountId)) return false;
  if (scope.groupId && !selectedGroupIds.has(scope.groupId)) return false;
  if ("checkId" in scope && scope.checkId && !selectedCheckIds.has(scope.checkId)) return false;
  return true;
}

function panelCompatible(
  panel: DashboardPanel,
  selectedAccountIds: Set<string>,
  selectedGroupIds: Set<string>,
  selectedCheckIds: Set<string>,
): boolean {
  if (panel.source.kind === "provider") return selectedAccountIds.has(panel.source.accountId);
  return scopeCompatible(panel.source, selectedAccountIds, selectedGroupIds, selectedCheckIds);
}

function filteredDashboard(
  dashboard: DashboardDefinition,
  selectedAccountIds: Set<string>,
  selectedGroupIds: Set<string>,
  selectedCheckIds: Set<string>,
): DashboardDefinition | null {
  if (dashboard.variables && !scopeCompatible(dashboard.variables, selectedAccountIds, selectedGroupIds, selectedCheckIds)) return null;
  const panels = dashboard.panels.filter((panel) => panelCompatible(panel, selectedAccountIds, selectedGroupIds, selectedCheckIds));
  if (dashboard.panels.length > 0 && panels.length === 0) return null;
  return { ...dashboard, panels };
}

function asPortableAccount(value: unknown): PortableAccount | null {
  const account = asRecord(value);
  if (typeof account.id !== "string" || !isProvider(account.provider) || typeof account.label !== "string") return null;
  return {
    id: account.id,
    provider: account.provider,
    label: account.label,
    groupId: clean(account.groupId),
    createdAt: clean(account.createdAt) ?? new Date().toISOString(),
    enabled: typeof account.enabled === "boolean" ? account.enabled : false,
    identity: clean(account.identity),
    config: typeof account.config === "object" && account.config !== null ? account.config as Record<string, string> : {},
  };
}

function asGroup(value: unknown): ProjectGroup | null {
  const group = asRecord(value);
  const id = clean(group.id);
  const name = clean(group.name);
  if (!id || !name) return null;
  return { id, name, createdAt: clean(group.createdAt) ?? new Date().toISOString() };
}

function asChannel(value: unknown): Channel | null {
  const channel = asRecord(value);
  const id = clean(channel.id);
  const name = clean(channel.name);
  const type = channel.type === "webhook" ? "webhook" : channel.type === "slack" ? "slack" : channel.type === "teams" ? "teams" : undefined;
  if (!id || !name || !type) return null;
  const events = Array.isArray(channel.events)
    ? channel.events.filter((event): event is Channel["events"][number] => typeof event === "string" && DISPATCH_EVENT_KINDS.has(event))
    : [];
  return { id, type, name, enabled: false, events };
}

function asServiceMetadata(value: unknown): ServiceMetadata | null {
  const metadata = asRecord(value);
  const serviceId = clean(metadata.serviceId);
  if (!serviceId) return null;
  const tier = metadata.tier === "critical" || metadata.tier === "standard" || metadata.tier === "internal" || metadata.tier === "experimental"
    ? metadata.tier
    : undefined;
  return {
    serviceId,
    owner: clean(metadata.owner),
    tier,
    runbookUrl: clean(metadata.runbookUrl),
    dashboardUrl: clean(metadata.dashboardUrl),
    repositoryUrl: clean(metadata.repositoryUrl),
    dependencies: Array.isArray(metadata.dependencies)
      ? metadata.dependencies.filter((dependency): dependency is string => typeof dependency === "string")
      : undefined,
    notes: clean(metadata.notes),
    updatedAt: clean(metadata.updatedAt) ?? new Date().toISOString(),
  };
}

function asSetupBundle(value: unknown): PortableSetupBundle {
  const file = asRecord(value);
  if (file.app !== "multi-monitor" || file.kind !== "portable-setup" || file.version !== 1 || file.secretsIncluded !== false) {
    throw new Error("This is not a supported Multi Monitor portable setup export.");
  }

  const settings = asRecord(file.settings);
  const digest = asRecord(settings.digest);
  return {
    app: "multi-monitor",
    kind: "portable-setup",
    version: 1,
    exportedAt: clean(file.exportedAt) ?? new Date().toISOString(),
    secretsIncluded: false,
    accounts: Array.isArray(file.accounts) ? file.accounts.map(asPortableAccount).filter((account): account is PortableAccount => account !== null) : [],
    groups: Array.isArray(file.groups) ? file.groups.map(asGroup).filter((group): group is ProjectGroup => group !== null) : [],
    settings: {
      pollIntervalSeconds: Number(settings.pollIntervalSeconds),
      notifyOnFailure: settings.notifyOnFailure !== false,
      notifyOnSuccess: settings.notifyOnSuccess === true,
      notifyOnlyOnChange: settings.notifyOnlyOnChange !== false,
      soundOnNotify: settings.soundOnNotify === true,
      historyRetentionDays: portableRetentionDays(settings.historyRetentionDays, 14),
      digest: {
        enabled: digest.enabled === true,
        cadence: digest.cadence === "weekly" ? "weekly" : "daily",
        hour: portableHour(digest.hour),
      },
      maintenanceWindows: portableMaintenanceWindows(settings.maintenanceWindows),
    },
    dashboards: Array.isArray(file.dashboards) ? file.dashboards as DashboardDefinition[] : [],
    checks: Array.isArray(file.checks) ? file.checks as HttpCheck[] : [],
    rules: Array.isArray(file.rules) ? file.rules as AlertRule[] : [],
    slos: Array.isArray(file.slos) ? file.slos as SloDefinition[] : [],
    channels: Array.isArray(file.channels) ? file.channels.map(asChannel).filter((channel): channel is Channel => channel !== null) : [],
    serviceMetadata: Array.isArray(file.serviceMetadata)
      ? file.serviceMetadata.map(asServiceMetadata).filter((metadata): metadata is ServiceMetadata => metadata !== null)
      : [],
    uiFilters: sanitizedFilters(file.uiFilters),
  };
}

function remapRuleScope(scope: RuleScope, maps: {
  accountIds: Map<string, string>;
  groupIds: Map<string, string>;
  checkIds: Map<string, string>;
}): RuleScope | null {
  const next: RuleScope = { ...scope };
  if (scope.accountId) {
    const mapped = maps.accountIds.get(scope.accountId);
    if (!mapped) return null;
    next.accountId = mapped;
  }
  if (scope.groupId) {
    const mapped = maps.groupIds.get(scope.groupId);
    if (!mapped) return null;
    next.groupId = mapped;
  }
  if (scope.checkId) {
    const mapped = maps.checkIds.get(scope.checkId);
    if (!mapped) return null;
    next.checkId = mapped;
  }
  return next;
}

function remapSloScope(scope: SloDefinition["scope"], maps: {
  accountIds: Map<string, string>;
  groupIds: Map<string, string>;
}): SloDefinition["scope"] | null {
  const next: SloDefinition["scope"] = { ...scope };
  if (scope.accountId) {
    const mapped = maps.accountIds.get(scope.accountId);
    if (!mapped) return null;
    next.accountId = mapped;
  }
  if (scope.groupId) {
    const mapped = maps.groupIds.get(scope.groupId);
    if (!mapped) return null;
    next.groupId = mapped;
  }
  return next;
}

function remapPanel(panel: unknown, maps: {
  accountIds: Map<string, string>;
  groupIds: Map<string, string>;
  checkIds: Map<string, string>;
}): DashboardPanel | null {
  const raw = asRecord(panel);
  const source = asRecord(raw.source);
  if (source.kind === "provider") {
    const sourceAccountId = clean(source.accountId);
    const capabilityId = clean(source.capabilityId);
    if (!sourceAccountId || !capabilityId) return null;
    const accountId = maps.accountIds.get(sourceAccountId);
    if (!accountId) return null;
    return { ...(raw as unknown as DashboardPanel), id: randomUUID(), source: { ...(source as unknown as DashboardPanelSource), kind: "provider", accountId, capabilityId } };
  }

  if (source.kind !== "local") return null;
  const next = { ...(source as unknown as DashboardLocalSource), kind: "local" as const };
  if (next.accountId) {
    const accountId = maps.accountIds.get(next.accountId);
    if (!accountId) return null;
    next.accountId = accountId;
  }
  if (next.groupId) {
    const groupId = maps.groupIds.get(next.groupId);
    if (!groupId) return null;
    next.groupId = groupId;
  }
  if (next.checkId) {
    const checkId = maps.checkIds.get(next.checkId);
    if (!checkId) return null;
    next.checkId = checkId;
  }
  return { ...(raw as unknown as DashboardPanel), id: randomUUID(), source: next };
}

function remapDashboardVariables(variables: unknown, maps: {
  accountIds: Map<string, string>;
  groupIds: Map<string, string>;
  checkIds: Map<string, string>;
}): DashboardPanelScope | undefined {
  const raw = asRecord(variables);
  const next: DashboardPanelScope = {
    provider: isProvider(raw.provider) ? raw.provider : undefined,
    owner: clean(raw.owner),
    tier: clean(raw.tier) as DashboardPanelScope["tier"],
    dependency: clean(raw.dependency),
  };
  const accountId = clean(raw.accountId);
  if (accountId) next.accountId = maps.accountIds.get(accountId);
  const groupId = clean(raw.groupId);
  if (groupId) next.groupId = maps.groupIds.get(groupId);
  const checkId = clean(raw.checkId);
  if (checkId) next.checkId = maps.checkIds.get(checkId);
  return Object.values(next).some(Boolean) ? next : undefined;
}

function remapServiceId(serviceId: string, maps: {
  accountIds: Map<string, string>;
  groupIds: Map<string, string>;
}): string | null {
  if (serviceId.startsWith("account:")) {
    const accountId = maps.accountIds.get(serviceId.slice("account:".length));
    return accountId ? accountServiceId(accountId) : null;
  }
  return maps.groupIds.get(serviceId) ?? null;
}

export function registerSetupHandlers(): void {
  ipcMain.handle("setup:export", async (_event, payload: unknown): Promise<{ ok: boolean; filePath?: string }> => {
    const req = asRecord(payload);
    const selectedAccountIds = requestedAccountIds(req.accountIds);
    const uiFilters = sanitizedFilters(req.filters);

    const [accounts, groups, settings, dashboards, checks, rules, slos, channels, serviceMetadata] = await Promise.all([
      listAccounts(),
      listGroups(),
      getSettings(),
      listDashboards(),
      listChecks(),
      listRules(),
      listSlos(),
      listChannels(),
      listServiceMetadata(),
    ]);

    const selectedAccounts = accounts.filter((account) => selectedAccountIds.has(account.id));
    if (selectedAccounts.length === 0) throw new Error("None of the selected accounts still exist.");

    const selectedGroupIds = new Set(selectedAccounts.map((account) => account.groupId).filter((id): id is string => Boolean(id)));
    const selectedChecks = checks.filter((check) => !check.groupId || selectedGroupIds.has(check.groupId));
    const selectedCheckIds = new Set(selectedChecks.map((check) => check.id));
    const selectedRules = rules
      .map((rule) => ({ ...rule, mutedUntil: undefined }))
      .filter((rule) => scopeCompatible(rule.scope, selectedAccountIds, selectedGroupIds, selectedCheckIds));
    const selectedSlos = slos.filter((slo) => scopeCompatible(slo.scope, selectedAccountIds, selectedGroupIds, selectedCheckIds));
    const selectedDashboards = dashboards
      .map((dashboard) => filteredDashboard(dashboard, selectedAccountIds, selectedGroupIds, selectedCheckIds))
      .filter((dashboard): dashboard is DashboardDefinition => dashboard !== null);
    const selectedServiceMetadata = serviceMetadata.filter((metadata) => serviceMetadataCompatible(metadata, selectedAccountIds, selectedGroupIds));

    const neededGroupIds = new Set<string>(selectedGroupIds);
    for (const check of selectedChecks) if (check.groupId) neededGroupIds.add(check.groupId);
    for (const rule of selectedRules) if (rule.scope.groupId) neededGroupIds.add(rule.scope.groupId);
    for (const slo of selectedSlos) if (slo.scope.groupId) neededGroupIds.add(slo.scope.groupId);
    for (const dashboard of selectedDashboards) {
      if (dashboard.variables?.groupId) neededGroupIds.add(dashboard.variables.groupId);
      for (const panel of dashboard.panels) {
        if (panel.source.kind === "local" && panel.source.groupId) neededGroupIds.add(panel.source.groupId);
      }
    }

    const bundle: PortableSetupBundle = {
      app: "multi-monitor",
      kind: "portable-setup",
      version: 1,
      exportedAt: new Date().toISOString(),
      secretsIncluded: false,
      accounts: selectedAccounts.map((account) => ({
        id: account.id,
        provider: account.provider,
        label: account.label,
        groupId: account.groupId,
        createdAt: account.createdAt,
        enabled: account.enabled,
        identity: account.identity,
        config: account.config ?? {},
      })),
      groups: groups.filter((group) => neededGroupIds.has(group.id)),
      settings: setupSettings(settings),
      dashboards: selectedDashboards,
      checks: selectedChecks,
      rules: selectedRules,
      slos: selectedSlos,
      channels: channels.map((channel) => ({ ...channel, enabled: false })),
      serviceMetadata: selectedServiceMetadata,
      uiFilters,
    };

    const stamp = new Date().toISOString().slice(0, 10);
    const result = await dialog.showSaveDialog({
      title: "Export portable setup",
      defaultPath: `multi-monitor-portable-setup-${stamp}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return { ok: false };
    await fs.writeFile(result.filePath, JSON.stringify(bundle, null, 2), "utf-8");
    return { ok: true, filePath: result.filePath };
  });

  ipcMain.handle("setup:import", async (): Promise<SetupImportSummary> => {
    const result = await dialog.showOpenDialog({
      title: "Import portable setup",
      filters: [{ name: "JSON", extensions: ["json"] }],
      properties: ["openFile"],
    });
    if (result.canceled || !result.filePaths?.[0]) {
      return {
        accountsImported: 0,
        accountsSkipped: 0,
        groupsImported: 0,
        dashboardsImported: 0,
        dashboardsSkipped: 0,
        checksImported: 0,
        checksSkipped: 0,
        rulesImported: 0,
        rulesSkipped: 0,
        slosImported: 0,
        slosSkipped: 0,
        channelsImported: 0,
        channelsSkipped: 0,
        serviceMetadataImported: 0,
        serviceMetadataSkipped: 0,
        filtersImported: 0,
        uiFilters: {},
      };
    }

    const filePath = result.filePaths[0];
    const bundle = asSetupBundle(JSON.parse(await fs.readFile(filePath, "utf-8")) as unknown);

    const existingGroups = await listGroups();
    const groupsByName = new Map(existingGroups.map((group) => [normalizedKey(group.name), group.id]));
    const groupIds = new Map<string, string>();
    let groupsImported = 0;
    for (const group of bundle.groups) {
      const key = normalizedKey(group.name);
      const existingGroupId = groupsByName.get(key);
      if (existingGroupId) {
        groupIds.set(group.id, existingGroupId);
        continue;
      }
      const groupId = await resolveGroupAssignment({ newGroupName: group.name });
      if (groupId) {
        groupIds.set(group.id, groupId);
        groupsByName.set(key, groupId);
        groupsImported += 1;
      }
    }

    const accountIds = new Map<string, string>();
    const existingAccounts = await listAccounts();
    const accountFingerprints = new Map(existingAccounts.map((account) => [accountFingerprint(account), account.id]));
    let accountsImported = 0;
    let accountsSkipped = 0;
    for (const source of bundle.accounts) {
      const fingerprint = accountFingerprint(source);
      const existingId = accountFingerprints.get(fingerprint);
      if (existingId) {
        accountIds.set(source.id, existingId);
        accountsSkipped += 1;
        continue;
      }
      const account: Account = {
        id: randomUUID(),
        provider: source.provider,
        label: source.label,
        groupId: source.groupId ? groupIds.get(source.groupId) : undefined,
        createdAt: new Date().toISOString(),
        enabled: false,
        identity: source.identity,
        config: source.config ?? {},
      };
      await addAccount(account);
      accountIds.set(source.id, account.id);
      accountFingerprints.set(fingerprint, account.id);
      accountsImported += 1;
    }

    const checkIds = new Map<string, string>();
    const existingChecks = await listChecks();
    const checkFingerprints = new Map(existingChecks.map((check) => [checkFingerprint(check), check.id]));
    let checksImported = 0;
    let checksSkipped = 0;
    for (const source of bundle.checks) {
      const groupId = source.groupId ? groupIds.get(source.groupId) : undefined;
      if (source.groupId && !groupId) {
        checksSkipped += 1;
        continue;
      }
      const candidate = { ...source, groupId };
      const fingerprint = checkFingerprint(candidate);
      const existingId = checkFingerprints.get(fingerprint);
      if (existingId) {
        checkIds.set(source.id, existingId);
        checksSkipped += 1;
        continue;
      }
      const check = await saveCheck({
        name: source.name,
        url: source.url,
        method: source.method,
        expectedStatus: source.expectedStatus,
        timeoutMs: source.timeoutMs,
        groupId,
        enabled: source.enabled,
      });
      checkIds.set(source.id, check.id);
      checkFingerprints.set(fingerprint, check.id);
      checksImported += 1;
    }

    await updateSettings(remapSettings(bundle.settings, { accountIds, groupIds, checkIds }));

    const existingChannels = await listChannels();
    const channelFingerprints = new Map(existingChannels.map((channel) => [channelFingerprint(channel), channel.id]));
    const channelIds = new Map<string, string>();
    let channelsImported = 0;
    let channelsSkipped = 0;
    for (const source of bundle.channels) {
      const fingerprint = channelFingerprint(source);
      const existingId = channelFingerprints.get(fingerprint);
      if (existingId) {
        channelIds.set(source.id, existingId);
        channelsSkipped += 1;
        continue;
      }
      const channel = await saveChannel({
        type: source.type,
        name: source.name,
        enabled: false,
        events: source.events,
      });
      channelIds.set(source.id, channel.id);
      channelFingerprints.set(fingerprint, channel.id);
      channelsImported += 1;
    }

    const existingRules = await listRules();
    const ruleFingerprints = new Set(existingRules.map(ruleFingerprint));
    let rulesImported = 0;
    let rulesSkipped = 0;
    for (const source of bundle.rules) {
      const scope = remapRuleScope(source.scope, { accountIds, groupIds, checkIds });
      if (!scope) {
        rulesSkipped += 1;
        continue;
      }
      const candidate = { ...source, scope };
      const fingerprint = ruleFingerprint(candidate);
      if (ruleFingerprints.has(fingerprint)) {
        rulesSkipped += 1;
        continue;
      }
      const mappedChannelIds = (source.channelIds ?? []).map((id) => channelIds.get(id)).filter((id): id is string => Boolean(id));
      await saveRule({
        name: source.name,
        metric: source.metric,
        operator: source.operator,
        threshold: source.threshold,
        scope,
        channelIds: mappedChannelIds.length > 0 ? mappedChannelIds : undefined,
        enabled: source.enabled,
        minSeverity: source.minSeverity,
        forMinutes: source.forMinutes,
        cooldownMinutes: source.cooldownMinutes,
        dedupeMinutes: source.dedupeMinutes,
      });
      ruleFingerprints.add(fingerprint);
      rulesImported += 1;
    }

    const existingSlos = await listSlos();
    const sloFingerprints = new Set(existingSlos.map(sloFingerprint));
    let slosImported = 0;
    let slosSkipped = 0;
    for (const source of bundle.slos) {
      const scope = remapSloScope(source.scope, { accountIds, groupIds });
      if (!scope) {
        slosSkipped += 1;
        continue;
      }
      const candidate = { ...source, scope };
      const fingerprint = sloFingerprint(candidate);
      if (sloFingerprints.has(fingerprint)) {
        slosSkipped += 1;
        continue;
      }
      await saveSlo({ name: source.name, scope, target: source.target, windowDays: source.windowDays });
      sloFingerprints.add(fingerprint);
      slosImported += 1;
    }

    const existingDashboards = await listDashboards();
    const dashboardNames = new Set(existingDashboards.map((dashboard) => normalizedKey(dashboard.name)));
    let dashboardsImported = 0;
    let dashboardsSkipped = 0;
    for (const source of bundle.dashboards) {
      const dashboard = asRecord(source);
      const dashboardName = clean(dashboard.name);
      if (!dashboardName) {
        dashboardsSkipped += 1;
        continue;
      }
      const nameKey = normalizedKey(dashboardName);
      if (dashboardNames.has(nameKey)) {
        dashboardsSkipped += 1;
        continue;
      }
      const sourcePanels = Array.isArray(dashboard.panels) ? dashboard.panels : [];
      const panels = sourcePanels
        .map((panel) => remapPanel(panel, { accountIds, groupIds, checkIds }))
        .filter((panel): panel is DashboardPanel => panel !== null);
      if (sourcePanels.length > 0 && panels.length === 0) {
        dashboardsSkipped += 1;
        continue;
      }
      const input: DashboardInput = {
        name: dashboardName,
        description: clean(dashboard.description),
        range: dashboard.range as DashboardInput["range"],
        refreshSeconds: typeof dashboard.refreshSeconds === "number" && Number.isFinite(dashboard.refreshSeconds)
          ? dashboard.refreshSeconds
          : undefined,
        variables: remapDashboardVariables(dashboard.variables, { accountIds, groupIds, checkIds }),
        panels,
      };
      await saveDashboard(input);
      dashboardNames.add(nameKey);
      dashboardsImported += 1;
    }

    const existingServiceMetadata = await listServiceMetadata();
    const existingServiceIds = new Set(existingServiceMetadata.map((metadata) => metadata.serviceId));
    let serviceMetadataImported = 0;
    let serviceMetadataSkipped = 0;
    for (const source of bundle.serviceMetadata ?? []) {
      const serviceId = remapServiceId(source.serviceId, { accountIds, groupIds });
      if (!serviceId || existingServiceIds.has(serviceId)) {
        serviceMetadataSkipped += 1;
        continue;
      }
      await saveServiceMetadata({
        serviceId,
        owner: source.owner,
        tier: source.tier,
        runbookUrl: source.runbookUrl,
        dashboardUrl: source.dashboardUrl,
        repositoryUrl: source.repositoryUrl,
        dependencies: source.dependencies,
        notes: source.notes,
      });
      existingServiceIds.add(serviceId);
      serviceMetadataImported += 1;
    }

    const uiFilters = sanitizedFilters(bundle.uiFilters);
    return {
      accountsImported,
      accountsSkipped,
      groupsImported,
      dashboardsImported,
      dashboardsSkipped,
      checksImported,
      checksSkipped,
      rulesImported,
      rulesSkipped,
      slosImported,
      slosSkipped,
      channelsImported,
      channelsSkipped,
      serviceMetadataImported,
      serviceMetadataSkipped,
      filtersImported: Object.keys(uiFilters).length,
      filePath,
      uiFilters,
    };
  });

  logger.info("setup", "✓ Setup handlers registered");
}
