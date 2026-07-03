/**
 * Local incident triage state. This intentionally stores only local metadata
 * keyed by normalized signal/incident ids; provider acknowledgements remain
 * outside the app until provider-specific write APIs are added.
 */

import { DataStore } from "./data-store.js";
import type { TriageState } from "./types.js";

type TriageData = Record<string, TriageState>;

const store = new DataStore<TriageData>("triage.json", {});

function activeState(state: TriageState, nowMs = Date.now()): TriageState {
  if (!state.silencedUntil) return state;
  const until = new Date(state.silencedUntil).getTime();
  if (Number.isFinite(until) && until > nowMs) return state;
  const { silencedUntil: _expired, ...rest } = state;
  return rest;
}

export async function listTriage(): Promise<TriageData> {
  const data = await store.load();
  const normalized = Object.fromEntries(Object.entries(data).map(([uid, state]) => [uid, activeState(state)]));
  if (JSON.stringify(normalized) !== JSON.stringify(data)) await store.save(normalized);
  return normalized;
}

export async function updateTriage(uid: string, patch: TriageState): Promise<TriageState> {
  const data = await listTriage();
  const next = { ...(data[uid] ?? {}), ...patch };
  const updated = { ...data, [uid]: next };
  await store.save(updated);
  return next;
}

export async function clearTriage(uid: string): Promise<void> {
  const data = await listTriage();
  const { [uid]: _removed, ...rest } = data;
  await store.save(rest);
}

export async function isSilenced(uid: string): Promise<boolean> {
  const data = await listTriage();
  const candidates = [uid, `${uid}:signal`, `${uid}:incident`];
  return candidates.some((candidate) => {
    const until = data[candidate]?.silencedUntil;
    return until ? new Date(until).getTime() > Date.now() : false;
  });
}
