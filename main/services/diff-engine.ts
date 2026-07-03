/**
 * Status-transition detection to drive notifications. Tracks the last-seen
 * status per item uid. Seeds silently on the first cycle so launch doesn't
 * produce a notification storm.
 */

import type { MonitorItem, NormalizedStatus } from "./types.js";

export interface StatusTransition {
  item: MonitorItem;
  previous: NormalizedStatus | undefined; // undefined = newly-seen
  next: NormalizedStatus;
}

const lastStatus = new Map<string, NormalizedStatus>();
let seeded = false;

/**
 * Compare the incoming items against the last-seen statuses.
 * Returns the transitions worth notifying about (empty on the seed cycle).
 */
export function detectTransitions(items: MonitorItem[]): StatusTransition[] {
  const transitions: StatusTransition[] = [];

  for (const item of items) {
    const previous = lastStatus.get(item.uid);
    if (previous !== item.status) {
      // Only report transitions after the first (seed) cycle.
      if (seeded && (previous === undefined ? isTerminal(item.status) : true)) {
        transitions.push({ item, previous, next: item.status });
      }
      lastStatus.set(item.uid, item.status);
    }
  }

  seeded = true;
  return transitions;
}

function isTerminal(status: NormalizedStatus): boolean {
  return status === "success" || status === "failure";
}

export function forgetItem(uid: string): void {
  lastStatus.delete(uid);
}

export function forgetAccount(accountId: string): void {
  const prefix = `${accountId}:`;
  for (const key of [...lastStatus.keys()]) {
    if (key.startsWith(prefix)) lastStatus.delete(key);
  }
}
