/**
 * Account/provider diagnostics IPC. Never returns tokens.
 */

import { ipcMain, logger } from "@glaze/core/backend";

import { getAccount, listAccounts, listGroups } from "../services/accounts-store.js";
import * as aggregator from "../services/aggregator.js";
import { getAccountBackoff } from "../services/poller.js";
import * as registry from "../services/providers/index.js";
import { getToken, isEncryptionAvailable } from "../services/token-store.js";
import type {
  Account,
  AccountDashboardCapabilityDiagnostic,
  AccountDiagnostic,
  DiagnosticErrorCategory,
  DiagnosticStatus,
} from "../services/types.js";

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) return {};
  return value as Record<string, unknown>;
}

function classifyError(message: string, missingRequiredConfig: string[]): DiagnosticErrorCategory {
  const lower = message.toLowerCase();
  if (missingRequiredConfig.length > 0) return "config";
  if (lower.includes("unauthorized") || lower.includes("forbidden") || lower.includes("invalid token") || lower.includes("401")) return "auth";
  if (lower.includes("permission") || lower.includes("scope") || lower.includes("403")) return "permission";
  if (lower.includes("rate") || lower.includes("429")) return "rateLimit";
  if (lower.includes("network") || lower.includes("timeout") || lower.includes("fetch") || lower.includes("econn")) return "network";
  if (lower.includes("not found") || lower.includes("invalid") || lower.includes("missing")) return "config";
  if (lower.includes("provider") || lower.includes("api")) return "provider";
  return "unknown";
}

function requiredConfigMissing(account: Account): string[] {
  const def = registry.get(account.provider);
  const config = account.config ?? {};
  return def.fields
    .filter((field) => field.required && !field.secret && !config[field.key])
    .map((field) => field.label);
}

function baseStatus(account: Account, hasToken: boolean, missingRequiredConfig: string[]): DiagnosticStatus {
  if (!account.enabled) return "disabled";
  if (!hasToken || missingRequiredConfig.length > 0 || account.lastError) return "error";
  if (!account.lastSyncAt) return "unknown";
  return "ok";
}

async function dashboardCapabilityDiagnostic(
  account: Account,
  token: string | null | undefined,
  missingRequiredConfig: string[],
  loadLive: boolean,
): Promise<AccountDashboardCapabilityDiagnostic> {
  const definition = registry.get(account.provider);
  const base: AccountDashboardCapabilityDiagnostic = {
    providerSupportsLive: Boolean(definition.getDashboardQueryCapabilities),
    available: false,
    capabilityCount: 0,
    defaultPanelCount: 0,
    customQueryCount: 0,
    capabilityLabels: [],
    defaultPanelTitles: [],
    customQueryLabels: [],
    queryLanguages: [],
    resultKinds: [],
  };

  if (!definition.getDashboardQueryCapabilities) return base;
  if (!loadLive) return { ...base, unavailableReason: "Run diagnostics to load live dashboard capabilities." };
  const checkedAt = new Date().toISOString();
  if (!account.enabled) return { ...base, checkedAt, unavailableReason: "Account is disabled." };
  if (!token) return { ...base, checkedAt, unavailableReason: "No stored token for this account." };
  if (missingRequiredConfig.length > 0) {
    return { ...base, checkedAt, unavailableReason: `Missing required config: ${missingRequiredConfig.join(", ")}` };
  }

  try {
    const secret = registry.secretField(account.provider);
    const capabilities = await definition.getDashboardQueryCapabilities(account, { ...(account.config ?? {}), [secret.key]: token });
    return {
      providerSupportsLive: true,
      available: true,
      capabilityCount: capabilities.length,
      defaultPanelCount: capabilities.filter((capability) => Boolean(capability.defaultPanel)).length,
      customQueryCount: capabilities.filter((capability) => capability.requiresQuery).length,
      capabilityLabels: capabilities.map((capability) => capability.label).filter(Boolean).sort(),
      defaultPanelTitles: capabilities
        .map((capability) => capability.defaultPanel?.title)
        .filter((value): value is string => Boolean(value))
        .sort(),
      customQueryLabels: capabilities
        .filter((capability) => capability.requiresQuery)
        .map((capability) => capability.label)
        .filter(Boolean)
        .sort(),
      queryLanguages: [...new Set(capabilities.map((capability) => capability.queryLanguage).filter((value): value is string => Boolean(value)))].sort(),
      resultKinds: [...new Set(capabilities.map((capability) => capability.resultKind))].sort(),
      checkedAt,
    };
  } catch (error) {
    return {
      ...base,
      checkedAt,
      unavailableReason: "Could not load live dashboard capabilities.",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function diagnosticFor(account: Account, validate = false): Promise<AccountDiagnostic> {
  const [token, encryptionAvailable] = await Promise.all([getToken(account.id), isEncryptionAvailable()]);
  const groups = await listGroups();
  aggregator.setKnownAccounts(await listAccounts(), groups);
  const snapshot = aggregator.buildSnapshot();
  const staleness = snapshot.staleness[account.id];
  const missingRequiredConfig = requiredConfigMissing(account);
  const accountBackoff = getAccountBackoff(account.id);
  const base: AccountDiagnostic = {
    accountId: account.id,
    provider: account.provider,
    label: account.label,
    enabled: account.enabled,
    identity: account.identity,
    groupId: account.groupId,
    status: baseStatus(account, Boolean(token), missingRequiredConfig),
    hasToken: Boolean(token),
    encryptionAvailable,
    lastSyncAt: account.lastSyncAt,
    lastError: account.lastError,
    stale: staleness?.stale,
    staleReason: staleness?.reason,
    backoff: accountBackoff,
    missingRequiredConfig,
    dashboardCapabilities: await dashboardCapabilityDiagnostic(account, token, missingRequiredConfig, validate),
  };
  if (accountBackoff && base.status !== "disabled") base.status = "warning";
  if (base.stale && base.status === "ok") base.status = "warning";
  if (!validate) return base;

  const checkedAt = new Date().toISOString();
  if (!token) {
    return {
      ...base,
      status: "error",
      validation: { ok: false, checkedAt, error: "No stored token for this account.", category: "auth" },
    };
  }
  if (missingRequiredConfig.length > 0) {
    return {
      ...base,
      status: "error",
      validation: {
        ok: false,
        checkedAt,
        error: `Missing required config: ${missingRequiredConfig.join(", ")}`,
        category: "config",
      },
    };
  }

  try {
    const secret = registry.secretField(account.provider);
    const { identity } = await registry.get(account.provider).validate({ ...(account.config ?? {}), [secret.key]: token });
    return {
      ...base,
      status: base.stale ? "warning" : "ok",
      validation: { ok: true, checkedAt, identity },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...base,
      status: "error",
      validation: { ok: false, checkedAt, error: message, category: classifyError(message, missingRequiredConfig) },
    };
  }
}

export function registerDiagnosticHandlers(): void {
  ipcMain.handle("diagnostics:listAccounts", async (): Promise<AccountDiagnostic[]> => {
    const accounts = await listAccounts();
    return await Promise.all(accounts.map((account) => diagnosticFor(account)));
  });

  ipcMain.handle("diagnostics:runAccount", async (_event, payload: unknown): Promise<AccountDiagnostic> => {
    const req = asRecord(payload);
    const accountId = typeof req.accountId === "string" ? req.accountId : "";
    const account = await getAccount(accountId);
    if (!account) throw new Error("Account not found.");
    return await diagnosticFor(account, true);
  });

  logger.info("diagnostics", "✓ Diagnostics handlers registered");
}
