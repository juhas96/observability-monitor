/**
 * Evaluates custom alerting rules against each snapshot. Keeps in-memory runtime
 * state so a rule alerts only when a breach is SUSTAINED for `forMinutes`, then
 * respects a `cooldownMinutes` before it can fire again, and sends a recovery
 * notification when the breach clears. On fire/recovery: native notification +
 * channel dispatch + a history event (incident center / timeline). Global
 * snooze and maintenance windows suppress delivery without losing state.
 */

import { Notification, logger } from "@glaze/core/backend";

import { dispatch } from "./dispatch.js";
import { appendEvent } from "./history-store.js";
import { isNotificationMuted } from "./notification-mute.js";
import { listRules } from "./rules-store.js";
import { listServiceMetadata } from "./service-metadata-store.js";
import { getSettings } from "./settings-store.js";
import type {
  AggregateSnapshot,
  AlertRule,
  DispatchEventContext,
  DispatchEventKind,
  HistoryEvent,
  ObservabilitySeverity,
  Provider,
  RulePreview,
  RuleScope,
  RuleState,
  ServiceHealth,
  ServiceMetadata,
} from "./types.js";

interface RuleRuntime {
  breaching: boolean;
  breachingSince?: string;
  alerting: boolean; // an alert has fired and not yet recovered
  firedAt?: string;
  value: number | null;
}

const runtime = new Map<string, RuleRuntime>();
const SEVERITY_RANK: Record<ObservabilitySeverity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function groupByAccount(snapshot: AggregateSnapshot): Map<string, string | undefined> {
  const map = new Map<string, string | undefined>();
  for (const service of snapshot.services) {
    for (const accountId of service.accountIds) map.set(accountId, service.groupId);
  }
  return map;
}

function scopeMatches(
  scope: RuleScope,
  accountId: string,
  provider: Provider,
  groups: Map<string, string | undefined>,
): boolean {
  if (scope.accountId && accountId !== scope.accountId) return false;
  if (scope.provider && provider !== scope.provider) return false;
  if (scope.groupId && groups.get(accountId) !== scope.groupId) return false;
  return true;
}

function severityMeetsThreshold(severity: ObservabilitySeverity, minSeverity: ObservabilitySeverity | undefined): boolean {
  if (!minSeverity) return true;
  return SEVERITY_RANK[severity] >= SEVERITY_RANK[minSeverity];
}

function computeValue(
  rule: AlertRule,
  snapshot: AggregateSnapshot,
  groups: Map<string, string | undefined>,
): { value: number | null; provider?: Provider } {
  switch (rule.metric) {
    case "failureRate": {
      const items = snapshot.items.filter(
        (item) =>
          (item.status === "success" || item.status === "failure") &&
          scopeMatches(rule.scope, item.accountId, item.provider, groups),
      );
      if (items.length === 0) return { value: null };
      const failures = items.filter((item) => item.status === "failure").length;
      return { value: (100 * failures) / items.length, provider: items[0].provider };
    }
    case "openIncidents": {
      const incidents = snapshot.incidents.filter(
        (incident) =>
          incident.status !== "resolved" &&
          severityMeetsThreshold(incident.severity, rule.minSeverity) &&
          scopeMatches(rule.scope, incident.accountId, incident.provider, groups),
      );
      const alertSignals = snapshot.signals.filter(
        (signal) =>
          signal.kind === "alert" &&
          signal.status !== "success" &&
          severityMeetsThreshold(signal.severity, rule.minSeverity) &&
          scopeMatches(rule.scope, signal.accountId, signal.provider, groups),
      );
      return { value: incidents.length + alertSignals.length, provider: incidents[0]?.provider ?? alertSignals[0]?.provider };
    }
    case "latency": {
      if (!rule.scope.checkId) return { value: null };
      const result = snapshot.checks.find((check) => check.checkId === rule.scope.checkId);
      return { value: result ? result.latencyMs : null };
    }
    case "checkDown": {
      if (!rule.scope.checkId) return { value: null };
      const result = snapshot.checks.find((check) => check.checkId === rule.scope.checkId);
      return { value: result ? (result.ok ? 0 : 1) : null };
    }
    default:
      return { value: null };
  }
}

function breached(rule: AlertRule, value: number): boolean {
  return rule.operator === "gt" ? value > rule.threshold : value < rule.threshold;
}

function describe(rule: AlertRule, value: number): string {
  const op = rule.operator === "gt" ? ">" : "<";
  const severitySuffix = rule.metric === "openIncidents" && rule.minSeverity ? ` at ${rule.minSeverity}+` : "";
  switch (rule.metric) {
    case "failureRate":
      return `Failure rate ${value.toFixed(0)}% ${op} ${rule.threshold}%`;
    case "latency":
      return `Latency ${Math.round(value)}ms ${op} ${rule.threshold}ms`;
    case "checkDown":
      return `Check is ${value > 0 ? "down" : "up"} (${value} ${op} ${rule.threshold})`;
    case "openIncidents":
      return `Open incidents${severitySuffix} ${value} ${op} ${rule.threshold}`;
    default:
      return `${value} ${op} ${rule.threshold}`;
  }
}

function serviceForRule(rule: AlertRule, snapshot: AggregateSnapshot): ServiceHealth | undefined {
  if (rule.scope.groupId) return snapshot.services.find((service) => service.id === rule.scope.groupId || service.groupId === rule.scope.groupId);
  if (rule.scope.accountId) return snapshot.services.find((service) => service.accountIds.includes(rule.scope.accountId as string));
  if (rule.scope.checkId) {
    const check = snapshot.checks.find((candidate) => candidate.checkId === rule.scope.checkId);
    if (check?.groupId) return snapshot.services.find((service) => service.id === check.groupId || service.groupId === check.groupId);
  }
  return undefined;
}

function contextForRule(rule: AlertRule, snapshot: AggregateSnapshot, metadata: ServiceMetadata[]): DispatchEventContext | undefined {
  const service = serviceForRule(rule, snapshot);
  if (!service) return undefined;
  const serviceMetadata = metadata.find((candidate) => candidate.serviceId === service.id);
  if (!serviceMetadata) return { serviceId: service.id, serviceName: service.name };
  return {
    serviceId: service.id,
    serviceName: service.name,
    owner: serviceMetadata.owner,
    tier: serviceMetadata.tier,
    runbookUrl: serviceMetadata.runbookUrl,
    dashboardUrl: serviceMetadata.dashboardUrl,
    repositoryUrl: serviceMetadata.repositoryUrl,
    dependencies: serviceMetadata.dependencies,
  };
}

function noDataReason(rule: AlertRule): string {
  if (rule.metric === "latency" && !rule.scope.checkId) return "Latency rules require an uptime check scope.";
  if (rule.metric === "checkDown" && !rule.scope.checkId) return "Uptime-down rules require an uptime check scope.";
  return "No matching current snapshot data.";
}

export function previewRule(rule: AlertRule, snapshot: AggregateSnapshot): RulePreview {
  const groups = groupByAccount(snapshot);
  const { value } = computeValue(rule, snapshot, groups);
  const breaching = value !== null && breached(rule, value);
  return {
    generatedAt: snapshot.generatedAt,
    value,
    breaching,
    description: value === null ? noDataReason(rule) : describe(rule, value),
    noDataReason: value === null ? noDataReason(rule) : undefined,
  };
}

export async function sendRuleTest(rule: AlertRule, snapshot: AggregateSnapshot): Promise<RulePreview> {
  const preview = previewRule(rule, snapshot);
  const metadata = await listServiceMetadata().catch(() => []);
  await dispatch({
    kind: "alert",
    title: `Test alert: ${rule.name}`,
    body: preview.value === null ? preview.description : `${preview.description}${preview.breaching ? " (would fire)" : " (would not fire)"}`,
    channelIds: rule.channelIds,
    context: contextForRule(rule, snapshot, metadata),
  });
  return preview;
}

function notify(
  title: string,
  subtitle: string,
  body: string,
  muted: boolean,
  kind: DispatchEventKind,
  channelIds?: string[],
  context?: DispatchEventContext,
): void {
  if (muted) return;
  if (Notification.isSupported()) {
    try {
      new Notification({ title, subtitle, body }).show();
    } catch (err) {
      logger.warn("rules", "Failed to show notification", { err: String(err) });
    }
  }
  void dispatch({ kind, title, body, channelIds, context });
}

function recordEvent(
  rule: AlertRule,
  provider: Provider | undefined,
  at: string,
  type: "alert" | "recovery",
  status: HistoryEvent["status"],
): void {
  if (!provider) return; // HistoryEvent.provider must be a real Provider
  const event: HistoryEvent = {
    id: `${type}:rule:${rule.id}:${at}`,
    ts: at,
    type,
    provider,
    accountId: rule.scope.accountId ?? "rule",
    groupId: rule.scope.groupId,
    sourceUid: `rule:${rule.id}`,
    title: rule.name,
    status,
    severity: type === "alert" ? "high" : "info",
    url: "",
  };
  void appendEvent(event).catch((err) => logger.warn("rules", "Failed to record rule event", { err: String(err) }));
}

/** Evaluate all enabled rules; fire on sustained breach, recover on clear. */
export async function evaluateRules(snapshot: AggregateSnapshot): Promise<void> {
  let rules: AlertRule[];
  try {
    rules = await listRules();
  } catch (err) {
    logger.warn("rules", "Failed to load rules", { err: String(err) });
    return;
  }

  const groups = groupByAccount(snapshot);
  const now = snapshot.generatedAt;
  const nowMs = new Date(now).getTime();
  const settings = await getSettings().catch(() => null);
  const serviceMetadata = await listServiceMetadata().catch(() => []);
  const liveIds = new Set(rules.map((rule) => rule.id));

  for (const rule of rules) {
    if (!rule.enabled) {
      runtime.set(rule.id, { breaching: false, alerting: false, value: null });
      continue;
    }

    const { value, provider } = computeValue(rule, snapshot, groups);
    const context = contextForRule(rule, snapshot, serviceMetadata);
    const muted = settings ? isNotificationMuted(settings, new Date(nowMs), rule.scope) : false;
    const breaching = value !== null && breached(rule, value);
    const prev = runtime.get(rule.id) ?? { breaching: false, alerting: false, value: null };
    const forMs = Math.max(0, (rule.forMinutes ?? 0) * 60_000);
    const cooldownMs = Math.max(0, (rule.cooldownMinutes ?? 0) * 60_000);

    const next: RuleRuntime = { ...prev, breaching, value };

    if (breaching) {
      next.breachingSince = prev.breaching ? prev.breachingSince ?? now : now;
      const sustainedMs = nowMs - new Date(next.breachingSince).getTime();
      const cooldownOk = !prev.firedAt || nowMs - new Date(prev.firedAt).getTime() >= cooldownMs;
      const dedupeMs = Math.max(0, (rule.dedupeMinutes ?? 0) * 60_000);
      const dedupeOk = !prev.firedAt || nowMs - new Date(prev.firedAt).getTime() >= dedupeMs;
      if (!prev.alerting && sustainedMs >= forMs && cooldownOk && dedupeOk) {
        next.alerting = true;
        next.firedAt = now;
        const ruleMuted = muted || Boolean(rule.mutedUntil && new Date(rule.mutedUntil).getTime() > nowMs);
        notify(`⚠️ ${rule.name}`, "Alert rule", describe(rule, value as number), ruleMuted, "alert", rule.channelIds, context);
        recordEvent(rule, provider, now, "alert", "warning");
      }
    } else {
      next.breachingSince = undefined;
      if (prev.alerting) {
        next.alerting = false;
        const ruleMuted = muted || Boolean(rule.mutedUntil && new Date(rule.mutedUntil).getTime() > nowMs);
        notify(`✅ Resolved: ${rule.name}`, "Alert rule", "Condition is back to normal.", ruleMuted, "recovery", rule.channelIds, context);
        recordEvent(rule, provider, now, "recovery", "success");
      }
    }

    runtime.set(rule.id, next);
  }

  for (const id of [...runtime.keys()]) {
    if (!liveIds.has(id)) runtime.delete(id);
  }
}

export function getRuleStates(): RuleState[] {
  return [...runtime.entries()].map(([ruleId, r]) => ({
    ruleId,
    firing: r.alerting,
    breaching: r.breaching,
    value: r.value,
    since: r.breachingSince,
  }));
}
