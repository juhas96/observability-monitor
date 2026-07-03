/**
 * Evaluates custom alerting rules against each snapshot. Keeps in-memory runtime
 * state so a rule alerts only when a breach is SUSTAINED for `forMinutes`, then
 * respects a `cooldownMinutes` before it can fire again, and sends a recovery
 * notification when the breach clears. On fire/recovery: native notification +
 * channel dispatch + a history event (incident center / timeline). A global
 * snooze (`settings.mutedUntil`) suppresses delivery without losing state.
 */

import { Notification, logger } from "@glaze/core/backend";

import { dispatch } from "./dispatch.js";
import { appendEvent } from "./history-store.js";
import { listRules } from "./rules-store.js";
import { getSettings } from "./settings-store.js";
import type {
  AggregateSnapshot,
  AlertRule,
  DispatchEventKind,
  HistoryEvent,
  Provider,
  RuleScope,
  RuleState,
} from "./types.js";

interface RuleRuntime {
  breaching: boolean;
  breachingSince?: string;
  alerting: boolean; // an alert has fired and not yet recovered
  firedAt?: string;
  value: number | null;
}

const runtime = new Map<string, RuleRuntime>();

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
          incident.status !== "resolved" && scopeMatches(rule.scope, incident.accountId, incident.provider, groups),
      );
      return { value: incidents.length, provider: incidents[0]?.provider };
    }
    case "latency": {
      if (!rule.scope.checkId) return { value: null };
      const result = snapshot.checks.find((check) => check.checkId === rule.scope.checkId);
      return { value: result ? result.latencyMs : null };
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
  switch (rule.metric) {
    case "failureRate":
      return `Failure rate ${value.toFixed(0)}% ${op} ${rule.threshold}%`;
    case "latency":
      return `Latency ${Math.round(value)}ms ${op} ${rule.threshold}ms`;
    case "openIncidents":
      return `Open incidents ${value} ${op} ${rule.threshold}`;
    default:
      return `${value} ${op} ${rule.threshold}`;
  }
}

function notify(title: string, subtitle: string, body: string, muted: boolean, kind: DispatchEventKind): void {
  if (muted) return;
  if (Notification.isSupported()) {
    try {
      new Notification({ title, subtitle, body }).show();
    } catch (err) {
      logger.warn("rules", "Failed to show notification", { err: String(err) });
    }
  }
  void dispatch({ kind, title, body });
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

  const settings = await getSettings().catch(() => null);
  const muted = Boolean(settings?.mutedUntil && new Date(settings.mutedUntil).getTime() > Date.now());

  const groups = groupByAccount(snapshot);
  const now = snapshot.generatedAt;
  const nowMs = new Date(now).getTime();
  const liveIds = new Set(rules.map((rule) => rule.id));

  for (const rule of rules) {
    if (!rule.enabled) {
      runtime.set(rule.id, { breaching: false, alerting: false, value: null });
      continue;
    }

    const { value, provider } = computeValue(rule, snapshot, groups);
    const breaching = value !== null && breached(rule, value);
    const prev = runtime.get(rule.id) ?? { breaching: false, alerting: false, value: null };
    const forMs = Math.max(0, (rule.forMinutes ?? 0) * 60_000);
    const cooldownMs = Math.max(0, (rule.cooldownMinutes ?? 0) * 60_000);

    const next: RuleRuntime = { ...prev, breaching, value };

    if (breaching) {
      next.breachingSince = prev.breaching ? prev.breachingSince ?? now : now;
      const sustainedMs = nowMs - new Date(next.breachingSince).getTime();
      const cooldownOk = !prev.firedAt || nowMs - new Date(prev.firedAt).getTime() >= cooldownMs;
      if (!prev.alerting && sustainedMs >= forMs && cooldownOk) {
        next.alerting = true;
        next.firedAt = now;
        notify(`⚠️ ${rule.name}`, "Alert rule", describe(rule, value as number), muted, "alert");
        recordEvent(rule, provider, now, "alert", "warning");
      }
    } else {
      next.breachingSince = undefined;
      if (prev.alerting) {
        next.alerting = false;
        notify(`✅ Resolved: ${rule.name}`, "Alert rule", "Condition is back to normal.", muted, "recovery");
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
