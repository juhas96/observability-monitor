/**
 * Custom alerting rule IPC handlers: CRUD plus current firing state.
 */

import { ipcMain, logger } from "@glaze/core/backend";

import { deleteRule, listRules, saveRule } from "../services/rules-store.js";
import { getRuleStates } from "../services/rules-engine.js";
import type { AlertRule, AlertRuleInput, Provider, RuleMetric, RuleOperator, RuleScope, RuleState } from "../services/types.js";

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

function parseInput(payload: unknown): AlertRuleInput {
  const req = asRecord(payload);
  if (typeof req.name !== "string") throw new Error("Rule name is required.");
  return {
    id: typeof req.id === "string" && req.id ? req.id : undefined,
    name: req.name,
    metric: String(req.metric) as RuleMetric,
    operator: String(req.operator) as RuleOperator,
    threshold: Number(req.threshold),
    scope: parseScope(req.scope),
    enabled: typeof req.enabled === "boolean" ? req.enabled : undefined,
    forMinutes: optionalNumber(req.forMinutes),
    cooldownMinutes: optionalNumber(req.cooldownMinutes),
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

  logger.info("rules", "✓ Rule handlers registered");
}
