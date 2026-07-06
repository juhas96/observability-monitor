import { listAccounts, listGroups } from "./accounts-store.js";
import { buildSnapshot, setKnownAccounts } from "./aggregator.js";
import { getEvents } from "./history-store.js";
import { listServiceMetadata } from "./service-metadata-store.js";
import type {
  Account,
  HistoryEvent,
  InvestigationContext,
  InvestigationTrigger,
  MonitorItem,
  ObservabilityIncident,
  ObservabilitySignal,
  Provider,
} from "./types.js";

export interface InvestigationRequest {
  itemUid?: string;
  eventId?: string;
  accountId?: string;
  provider?: Provider;
  groupId?: string;
  title?: string;
  subtitle?: string;
  ts?: string;
  url?: string;
}

function accountPublic(account: Account): InvestigationContext["account"] {
  return {
    id: account.id,
    provider: account.provider,
    label: account.label,
    groupId: account.groupId,
    identity: account.identity,
    enabled: account.enabled,
    lastSyncAt: account.lastSyncAt,
    lastError: account.lastError,
  };
}

function triggerFromItem(item: MonitorItem): InvestigationTrigger {
  return {
    kind: "item",
    itemUid: item.uid,
    accountId: item.accountId,
    provider: item.provider,
    title: item.title,
    subtitle: item.subtitle,
    status: item.status,
    category: item.category,
    ts: item.updatedAt,
    url: item.url,
  };
}

function triggerFromEvent(event: HistoryEvent): InvestigationTrigger {
  return {
    kind: "event",
    eventId: event.id,
    accountId: event.accountId,
    provider: event.provider,
    groupId: event.groupId,
    title: event.title,
    status: event.status,
    severity: event.severity,
    category: event.category,
    ts: event.ts,
    url: event.url,
  };
}

function triggerFromRequest(req: InvestigationRequest): InvestigationTrigger {
  return {
    kind: "manual",
    accountId: req.accountId,
    provider: req.provider,
    groupId: req.groupId,
    title: req.title,
    subtitle: req.subtitle,
    ts: req.ts,
    url: req.url,
  };
}

function itemMatchesScope(item: MonitorItem, accountIds: Set<string>, provider: Provider | undefined): boolean {
  if (accountIds.size > 0) return accountIds.has(item.accountId);
  return !provider || item.provider === provider;
}

function accountProviderMatchesScope(row: { accountId: string; provider: Provider }, accountIds: Set<string>, provider: Provider | undefined): boolean {
  if (accountIds.size > 0) return accountIds.has(row.accountId);
  return !provider || row.provider === provider;
}

function eventMatchesScope(event: HistoryEvent, accountIds: Set<string>, provider: Provider | undefined): boolean {
  if (accountIds.size > 0) return accountIds.has(event.accountId);
  return !provider || event.provider === provider;
}

function signalMatchesScope(signal: ObservabilitySignal, accountIds: Set<string>, provider: Provider | undefined): boolean {
  if (accountIds.size > 0) return accountIds.has(signal.accountId);
  return !provider || signal.provider === provider;
}

function incidentMatchesScope(incident: ObservabilityIncident, accountIds: Set<string>, provider: Provider | undefined): boolean {
  if (accountIds.size > 0) return accountIds.has(incident.accountId);
  return !provider || incident.provider === provider;
}

export async function getInvestigationContext(req: InvestigationRequest): Promise<InvestigationContext> {
  const [accounts, groups] = await Promise.all([listAccounts(), listGroups()]);
  setKnownAccounts(accounts, groups);
  const snapshot = buildSnapshot();
  const allEvents = await getEvents({ range: "24h" });
  const item = req.itemUid ? snapshot.items.find((candidate) => candidate.uid === req.itemUid) : undefined;
  const event = req.eventId ? allEvents.find((candidate) => candidate.id === req.eventId) : undefined;
  const trigger = item ? triggerFromItem(item) : event ? triggerFromEvent(event) : triggerFromRequest(req);
  const accountId = trigger.accountId ?? req.accountId;
  const account = accountId ? accounts.find((candidate) => candidate.id === accountId) : undefined;
  const groupId = trigger.groupId ?? account?.groupId ?? req.groupId;
  const group = groupId ? groups.find((candidate) => candidate.id === groupId) : undefined;
  const service = accountId
    ? snapshot.services.find((candidate) => candidate.accountIds.includes(accountId))
    : groupId
      ? snapshot.services.find((candidate) => candidate.id === groupId || candidate.groupId === groupId)
      : undefined;
  const accountIds = new Set(service?.accountIds ?? (accountId ? [accountId] : []));
  const provider = trigger.provider ?? req.provider;
  const metadata = (await listServiceMetadata()).find((candidate) => candidate.serviceId === (service?.id ?? groupId ?? (accountId ? `account:${accountId}` : "")));

  return {
    generatedAt: new Date().toISOString(),
    trigger,
    account: account ? accountPublic(account) : undefined,
    group,
    service,
    serviceMetadata: metadata,
    currentItems: snapshot.items.filter((candidate) => itemMatchesScope(candidate, accountIds, provider)).slice(0, 25),
    relatedEvents: allEvents.filter((candidate) => eventMatchesScope(candidate, accountIds, provider)).slice(0, 25),
    relatedSignals: snapshot.signals.filter((candidate) => signalMatchesScope(candidate, accountIds, provider)).slice(0, 25),
    relatedIncidents: snapshot.incidents.filter((candidate) => incidentMatchesScope(candidate, accountIds, provider)).slice(0, 25),
    relatedMetrics: snapshot.metrics.filter((candidate) => accountProviderMatchesScope(candidate, accountIds, provider)).slice(0, 12),
    relatedChecks: snapshot.checks.filter((check) => !groupId || check.groupId === groupId).slice(0, 12),
    deepLinks: snapshot.deepLinks.filter((link) => accountProviderMatchesScope(link, accountIds, provider)).slice(0, 12),
  };
}
