/**
 * User-triggered live smoke verification. This intentionally returns only
 * status metadata and never exposes provider tokens or webhook URLs.
 */

import { ipcMain, logger } from "@glaze/core/backend";

import { listAccounts } from "../services/accounts-store.js";
import { listChannels } from "../services/channels-store.js";
import { runChecks } from "../services/checks-runner.js";
import { listChecks } from "../services/checks-store.js";
import { listDashboardCapabilities } from "../services/dashboard-query-runner.js";
import { listDashboards } from "../services/dashboard-store.js";
import { dispatchTest } from "../services/dispatch.js";
import { listLocalIncidents } from "../services/local-incidents-store.js";
import { get as getProviderDefinition, secretField } from "../services/providers/registry.js";
import { listRules } from "../services/rules-store.js";
import { getToken } from "../services/token-store.js";
import type { VerificationReport, VerificationResult } from "../services/types.js";

interface VerificationRequest {
  includeChannelTests?: boolean;
}

function result(input: VerificationResult): VerificationResult {
  return input;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function dashboardCapabilityDetail(capabilities: Awaited<ReturnType<typeof listDashboardCapabilities>>): string {
  const defaultPanels = capabilities
    .map((capability) => capability.defaultPanel?.title)
    .filter((value): value is string => Boolean(value));
  const customQueries = capabilities.filter((capability) => capability.requiresQuery).length;
  const examples = defaultPanels.slice(0, 5);
  const examplesText = examples.length > 0 ? ` Examples: ${examples.join(", ")}${defaultPanels.length > examples.length ? "…" : ""}.` : "";
  return `${capabilities.length} capabilities available across local and live providers; ${defaultPanels.length} one-click defaults; ${customQueries} custom-query sources.${examplesText}`;
}

async function verifyAccounts(): Promise<VerificationResult[]> {
  const accounts = await listAccounts();
  if (accounts.length === 0) {
    return [result({ id: "accounts:none", area: "accounts", label: "Provider accounts", status: "skipped", detail: "No accounts configured." })];
  }
  return await Promise.all(accounts.map(async (account) => {
    if (!account.enabled) {
      return result({ id: `account:${account.id}`, area: "accounts", label: account.label, status: "skipped", detail: "Account is disabled." });
    }
    const token = await getToken(account.id);
    if (!token) {
      return result({ id: `account:${account.id}`, area: "accounts", label: account.label, status: "failed", detail: "No stored token." });
    }
    try {
      const definition = getProviderDefinition(account.provider);
      const secret = secretField(account.provider);
      const validation = await definition.validate({ ...(account.config ?? {}), [secret.key]: token });
      return result({
        id: `account:${account.id}`,
        area: "accounts",
        label: account.label,
        status: "passed",
        detail: validation.identity ? `Validated as ${validation.identity}.` : "Credentials validated.",
      });
    } catch (error) {
      return result({
        id: `account:${account.id}`,
        area: "accounts",
        label: account.label,
        status: "failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }));
}

async function verifyChannels(includeTests: boolean): Promise<VerificationResult[]> {
  const channels = await listChannels();
  if (channels.length === 0) {
    return [result({ id: "channels:none", area: "channels", label: "Notification channels", status: "skipped", detail: "No channels configured." })];
  }
  if (!includeTests) {
    return [result({
      id: "channels:skipped",
      area: "channels",
      label: "Notification channels",
      status: "skipped",
      detail: `${channels.length} channel definitions loaded; delivery tests were skipped by request.`,
    })];
  }
  return await Promise.all(channels.map(async (channel) => {
    if (!channel.enabled) {
      return result({ id: `channel:${channel.id}`, area: "channels", label: channel.name, status: "skipped", detail: "Channel is disabled." });
    }
    try {
      await dispatchTest(channel.id);
      return result({ id: `channel:${channel.id}`, area: "channels", label: channel.name, status: "passed", detail: "Test notification delivered." });
    } catch (error) {
      return result({
        id: `channel:${channel.id}`,
        area: "channels",
        label: channel.name,
        status: "failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }));
}

async function verifyChecks(): Promise<VerificationResult[]> {
  const checks = await listChecks();
  const enabled = checks.filter((check) => check.enabled);
  if (enabled.length === 0) {
    return [result({ id: "checks:none", area: "checks", label: "Uptime checks", status: "skipped", detail: "No enabled checks configured." })];
  }
  const results = await runChecks();
  return results.map((check) => result({
    id: `check:${check.checkId}`,
    area: "checks",
    label: check.name,
    status: check.ok ? "passed" : "failed",
    detail: check.ok
      ? `HTTP ${check.statusCode ?? "ok"} in ${check.latencyMs}ms.`
      : check.error ?? `HTTP ${check.statusCode ?? "unknown"} in ${check.latencyMs}ms.`,
  }));
}

async function verifyDashboardsAndLocal(): Promise<VerificationResult[]> {
  const [dashboards, capabilities, incidents, rules] = await Promise.allSettled([
    listDashboards(),
    listDashboardCapabilities(),
    listLocalIncidents(),
    listRules(),
  ]);
  const dashboardsCount = dashboards.status === "fulfilled" ? dashboards.value.length : 0;
  const capabilitiesCount = capabilities.status === "fulfilled" ? capabilities.value.length : 0;
  const incidentsCount = incidents.status === "fulfilled" ? incidents.value.length : 0;
  const rulesCount = rules.status === "fulfilled" ? rules.value.length : 0;
  return [
    result({
      id: "dashboards:capabilities",
      area: "dashboards",
      label: "Dashboard capabilities",
      status: capabilities.status === "rejected" ? "failed" : capabilitiesCount > 0 ? "passed" : "warning",
      detail: capabilities.status === "rejected"
        ? (capabilities.reason instanceof Error ? capabilities.reason.message : String(capabilities.reason))
        : dashboardCapabilityDetail(capabilities.value),
    }),
    result({
      id: "dashboards:definitions",
      area: "dashboards",
      label: "Saved dashboards",
      status: dashboards.status === "rejected" ? "failed" : "passed",
      detail: dashboards.status === "rejected"
        ? (dashboards.reason instanceof Error ? dashboards.reason.message : String(dashboards.reason))
        : `${dashboardsCount} dashboard definitions loaded.`,
    }),
    result({
      id: "local:incidents",
      area: "local",
      label: "Local incidents",
      status: incidents.status === "rejected" ? "failed" : "passed",
      detail: incidents.status === "rejected"
        ? (incidents.reason instanceof Error ? incidents.reason.message : String(incidents.reason))
        : `${incidentsCount} local incident records loaded.`,
    }),
    result({
      id: "local:rules",
      area: "local",
      label: "Alert rules",
      status: rules.status === "rejected" ? "failed" : "passed",
      detail: rules.status === "rejected"
        ? (rules.reason instanceof Error ? rules.reason.message : String(rules.reason))
        : `${rulesCount} alert rules loaded.`,
    }),
  ];
}

export function registerVerificationHandlers(): void {
  ipcMain.handle("verification:run", async (_event, payload: unknown): Promise<VerificationReport> => {
    const req = asRecord(payload) as VerificationRequest;
    const groups = await Promise.all([
      verifyAccounts(),
      verifyChannels(req.includeChannelTests === true),
      verifyChecks(),
      verifyDashboardsAndLocal(),
    ]);
    return {
      generatedAt: new Date().toISOString(),
      results: groups.flat(),
    };
  });

  logger.info("verification", "✓ Verification handlers registered");
}
