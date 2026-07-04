/**
 * Rolling history persistence for poll samples, discrete events, and SLOs.
 * The data is local-only JSON in userData and contains no provider secrets.
 */

import { DataStore } from "./data-store.js";
import type { StatusTransition } from "./diff-engine.js";
import { getSettings } from "./settings-store.js";
import { DEFAULT_SETTINGS } from "./types.js";
import type {
  AggregateSnapshot,
  CheckLatencyPoint,
  CheckSeries,
  HistoryDateRange,
  HistoryEvent,
  HistoryEventType,
  HistoryRange,
  HistorySample,
  HistorySampleAccount,
  HistoryStats,
  HistoryStatusCounts,
  HttpCheckResult,
  MonitorCategory,
  MonitorItem,
  NormalizedStatus,
  ObservabilitySeverity,
  Provider,
  SloDefinition,
  SloStatus,
} from "./types.js";

interface CheckSampleRow {
  checkId: string;
  ts: string;
  latencyMs: number;
  ok: boolean;
}

interface HistoryData {
  version: 1;
  samples: HistorySample[];
  events: HistoryEvent[];
  slos: SloDefinition[];
  checkSamples: CheckSampleRow[];
}

const DEFAULT_DATA: HistoryData = { version: 1, samples: [], events: [], slos: [], checkSamples: [] };
const store = new DataStore<HistoryData>("history.json", DEFAULT_DATA);

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_MS = DEFAULT_SETTINGS.historyRetentionDays * DAY_MS;
const MIN_SAMPLE_CAP = 4000;
const MIN_EVENT_CAP = 2000;
const MIN_CHECK_SAMPLE_CAP = 5000;
const MAX_SERIES_POINTS = 180;

const STATUS_ORDER: NormalizedStatus[] = [
  "failure",
  "warning",
  "running",
  "queued",
  "success",
  "info",
  "cancelled",
  "unknown",
];

const RANGE_MS: Record<HistoryRange, number> = {
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "14d": 14 * 24 * 60 * 60 * 1000,
};

function emptyCounts(): HistoryStatusCounts {
  return {
    success: 0,
    failure: 0,
    warning: 0,
    running: 0,
    queued: 0,
    cancelled: 0,
    info: 0,
    unknown: 0,
  };
}

async function currentRetentionDays(): Promise<number> {
  try {
    return Math.max(1, Math.round((await getSettings()).historyRetentionDays));
  } catch {
    return DEFAULT_SETTINGS.historyRetentionDays;
  }
}

async function currentRetentionMs(): Promise<number> {
  return (await currentRetentionDays()) * DAY_MS;
}

function retentionCaps(retentionMs: number): { samples: number; events: number; checkSamples: number } {
  const days = Math.max(1, Math.ceil(retentionMs / DAY_MS));
  return {
    samples: Math.max(MIN_SAMPLE_CAP, days * 24 * 60 * 2),
    events: Math.max(MIN_EVENT_CAP, days * 1000),
    checkSamples: Math.max(MIN_CHECK_SAMPLE_CAP, days * 24 * 60 * 4),
  };
}

function dateWindow(range: HistoryRange | HistoryDateRange, nowMs = Date.now(), retentionMs = DEFAULT_RETENTION_MS): { start: number; end: number; bucketMs: number } {
  if (typeof range === "string") {
    const duration = RANGE_MS[range];
    return { start: nowMs - duration, end: nowMs, bucketMs: Math.max(60 * 1000, Math.ceil(duration / MAX_SERIES_POINTS)) };
  }
  if (range.mode === "relative") {
    const duration = RANGE_MS[normalizeRange(range.range)];
    return { start: nowMs - duration, end: nowMs, bucketMs: Math.max(60 * 1000, Math.ceil(duration / MAX_SERIES_POINTS)) };
  }
  const retentionStart = nowMs - retentionMs;
  const parsedFrom = range.from ? new Date(range.from).getTime() : NaN;
  const parsedTo = range.to ? new Date(range.to).getTime() : NaN;
  const start = Math.max(Number.isFinite(parsedFrom) ? parsedFrom : nowMs - RANGE_MS["24h"], retentionStart);
  const end = Math.min(Number.isFinite(parsedTo) ? parsedTo : nowMs, nowMs);
  const duration = Math.max(60 * 1000, end - start);
  return { start, end, bucketMs: Math.max(60 * 1000, Math.ceil(duration / MAX_SERIES_POINTS)) };
}

function normalizeRange(value: unknown): HistoryRange {
  if (value === "15m" || value === "1h" || value === "6h" || value === "24h" || value === "7d" || value === "14d") return value;
  return "24h";
}

function worstStatus(statuses: NormalizedStatus[]): NormalizedStatus {
  for (const status of STATUS_ORDER) {
    if (statuses.includes(status)) return status;
  }
  return "unknown";
}

function severityForStatus(status: NormalizedStatus): ObservabilitySeverity {
  switch (status) {
    case "failure":
      return "critical";
    case "warning":
      return "high";
    case "running":
    case "queued":
      return "medium";
    case "success":
    case "info":
      return "info";
    default:
      return "low";
  }
}

function eventTypeForTransition(transition: StatusTransition): HistoryEventType | null {
  if (transition.next === "failure") return "failure";
  if (transition.previous === "failure" && transition.next === "success") return "recovery";
  return null;
}

function bucketFor(ts: string): string {
  const value = new Date(ts).getTime();
  if (!Number.isFinite(value)) return "unknown";
  return String(Math.floor(value / 60000));
}

function groupIdsByAccount(snapshot: AggregateSnapshot): Map<string, string | undefined> {
  const map = new Map<string, string | undefined>();
  for (const service of snapshot.services) {
    for (const accountId of service.accountIds) map.set(accountId, service.groupId);
  }
  return map;
}

function sampleFromSnapshot(snapshot: AggregateSnapshot): HistorySample {
  const groups = groupIdsByAccount(snapshot);
  const perAccount = new Map<string, HistorySampleAccount>();
  const ensureAccount = (accountId: string, provider: Provider): HistorySampleAccount => {
    const current = perAccount.get(accountId) ?? {
      provider,
      groupId: groups.get(accountId),
      counts: emptyCounts(),
      openIncidentCount: 0,
      alertCount: 0,
    };
    perAccount.set(accountId, current);
    return current;
  };

  for (const item of snapshot.items) {
    const current = ensureAccount(item.accountId, item.provider);
    current.counts[item.status] += 1;
  }
  for (const incident of snapshot.incidents) {
    if (incident.status === "resolved") continue;
    ensureAccount(incident.accountId, incident.provider).openIncidentCount = (perAccount.get(incident.accountId)?.openIncidentCount ?? 0) + 1;
  }
  for (const signal of snapshot.signals) {
    if (signal.kind !== "alert") continue;
    ensureAccount(signal.accountId, signal.provider).alertCount = (perAccount.get(signal.accountId)?.alertCount ?? 0) + 1;
  }

  const perService: Record<string, NormalizedStatus> = {};
  for (const service of snapshot.services) perService[service.id] = service.status;

  return {
    ts: snapshot.generatedAt,
    aggregateStatus: snapshot.aggregateStatus,
    perAccount: Object.fromEntries(perAccount.entries()),
    perService,
    openIncidentCount: snapshot.incidents.filter((incident) => incident.status !== "resolved").length,
    alertCount: snapshot.signals.filter((signal) => signal.kind === "alert").length,
    failureCount: snapshot.items.filter((item) => item.status === "failure").length,
    successCount: snapshot.items.filter((item) => item.status === "success").length,
  };
}

function eventId(type: HistoryEventType, accountId: string, sourceUid: string, ts: string): string {
  return `${type}:${accountId}:${sourceUid}:${bucketFor(ts)}`;
}

function itemEvent(type: HistoryEventType, item: MonitorItem, groupId: string | undefined, ts = item.updatedAt): HistoryEvent {
  return {
    id: eventId(type, item.accountId, item.uid, ts),
    ts,
    type,
    provider: item.provider,
    accountId: item.accountId,
    groupId,
    sourceUid: item.uid,
    category: item.category,
    title: item.title,
    status: item.status,
    severity: severityForStatus(item.status),
    url: item.url,
  };
}

function eventsFromSnapshot(snapshot: AggregateSnapshot, transitions: StatusTransition[]): HistoryEvent[] {
  const groups = groupIdsByAccount(snapshot);
  const events: HistoryEvent[] = [];

  for (const item of snapshot.items) {
    if (item.category === "deploy" || item.category === "release") {
      events.push(itemEvent("deploy", item, groups.get(item.accountId), item.createdAt || item.updatedAt));
    }
  }

  for (const transition of transitions) {
    const type = eventTypeForTransition(transition);
    if (!type) continue;
    events.push(itemEvent(type, transition.item, groups.get(transition.item.accountId), snapshot.generatedAt));
  }

  for (const signal of snapshot.signals) {
    if (signal.kind !== "alert") continue;
    events.push({
      id: eventId("alert", signal.accountId, signal.sourceItemUid ?? signal.uid, signal.updatedAt),
      ts: signal.updatedAt,
      type: "alert",
      provider: signal.provider,
      accountId: signal.accountId,
      groupId: groups.get(signal.accountId),
      sourceUid: signal.sourceItemUid ?? signal.uid,
      category: signal.category,
      title: signal.title,
      status: signal.status,
      severity: signal.severity,
      url: signal.url,
    });
  }

  for (const incident of snapshot.incidents) {
    events.push({
      id: eventId("incident", incident.accountId, incident.sourceItemUid ?? incident.uid, incident.updatedAt),
      ts: incident.updatedAt,
      type: "incident",
      provider: incident.provider,
      accountId: incident.accountId,
      groupId: groups.get(incident.accountId),
      sourceUid: incident.sourceItemUid ?? incident.uid,
      category: "incident",
      title: incident.title,
      status: incident.status,
      severity: incident.severity,
      url: incident.url,
    });
  }

  return events;
}

function prune(data: HistoryData, nowMs = Date.now(), retentionMs = DEFAULT_RETENTION_MS): HistoryData {
  const oldest = nowMs - retentionMs;
  const caps = retentionCaps(retentionMs);
  const samples = data.samples
    .filter((sample) => new Date(sample.ts).getTime() >= oldest)
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
    .slice(-caps.samples);
  const events = data.events
    .filter((event) => new Date(event.ts).getTime() >= oldest)
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
    .slice(-caps.events);
  const checkSamples = (data.checkSamples ?? [])
    .filter((sample) => new Date(sample.ts).getTime() >= oldest)
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
    .slice(-caps.checkSamples);
  return { ...data, samples, events, checkSamples };
}

function collapseSamples(samples: HistorySample[], bucketMs: number): HistorySample[] {
  const buckets = new Map<number, HistorySample[]>();
  for (const sample of samples) {
    const ts = new Date(sample.ts).getTime();
    const bucket = Math.floor(ts / bucketMs) * bucketMs;
    const list = buckets.get(bucket) ?? [];
    list.push(sample);
    buckets.set(bucket, list);
  }

  return [...buckets.entries()].map(([bucket, rows]) => {
    const last = rows[rows.length - 1];
    return {
      ts: new Date(bucket).toISOString(),
      aggregateStatus: worstStatus(rows.map((row) => row.aggregateStatus)),
      perAccount: last.perAccount,
      perService: last.perService,
      openIncidentCount: Math.max(...rows.map((row) => row.openIncidentCount)),
      alertCount: rows.reduce((sum, row) => sum + row.alertCount, 0),
      failureCount: rows.reduce((sum, row) => sum + row.failureCount, 0),
      successCount: rows.reduce((sum, row) => sum + row.successCount, 0),
    };
  }).sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
}

function filteredSamples(data: HistoryData, range: HistoryRange | HistoryDateRange, retentionMs = DEFAULT_RETENTION_MS): HistorySample[] {
  const { start, end } = dateWindow(range, Date.now(), retentionMs);
  return data.samples.filter((sample) => {
    const ts = new Date(sample.ts).getTime();
    return ts >= start && ts <= end;
  });
}

function accountStatus(row: HistorySampleAccount): NormalizedStatus {
  const statuses = Object.entries(row.counts)
    .filter(([, count]) => count > 0)
    .map(([status]) => status as NormalizedStatus);
  if ((row.openIncidentCount ?? 0) > 0) statuses.push("failure");
  if ((row.alertCount ?? 0) > 0) statuses.push("warning");
  return worstStatus(statuses);
}

function scopeSample(
  sample: HistorySample,
  filters: { groupId?: string; accountId?: string; provider?: string },
): HistorySample | null {
  if (!filters.groupId && !filters.accountId && !filters.provider) return sample;

  const perAccount = Object.fromEntries(
    Object.entries(sample.perAccount).filter(([accountId, row]) => {
      if (filters.accountId && accountId !== filters.accountId) return false;
      if (filters.groupId && row.groupId !== filters.groupId) return false;
      if (filters.provider && row.provider !== filters.provider) return false;
      return true;
    }),
  );
  const rows = Object.values(perAccount);
  if (rows.length === 0) return null;

  const successCount = rows.reduce((sum, row) => sum + row.counts.success, 0);
  const failureCount = rows.reduce((sum, row) => sum + row.counts.failure, 0);
  const openIncidentCount = rows.reduce((sum, row) => sum + (row.openIncidentCount ?? 0), 0);
  const alertCount = rows.reduce((sum, row) => sum + (row.alertCount ?? 0), 0);

  return {
    ...sample,
    aggregateStatus: worstStatus(rows.map(accountStatus)),
    perAccount,
    perService: {},
    openIncidentCount,
    alertCount,
    failureCount,
    successCount,
  };
}

function validTime(value: string): number {
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function retainedRows<T extends { ts: string }>(rows: T[], retentionMs: number): T[] {
  const oldest = Date.now() - retentionMs;
  return rows
    .filter((row) => validTime(row.ts) >= oldest)
    .sort((a, b) => validTime(a.ts) - validTime(b.ts));
}

function sampleMatchesScope(sample: HistorySample, slo: SloDefinition): boolean {
  if (!slo.scope.accountId && !slo.scope.groupId && !slo.scope.provider) return true;
  return Object.entries(sample.perAccount).some(([accountId, row]) => {
    if (slo.scope.accountId && accountId !== slo.scope.accountId) return false;
    if (slo.scope.groupId && row.groupId !== slo.scope.groupId) return false;
    if (slo.scope.provider && row.provider !== slo.scope.provider) return false;
    return true;
  });
}

function scopedCounts(sample: HistorySample, slo: SloDefinition): { success: number; failure: number } {
  if (!slo.scope.accountId && !slo.scope.groupId && !slo.scope.provider) {
    return { success: sample.successCount, failure: sample.failureCount };
  }
  let success = 0;
  let failure = 0;
  for (const [accountId, row] of Object.entries(sample.perAccount)) {
    if (slo.scope.accountId && accountId !== slo.scope.accountId) continue;
    if (slo.scope.groupId && row.groupId !== slo.scope.groupId) continue;
    if (slo.scope.provider && row.provider !== slo.scope.provider) continue;
    success += row.counts.success;
    failure += row.counts.failure;
  }
  return { success, failure };
}

function sloStatus(slo: SloDefinition, samples: HistorySample[]): SloStatus {
  const scoped = samples.filter((sample) => sampleMatchesScope(sample, slo));
  const totals = scoped.reduce(
    (sum, sample) => {
      const counts = scopedCounts(sample, slo);
      return { success: sum.success + counts.success, failure: sum.failure + counts.failure };
    },
    { success: 0, failure: 0 },
  );
  const attempts = totals.success + totals.failure;
  const compliance = attempts > 0 ? totals.success / attempts : null;
  const allowedFailureRatio = Math.max(0, 1 - slo.target / 100);
  const observedFailureRatio = attempts > 0 ? totals.failure / attempts : null;
  const remainingBudget = observedFailureRatio === null
    ? null
    : allowedFailureRatio <= 0
    ? (observedFailureRatio === 0 ? 1 : 0)
    : Math.max(0, 1 - observedFailureRatio / allowedFailureRatio);
  const burnRate = observedFailureRatio === null || allowedFailureRatio <= 0 ? null : observedFailureRatio / allowedFailureRatio;

  let runningSuccess = 0;
  let runningFailure = 0;
  const series = scoped.map((sample) => {
    const counts = scopedCounts(sample, slo);
    runningSuccess += counts.success;
    runningFailure += counts.failure;
    const runningAttempts = runningSuccess + runningFailure;
    const runningCompliance = runningAttempts > 0 ? runningSuccess / runningAttempts : null;
    const runningFailureRatio = runningAttempts > 0 ? runningFailure / runningAttempts : null;
    const runningBudget = runningFailureRatio === null
      ? null
      : allowedFailureRatio <= 0
      ? (runningFailureRatio === 0 ? 1 : 0)
      : Math.max(0, 1 - runningFailureRatio / allowedFailureRatio);
    return { ts: sample.ts, compliance: runningCompliance, remainingBudget: runningBudget };
  });

  return {
    slo,
    compliance,
    successCount: totals.success,
    failureCount: totals.failure,
    remainingBudget,
    burnRate,
    atRisk: burnRate !== null && burnRate > 1,
    series,
  };
}

export function historyRange(value: unknown): HistoryRange {
  return normalizeRange(value);
}

export function historyDateRange(value: unknown): HistoryRange | HistoryDateRange {
  if (typeof value === "string") return normalizeRange(value);
  if (typeof value !== "object" || value === null) return "24h";
  const candidate = value as Partial<HistoryDateRange>;
  if (candidate.mode === "custom") {
    return {
      mode: "custom",
      from: typeof candidate.from === "string" ? candidate.from : undefined,
      to: typeof candidate.to === "string" ? candidate.to : undefined,
    };
  }
  if (candidate.mode === "relative") return { mode: "relative", range: normalizeRange(candidate.range) };
  return "24h";
}

export async function record(
  snapshot: AggregateSnapshot,
  transitions: StatusTransition[],
  checkResults: HttpCheckResult[] = [],
): Promise<void> {
  const retentionMs = await currentRetentionMs();
  const data = prune(await store.load(), Date.now(), retentionMs);
  const sample = sampleFromSnapshot(snapshot);
  const eventMap = new Map(data.events.map((event) => [event.id, event]));
  for (const event of eventsFromSnapshot(snapshot, transitions)) eventMap.set(event.id, event);
  const checkRows: CheckSampleRow[] = checkResults.map((result) => ({
    checkId: result.checkId,
    ts: result.checkedAt,
    latencyMs: result.latencyMs,
    ok: result.ok,
  }));
  await store.save(
    prune({
      ...data,
      samples: [...data.samples, sample],
      events: [...eventMap.values()],
      checkSamples: [...data.checkSamples, ...checkRows],
    }, Date.now(), retentionMs),
  );
}

/** Append a single discrete event (e.g. a fired alerting rule), deduped by id. */
export async function appendEvent(event: HistoryEvent): Promise<void> {
  const retentionMs = await currentRetentionMs();
  const data = prune(await store.load(), Date.now(), retentionMs);
  const eventMap = new Map(data.events.map((existing) => [existing.id, existing]));
  eventMap.set(event.id, event);
  await store.save(prune({ ...data, events: [...eventMap.values()] }, Date.now(), retentionMs));
}

export async function getCheckLatencySeries(checkId: string, range: HistoryRange | HistoryDateRange): Promise<CheckSeries> {
  const data = await store.load();
  const retentionMs = await currentRetentionMs();
  const { start, end, bucketMs } = dateWindow(range, Date.now(), retentionMs);
  const rows = (data.checkSamples ?? []).filter((row) => {
    const ts = new Date(row.ts).getTime();
    return row.checkId === checkId && ts >= start && ts <= end;
  });
  if (rows.length === 0) return { points: [], uptime: null, avgLatencyMs: null };

  const buckets = new Map<number, { latencies: number[]; ok: boolean }>();
  for (const row of rows) {
    const bucket = Math.floor(new Date(row.ts).getTime() / bucketMs) * bucketMs;
    const entry = buckets.get(bucket) ?? { latencies: [], ok: true };
    entry.latencies.push(row.latencyMs);
    entry.ok = entry.ok && row.ok;
    buckets.set(bucket, entry);
  }
  const points: CheckLatencyPoint[] = [...buckets.entries()]
    .map(([bucket, entry]) => ({
      ts: new Date(bucket).toISOString(),
      latencyMs: entry.latencies.length
        ? Math.round(entry.latencies.reduce((sum, value) => sum + value, 0) / entry.latencies.length)
        : null,
      ok: entry.ok,
    }))
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

  const okCount = rows.filter((row) => row.ok).length;
  const avgLatencyMs = Math.round(rows.reduce((sum, row) => sum + row.latencyMs, 0) / rows.length);
  return { points, uptime: okCount / rows.length, avgLatencyMs };
}

export async function getSeries(
  range: HistoryRange | HistoryDateRange,
  filters: { groupId?: string; accountId?: string; provider?: string } = {},
): Promise<HistorySample[]> {
  const data = await store.load();
  const retentionMs = await currentRetentionMs();
  const samples = filteredSamples(data, range, retentionMs)
    .map((sample) => scopeSample(sample, filters))
    .filter((sample): sample is HistorySample => sample !== null);
  const { bucketMs } = dateWindow(range, Date.now(), retentionMs);
  return collapseSamples(samples, bucketMs);
}

function typeCategory(type: HistoryEventType): MonitorCategory {
  if (type === "deploy") return "deploy";
  if (type === "alert") return "alert";
  if (type === "incident") return "incident";
  if (type === "check") return "monitor";
  return "other";
}

export async function getEvents(filters: {
  range: HistoryRange | HistoryDateRange;
  groupId?: string;
  accountId?: string;
  provider?: string;
  status?: string;
  severity?: string;
  category?: string;
  types?: HistoryEventType[];
}): Promise<HistoryEvent[]> {
  const data = await store.load();
  const retentionMs = await currentRetentionMs();
  const { start, end } = dateWindow(filters.range, Date.now(), retentionMs);
  return data.events
    .filter((event) => {
      const ts = new Date(event.ts).getTime();
      return ts >= start && ts <= end;
    })
    .filter((event) => !filters.groupId || event.groupId === filters.groupId)
    .filter((event) => !filters.accountId || event.accountId === filters.accountId)
    .filter((event) => !filters.provider || event.provider === filters.provider)
    .filter((event) => !filters.status || event.status === filters.status)
    .filter((event) => !filters.severity || event.severity === filters.severity)
    .filter((event) => !filters.category || (event.category ?? typeCategory(event.type)) === filters.category)
    .filter((event) => !filters.types?.length || filters.types.includes(event.type))
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
}

export async function getAllSamples(): Promise<HistorySample[]> {
  const retentionMs = await currentRetentionMs();
  return retainedRows((await store.load()).samples, retentionMs);
}

export async function getAllEvents(): Promise<HistoryEvent[]> {
  const retentionMs = await currentRetentionMs();
  return retainedRows((await store.load()).events, retentionMs);
}

export async function getStats(): Promise<HistoryStats> {
  const [data, retentionDays, storageBytes] = await Promise.all([store.load(), currentRetentionDays(), store.sizeBytes()]);
  const retentionMs = retentionDays * DAY_MS;
  const samples = retainedRows(data.samples, retentionMs);
  const events = retainedRows(data.events, retentionMs);
  const checkSamples = retainedRows(data.checkSamples ?? [], retentionMs);
  return {
    retentionDays,
    storageBytes,
    sampleCount: samples.length,
    eventCount: events.length,
    checkSampleCount: checkSamples.length,
    sloCount: data.slos.length,
    oldestSampleAt: samples[0]?.ts,
    newestSampleAt: samples[samples.length - 1]?.ts,
    oldestEventAt: events[0]?.ts,
    newestEventAt: events[events.length - 1]?.ts,
    oldestCheckSampleAt: checkSamples[0]?.ts,
    newestCheckSampleAt: checkSamples[checkSamples.length - 1]?.ts,
  };
}

export async function clearRetainedHistory(): Promise<HistoryStats> {
  const data = await store.load();
  await store.save({ ...data, samples: [], events: [], checkSamples: [] });
  return await getStats();
}

export async function pruneRetainedHistory(): Promise<HistoryStats> {
  const retentionMs = await currentRetentionMs();
  await store.save(prune(await store.load(), Date.now(), retentionMs));
  return await getStats();
}

export async function listSlos(): Promise<SloDefinition[]> {
  return (await store.load()).slos;
}

export async function saveSlo(input: {
  id?: string;
  name: string;
  scope: SloDefinition["scope"];
  target: number;
  windowDays: number;
}): Promise<SloDefinition> {
  const data = await store.load();
  const retentionDays = await currentRetentionDays();
  const now = new Date().toISOString();
  const existing = input.id ? data.slos.find((slo) => slo.id === input.id) : undefined;
  const slo: SloDefinition = {
    id: existing?.id ?? globalThis.crypto.randomUUID(),
    name: input.name,
    scope: input.scope,
    target: Math.min(99.99, Math.max(1, input.target)),
    windowDays: Math.min(retentionDays, Math.max(1, Math.round(input.windowDays))),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  const slos = existing ? data.slos.map((candidate) => candidate.id === slo.id ? slo : candidate) : [...data.slos, slo];
  await store.save({ ...data, slos });
  return slo;
}

export async function deleteSlo(id: string): Promise<void> {
  const data = await store.load();
  await store.save({ ...data, slos: data.slos.filter((slo) => slo.id !== id) });
}

export async function getSloStatus(): Promise<SloStatus[]> {
  const data = await store.load();
  const retentionDays = await currentRetentionDays();
  return data.slos.map((slo) => {
    const effectiveSlo = { ...slo, windowDays: Math.min(slo.windowDays, retentionDays) };
    const start = Date.now() - effectiveSlo.windowDays * DAY_MS;
    const samples = data.samples.filter((sample) => new Date(sample.ts).getTime() >= start);
    return sloStatus(effectiveSlo, samples);
  });
}
