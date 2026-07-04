/**
 * Account CRUD + credential validation IPC handlers, driven by the provider
 * registry. Credentials arrive as a flat `creds` map keyed by each provider's
 * CredentialField keys. The one secret field is encrypted into the token-store;
 * non-secret fields are persisted in `account.config`. Secrets are NEVER
 * returned by accounts:list.
 */

import * as fs from "fs/promises";
import { randomUUID } from "crypto";

import { dialog, ipcMain, logger } from "@glaze/core/backend";

import {
  addAccount,
  getAccount,
  listAccounts,
  listGroups,
  removeAccount,
  resolveGroupAssignment,
  updateAccount,
} from "../services/accounts-store.js";
import * as registry from "../services/providers/index.js";
import * as poller from "../services/poller.js";
import { getToken, removeToken, setToken } from "../services/token-store.js";
import { pushSnapshot } from "../services/push.js";
import * as aggregator from "../services/aggregator.js";
import type { Account, ProjectGroup, Provider } from "../services/types.js";

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error("Invalid request payload.");
  }
  return value as Record<string, unknown>;
}

function asProvider(value: unknown): Provider {
  if (typeof value === "string" && registry.has(value)) return value;
  throw new Error(`Unknown provider: ${String(value)}`);
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing or invalid "${field}".`);
  }
  return value.trim();
}

function asCreds(value: unknown): Record<string, string> {
  const rec = asRecord(value);
  const creds: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec)) {
    if (typeof v === "string") creds[k] = v;
  }
  return creds;
}

function asOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error(`Invalid "${field}".`);
  }
  return value;
}

function asOptionalGroupId(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string") return value.trim();
  throw new Error('Invalid "groupId".');
}

function groupInput(req: Record<string, unknown>): { groupId?: string | null; newGroupName?: string } {
  return {
    groupId: asOptionalGroupId(req.groupId),
    newGroupName: asOptionalString(req.newGroupName, "newGroupName"),
  };
}

interface AccountBackupFile {
  app: "multi-monitor";
  version: 1;
  exportedAt: string;
  groups: ProjectGroup[];
  accounts: Pick<Account, "provider" | "label" | "groupId" | "createdAt" | "enabled" | "identity" | "config">[];
}

interface AccountImportSummary {
  imported: number;
  skipped: number;
  groupsCreated: number;
  filePath?: string;
}

function accountFingerprint(account: Pick<Account, "provider" | "label" | "identity" | "config">): string {
  return JSON.stringify({
    provider: account.provider,
    label: account.label.trim().toLowerCase(),
    identity: account.identity?.trim().toLowerCase() ?? "",
    config: account.config ?? {},
  });
}

function asAccountBackupFile(value: unknown): AccountBackupFile {
  const file = asRecord(value);
  if (file.app !== "multi-monitor" || file.version !== 1) {
    throw new Error("This is not a supported Multi Monitor account setup export.");
  }
  if (!Array.isArray(file.accounts) || !Array.isArray(file.groups)) {
    throw new Error("Invalid account setup export.");
  }
  const groups = file.groups.map((candidate) => {
    const group = asRecord(candidate);
    return {
      id: asString(group.id, "group.id"),
      name: asString(group.name, "group.name"),
      createdAt: asString(group.createdAt, "group.createdAt"),
    };
  });
  const accounts = file.accounts.map((candidate) => {
    const account = asRecord(candidate);
    const provider = asProvider(account.provider);
    return {
      provider,
      label: asString(account.label, "account.label"),
      groupId: typeof account.groupId === "string" ? account.groupId : undefined,
      createdAt: typeof account.createdAt === "string" ? account.createdAt : new Date().toISOString(),
      enabled: typeof account.enabled === "boolean" ? account.enabled : false,
      identity: typeof account.identity === "string" ? account.identity : undefined,
      config: typeof account.config === "object" && account.config !== null ? (account.config as Record<string, string>) : {},
    };
  });
  return {
    app: "multi-monitor",
    version: 1,
    exportedAt: typeof file.exportedAt === "string" ? file.exportedAt : new Date().toISOString(),
    groups,
    accounts,
  };
}

/** Split a creds map into the encrypted secret value + persisted non-secret config. */
function splitCreds(
  provider: Provider,
  creds: Record<string, string>,
): { secret?: string; config: Record<string, string>; clearedConfigKeys: string[] } {
  const def = registry.get(provider);
  let secret: string | undefined;
  const config: Record<string, string> = {};
  const clearedConfigKeys: string[] = [];
  for (const field of def.fields) {
    const rawValue = creds[field.key];
    if (rawValue === undefined) continue;
    const value = rawValue.trim();
    if (field.secret) {
      if (value !== "") secret = value;
    } else if (value === "") {
      clearedConfigKeys.push(field.key);
    } else {
      config[field.key] = value;
    }
  }
  return { secret, config, clearedConfigKeys };
}

/** Ensure all required fields are present in the effective credential set. */
function assertRequired(provider: Provider, secret: string | undefined, config: Record<string, string>): void {
  const def = registry.get(provider);
  for (const field of def.fields) {
    if (!field.required) continue;
    const present = field.secret ? Boolean(secret) : Boolean(config[field.key]);
    if (!present) throw new Error(`Missing required field "${field.label}".`);
  }
}

export function registerAccountHandlers(): void {
  ipcMain.handle("accounts:list", async (): Promise<Account[]> => {
    return await listAccounts();
  });

  ipcMain.handle("groups:list", async (): Promise<ProjectGroup[]> => {
    return await listGroups();
  });

  ipcMain.handle("accounts:test", async (_event, payload: unknown) => {
    const req = asRecord(payload);
    const provider = asProvider(req.provider);
    const creds = asCreds(req.creds);
    try {
      const { secret, config } = splitCreds(provider, creds);
      assertRequired(provider, secret, config);
      const { identity } = await registry.get(provider).validate({ ...config, ...(secret ? { [registry.secretField(provider).key]: secret } : {}) });
      return { ok: true, identity };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle("accounts:add", async (_event, payload: unknown): Promise<{ account: Account }> => {
    const req = asRecord(payload);
    const provider = asProvider(req.provider);
    const label = asString(req.label, "label");
    const creds = asCreds(req.creds);

    const { secret, config } = splitCreds(provider, creds);
    assertRequired(provider, secret, config);

    const secretKey = registry.secretField(provider).key;
    const { identity } = await registry.get(provider).validate({ ...config, ...(secret ? { [secretKey]: secret } : {}) });
    const groupId = await resolveGroupAssignment(groupInput(req));

    const account: Account = {
      id: randomUUID(),
      provider,
      label,
      groupId,
      createdAt: new Date().toISOString(),
      enabled: true,
      identity,
      config,
    };

    if (secret) await setToken(account.id, secret);
    await addAccount(account);
    logger.info("accounts", "Account added", { id: account.id, provider });

    void poller.refresh(account.id);
    return { account };
  });

  ipcMain.handle("accounts:update", async (_event, payload: unknown): Promise<{ account: Account }> => {
    const req = asRecord(payload);
    const id = asString(req.id, "id");
    const existing = await getAccount(id);
    if (!existing) throw new Error(`Account not found: ${id}`);
    const provider = existing.provider;
    const secretKey = registry.secretField(provider).key;

    const patch: Partial<Account> = {};
    const hasGroupPatch = req.groupId !== undefined || req.newGroupName !== undefined;
    const nextGroupInput = hasGroupPatch ? groupInput(req) : undefined;
    let secretToStore: string | undefined;
    if (typeof req.label === "string") patch.label = req.label.trim();
    if (typeof req.enabled === "boolean") patch.enabled = req.enabled;

    if (req.creds !== undefined) {
      const { secret, config, clearedConfigKeys } = splitCreds(provider, asCreds(req.creds));
      // Merge non-secret config over the existing config.
      const mergedConfig = { ...(existing.config ?? {}) };
      for (const key of clearedConfigKeys) delete mergedConfig[key];
      Object.assign(mergedConfig, config);
      // Re-validate with the new secret (if provided) or the stored one.
      const effectiveSecret = secret ?? (await getToken(id)) ?? undefined;
      assertRequired(provider, effectiveSecret, mergedConfig);
      const { identity } = await registry
        .get(provider)
        .validate({ ...mergedConfig, ...(effectiveSecret ? { [secretKey]: effectiveSecret } : {}) });
      patch.config = mergedConfig;
      patch.identity = identity;
      secretToStore = secret;
    }

    if (nextGroupInput) patch.groupId = await resolveGroupAssignment(nextGroupInput);
    if (secretToStore) await setToken(id, secretToStore);

    const account = await updateAccount(id, patch);
    void poller.refresh(account.id);
    return { account };
  });

  ipcMain.handle("accounts:remove", async (_event, payload: unknown): Promise<{ ok: true }> => {
    const req = asRecord(payload);
    const id = asString(req.id, "id");
    await removeToken(id);
    await removeAccount(id);
    poller.dropAccount(id);
    logger.info("accounts", "Account removed", { id });
    aggregator.removeAccount(id);
    aggregator.setKnownAccounts(await listAccounts(), await listGroups());
    pushSnapshot(aggregator.buildSnapshot());
    return { ok: true };
  });

  ipcMain.handle("accounts:exportSetup", async (): Promise<{ ok: boolean; filePath?: string }> => {
    const [accounts, groups] = await Promise.all([listAccounts(), listGroups()]);
    const backup: AccountBackupFile = {
      app: "multi-monitor",
      version: 1,
      exportedAt: new Date().toISOString(),
      groups,
      accounts: accounts.map((account) => ({
        provider: account.provider,
        label: account.label,
        groupId: account.groupId,
        createdAt: account.createdAt,
        enabled: account.enabled,
        identity: account.identity,
        config: account.config ?? {},
      })),
    };
    const stamp = new Date().toISOString().slice(0, 10);
    const result = await dialog.showSaveDialog({
      title: "Export account setup",
      defaultPath: `multi-monitor-account-setup-${stamp}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return { ok: false };
    await fs.writeFile(result.filePath, JSON.stringify(backup, null, 2), "utf-8");
    return { ok: true, filePath: result.filePath };
  });

  ipcMain.handle("accounts:importSetup", async (): Promise<AccountImportSummary> => {
    const result = await dialog.showOpenDialog({
      title: "Import account setup",
      filters: [{ name: "JSON", extensions: ["json"] }],
      properties: ["openFile"],
    });
    if (result.canceled || !result.filePaths?.[0]) {
      return { imported: 0, skipped: 0, groupsCreated: 0 };
    }

    const filePath = result.filePaths[0];
    const parsed = JSON.parse(await fs.readFile(filePath, "utf-8")) as unknown;
    const backup = asAccountBackupFile(parsed);
    const existingAccounts = await listAccounts();
    const existingGroups = await listGroups();
    const existingFingerprints = new Set(existingAccounts.map(accountFingerprint));
    const groupsByName = new Map(existingGroups.map((group) => [group.name.trim().toLowerCase(), group.id]));
    const exportedGroupsById = new Map(backup.groups.map((group) => [group.id, group]));
    const groupIdMap = new Map<string, string>();
    let groupsCreated = 0;

    for (const group of backup.groups) {
      const key = group.name.trim().toLowerCase();
      const existingGroupId = groupsByName.get(key);
      if (existingGroupId) {
        groupIdMap.set(group.id, existingGroupId);
        continue;
      }
      const groupId = await resolveGroupAssignment({ newGroupName: group.name });
      if (groupId) {
        groupsByName.set(key, groupId);
        groupIdMap.set(group.id, groupId);
        groupsCreated += 1;
      }
    }

    let imported = 0;
    let skipped = 0;
    for (const source of backup.accounts) {
      const fingerprint = accountFingerprint(source);
      if (existingFingerprints.has(fingerprint)) {
        skipped += 1;
        continue;
      }
      let groupId = source.groupId ? groupIdMap.get(source.groupId) : undefined;
      if (!groupId && source.groupId) {
        const exportedGroup = exportedGroupsById.get(source.groupId);
        if (exportedGroup) groupId = await resolveGroupAssignment({ newGroupName: exportedGroup.name });
      }
      const account: Account = {
        id: randomUUID(),
        provider: source.provider,
        label: source.label,
        groupId,
        createdAt: new Date().toISOString(),
        enabled: false,
        identity: source.identity,
        config: source.config ?? {},
      };
      await addAccount(account);
      existingFingerprints.add(fingerprint);
      imported += 1;
    }

    aggregator.setKnownAccounts(await listAccounts(), await listGroups());
    pushSnapshot(aggregator.buildSnapshot());
    return { imported, skipped, groupsCreated, filePath };
  });

  logger.info("accounts", "✓ Account handlers registered");
}
