/**
 * Account metadata persistence (accounts.json). NEVER stores tokens —
 * tokens live in the encrypted token-store keyed by account id.
 */

import { randomUUID } from "crypto";

import { DataStore } from "./data-store.js";
import type { Account, ProjectGroup } from "./types.js";

interface StoredAccountsFile {
  accounts: Account[];
  groups?: ProjectGroup[];
}

interface AccountsFile {
  accounts: Account[];
  groups: ProjectGroup[];
}

const store = new DataStore<StoredAccountsFile>("accounts.json", { accounts: [], groups: [] });

/**
 * Map any legacy account shape (per-provider `login`/`accountName`/
 * `cloudflareAccountId`/`repoFilter` fields from the original two-provider
 * build) onto the generic `identity` + `config` shape.
 */
function migrate(account: Account): Account {
  const legacy = account as Account & {
    login?: string;
    accountName?: string;
    cloudflareAccountId?: string;
    repoFilter?: string[];
  };
  if (account.identity && account.config) return account;

  const config: Record<string, string> = { ...(account.config ?? {}) };
  if (legacy.cloudflareAccountId && config.accountId === undefined) config.accountId = legacy.cloudflareAccountId;
  if (Array.isArray(legacy.repoFilter) && config.repos === undefined) config.repos = legacy.repoFilter.join(", ");

  return {
    ...account,
    identity: account.identity ?? legacy.login ?? legacy.accountName,
    config,
  };
}

function normalize(file: StoredAccountsFile): AccountsFile {
  return {
    accounts: file.accounts.map(migrate),
    groups: file.groups ?? [],
  };
}

function pruneUnusedGroups(file: AccountsFile): AccountsFile {
  const used = new Set(file.accounts.map((account) => account.groupId).filter((id): id is string => Boolean(id)));
  return {
    ...file,
    groups: file.groups.filter((group) => used.has(group.id)),
  };
}

async function loadFile(): Promise<AccountsFile> {
  return normalize(await store.load());
}

async function saveFile(file: AccountsFile): Promise<void> {
  await store.save(file);
}

export async function listAccounts(): Promise<Account[]> {
  const file = await loadFile();
  return file.accounts;
}

export async function getAccount(id: string): Promise<Account | undefined> {
  const accounts = await listAccounts();
  return accounts.find((a) => a.id === id);
}

export async function listGroups(): Promise<ProjectGroup[]> {
  const file = await loadFile();
  return [...file.groups].sort((a, b) => a.name.localeCompare(b.name));
}

export async function resolveGroupAssignment(input: { groupId?: string | null; newGroupName?: string }): Promise<string | undefined> {
  const file = await loadFile();
  const newGroupName = input.newGroupName;

  if (newGroupName !== undefined) {
    const name = newGroupName.trim();
    if (name === "") {
      throw new Error("Group name is required.");
    }

    const existing = file.groups.find((group) => group.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing.id;

    const group: ProjectGroup = {
      id: randomUUID(),
      name,
      createdAt: new Date().toISOString(),
    };
    file.groups.push(group);
    await saveFile(file);
    return group.id;
  }

  if (input.groupId === null || input.groupId === undefined) return undefined;

  const groupId = input.groupId.trim();
  if (groupId === "") {
    throw new Error("Group id is required.");
  }
  if (!file.groups.some((group) => group.id === groupId)) {
    throw new Error(`Group not found: ${groupId}`);
  }
  return groupId;
}

export async function addAccount(account: Account): Promise<Account> {
  const file = await loadFile();
  file.accounts.push(account);
  await saveFile(file);
  return account;
}

export async function updateAccount(id: string, patch: Partial<Account>): Promise<Account> {
  const file = await loadFile();
  const index = file.accounts.findIndex((a) => a.id === id);
  if (index === -1) {
    throw new Error(`Account not found: ${id}`);
  }
  // Preserve the discriminant `provider` and `id`.
  const merged = { ...file.accounts[index], ...patch, id, provider: file.accounts[index].provider } as Account;
  if ("groupId" in patch && patch.groupId === undefined) delete merged.groupId;
  file.accounts[index] = merged;
  await saveFile(pruneUnusedGroups(file));
  return merged;
}

export async function removeAccount(id: string): Promise<void> {
  const file = await loadFile();
  file.accounts = file.accounts.filter((a) => a.id !== id);
  await saveFile(pruneUnusedGroups(file));
}
