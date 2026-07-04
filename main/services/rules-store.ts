/**
 * Custom alerting rule definitions. Plain JSON in userData/rules.json; no secrets.
 */

import { randomUUID } from "crypto";

import { DataStore } from "./data-store.js";
import type { AlertRule, AlertRuleInput, ObservabilitySeverity, RuleMetric, RuleOperator } from "./types.js";

interface RulesFile {
  rules: AlertRule[];
}

const store = new DataStore<RulesFile>("rules.json", { rules: [] });

const METRICS: RuleMetric[] = ["failureRate", "latency", "checkDown", "openIncidents"];
const OPERATORS: RuleOperator[] = ["gt", "lt"];
const SEVERITIES: ObservabilitySeverity[] = ["critical", "high", "medium", "low", "info"];

function normalizeMutedUntil(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const until = new Date(value).getTime();
  return Number.isFinite(until) && until > Date.now() ? value : undefined;
}

function normalizeChannelIds(value: string[] | null | undefined): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ids = [...new Set(value.map((id) => id.trim()).filter(Boolean))];
  return ids.length > 0 ? ids : undefined;
}

function normalizeSeverity(value: ObservabilitySeverity | null | undefined): ObservabilitySeverity | undefined {
  return value && SEVERITIES.includes(value) ? value : undefined;
}

function normalizeMinutes(value: number | undefined, { allowZero }: { allowZero: boolean }): number | undefined {
  if (value == null) return undefined;
  const minutes = Number(value);
  if (!Number.isFinite(minutes)) return undefined;
  if (minutes === 0 && allowZero) return 0;
  return minutes > 0 ? minutes : undefined;
}

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
      channelIds: "channelIds" in input ? normalizeChannelIds(input.channelIds) : normalizeChannelIds(rules[idx].channelIds),
      enabled: input.enabled ?? rules[idx].enabled,
      minSeverity: "minSeverity" in input ? normalizeSeverity(input.minSeverity) : normalizeSeverity(rules[idx].minSeverity),
      forMinutes: normalizeMinutes(input.forMinutes, { allowZero: true }),
      cooldownMinutes: normalizeMinutes(input.cooldownMinutes, { allowZero: true }),
      dedupeMinutes: normalizeMinutes(input.dedupeMinutes, { allowZero: false }),
      mutedUntil: "mutedUntil" in input ? normalizeMutedUntil(input.mutedUntil) : normalizeMutedUntil(rules[idx].mutedUntil),
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
      channelIds: normalizeChannelIds(input.channelIds),
      enabled: input.enabled ?? true,
      minSeverity: normalizeSeverity(input.minSeverity),
      forMinutes: normalizeMinutes(input.forMinutes, { allowZero: true }),
      cooldownMinutes: normalizeMinutes(input.cooldownMinutes, { allowZero: true }),
      dedupeMinutes: normalizeMinutes(input.dedupeMinutes, { allowZero: false }),
      mutedUntil: normalizeMutedUntil(input.mutedUntil),
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
