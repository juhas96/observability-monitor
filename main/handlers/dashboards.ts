/**
 * Custom dashboard IPC handlers.
 */

import * as fs from "fs/promises";

import { ipcMain, logger } from "@glaze/core/backend";
import { dialog } from "@glaze/core/backend";

import { listAccounts, listGroups } from "../services/accounts-store.js";
import { listChecks } from "../services/checks-store.js";
import { listDashboardCapabilities, runDashboardPanel } from "../services/dashboard-query-runner.js";
import { deleteDashboard, listDashboards, saveDashboard } from "../services/dashboard-store.js";
import { historyRange } from "../services/history-store.js";
import type {
  Account,
  DashboardDefinition,
  DashboardInput,
  DashboardLocalSource,
  DashboardPanel,
  DashboardPanelSource,
  DashboardPanelResult,
  DashboardPanelScope,
  DashboardQueryCapability,
  HttpCheck,
  ProjectGroup,
} from "../services/types.js";

interface DashboardExportBundle {
  app: "multi-monitor";
  kind: "dashboard-export";
  version: 1;
  exportedAt: string;
  secretsIncluded: false;
  dashboards: DashboardDefinition[];
  accounts: Pick<Account, "id" | "provider" | "label" | "identity">[];
  groups: ProjectGroup[];
  checks: Pick<HttpCheck, "id" | "name" | "url" | "method" | "groupId">[];
}

interface DashboardImportSummary {
  imported: number;
  skipped: number;
  panelsSkipped: number;
  filePath?: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) return {};
  return value as Record<string, unknown>;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`Missing or invalid "${field}".`);
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function parsePanels(value: unknown): DashboardPanel[] {
  if (!Array.isArray(value)) return [];
  return value.filter((panel): panel is DashboardPanel => {
    const rec = asRecord(panel);
    const source = asRecord(rec.source);
    return typeof rec.title === "string" && (source.kind === "local" || source.kind === "provider");
  }) as DashboardPanel[];
}

function parseDashboardInput(payload: unknown): DashboardInput {
  const req = asRecord(payload);
  return {
    id: optionalString(req.id),
    name: asString(req.name, "name"),
    description: optionalString(req.description),
    range: historyRange(req.range),
    refreshSeconds: typeof req.refreshSeconds === "number" && Number.isFinite(req.refreshSeconds)
      ? req.refreshSeconds
      : undefined,
    variables: asRecord(req.variables),
    panels: parsePanels(req.panels),
  };
}

function normalizedKey(value: string): string {
  return value.trim().toLowerCase();
}

function accountKey(account: Pick<Account, "provider" | "label" | "identity">): string {
  return JSON.stringify({
    provider: account.provider,
    label: normalizedKey(account.label),
    identity: account.identity ? normalizedKey(account.identity) : "",
  });
}

function checkKey(check: Pick<HttpCheck, "name" | "url" | "method">): string {
  return JSON.stringify({
    name: normalizedKey(check.name),
    url: check.url.trim(),
    method: check.method.toUpperCase(),
  });
}

function sourceScope(source: unknown): DashboardPanelScope {
  const raw = asRecord(source);
  if (raw.kind === "provider") return { accountId: optionalString(raw.accountId) };
  return {
    accountId: optionalString(raw.accountId),
    groupId: optionalString(raw.groupId),
    checkId: optionalString(raw.checkId),
  };
}

function addSourceRefs(source: unknown, accountIds: Set<string>, groupIds: Set<string>, checkIds: Set<string>) {
  const scope = sourceScope(source);
  if (scope.accountId) accountIds.add(scope.accountId);
  if (scope.groupId) groupIds.add(scope.groupId);
  if (scope.checkId) checkIds.add(scope.checkId);
}

function asBundle(value: unknown): DashboardExportBundle {
  const raw = asRecord(value);
  if (raw.app !== "multi-monitor" || raw.kind !== "dashboard-export" || raw.version !== 1 || raw.secretsIncluded !== false) {
    throw new Error("This is not a supported Multi Monitor dashboard export.");
  }
  return {
    app: "multi-monitor",
    kind: "dashboard-export",
    version: 1,
    exportedAt: optionalString(raw.exportedAt) ?? new Date().toISOString(),
    secretsIncluded: false,
    dashboards: Array.isArray(raw.dashboards) ? raw.dashboards as DashboardDefinition[] : [],
    accounts: Array.isArray(raw.accounts) ? raw.accounts as DashboardExportBundle["accounts"] : [],
    groups: Array.isArray(raw.groups) ? raw.groups as ProjectGroup[] : [],
    checks: Array.isArray(raw.checks) ? raw.checks as DashboardExportBundle["checks"] : [],
  };
}

function remapSource(
  source: unknown,
  accountIds: Map<string, string>,
  groupIds: Map<string, string>,
  checkIds: Map<string, string>,
): DashboardPanelSource | null {
  const raw = asRecord(source);
  if (raw.kind === "provider") {
    const sourceAccountId = optionalString(raw.accountId);
    const capabilityId = optionalString(raw.capabilityId);
    if (!sourceAccountId || !capabilityId) return null;
    const accountId = accountIds.get(sourceAccountId);
    return accountId ? { ...(raw as unknown as DashboardPanelSource), kind: "provider", accountId, capabilityId } : null;
  }
  if (raw.kind !== "local") return null;
  const next = { ...(raw as unknown as DashboardLocalSource), kind: "local" as const };
  if (next.accountId) {
    const accountId = accountIds.get(next.accountId);
    if (!accountId) return null;
    next.accountId = accountId;
  }
  if (next.groupId) {
    const groupId = groupIds.get(next.groupId);
    if (!groupId) return null;
    next.groupId = groupId;
  }
  if (next.checkId) {
    const checkId = checkIds.get(next.checkId);
    if (!checkId) return null;
    next.checkId = checkId;
  }
  return next;
}

function remapVariables(
  variables: unknown,
  accountIds: Map<string, string>,
  groupIds: Map<string, string>,
  checkIds: Map<string, string>,
): DashboardPanelScope | undefined {
  const raw = asRecord(variables);
  const next: DashboardPanelScope = {
    provider: optionalString(raw.provider) as DashboardPanelScope["provider"],
    owner: optionalString(raw.owner),
    tier: optionalString(raw.tier) as DashboardPanelScope["tier"],
    dependency: optionalString(raw.dependency),
  };
  const accountId = optionalString(raw.accountId);
  if (accountId) next.accountId = accountIds.get(accountId);
  const groupId = optionalString(raw.groupId);
  if (groupId) next.groupId = groupIds.get(groupId);
  const checkId = optionalString(raw.checkId);
  if (checkId) next.checkId = checkIds.get(checkId);
  return Object.values(next).some(Boolean) ? next : undefined;
}

function dashboardInputName(name: unknown, existingNames: Set<string>): string {
  const base = optionalString(name) ?? "Imported dashboard";
  if (!existingNames.has(normalizedKey(base))) return base;
  let index = 2;
  while (existingNames.has(normalizedKey(`${base} ${index}`))) index += 1;
  return `${base} ${index}`;
}

export function registerDashboardHandlers(): void {
  ipcMain.handle("dashboards:list", async (): Promise<DashboardDefinition[]> => {
    return await listDashboards();
  });

  ipcMain.handle("dashboards:save", async (_event, payload: unknown): Promise<DashboardDefinition> => {
    return await saveDashboard(parseDashboardInput(payload));
  });

  ipcMain.handle("dashboards:delete", async (_event, payload: unknown): Promise<{ ok: true }> => {
    const req = asRecord(payload);
    await deleteDashboard(asString(req.id, "id"));
    return { ok: true };
  });

  ipcMain.handle("dashboards:export", async (_event, payload: unknown): Promise<{ ok: boolean; filePath?: string }> => {
    const req = asRecord(payload);
    const id = asString(req.id, "id");
    const dashboards = await listDashboards();
    const dashboard = dashboards.find((candidate) => candidate.id === id);
    if (!dashboard) throw new Error("Dashboard not found.");

    const accountIds = new Set<string>();
    const groupIds = new Set<string>();
    const checkIds = new Set<string>();
    addSourceRefs(dashboard.variables, accountIds, groupIds, checkIds);
    for (const panel of dashboard.panels) addSourceRefs(panel.source, accountIds, groupIds, checkIds);

    const [accounts, groups, checks] = await Promise.all([listAccounts(), listGroups(), listChecks()]);
    const bundle: DashboardExportBundle = {
      app: "multi-monitor",
      kind: "dashboard-export",
      version: 1,
      exportedAt: new Date().toISOString(),
      secretsIncluded: false,
      dashboards: [dashboard],
      accounts: accounts
        .filter((account) => accountIds.has(account.id))
        .map((account) => ({ id: account.id, provider: account.provider, label: account.label, identity: account.identity })),
      groups: groups.filter((group) => groupIds.has(group.id)),
      checks: checks
        .filter((check) => checkIds.has(check.id))
        .map((check) => ({ id: check.id, name: check.name, url: check.url, method: check.method, groupId: check.groupId })),
    };

    const safeName = dashboard.name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-|-$/g, "") || "dashboard";
    const result = await dialog.showSaveDialog({
      title: "Export dashboard",
      defaultPath: `multi-monitor-dashboard-${safeName}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return { ok: false };
    await fs.writeFile(result.filePath, JSON.stringify(bundle, null, 2), "utf-8");
    return { ok: true, filePath: result.filePath };
  });

  ipcMain.handle("dashboards:import", async (): Promise<DashboardImportSummary> => {
    const result = await dialog.showOpenDialog({
      title: "Import dashboard",
      filters: [{ name: "JSON", extensions: ["json"] }],
      properties: ["openFile"],
    });
    if (result.canceled || !result.filePaths?.[0]) return { imported: 0, skipped: 0, panelsSkipped: 0 };

    const filePath = result.filePaths[0];
    const bundle = asBundle(JSON.parse(await fs.readFile(filePath, "utf-8")) as unknown);
    const [accounts, groups, checks, existingDashboards] = await Promise.all([listAccounts(), listGroups(), listChecks(), listDashboards()]);
    const accountsById = new Map(accounts.map((account) => [account.id, account.id]));
    const accountsByKey = new Map(accounts.map((account) => [accountKey(account), account.id]));
    const groupsById = new Map(groups.map((group) => [group.id, group.id]));
    const groupsByName = new Map(groups.map((group) => [normalizedKey(group.name), group.id]));
    const checksById = new Map(checks.map((check) => [check.id, check.id]));
    const checksByKey = new Map(checks.map((check) => [checkKey(check), check.id]));

    const accountIds = new Map<string, string>();
    for (const source of bundle.accounts) {
      const matched = accountsById.get(source.id) ?? accountsByKey.get(accountKey(source));
      if (matched) accountIds.set(source.id, matched);
    }
    const groupIds = new Map<string, string>();
    for (const source of bundle.groups) {
      const matched = groupsById.get(source.id) ?? groupsByName.get(normalizedKey(source.name));
      if (matched) groupIds.set(source.id, matched);
    }
    const checkIds = new Map<string, string>();
    for (const source of bundle.checks) {
      const matched = checksById.get(source.id) ?? checksByKey.get(checkKey(source));
      if (matched) checkIds.set(source.id, matched);
    }

    const existingNames = new Set(existingDashboards.map((dashboard) => normalizedKey(dashboard.name)));
    let imported = 0;
    let skipped = 0;
    let panelsSkipped = 0;
    for (const source of bundle.dashboards) {
      const dashboard = asRecord(source);
      const sourcePanels = Array.isArray(dashboard.panels) ? dashboard.panels : [];
      const panels = sourcePanels.flatMap((panel): DashboardPanel[] => {
        const rawPanel = asRecord(panel);
        const remapped = remapSource(rawPanel.source, accountIds, groupIds, checkIds);
        if (!remapped) {
          panelsSkipped += 1;
          return [];
        }
        return [{ ...(rawPanel as unknown as DashboardPanel), source: remapped }];
      });
      if (sourcePanels.length > 0 && panels.length === 0) {
        skipped += 1;
        continue;
      }
      const name = dashboardInputName(dashboard.name, existingNames);
      await saveDashboard({
        name,
        description: optionalString(dashboard.description),
        range: historyRange(dashboard.range),
        refreshSeconds: typeof dashboard.refreshSeconds === "number" && Number.isFinite(dashboard.refreshSeconds)
          ? dashboard.refreshSeconds
          : undefined,
        variables: remapVariables(dashboard.variables, accountIds, groupIds, checkIds),
        panels,
      });
      existingNames.add(normalizedKey(name));
      imported += 1;
    }

    return { imported, skipped, panelsSkipped, filePath };
  });

  ipcMain.handle("dashboards:listCapabilities", async (): Promise<DashboardQueryCapability[]> => {
    return await listDashboardCapabilities();
  });

  ipcMain.handle("dashboards:runPanel", async (_event, payload: unknown): Promise<DashboardPanelResult> => {
    const req = asRecord(payload);
    const panel = asRecord(req.panel) as unknown as DashboardPanel;
    const source = asRecord(panel.source);
    if (typeof panel.title !== "string" || (source.kind !== "local" && source.kind !== "provider")) {
      throw new Error("Invalid dashboard panel.");
    }
    return await runDashboardPanel(panel, historyRange(req.range));
  });

  logger.info("dashboards", "✓ Dashboard handlers registered");
}
