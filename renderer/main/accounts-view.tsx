import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, AlertCircle, CheckCircle2, Stethoscope, Download, Upload, LayoutDashboard, RefreshCw } from "lucide-react";
import {
  ScrollArea,
  Button,
  List,
  Switch,
  Text,
  EmptyState,
  Callout,
  AlertDialog,
  Badge,
  Dialog,
  toast,
} from "@glaze/core/components";

import { AddAccountDialog } from "./components/add-account-dialog";
import { ALL, type AppliedFilter, FilterMenu, FilterSearchField, FilterSelectField, optionLabel, useStoredState } from "./components/filters";
import { providerIcon, providerLabel } from "./components/provider-meta";
import { useAccounts, useAccountMutations, useGroups } from "./hooks/use-accounts";
import { useChecks } from "./hooks/use-checks";
import { useDashboards } from "./hooks/use-dashboards";
import { useAccountDiagnostics, useDiagnosticMutations } from "./hooks/use-diagnostics";
import { useProviders } from "./hooks/use-providers";
import { useRules } from "./hooks/use-rules";
import { useSlos } from "./hooks/use-slos";
import { monitorApi } from "./ipc";
import { downloadCsv } from "./utils/csv";
import type { Account, AccountDiagnostic, DiagnosticStatus, ProjectGroup, Provider, ProviderInfo, VerificationReport, VerificationStatus } from "./types";

const SETUP_FILTER_KEYS = [
  "accounts.filters.v1",
  "accounts.filters.v1.presets",
  "accounts.filters.v1.presets.default",
  "dashboard.filters.v2",
  "dashboard.filters.v2.presets",
  "dashboard.filters.v2.presets.default",
  "apps.filters.v1",
  "apps.filters.v1.presets",
  "apps.filters.v1.presets.default",
  "insights.filters.v2",
  "insights.filters.v2.presets",
  "insights.filters.v2.presets.default",
  "incidents.filters.v1",
  "incidents.filters.v1.presets",
  "incidents.filters.v1.presets.default",
  "timeline.filters.v1",
  "timeline.filters.v1.presets",
  "timeline.filters.v1.presets.default",
  "uptime.filters.v1",
  "uptime.filters.v1.presets",
  "uptime.filters.v1.presets.default",
  "alerts.filters.v1",
  "alerts.filters.v1.presets",
  "alerts.filters.v1.presets.default",
  "customDashboards.filters.v2",
  "customDashboards.filters.v2.presets",
  "customDashboards.filters.v2.presets.default",
  "notificationChannels.filters.v1",
  "notificationChannels.filters.v1.presets",
  "notificationChannels.filters.v1.presets.default",
];
const ACCOUNT_SELECT_KEY = "accounts.select.v1";
const ACCOUNT_CREATE_KEY = "accounts.create.v1";
const ACCOUNT_VERIFY_KEY = "accounts.verify.v1";
const CUSTOM_DASHBOARD_FILTER_KEY = "customDashboards.filters.v2";
const FILTER_KEY = "accounts.filters.v1";
const FILTER_PRESET_KEY = `${FILTER_KEY}.presets`;
const UNGROUPED = "ungrouped";

interface AccountFilters {
  search: string;
  provider: string;
  group: string;
  enabled: "all" | "enabled" | "disabled";
  diagnostic: DiagnosticStatus | "all";
  token: "all" | "present" | "missing";
  dashboardSupport: "all" | "liveSupported" | "localOnly" | "liveAvailable" | "liveUnavailable";
}

const DEFAULT_FILTERS: AccountFilters = {
  search: "",
  provider: ALL,
  group: ALL,
  enabled: "all",
  diagnostic: "all",
  token: "all",
  dashboardSupport: "all",
};

function collectSetupFilters(): Record<string, string> {
  const filters: Record<string, string> = {};
  for (const key of SETUP_FILTER_KEYS) {
    const value = localStorage.getItem(key);
    if (!value) continue;
    try {
      JSON.parse(value);
      filters[key] = value;
    } catch {
      // Ignore stale or invalid filter state.
    }
  }
  return filters;
}

function restoreSetupFilters(filters: Record<string, string>) {
  for (const [key, value] of Object.entries(filters)) {
    if (!SETUP_FILTER_KEYS.includes(key)) continue;
    try {
      JSON.parse(value);
      localStorage.setItem(key, value);
    } catch {
      // Ignore invalid imported filter state.
    }
  }
}

function identity(account: Account): string {
  return account.identity ?? `${providerLabel(account.provider)} account`;
}

function accountDescription(account: Account, groupsById: Map<string, ProjectGroup>): string {
  const parts = [identity(account)];
  const group = account.groupId ? groupsById.get(account.groupId) : undefined;
  if (group) parts.push(`Project: ${group.name}`);
  if (account.lastError) parts.push(account.lastError);
  return parts.join(" · ");
}

function diagnosticColor(status: DiagnosticStatus): "green" | "yellow" | "red" | "secondary" {
  if (status === "ok") return "green";
  if (status === "warning" || status === "unknown") return "yellow";
  if (status === "error") return "red";
  return "secondary";
}

function verificationColor(status: VerificationStatus): "green" | "yellow" | "red" | "secondary" {
  if (status === "passed") return "green";
  if (status === "warning") return "yellow";
  if (status === "failed") return "red";
  return "secondary";
}

function diagnosticDetail(diagnostic: AccountDiagnostic | undefined): string {
  if (!diagnostic) return "Diagnostics pending";
  const parts = [
    diagnostic.validation?.ok ? "Credentials valid" : diagnostic.validation?.error,
    diagnostic.missingRequiredConfig.length > 0 ? `Missing ${diagnostic.missingRequiredConfig.join(", ")}` : undefined,
    !diagnostic.hasToken ? "No stored token" : undefined,
    diagnostic.backoff ? `Retry in ${Math.ceil(diagnostic.backoff.remainingSeconds / 60)}m after ${diagnostic.backoff.failures} failed attempts` : undefined,
    diagnostic.stale ? diagnostic.staleReason ?? "Stale polling data" : undefined,
    diagnostic.lastError,
    diagnostic.lastSyncAt ? `Last sync ${new Date(diagnostic.lastSyncAt).toLocaleString()}` : undefined,
  ];
  return parts.filter(Boolean).join(" · ") || "No issues detected";
}

function dashboardCapabilityDetail(diagnostic: AccountDiagnostic): string {
  const summary = diagnostic.dashboardCapabilities;
  if (!summary) return "Local dashboard panels available";
  if (!summary.providerSupportsLive) return "Local dashboard panels available; no provider live-query support declared";
  if (summary.available) {
    const languages = summary.queryLanguages.length > 0 ? ` · ${summary.queryLanguages.join(", ")}` : "";
    const examples = summary.defaultPanelTitles.slice(0, 3);
    const exampleText = examples.length > 0 ? ` · ${examples.join(", ")}${summary.defaultPanelTitles.length > examples.length ? "…" : ""}` : "";
    return `${summary.capabilityCount} live dashboard capabilities · ${summary.defaultPanelCount} defaults · ${summary.customQueryCount} custom${languages}${exampleText}`;
  }
  return summary.unavailableReason ?? "Run diagnostics to load live dashboard capabilities";
}

function collectionAreaSummary(diagnostic: AccountDiagnostic): string {
  const areas = diagnostic.collectionAreas ?? [];
  if (areas.length === 0) return "Collection areas unavailable";
  const active = areas.filter((area) => area.status === "always-on" || area.status === "enabled").length;
  const configured = areas.filter((area) => area.defaultState === "configured").length;
  return `${active}/${areas.length} collection areas active${configured ? ` · ${configured} configured-only` : ""}`;
}

function collectionAreaColor(status: AccountDiagnostic["collectionAreas"][number]["status"]): "green" | "yellow" | "red" | "secondary" | "blue" {
  if (status === "always-on") return "blue";
  if (status === "enabled") return "green";
  if (status === "missing-config") return "yellow";
  if (status === "unavailable") return "red";
  return "secondary";
}

function downloadAccountsCsv(accounts: Account[], diagnosticsById: Map<string, AccountDiagnostic>, groupsById: Map<string, ProjectGroup>): void {
  const columns = [
    "id",
    "label",
    "provider",
    "identity",
    "group",
    "groupId",
    "enabled",
    "diagnosticStatus",
    "hasToken",
    "encryptionAvailable",
    "validationOk",
    "validationCheckedAt",
    "validationIdentity",
    "validationError",
    "missingRequiredConfig",
    "lastSyncAt",
    "lastError",
    "stale",
    "staleReason",
    "backoffFailures",
    "backoffNextAttemptAt",
    "dashboardProviderSupportsLive",
    "dashboardAvailable",
    "dashboardCapabilityCount",
    "dashboardDefaultPanelCount",
    "dashboardCustomQueryCount",
    "dashboardQueryLanguages",
    "dashboardResultKinds",
    "dashboardUnavailableReason",
    "collectionAreas",
    "createdAt",
  ];
  const rows = accounts.map((account) => {
    const diagnostic = diagnosticsById.get(account.id);
    const dashboard = diagnostic?.dashboardCapabilities;
    const group = account.groupId ? groupsById.get(account.groupId) : undefined;
    return [
      account.id,
      account.label,
      providerLabel(account.provider),
      account.identity ?? diagnostic?.identity ?? "",
      group?.name ?? "",
      account.groupId ?? "",
      account.enabled ? "enabled" : "disabled",
      diagnostic?.status ?? "pending",
      diagnostic?.hasToken ?? "",
      diagnostic?.encryptionAvailable ?? "",
      diagnostic?.validation?.ok ?? "",
      diagnostic?.validation?.checkedAt ?? "",
      diagnostic?.validation?.identity ?? "",
      diagnostic?.validation?.error ?? "",
      diagnostic?.missingRequiredConfig.join("; ") ?? "",
      diagnostic?.lastSyncAt ?? account.lastSyncAt ?? "",
      diagnostic?.lastError ?? account.lastError ?? "",
      diagnostic?.stale ?? "",
      diagnostic?.staleReason ?? "",
      diagnostic?.backoff?.failures ?? "",
      diagnostic?.backoff?.nextAttemptAt ?? "",
      dashboard?.providerSupportsLive ?? "",
      dashboard?.available ?? "",
      dashboard?.capabilityCount ?? "",
      dashboard?.defaultPanelCount ?? "",
      dashboard?.customQueryCount ?? "",
      dashboard?.queryLanguages.join("; ") ?? "",
      dashboard?.resultKinds.join("; ") ?? "",
      dashboard?.unavailableReason ?? dashboard?.error ?? "",
      diagnostic?.collectionAreas.map((area) => `${area.label}:${area.status}`).join("; ") ?? "",
      account.createdAt,
    ];
  });
  downloadCsv(`accounts-${new Date().toISOString().slice(0, 10)}.csv`, columns, rows);
}

function SetupChecklist({
  accountCount,
  groupCount,
  checkCount,
  ruleCount,
  dashboardCount,
  onAddAccount,
  onReviewGroups,
  onOpenUptime,
  onOpenAlerts,
  onOpenDashboards,
}: {
  accountCount: number;
  groupCount: number;
  checkCount: number;
  ruleCount: number;
  dashboardCount: number;
  onAddAccount: () => void;
  onReviewGroups: () => void;
  onOpenUptime: () => void;
  onOpenAlerts: () => void;
  onOpenDashboards: () => void;
}) {
  const items = [
    { label: "Connect a provider account", done: accountCount > 0, detail: `${accountCount} connected`, action: "Add", onAction: onAddAccount },
    { label: "Assign accounts to project groups", done: groupCount > 0, detail: `${groupCount} groups`, action: "Review", onAction: onReviewGroups },
    { label: "Add an uptime check", done: checkCount > 0, detail: `${checkCount} checks`, action: "Open", onAction: onOpenUptime },
    { label: "Create an alert rule", done: ruleCount > 0, detail: `${ruleCount} rules`, action: "Open", onAction: onOpenAlerts },
    { label: "Create a dashboard", done: dashboardCount > 0, detail: `${dashboardCount} dashboards`, action: "Open", onAction: onOpenDashboards },
  ];
  const doneCount = items.filter((item) => item.done).length;
  return (
    <section className="rounded-lg border border-separator p-3 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Text variant="strong">Setup checklist</Text>
        <Badge color={doneCount === items.length ? "green" : "secondary"}>{doneCount}/{items.length}</Badge>
        {accountCount === 0 ? (
          <Button variant="accent" size="small" className="ml-auto" onClick={onAddAccount}>
            <Plus className="size-4" />
            Add account
          </Button>
        ) : null}
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-2">
        {items.map((item) => (
          <div key={item.label} className="rounded-md border border-separator p-2 flex items-start gap-2">
            {item.done ? <CheckCircle2 className="size-4 text-support-green mt-0.5" /> : <AlertCircle className="size-4 text-tertiary mt-0.5" />}
            <div className="min-w-0 flex-1">
              <Text variant="small" truncate className="block">{item.label}</Text>
              <Text variant="small" color="tertiary" className="block">{item.detail}</Text>
            </div>
            {!item.done ? (
              <Button variant="glass" size="small" onClick={item.onAction}>
                {item.action}
              </Button>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function DiagnosticsPanel({
  diagnostics,
  onEditAccount,
  onOpenDashboards,
}: {
  diagnostics: AccountDiagnostic[];
  onEditAccount: (diagnostic: AccountDiagnostic) => void;
  onOpenDashboards: (diagnostic: AccountDiagnostic) => void;
}) {
  const { runAccount } = useDiagnosticMutations();
  const [refreshingAccountId, setRefreshingAccountId] = useState<string | null>(null);
  if (diagnostics.length === 0) return null;
  return (
    <section className="rounded-lg border border-separator p-3 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Stethoscope className="size-4 text-tertiary" />
        <Text variant="strong">Account diagnostics</Text>
      </div>
      <div className="flex flex-col">
        {diagnostics.map((diagnostic) => (
          <div key={diagnostic.accountId} className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-3 py-2 border-t border-separator first:border-t-0 items-center">
            <div className="min-w-0">
              <Text variant="strong" truncate className="block">{diagnostic.label}</Text>
              <Text variant="small" color="secondary" truncate className="block">{diagnosticDetail(diagnostic)}</Text>
              <Text variant="small" color="tertiary" truncate className="block">{dashboardCapabilityDetail(diagnostic)}</Text>
              <Text variant="small" color="tertiary" truncate className="block">{collectionAreaSummary(diagnostic)}</Text>
              {diagnostic.dashboardCapabilities?.available ? (
                <div className="flex flex-wrap gap-1 mt-1">
                  <Badge color="blue">{diagnostic.dashboardCapabilities.defaultPanelCount} defaults</Badge>
                  {diagnostic.dashboardCapabilities.defaultPanelTitles.slice(0, 3).map((title) => (
                    <Badge key={title} color="secondary">{title}</Badge>
                  ))}
                  {diagnostic.dashboardCapabilities.customQueryCount > 0 ? (
                    <Badge color="secondary">{diagnostic.dashboardCapabilities.customQueryCount} custom</Badge>
                  ) : null}
                  {diagnostic.dashboardCapabilities.customQueryLabels.slice(0, 2).map((label) => (
                    <Badge key={label} color="secondary">{label}</Badge>
                  ))}
                  {diagnostic.dashboardCapabilities.resultKinds.slice(0, 3).map((kind) => (
                    <Badge key={kind} color="secondary">{kind}</Badge>
                  ))}
                </div>
              ) : null}
              {diagnostic.collectionAreas.length > 0 ? (
                <div className="flex flex-wrap gap-1 mt-1">
                  {diagnostic.collectionAreas.slice(0, 6).map((area) => (
                    <Badge key={area.id} color={collectionAreaColor(area.status)}>{area.label}: {area.status}</Badge>
                  ))}
                  {diagnostic.collectionAreas.length > 6 ? <Badge color="secondary">+{diagnostic.collectionAreas.length - 6} more</Badge> : null}
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              <Badge color={diagnosticColor(diagnostic.status)}>{diagnostic.status}</Badge>
              <Button
                variant="glass"
                size="small"
                onClick={() => onEditAccount(diagnostic)}
              >
                <Pencil className="size-4" />
                Edit
              </Button>
              <Button
                variant="glass"
                size="small"
                onClick={() => onOpenDashboards(diagnostic)}
              >
                <LayoutDashboard className="size-4" />
                Dashboards
              </Button>
              <Button
                variant="glass"
                size="small"
                onClick={() => {
                  setRefreshingAccountId(diagnostic.accountId);
                  void monitorApi.refresh(diagnostic.accountId)
                    .then(() => toast.success("Account refreshed"))
                    .catch((error) => toast.error(error instanceof Error ? error.message : String(error)))
                    .finally(() => setRefreshingAccountId((current) => current === diagnostic.accountId ? null : current));
                }}
                disabled={refreshingAccountId === diagnostic.accountId}
              >
                <RefreshCw className="size-4" />
                Refresh
              </Button>
              <Button
                variant="glass"
                size="small"
                onClick={() =>
                  void runAccount.mutateAsync(diagnostic.accountId)
                    .then((result) => toast[result.validation?.ok ? "success" : "error"](result.validation?.ok ? "Credentials valid" : result.validation?.error ?? "Diagnostic failed"))
                    .catch((error) => toast.error(error instanceof Error ? error.message : String(error)))}
                disabled={runAccount.isPending}
              >
                Run
              </Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function VerificationPanel() {
  const { runVerification } = useDiagnosticMutations();
  const [report, setReport] = useState<VerificationReport | null>(null);
  const [includeChannelTests, setIncludeChannelTests] = useState(false);
  const runSmokeVerification = (includeChannels: boolean) => {
    void runVerification.mutateAsync({ includeChannelTests: includeChannels })
      .then((next) => {
        setReport(next);
        const failed = next.results.filter((item) => item.status === "failed").length;
        toast[failed > 0 ? "error" : "success"](failed > 0 ? `${failed} verification checks failed` : "Smoke verification passed");
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : String(error)));
  };

  useEffect(() => {
    const raw = localStorage.getItem(ACCOUNT_VERIFY_KEY);
    if (!raw) return;
    localStorage.removeItem(ACCOUNT_VERIFY_KEY);
    try {
      const parsed = JSON.parse(raw) as { run?: unknown };
      if (parsed.run) runSmokeVerification(false);
    } catch {
      // Ignore stale command-palette verification payloads.
    }
  }, []);

  return (
    <section className="rounded-lg border border-separator p-3 flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <Text variant="strong" className="block">Live smoke verification</Text>
          <Text variant="small" color="secondary" className="block">
            Validates accounts, probes enabled uptime checks, lists dashboard capabilities, and can optionally send test messages.
          </Text>
        </div>
        <Button
          variant="glass"
          size="small"
          disabled={runVerification.isPending}
          onClick={() => runSmokeVerification(includeChannelTests)}
        >
          Run smoke tests
        </Button>
      </div>
      <div className="flex items-center gap-2 rounded-md border border-separator p-2">
        <Switch
          checked={includeChannelTests}
          onCheckedChange={setIncludeChannelTests}
          aria-label="Send real notification channel tests"
        />
        <div className="min-w-0">
          <Text variant="small" className="block">Send notification channel tests</Text>
          <Text variant="small" color="tertiary" className="block">
            Off by default; when enabled this posts real test messages to enabled Slack, Teams, and webhook channels.
          </Text>
        </div>
      </div>
      {report ? (
        <div className="flex flex-col">
          {report.results.map((item) => (
            <div key={item.id} className="grid grid-cols-[auto_1fr] gap-3 py-2 border-t border-separator first:border-t-0 items-start">
              <Badge color={verificationColor(item.status)}>{item.status}</Badge>
              <div className="min-w-0">
                <Text variant="strong" truncate className="block">{item.label}</Text>
                <Text variant="small" color="secondary" truncate className="block">{item.area}{item.detail ? ` · ${item.detail}` : ""}</Text>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Callout color={includeChannelTests ? "yellow" : "secondary"} icon={<AlertCircle />}>
          {includeChannelTests
            ? "This run will send real test notifications to enabled Slack, Teams, and webhook channels."
            : "Notification channels are inspected but delivery tests are skipped unless you enable them above."}
        </Callout>
      )}
    </section>
  );
}

function SetupBackupPanel({
  onExport,
  onImport,
  exporting,
  importing,
}: {
  onExport: () => void;
  onImport: () => void;
  exporting: boolean;
  importing: boolean;
}) {
  return (
    <section className="rounded-lg border border-separator p-3 flex flex-col md:flex-row md:items-center gap-3">
      <div className="min-w-0 flex-1">
        <Text variant="strong" className="block">Portable setup</Text>
        <Text variant="small" color="secondary" className="block">
          Export or import app configuration for sharing. Tokens and webhook URLs are never included.
        </Text>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="glass" size="small" onClick={onImport} disabled={importing || exporting}>
          <Upload className="size-4" />
          Import setup
        </Button>
        <Button variant="glass" size="small" onClick={onExport} disabled={importing || exporting}>
          <Download className="size-4" />
          Export setup
        </Button>
      </div>
    </section>
  );
}

function ProviderCapabilityMatrix({
  providers,
  accounts,
  diagnostics,
  onFilterProvider,
  onOpenDashboards,
}: {
  providers: ProviderInfo[];
  accounts: Account[];
  diagnostics: AccountDiagnostic[];
  onFilterProvider: (provider: Provider) => void;
  onOpenDashboards: (provider: Provider) => void;
}) {
  if (providers.length === 0) return null;
  return (
    <section className="rounded-lg border border-separator p-3 flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <Text variant="strong" className="block">Provider capability matrix</Text>
          <Text variant="small" color="secondary" className="block">
            Shows connected account coverage, diagnostics, local dashboard availability, and loaded live dashboard defaults per provider.
          </Text>
        </div>
      </div>
      <div className="overflow-auto rounded-md border border-separator">
        <table className="w-full min-w-[880px] text-left text-sm">
          <thead className="bg-control-subtle text-tertiary">
            <tr>
              <th className="px-3 py-2 font-medium">Provider</th>
              <th className="px-3 py-2 font-medium">Accounts</th>
              <th className="px-3 py-2 font-medium">Diagnostics</th>
              <th className="px-3 py-2 font-medium">Local panels</th>
              <th className="px-3 py-2 font-medium">Live dashboards</th>
              <th className="px-3 py-2 font-medium">Collection</th>
              <th className="px-3 py-2 font-medium">Defaults</th>
              <th className="px-3 py-2 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {providers.map((provider) => {
              const providerAccounts = accounts.filter((account) => account.provider === provider.id);
              const providerDiagnostics = diagnostics.filter((diagnostic) => diagnostic.provider === provider.id);
              const enabledCount = providerAccounts.filter((account) => account.enabled).length;
              const diagnosticCounts = providerDiagnostics.reduce<Record<DiagnosticStatus, number>>((counts, diagnostic) => {
                counts[diagnostic.status] += 1;
                return counts;
              }, { ok: 0, warning: 0, error: 0, disabled: 0, unknown: 0 });
              const liveSummaries = providerDiagnostics
                .map((diagnostic) => diagnostic.dashboardCapabilities)
                .filter((summary): summary is NonNullable<AccountDiagnostic["dashboardCapabilities"]> => Boolean(summary));
              const supportsLive = liveSummaries.some((summary) => summary.providerSupportsLive);
              const availableSummaries = liveSummaries.filter((summary) => summary.available);
              const defaultCount = availableSummaries.reduce((sum, summary) => sum + summary.defaultPanelCount, 0);
              const customCount = availableSummaries.reduce((sum, summary) => sum + summary.customQueryCount, 0);
              const resultKinds = [...new Set(availableSummaries.flatMap((summary) => summary.resultKinds))].slice(0, 4);
              const Icon = providerIcon(provider.id);
              return (
                <tr key={provider.id} className="border-t border-separator">
                  <td className="px-3 py-2 align-top">
                    <div className="flex items-center gap-2 min-w-0">
                      <Icon className="size-4 shrink-0 text-tertiary" />
                      <div className="min-w-0">
                        <Text variant="strong" truncate className="block">{provider.label}</Text>
                        <Text variant="small" color="tertiary" truncate className="block">{provider.scopeHint}</Text>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <Text variant="small" className="block">{providerAccounts.length} connected</Text>
                    <Text variant="small" color="tertiary" className="block">{enabledCount} enabled</Text>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="flex flex-wrap gap-1">
                      {(["ok", "warning", "error", "disabled", "unknown"] as DiagnosticStatus[])
                        .filter((status) => diagnosticCounts[status] > 0)
                        .map((status) => <Badge key={status} color={diagnosticColor(status)}>{diagnosticCounts[status]} {status}</Badge>)}
                      {providerDiagnostics.length === 0 ? <Badge color="secondary">not connected</Badge> : null}
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <Badge color={providerAccounts.length > 0 ? "green" : "secondary"}>
                      {providerAccounts.length > 0 ? "available" : "needs account"}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="flex flex-col gap-1">
                      <Badge color={supportsLive ? (availableSummaries.length > 0 ? "blue" : "yellow") : "secondary"}>
                        {supportsLive ? (availableSummaries.length > 0 ? "loaded" : "supported") : "local only"}
                      </Badge>
                      {resultKinds.length > 0 ? (
                        <Text variant="small" color="tertiary" truncate>{resultKinds.join(", ")}</Text>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="flex flex-wrap gap-1">
                      {(provider.collectionAreas ?? []).slice(0, 4).map((area) => (
                        <Badge key={area.id} color={area.defaultState === "always" ? "blue" : "secondary"}>{area.label}</Badge>
                      ))}
                      {(provider.collectionAreas ?? []).length > 4 ? <Badge color="secondary">+{(provider.collectionAreas ?? []).length - 4}</Badge> : null}
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <Text variant="small" className="block">{defaultCount} one-click</Text>
                    <Text variant="small" color="tertiary" className="block">{customCount} custom</Text>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button variant="glass" size="small" onClick={() => onFilterProvider(provider.id)}>
                        Accounts
                      </Button>
                      <Button variant="glass" size="small" onClick={() => onOpenDashboards(provider.id)} disabled={providerAccounts.length === 0}>
                        Dashboards
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PortableExportDialog({
  open,
  onOpenChange,
  accounts,
  groupsById,
  dashboardCount,
  checkCount,
  ruleCount,
  sloCount,
  exporting,
  onExport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: Account[];
  groupsById: Map<string, ProjectGroup>;
  dashboardCount: number;
  checkCount: number;
  ruleCount: number;
  sloCount: number;
  exporting: boolean;
  onExport: (accountIds: string[]) => Promise<void>;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    if (open) setSelectedIds(accounts.map((account) => account.id));
  }, [accounts, open]);

  const selected = new Set(selectedIds);
  const toggle = (accountId: string, checked: boolean) => {
    setSelectedIds((current) => checked ? [...new Set([...current, accountId])] : current.filter((id) => id !== accountId));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Export portable setup"
      description="Choose which accounts to include. Related portable setup is filtered to compatible account, group, and check references."
      confirmLabel="Export setup"
      confirmDisabled={selectedIds.length === 0 || exporting}
      onConfirm={() => onExport(selectedIds)}
      size="medium"
    >
      <div className="flex flex-col gap-4">
        <Callout color="yellow" icon={<AlertCircle />}>
          Provider tokens, notification webhook URLs, runtime history, local incidents, and triage state are excluded.
        </Callout>

        <section className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Text variant="strong">Accounts</Text>
            <Badge color="secondary">{selectedIds.length}/{accounts.length}</Badge>
            <div className="ml-auto flex gap-2">
              <Button variant="glass" size="small" onClick={() => setSelectedIds(accounts.map((account) => account.id))}>
                Select all
              </Button>
              <Button variant="glass" size="small" onClick={() => setSelectedIds([])}>
                None
              </Button>
            </div>
          </div>

          <div className="max-h-64 overflow-auto rounded-md border border-separator">
            {accounts.map((account) => {
              const group = account.groupId ? groupsById.get(account.groupId) : undefined;
              return (
                <div key={account.id} className="grid grid-cols-[auto_1fr] gap-3 p-2 border-t border-separator first:border-t-0 items-center">
                  <Switch
                    checked={selected.has(account.id)}
                    onCheckedChange={(checked) => toggle(account.id, checked)}
                    aria-label={`Include ${account.label}`}
                  />
                  <div className="min-w-0">
                    <Text variant="strong" truncate className="block">{account.label}</Text>
                    <Text variant="small" color="secondary" truncate className="block">
                      {providerLabel(account.provider)}{group ? ` · ${group.name}` : ""}
                    </Text>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {[
            `${dashboardCount} dashboards`,
            `${checkCount} checks`,
            `${ruleCount} rules`,
            `${sloCount} SLOs`,
            "Monitor settings",
            "Notification metadata",
            "Service metadata",
            "Project groups",
            "UI filters",
          ].map((item) => (
            <div key={item} className="rounded-md border border-separator p-2">
              <Text variant="small" color="secondary">{item}</Text>
            </div>
          ))}
        </section>
      </div>
    </Dialog>
  );
}

export function AccountsView() {
  const navigate = useNavigate();
  const accountsQuery = useAccounts();
  const groupsQuery = useGroups();
  const checksQuery = useChecks();
  const rulesQuery = useRules();
  const slosQuery = useSlos();
  const dashboardsQuery = useDashboards();
  const providersQuery = useProviders();
  const diagnosticsQuery = useAccountDiagnostics();
  const { update, remove, exportSetup, importSetup } = useAccountMutations();
  const statusQuery = useQuery({ queryKey: ["monitor", "status"], queryFn: () => monitorApi.getStatus() });
  const [storedFilters, setFilters, resetFilters] = useStoredState<AccountFilters>(FILTER_KEY, DEFAULT_FILTERS);
  const filters: AccountFilters = { ...DEFAULT_FILTERS, ...storedFilters };

  const [dialogOpen, setDialogOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [removing, setRemoving] = useState<Account | null>(null);

  const openAdd = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (account: Account) => {
    setEditing(account);
    setDialogOpen(true);
  };

  useEffect(() => {
    const raw = localStorage.getItem(ACCOUNT_CREATE_KEY);
    if (!raw) return;
    localStorage.removeItem(ACCOUNT_CREATE_KEY);
    openAdd();
  }, []);

  const accounts = accountsQuery.data ?? [];
  const groupsById = new Map((groupsQuery.data ?? []).map((group) => [group.id, group]));
  const groups = groupsQuery.data ?? [];
  const encryptionUnavailable = statusQuery.data?.encryptionAvailable === false;
  const diagnostics = diagnosticsQuery.data ?? [];
  const diagnosticsById = new Map(diagnostics.map((diagnostic) => [diagnostic.accountId, diagnostic]));
  const setFilter = <K extends keyof AccountFilters>(key: K, value: AccountFilters[K]) => setFilters({ ...filters, [key]: value });
  const providerOptions = [
    { value: ALL, label: "All providers" },
    ...[...new Set(accounts.map((account) => account.provider))]
      .sort((a, b) => providerLabel(a).localeCompare(providerLabel(b)))
      .map((provider) => ({ value: provider, label: providerLabel(provider) })),
  ];
  const groupOptions = [
    { value: ALL, label: "All groups" },
    { value: UNGROUPED, label: "Ungrouped" },
    ...groups.map((group) => ({ value: group.id, label: group.name })),
  ];
  const enabledOptions = [
    { value: "all", label: "All accounts" },
    { value: "enabled", label: "Enabled" },
    { value: "disabled", label: "Disabled" },
  ];
  const diagnosticOptions = [
    { value: "all", label: "All diagnostics" },
    { value: "ok", label: "OK" },
    { value: "warning", label: "Warning" },
    { value: "error", label: "Error" },
    { value: "disabled", label: "Disabled" },
    { value: "unknown", label: "Unknown" },
  ];
  const tokenOptions = [
    { value: "all", label: "All token states" },
    { value: "present", label: "Token present" },
    { value: "missing", label: "Token missing" },
  ];
  const dashboardSupportOptions = [
    { value: "all", label: "All dashboard support" },
    { value: "liveSupported", label: "Live provider support" },
    { value: "localOnly", label: "Local panels only" },
    { value: "liveAvailable", label: "Live capabilities loaded" },
    { value: "liveUnavailable", label: "Live support unavailable" },
  ];
  const filteredAccounts = accounts.filter((account) => {
    const diagnostic = diagnosticsById.get(account.id);
    const dashboardSupport = diagnostic?.dashboardCapabilities;
    const groupId = account.groupId && groupsById.has(account.groupId) ? account.groupId : UNGROUPED;
    const search = filters.search.trim().toLowerCase();
    if (search) {
      const haystack = [
        account.label,
        account.identity,
        providerLabel(account.provider),
        account.lastError,
        groupId === UNGROUPED ? "ungrouped" : groupsById.get(groupId)?.name,
        diagnostic?.lastError,
        diagnostic?.staleReason,
        dashboardSupport ? dashboardCapabilityDetail(diagnostic) : undefined,
      ].filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    if (filters.provider !== ALL && account.provider !== filters.provider) return false;
    if (filters.group !== ALL && groupId !== filters.group) return false;
    if (filters.enabled === "enabled" && !account.enabled) return false;
    if (filters.enabled === "disabled" && account.enabled) return false;
    if (filters.diagnostic !== "all" && diagnostic?.status !== filters.diagnostic) return false;
    if (filters.token === "present" && !diagnostic?.hasToken) return false;
    if (filters.token === "missing" && diagnostic?.hasToken) return false;
    if (filters.dashboardSupport === "liveSupported" && !dashboardSupport?.providerSupportsLive) return false;
    if (filters.dashboardSupport === "localOnly" && dashboardSupport?.providerSupportsLive) return false;
    if (filters.dashboardSupport === "liveAvailable" && !dashboardSupport?.available) return false;
    if (filters.dashboardSupport === "liveUnavailable" && (!dashboardSupport?.providerSupportsLive || dashboardSupport.available)) return false;
    return true;
  });
  const filteredAccountIds = new Set(filteredAccounts.map((account) => account.id));
  const filteredDiagnostics = diagnostics.filter((diagnostic) => filteredAccountIds.has(diagnostic.accountId));
  const activeFilters: AppliedFilter[] = [
    filters.search.trim()
      ? { id: "search", label: "Search", value: filters.search.trim(), onClear: () => setFilter("search", DEFAULT_FILTERS.search) }
      : null,
    filters.provider !== DEFAULT_FILTERS.provider
      ? { id: "provider", label: "Provider", value: optionLabel(providerOptions, filters.provider), onClear: () => setFilter("provider", DEFAULT_FILTERS.provider) }
      : null,
    filters.group !== DEFAULT_FILTERS.group
      ? { id: "group", label: "Group", value: optionLabel(groupOptions, filters.group), onClear: () => setFilter("group", DEFAULT_FILTERS.group) }
      : null,
    filters.enabled !== DEFAULT_FILTERS.enabled
      ? { id: "enabled", label: "State", value: optionLabel(enabledOptions, filters.enabled), onClear: () => setFilter("enabled", DEFAULT_FILTERS.enabled) }
      : null,
    filters.diagnostic !== DEFAULT_FILTERS.diagnostic
      ? { id: "diagnostic", label: "Diagnostic", value: optionLabel(diagnosticOptions, filters.diagnostic), onClear: () => setFilter("diagnostic", DEFAULT_FILTERS.diagnostic) }
      : null,
    filters.token !== DEFAULT_FILTERS.token
      ? { id: "token", label: "Token", value: optionLabel(tokenOptions, filters.token), onClear: () => setFilter("token", DEFAULT_FILTERS.token) }
      : null,
    filters.dashboardSupport !== DEFAULT_FILTERS.dashboardSupport
      ? {
        id: "dashboardSupport",
        label: "Dashboards",
        value: optionLabel(dashboardSupportOptions, filters.dashboardSupport),
        onClear: () => setFilter("dashboardSupport", DEFAULT_FILTERS.dashboardSupport),
      }
      : null,
  ].filter((filter): filter is AppliedFilter => filter !== null);

  useEffect(() => {
    if (!accountsQuery.data) return;
    const raw = localStorage.getItem(ACCOUNT_SELECT_KEY);
    if (!raw) return;
    localStorage.removeItem(ACCOUNT_SELECT_KEY);
    try {
      const parsed = JSON.parse(raw) as { accountId?: unknown; filters?: unknown };
      if (typeof parsed.filters === "object" && parsed.filters !== null) {
        const filterPayload = parsed.filters as Partial<Record<keyof AccountFilters, unknown>>;
        setFilters({
          ...DEFAULT_FILTERS,
          provider: typeof filterPayload.provider === "string" ? filterPayload.provider : DEFAULT_FILTERS.provider,
          group: typeof filterPayload.group === "string" ? filterPayload.group : DEFAULT_FILTERS.group,
          enabled: filterPayload.enabled === "enabled" || filterPayload.enabled === "disabled" ? filterPayload.enabled : DEFAULT_FILTERS.enabled,
          dashboardSupport: filterPayload.dashboardSupport === "liveSupported" || filterPayload.dashboardSupport === "localOnly" ||
            filterPayload.dashboardSupport === "liveAvailable" || filterPayload.dashboardSupport === "liveUnavailable"
            ? filterPayload.dashboardSupport
            : DEFAULT_FILTERS.dashboardSupport,
        });
      }
      const accountId = typeof parsed.accountId === "string" ? parsed.accountId : "";
      const account = accountsQuery.data.find((candidate) => candidate.id === accountId);
      if (!account) return;
      setEditing(account);
      setDialogOpen(true);
    } catch {
      // Ignore stale command-palette selection payloads.
    }
  }, [accountsQuery.data]);

  const handleExportSetup = async (accountIds: string[]) => {
    await exportSetup.mutateAsync({ accountIds, filters: collectSetupFilters() })
      .then((result) => {
        if (result.ok) {
          toast.success("Portable setup exported");
          setExportDialogOpen(false);
        }
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : String(error)));
  };
  const handleImportSetup = () => {
    void importSetup.mutateAsync()
      .then((result) => {
        if (!result.filePath) return;
        restoreSetupFilters(result.uiFilters);
        const imported = result.accountsImported + result.groupsImported + result.dashboardsImported + result.checksImported +
          result.rulesImported + result.slosImported + result.channelsImported + result.serviceMetadataImported + result.filtersImported;
        const skipped = result.accountsSkipped + result.dashboardsSkipped + result.checksSkipped + result.rulesSkipped +
          result.slosSkipped + result.channelsSkipped + result.serviceMetadataSkipped;
        toast.success(`Imported ${imported} setup items, skipped ${skipped}. Add tokens before enabling imported accounts.`);
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : String(error)));
  };
  const exportAccounts = () => {
    downloadAccountsCsv(filteredAccounts, diagnosticsById, groupsById);
    toast.success(`Exported ${filteredAccounts.length} ${filteredAccounts.length === 1 ? "account" : "accounts"}`);
  };

  const openDashboardsForDiagnostic = (diagnostic: AccountDiagnostic) => {
    localStorage.setItem(CUSTOM_DASHBOARD_FILTER_KEY, JSON.stringify({
      group: diagnostic.groupId ?? ALL,
      provider: diagnostic.provider,
      account: diagnostic.accountId,
      check: ALL,
      owner: ALL,
      tier: "all",
      dependency: ALL,
    }));
    void navigate({ to: "/dashboards" });
  };
  const openDashboardsForProvider = (provider: Provider) => {
    localStorage.setItem(CUSTOM_DASHBOARD_FILTER_KEY, JSON.stringify({
      group: ALL,
      provider,
      account: ALL,
      check: ALL,
      owner: ALL,
      tier: "all",
      dependency: ALL,
    }));
    void navigate({ to: "/dashboards" });
  };
  const openEditForDiagnostic = (diagnostic: AccountDiagnostic) => {
    const account = accounts.find((candidate) => candidate.id === diagnostic.accountId);
    if (!account) {
      toast.error("Account no longer exists");
      return;
    }
    openEdit(account);
  };

  return (
    <ScrollArea
      title="Accounts"
      actions={
        <div className="flex min-w-0 items-center gap-2 flex-wrap justify-end">
          <Button variant="glass" size="small" onClick={exportAccounts} disabled={filteredAccounts.length === 0}>
            <Download className="size-4" />
            Export CSV
          </Button>
          <FilterMenu
            filters={activeFilters}
            onReset={resetFilters}
            presetKey={FILTER_PRESET_KEY}
            presetValue={filters}
            onApplyPreset={(value) => setFilters({ ...DEFAULT_FILTERS, ...value })}
          >
            <FilterSearchField label="Search" value={filters.search} onChange={(value) => setFilter("search", value)} placeholder="Label, identity, error…" />
            <FilterSelectField label="Provider" value={filters.provider} onChange={(value) => setFilter("provider", value)} options={providerOptions} />
            <FilterSelectField label="Group" value={filters.group} onChange={(value) => setFilter("group", value)} options={groupOptions} />
            <FilterSelectField label="State" value={filters.enabled} onChange={(value) => setFilter("enabled", value as AccountFilters["enabled"])} options={enabledOptions} />
            <FilterSelectField label="Diagnostic" value={filters.diagnostic} onChange={(value) => setFilter("diagnostic", value as AccountFilters["diagnostic"])} options={diagnosticOptions} />
            <FilterSelectField label="Token" value={filters.token} onChange={(value) => setFilter("token", value as AccountFilters["token"])} options={tokenOptions} />
            <FilterSelectField label="Dashboard support" value={filters.dashboardSupport} onChange={(value) => setFilter("dashboardSupport", value as AccountFilters["dashboardSupport"])} options={dashboardSupportOptions} />
          </FilterMenu>
          <Button variant="glass" size="large" onClick={openAdd}>
            <Plus className="size-4.5" />
            Add account
          </Button>
        </div>
      }
      className="h-full"
    >
      <div className="px-2 pb-8 flex flex-col gap-3">
        {encryptionUnavailable ? (
          <Callout color="red" icon={<AlertCircle />}>
            Secure token storage is unavailable on this system, so accounts can't be saved safely.
          </Callout>
        ) : null}

        <SetupChecklist
          accountCount={accounts.length}
          groupCount={groups.length}
          checkCount={(checksQuery.data ?? []).length}
          ruleCount={(rulesQuery.data ?? []).length}
          dashboardCount={(dashboardsQuery.data ?? []).length}
          onAddAccount={openAdd}
          onReviewGroups={() => setFilter("group", UNGROUPED)}
          onOpenUptime={() => void navigate({ to: "/uptime" })}
          onOpenAlerts={() => void navigate({ to: "/alerts" })}
          onOpenDashboards={() => void navigate({ to: "/dashboards" })}
        />

        <SetupBackupPanel
          onExport={() => setExportDialogOpen(true)}
          onImport={handleImportSetup}
          exporting={exportSetup.isPending}
          importing={importSetup.isPending}
        />

        <ProviderCapabilityMatrix
          providers={providersQuery.data ?? []}
          accounts={accounts}
          diagnostics={diagnostics}
          onFilterProvider={(provider) => setFilter("provider", provider)}
          onOpenDashboards={openDashboardsForProvider}
        />

        {accounts.length === 0 ? (
          <EmptyState
            title="No accounts yet"
            description="Connect CI/CD, incident, status, and observability providers to monitor their activity."
            actions={<Button variant="accent" onClick={openAdd}>Add account</Button>}
          />
        ) : filteredAccounts.length === 0 ? (
          <EmptyState title="No accounts match filters" description="Adjust or reset filters to show more accounts.">
            <Button variant="glass" size="small" onClick={resetFilters}>
              Reset filters
            </Button>
          </EmptyState>
        ) : (
          <List.Root items={filteredAccounts} getItemKey={(a) => a.id}>
            {filteredAccounts.map((account) => (
              <List.Item key={account.id} item={account}>
                <List.ItemIcon>
                  {(() => {
                    const Icon = providerIcon(account.provider);
                    return <Icon className="size-5" />;
                  })()}
                </List.ItemIcon>
                <List.ItemContent>
                  <List.ItemTitle>{account.label}</List.ItemTitle>
                  <List.ItemDescription>{accountDescription(account, groupsById)}</List.ItemDescription>
                </List.ItemContent>
                <List.ItemAccessory>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={account.enabled}
                      onCheckedChange={(checked) => update.mutate({ id: account.id, enabled: checked })}
                      aria-label="Enable monitoring"
                    />
                    <Button variant="transparent" size="small" iconOnly aria-label="Edit" onClick={() => openEdit(account)}>
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="transparent"
                      size="small"
                      iconOnly
                      aria-label="Remove"
                      onClick={() => setRemoving(account)}
                    >
                      <Trash2 className="size-4 text-support-red" />
                    </Button>
                  </div>
                </List.ItemAccessory>
              </List.Item>
            ))}
          </List.Root>
        )}

        {accounts.length > 0 ? (
          <Text variant="small" color="tertiary" className="px-2">
            Disabled accounts are skipped during polling but keep their stored token.
          </Text>
        ) : null}

        <DiagnosticsPanel
          diagnostics={filteredDiagnostics}
          onEditAccount={openEditForDiagnostic}
          onOpenDashboards={openDashboardsForDiagnostic}
        />
        <VerificationPanel />
      </div>

      <AddAccountDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} />

      <PortableExportDialog
        open={exportDialogOpen}
        onOpenChange={setExportDialogOpen}
        accounts={accounts}
        groupsById={groupsById}
        dashboardCount={(dashboardsQuery.data ?? []).length}
        checkCount={(checksQuery.data ?? []).length}
        ruleCount={(rulesQuery.data ?? []).length}
        sloCount={(slosQuery.data ?? []).length}
        exporting={exportSetup.isPending}
        onExport={handleExportSetup}
      />

      <AlertDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={removing ? `Remove "${removing.label}"?` : ""}
        description="This deletes the stored API token and stops monitoring this account. You can add it again later."
        confirmLabel="Remove"
        confirmVariant="destructive"
        onConfirm={async () => {
          if (!removing) return;
          await remove.mutateAsync(removing.id);
          toast.success("Account removed");
          setRemoving(null);
        }}
      />
    </ScrollArea>
  );
}
