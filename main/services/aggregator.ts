/**
 * In-memory cache of the latest normalized items across all accounts.
 * Holds the last snapshot and rebuilds it as accounts are (re)fetched.
 */

import type {
  AggregateSnapshot,
  MonitorItem,
  NormalizedStatus,
  PerAccountStatus,
} from "./types.js";

const MAX_ITEMS_PER_ACCOUNT = 50;

// accountId -> its most recent items (already capped, newest-first)
const itemsByAccount = new Map<string, MonitorItem[]>();
const perAccount = new Map<string, PerAccountStatus>();

/** Priority for computing the worst/most-relevant aggregate status. */
const STATUS_PRIORITY: NormalizedStatus[] = [
  "failure",
  "warning",
  "running",
  "queued",
  "success",
  "info",
  "cancelled",
  "unknown",
];

function worstStatus(items: MonitorItem[]): NormalizedStatus {
  for (const status of STATUS_PRIORITY) {
    if (items.some((i) => i.status === status)) return status;
  }
  return "unknown";
}

export function setAccountItems(accountId: string, items: MonitorItem[], lastSyncAt: string): void {
  const sorted = [...items]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, MAX_ITEMS_PER_ACCOUNT);
  itemsByAccount.set(accountId, sorted);
  perAccount.set(accountId, { count: sorted.length, lastSyncAt, lastError: undefined });
}

export function setAccountError(accountId: string, error: string, lastSyncAt: string): void {
  const existing = perAccount.get(accountId);
  perAccount.set(accountId, { count: existing?.count ?? 0, lastError: error, lastSyncAt });
}

export function removeAccount(accountId: string): void {
  itemsByAccount.delete(accountId);
  perAccount.delete(accountId);
}

/** Keep the cache in sync with the set of currently-known account ids. */
export function pruneToAccounts(accountIds: Set<string>): void {
  for (const id of [...itemsByAccount.keys()]) {
    if (!accountIds.has(id)) itemsByAccount.delete(id);
  }
  for (const id of [...perAccount.keys()]) {
    if (!accountIds.has(id)) perAccount.delete(id);
  }
}

export function buildSnapshot(): AggregateSnapshot {
  const allItems: MonitorItem[] = [];
  for (const items of itemsByAccount.values()) allItems.push(...items);
  allItems.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  const perAccountObj: Record<string, PerAccountStatus> = {};
  for (const [id, status] of perAccount.entries()) perAccountObj[id] = status;

  // Aggregate status is driven by the most recent active items only.
  return {
    items: allItems,
    perAccount: perAccountObj,
    aggregateStatus: worstStatus(allItems),
    generatedAt: new Date().toISOString(),
  };
}
