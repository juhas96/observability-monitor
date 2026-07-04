/**
 * Custom alerting rule IPC handlers: CRUD plus current firing state.
 */

import { ipcMain, logger } from "@glaze/core/backend";

import { buildSnapshot } from "../services/aggregator.js";
import { deleteRule, listRules, saveRule } from "../services/rules-store.js";
import { getRuleStates, previewRule, sendRuleTest } from "../services/rules-engine.js";
import type { AlertRule, AlertRuleInput, ObservabilitySeverity, Provider, RuleMetric, RuleOperator, RulePreview, RuleScope, RuleState } from "../services/types.js";

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) return {};
  return value as Record<string, unknown>;
}

function parseScope(value: unknown): RuleScope {
  const req = asRecord(value);
  return {
    groupId: typeof req.groupId === "string" && req.groupId ? req.groupId : undefined,
    accountId: typeof req.accountId === "string" && req.accountId ? req.accountId : undefined,
    provider: typeof req.provider === "string" && req.provider ? (req.provider as Provider) : undefined,
    checkId: typeof req.checkId === "string" && req.checkId ? req.checkId : undefined,
  };
}

function optionalNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && value !== "" && value != null ? Math.max(0, n) : undefined;
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ids = [...new Set(value.filter((id): id is string => typeof id === "string" && id.trim() !== "").map((id) => id.trim()))];
  return ids.length > 0 ? ids : undefined;
}

function optionalSeverity(value: unknown): ObservabilitySeverity | undefined {
  if (!["critical", "high", "medium", "low", "info"].includes(String(value))) return undefined;
  return value as ObservabilitySeverity;
}

function parseInput(payload: unknown): AlertRuleInput {
  const req = asRecord(payload);
  if (typeof req.name !== "string") throw new Error("Rule name is required.");
  const input: AlertRuleInput = {
    id: typeof req.id === "string" && req.id ? req.id : undefined,
    name: req.name,
    metric: String(req.metric) as RuleMetric,
    operator: String(req.operator) as RuleOperator,
    threshold: Number(req.threshold),
    scope: parseScope(req.scope),
    enabled: typeof req.enabled === "boolean" ? req.enabled : undefined,
    minSeverity: optionalSeverity(req.minSeverity),
    forMinutes: optionalNumber(req.forMinutes),
    cooldownMinutes: optionalNumber(req.cooldownMinutes),
    dedupeMinutes: optionalNumber(req.dedupeMinutes),
  };
  if ("channelIds" in req) input.channelIds = req.channelIds === null ? null : optionalStringArray(req.channelIds);
  if ("minSeverity" in req && req.minSeverity === null) input.minSeverity = null;
  if ("mutedUntil" in req) input.mutedUntil = typeof req.mutedUntil === "string" || req.mutedUntil === null ? req.mutedUntil : undefined;
  return input;
}

function inputToRule(input: AlertRuleInput): AlertRule {
  const now = new Date().toISOString();
  return {
    id: input.id ?? "preview",
    name: input.name.trim() || "Unsaved rule",
    metric: input.metric,
    operator: input.operator,
    threshold: Number(input.threshold),
    scope: input.scope,
    channelIds: Array.isArray(input.channelIds) ? input.channelIds : undefined,
    enabled: input.enabled ?? true,
    minSeverity: input.minSeverity ?? undefined,
    forMinutes: input.forMinutes,
    cooldownMinutes: input.cooldownMinutes,
    dedupeMinutes: input.dedupeMinutes,
    mutedUntil: typeof input.mutedUntil === "string" ? input.mutedUntil : undefined,
    createdAt: now,
    updatedAt: now,
  };
}

export function registerRuleHandlers(): void {
  ipcMain.handle("rules:list", async (): Promise<AlertRule[]> => {
    return listRules();
  });

  ipcMain.handle("rules:save", async (_event, payload: unknown): Promise<AlertRule> => {
    return saveRule(parseInput(payload));
  });

  ipcMain.handle("rules:delete", async (_event, payload: unknown): Promise<{ ok: true }> => {
    const req = asRecord(payload);
    if (typeof req.id !== "string" || req.id.trim() === "") throw new Error("Rule id is required.");
    await deleteRule(req.id);
    return { ok: true };
  });

  ipcMain.handle("rules:getState", async (): Promise<RuleState[]> => {
    return getRuleStates();
  });

  ipcMain.handle("rules:preview", async (_event, payload: unknown): Promise<RulePreview> => {
    return previewRule(inputToRule(parseInput(payload)), buildSnapshot());
  });

  ipcMain.handle("rules:testDelivery", async (_event, payload: unknown): Promise<RulePreview> => {
    return sendRuleTest(inputToRule(parseInput(payload)), buildSnapshot());
  });

  logger.info("rules", "✓ Rule handlers registered");
}
