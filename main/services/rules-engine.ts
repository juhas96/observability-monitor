/**
 * Evaluates custom alerting rules against each snapshot. Keeps in-memory firing
 * state (like the diff-engine) so a rule alerts on the transition INTO breach,
 * not every cycle. On fire: native notification + channel dispatch + a history
 * event so it shows in the incident center and timeline.
 */

import { Notification, logger } from "@glaze/core/backend";

import { dispatch } from "./dispatch.js";
import { appendEvent } from "./history-store.js";
import { listRules } from "./rules-store.js";
import type {
  AggregateSnapshot,
  AlertRule,
  HistoryEvent,
  Provider,
  RuleScope,
  RuleState,
} from "./types.js";

const states = new Map<string, RuleState>();

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

function fire(rule: AlertRule, value: number, provider: Provider | undefined, at: string): void {
  const body = describe(rule, value);

  if (Notification.isSupported()) {
    try {
      new Notification({ title: `⚠️ ${rule.name}`, subtitle: "Alert rule", body }).show();
    } catch (err) {
      logger.warn("rules", "Failed to show notification", { err: String(err) });
    }
  }

  void dispatch({ kind: "alert", title: `Alert: ${rule.name}`, body });

  // Attribute the timeline/incident event to a provider when one is determinable.
  if (provider) {
    const event: HistoryEvent = {
      id: `alert:rule:${rule.id}:${at}`,
      ts: at,
      type: "alert",
      provider,
      accountId: rule.scope.accountId ?? "rule",
      groupId: rule.scope.groupId,
      sourceUid: `rule:${rule.id}`,
      title: rule.name,
      status: "warning",
      severity: "high",
      url: "",
    };
    void appendEvent(event).catch((err) => logger.warn("rules", "Failed to record alert event", { err: String(err) }));
  }
}

/** Evaluate all enabled rules against the snapshot; fire on transitions into breach. */
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
  const liveIds = new Set(rules.map((rule) => rule.id));

  for (const rule of rules) {
    if (!rule.enabled) {
      states.set(rule.id, { ruleId: rule.id, firing: false, value: null });
      continue;
    }
    const { value, provider } = computeValue(rule, snapshot, groups);
    const firing = value !== null && breached(rule, value);
    const prev = states.get(rule.id);
    states.set(rule.id, {
      ruleId: rule.id,
      firing,
      value,
      since: firing ? (prev?.firing ? prev.since : now) : undefined,
    });
    if (firing && !prev?.firing) fire(rule, value as number, provider, now);
  }

  for (const id of [...states.keys()]) {
    if (!liveIds.has(id)) states.delete(id);
  }
}

export function getRuleStates(): RuleState[] {
  return [...states.values()];
}
