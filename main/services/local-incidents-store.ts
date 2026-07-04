/**
 * Local incident lifecycle store. Provider-side incident mutation APIs are
 * intentionally out of scope here; this persists only local workflow metadata.
 */

import { DataStore } from "./data-store.js";
import type {
  LocalIncident,
  LocalIncidentInput,
  LocalIncidentNote,
  LocalIncidentStatus,
  ObservabilitySeverity,
} from "./types.js";

interface LocalIncidentsFile {
  version: 1;
  incidents: LocalIncident[];
}

const store = new DataStore<LocalIncidentsFile>("local-incidents.json", { version: 1, incidents: [] });

const SEVERITIES = new Set<ObservabilitySeverity>(["critical", "high", "medium", "low", "info"]);
const STATUSES = new Set<LocalIncidentStatus>(["open", "acknowledged", "resolved"]);

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function noteFrom(body: string | undefined, now: string): LocalIncidentNote | undefined {
  const text = clean(body);
  if (!text) return undefined;
  return { id: globalThis.crypto.randomUUID(), body: text, createdAt: now };
}

function sortIncidents(incidents: LocalIncident[]): LocalIncident[] {
  return [...incidents].sort((a, b) => {
    if (a.status !== b.status) {
      if (a.status === "resolved") return 1;
      if (b.status === "resolved") return -1;
    }
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

export async function listLocalIncidents(): Promise<LocalIncident[]> {
  return sortIncidents((await store.load()).incidents);
}

export async function getLocalIncident(id: string): Promise<LocalIncident | undefined> {
  const data = await store.load();
  return data.incidents.find((incident) => incident.id === id);
}

export async function saveLocalIncident(input: LocalIncidentInput): Promise<LocalIncident> {
  const title = clean(input.title);
  if (!title) throw new Error("Incident title is required.");
  const data = await store.load();
  const now = new Date().toISOString();
  const existing = input.id ? data.incidents.find((incident) => incident.id === input.id) : undefined;
  const nextStatus = STATUSES.has(input.status ?? "open") ? input.status ?? "open" : "open";
  const nextNote = noteFrom(input.note, now);
  const incident: LocalIncident = {
    id: existing?.id ?? globalThis.crypto.randomUUID(),
    sourceKind: input.sourceKind ?? existing?.sourceKind ?? "manual",
    sourceUid: clean(input.sourceUid) ?? existing?.sourceUid,
    sourceUrl: clean(input.sourceUrl) ?? existing?.sourceUrl,
    accountId: clean(input.accountId) ?? existing?.accountId,
    provider: input.provider ?? existing?.provider,
    title,
    description: clean(input.description),
    status: nextStatus,
    severity: SEVERITIES.has(input.severity ?? "medium") ? input.severity ?? "medium" : "medium",
    assignee: clean(input.assignee),
    rootCause: clean(input.rootCause),
    resolvedReason: clean(input.resolvedReason),
    relatedEventIds: input.relatedEventIds ?? existing?.relatedEventIds ?? [],
    notes: [...(existing?.notes ?? []), ...(nextNote ? [nextNote] : [])],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    acknowledgedAt: nextStatus === "acknowledged" ? existing?.acknowledgedAt ?? now : existing?.acknowledgedAt,
    resolvedAt: nextStatus === "resolved" ? existing?.resolvedAt ?? now : undefined,
  };
  const incidents = existing
    ? data.incidents.map((candidate) => candidate.id === incident.id ? incident : candidate)
    : [...data.incidents, incident];
  await store.save({ version: 1, incidents });
  return incident;
}

export async function updateLocalIncidentStatus(id: string, status: LocalIncidentStatus, reason?: string): Promise<LocalIncident> {
  const data = await store.load();
  const existing = data.incidents.find((incident) => incident.id === id);
  if (!existing) throw new Error("Incident not found.");
  const now = new Date().toISOString();
  const next: LocalIncident = {
    ...existing,
    status,
    resolvedReason: status === "resolved" ? clean(reason) ?? existing.resolvedReason : existing.resolvedReason,
    acknowledgedAt: status === "acknowledged" ? existing.acknowledgedAt ?? now : existing.acknowledgedAt,
    resolvedAt: status === "resolved" ? now : undefined,
    updatedAt: now,
  };
  await store.save({ version: 1, incidents: data.incidents.map((incident) => incident.id === id ? next : incident) });
  return next;
}

export async function deleteLocalIncident(id: string): Promise<void> {
  const data = await store.load();
  await store.save({ version: 1, incidents: data.incidents.filter((incident) => incident.id !== id) });
}
