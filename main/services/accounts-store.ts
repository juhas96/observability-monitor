/**
 * Account metadata persistence (accounts.json). NEVER stores tokens —
 * tokens live in the encrypted token-store keyed by account id.
 */

import { DataStore } from "./data-store.js";
import type { Account } from "./types.js";

interface AccountsFile {
  accounts: Account[];
}

const store = new DataStore<AccountsFile>("accounts.json", { accounts: [] });

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

export async function listAccounts(): Promise<Account[]> {
  const file = await store.load();
  return file.accounts.map(migrate);
}

export async function getAccount(id: string): Promise<Account | undefined> {
  const accounts = await listAccounts();
  return accounts.find((a) => a.id === id);
}

export async function addAccount(account: Account): Promise<Account> {
  const accounts = await listAccounts();
  accounts.push(account);
  await store.save({ accounts });
  return account;
}

export async function updateAccount(id: string, patch: Partial<Account>): Promise<Account> {
  const accounts = await listAccounts();
  const index = accounts.findIndex((a) => a.id === id);
  if (index === -1) {
    throw new Error(`Account not found: ${id}`);
  }
  // Preserve the discriminant `provider` and `id`.
  const merged = { ...accounts[index], ...patch, id, provider: accounts[index].provider } as Account;
  accounts[index] = merged;
  await store.save({ accounts });
  return merged;
}

export async function removeAccount(id: string): Promise<void> {
  const accounts = await listAccounts();
  const next = accounts.filter((a) => a.id !== id);
  await store.save({ accounts: next });
}
