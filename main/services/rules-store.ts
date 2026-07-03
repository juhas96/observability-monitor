/**
 * Custom alerting rule definitions. Plain JSON in userData/rules.json; no secrets.
 */

import { randomUUID } from "crypto";

import { DataStore } from "./data-store.js";
import type { AlertRule, AlertRuleInput, RuleMetric, RuleOperator } from "./types.js";

interface RulesFile {
  rules: AlertRule[];
}

const store = new DataStore<RulesFile>("rules.json", { rules: [] });

const METRICS: RuleMetric[] = ["failureRate", "latency", "openIncidents"];
const OPERATORS: RuleOperator[] = ["gt", "lt"];

export async function listRules(): Promise<AlertRule[]> {
  return (await store.load()).rules;
}

export async function saveRule(input: AlertRuleInput): Promise<AlertRule> {
  if (!METRICS.includes(input.metric)) throw new Error("Invalid rule metric.");
  if (!OPERATORS.includes(input.operator)) throw new Error("Invalid rule operator.");
  const name = input.name.trim();
  if (name === "") throw new Error("Rule name is required.");
  const threshold = Number(input.threshold);
  if (!Number.isFinite(threshold)) throw new Error("Threshold must be a number.");

  const file = await store.load();
  const rules = [...file.rules];
  const now = new Date().toISOString();

  let rule: AlertRule;
  if (input.id) {
    const idx = rules.findIndex((r) => r.id === input.id);
    if (idx === -1) throw new Error("Rule not found.");
    rule = {
      ...rules[idx],
      name,
      metric: input.metric,
      operator: input.operator,
      threshold,
      scope: input.scope,
      enabled: input.enabled ?? rules[idx].enabled,
      updatedAt: now,
    };
    rules[idx] = rule;
  } else {
    rule = {
      id: randomUUID(),
      name,
      metric: input.metric,
      operator: input.operator,
      threshold,
      scope: input.scope,
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    };
    rules.push(rule);
  }

  await store.save({ rules });
  return rule;
}

export async function deleteRule(id: string): Promise<void> {
  const file = await store.load();
  await store.save({ rules: file.rules.filter((r) => r.id !== id) });
}
