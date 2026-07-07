import { useEffect, useMemo, useState } from "react";
import { AlertCircle, BookOpen, CheckCircle2, Clock3, Copy, Download, Edit3, ExternalLink, GitBranch, LayoutDashboard, Plus, RotateCcw, Trash2, VolumeX } from "lucide-react";
import {
  Badge,
  Button,
  Callout,
  Dialog,
  EmptyState,
  Field,
  FieldSet,
  Input,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Text,
  toast,
} from "@glaze/core/components";

import { formatRelativeTime } from "./components/relative-time";
import { StatusBadge } from "./components/status-badge";
import { providerIcon, providerLabel } from "./components/provider-meta";
import {
  ALL,
  type AppliedFilter,
  FilterDateRangeField,
  FilterMenu,
  FilterSelectField,
  SEVERITY_FILTER_OPTIONS,
  dateRangeLabel,
  defaultDateRange,
  matchesDateRange,
  optionLabel,
  retainedHistoryDateBounds,
  sameDateRange,
  useStoredState,
} from "./components/filters";
import { useAccounts, useGroups } from "./hooks/use-accounts";
import { useHistoryEvents, useHistoryStats } from "./hooks/use-history";
import { useLocalIncidentMutations, useLocalIncidents } from "./hooks/use-local-incidents";
import { useMonitorData } from "./hooks/use-monitor-data";
import { useProviders } from "./hooks/use-providers";
import { useServiceMetadata } from "./hooks/use-service-metadata";
import { useTriage, useTriageMutations } from "./hooks/use-triage";
import { monitorApi } from "./ipc";
import { downloadCsv } from "./utils/csv";
import type {
  Account,
  HistoryEvent,
  LocalIncident,
  LocalIncidentInput,
  LocalIncidentStatus,
  MonitorItem,
  ObservabilityIncident,
  ObservabilitySeverity,
  ObservabilitySignal,
  NormalizedStatus,
  ProjectGroup,
  Provider,
  ServiceHealth,
  ServiceMetadata,
  ServiceTier,
  TriageState,
} from "./types";

type SeverityFilter = "all" | ObservabilitySeverity;
type StatusFilter = "all" | "open" | "acknowledged" | "silenced";
type KindFilter = "all" | "signal" | "incident";
type IncidentSelection = { kind: "local"; id: string } | { kind: "source"; uid: string } | null;
const FILTER_KEY = "incidents.filters.v1";
const FILTER_PRESET_KEY = `${FILTER_KEY}.presets`;
const INCIDENTS_DRILLDOWN_KEY = "incidents.drilldown.v1";
const INCIDENT_SELECT_KEY = "incidents.select.v1";
const INCIDENT_CREATE_KEY = "incidents.create.v1";
const INCIDENT_SELECTION_PADDING_MS = 60 * 60 * 1000;

interface IncidentsFilters {
  dateRange: ReturnType<typeof defaultDateRange>;
  severity: SeverityFilter;
  status: StatusFilter;
  group: string;
  provider: "all" | Provider;
  account: string;
  kind: KindFilter;
  owner: string;
  tier: "all" | ServiceTier;
  dependency: string;
}

const DEFAULT_FILTERS: IncidentsFilters = {
  dateRange: defaultDateRange("24h"),
  severity: "all",
  status: "all",
  group: ALL,
  provider: "all",
  account: ALL,
  kind: "all",
  owner: ALL,
  tier: "all",
  dependency: ALL,
};

function selectionDateRange(ts: string): IncidentsFilters["dateRange"] {
  const parsed = new Date(ts).getTime();
  if (!Number.isFinite(parsed)) return DEFAULT_FILTERS.dateRange;
  return {
    mode: "custom",
    from: new Date(parsed - INCIDENT_SELECTION_PADDING_MS).toISOString(),
    to: new Date(parsed + INCIDENT_SELECTION_PADDING_MS).toISOString(),
  };
}

function incidentDrilldownFilters(value: unknown): Partial<IncidentsFilters> | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<IncidentsFilters>;
  return {
    dateRange: candidate.dateRange,
    severity: typeof candidate.severity === "string" ? candidate.severity as SeverityFilter : undefined,
    status: typeof candidate.status === "string" ? candidate.status as StatusFilter : undefined,
    group: typeof candidate.group === "string" ? candidate.group : undefined,
    provider: typeof candidate.provider === "string" ? candidate.provider as IncidentsFilters["provider"] : undefined,
    account: typeof candidate.account === "string" ? candidate.account : undefined,
    kind: typeof candidate.kind === "string" ? candidate.kind as KindFilter : undefined,
    owner: typeof candidate.owner === "string" ? candidate.owner : undefined,
    tier: typeof candidate.tier === "string" ? candidate.tier as IncidentsFilters["tier"] : undefined,
    dependency: typeof candidate.dependency === "string" ? candidate.dependency : undefined,
  };
}

function historyEventPayload(value: unknown): HistoryEvent | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<HistoryEvent>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.ts !== "string" ||
    typeof candidate.type !== "string" ||
    typeof candidate.provider !== "string" ||
    typeof candidate.accountId !== "string" ||
    typeof candidate.title !== "string" ||
    typeof candidate.status !== "string" ||
    typeof candidate.severity !== "string" ||
    typeof candidate.url !== "string"
  ) {
    return null;
  }
  return candidate as HistoryEvent;
}

function monitorItemPayload(value: unknown): MonitorItem | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<MonitorItem>;
  if (
    typeof candidate.uid !== "string" ||
    typeof candidate.accountId !== "string" ||
    typeof candidate.provider !== "string" ||
    typeof candidate.title !== "string" ||
    typeof candidate.subtitle !== "string" ||
    typeof candidate.status !== "string" ||
    typeof candidate.updatedAt !== "string" ||
    typeof candidate.url !== "string"
  ) {
    return null;
  }
  return candidate as MonitorItem;
}

function triageItemPayload(value: unknown): TriageItem | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<TriageItem>;
  if (
    typeof candidate.uid !== "string" ||
    typeof candidate.accountId !== "string" ||
    typeof candidate.provider !== "string" ||
    typeof candidate.title !== "string" ||
    typeof candidate.subtitle !== "string" ||
    typeof candidate.status !== "string" ||
    typeof candidate.severity !== "string" ||
    typeof candidate.updatedAt !== "string" ||
    typeof candidate.url !== "string" ||
    (candidate.kind !== "signal" && candidate.kind !== "incident")
  ) {
    return null;
  }
  return candidate as TriageItem;
}

function uptimeIncidentPayload(value: unknown): UptimeIncidentSource | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<UptimeIncidentSource>;
  if (
    typeof candidate.checkId !== "string" ||
    typeof candidate.name !== "string" ||
    typeof candidate.url !== "string" ||
    (candidate.status !== "up" && candidate.status !== "down" && candidate.status !== "pending")
  ) {
    return null;
  }
  return candidate as UptimeIncidentSource;
}

function severityForMonitorStatus(status: NormalizedStatus): ObservabilitySeverity {
  if (status === "failure") return "critical";
  if (status === "warning") return "high";
  if (status === "running" || status === "queued") return "medium";
  if (status === "success" || status === "info") return "info";
  return "low";
}

const SERVICE_TIERS: Record<string, string> = {
  critical: "Critical",
  standard: "Standard",
  internal: "Internal",
  experimental: "Experimental",
};

interface TriageItem {
  uid: string;
  sourceUid?: string;
  accountId: string;
  provider: Provider;
  title: string;
  subtitle: string;
  status: string;
  severity: ObservabilitySeverity;
  updatedAt: string;
  url: string;
  kind: "signal" | "incident";
}

interface UptimeIncidentSource {
  checkId: string;
  name: string;
  url: string;
  status: "up" | "down" | "pending";
  checkedAt?: string;
  statusCode?: number;
  latencyMs?: number;
  error?: string;
}

function accountMap(accounts: Account[]): Map<string, Account> {
  return new Map(accounts.map((account) => [account.id, account]));
}

function groupMap(groups: ProjectGroup[]): Map<string, ProjectGroup> {
  return new Map(groups.map((group) => [group.id, group]));
}

function toItems(signals: ObservabilitySignal[], incidents: ObservabilityIncident[]): TriageItem[] {
  return [
    ...incidents.map((incident): TriageItem => ({
      uid: incident.uid,
      sourceUid: incident.sourceItemUid,
      accountId: incident.accountId,
      provider: incident.provider,
      title: incident.title,
      subtitle: incident.subtitle,
      status: incident.status,
      severity: incident.severity,
      updatedAt: incident.updatedAt,
      url: incident.url,
      kind: "incident",
    })),
    ...signals.map((signal): TriageItem => ({
      uid: signal.uid,
      sourceUid: signal.sourceItemUid,
      accountId: signal.accountId,
      provider: signal.provider,
      title: signal.title,
      subtitle: signal.subtitle,
      status: signal.status,
      severity: signal.severity,
      updatedAt: signal.updatedAt,
      url: signal.url,
      kind: "signal",
    })),
  ].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

function isSilenced(state: TriageState | undefined): boolean {
  return state?.silencedUntil ? new Date(state.silencedUntil).getTime() > Date.now() : false;
}

function isNormalizedStatus(status: string): status is NormalizedStatus {
  return ["success", "failure", "warning", "running", "queued", "cancelled", "info", "unknown"].includes(status);
}

function matchesStatus(item: TriageItem, state: TriageState | undefined, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "acknowledged") return Boolean(state?.acknowledgedAt);
  if (filter === "silenced") return isSilenced(state);
  return item.status === "open" || item.status === "failure" || item.status === "warning";
}

function eventIcon(event: HistoryEvent): string {
  switch (event.type) {
    case "deploy":
      return "Deploy";
    case "failure":
      return "Failure";
    case "recovery":
      return "Recovery";
    case "alert":
      return "Alert";
    case "incident":
      return "Incident";
    case "check":
      return "Check";
  }
}

function openUrl(url: string): void {
  void monitorApi.openExternal(url).catch((error) => toast.error(error instanceof Error ? error.message : String(error)));
}

function serviceForAccount(services: ServiceHealth[], accountId: string | undefined): ServiceHealth | undefined {
  if (!accountId) return undefined;
  return services.find((service) => service.accountIds.includes(accountId));
}

function metadataCells(metadata: ServiceMetadata | undefined): [string, string, string] {
  return [
    metadata?.owner ?? "",
    metadata?.tier ?? "",
    (metadata?.dependencies ?? []).join("; "),
  ];
}

function downloadIncidentsCsv({
  localIncidents,
  liveItems,
  triage,
  accountsById,
  groupsById,
  services,
  metadataByService,
}: {
  localIncidents: LocalIncident[];
  liveItems: TriageItem[];
  triage: Record<string, TriageState>;
  accountsById: Map<string, Account>;
  groupsById: Map<string, ProjectGroup>;
  services: ServiceHealth[];
  metadataByService: Map<string, ServiceMetadata>;
}): void {
  const columns = [
    "rowType",
    "id",
    "sourceUid",
    "kind",
    "title",
    "status",
    "severity",
    "provider",
    "account",
    "accountId",
    "group",
    "groupId",
    "updatedAt",
    "createdAt",
    "acknowledgedAt",
    "silencedUntil",
    "resolvedAt",
    "assignee",
    "rootCause",
    "resolvedReason",
    "relatedEventCount",
    "noteCount",
    "url",
    "owner",
    "tier",
    "dependencies",
    "detail",
  ];
  const rows: unknown[][] = [];
  for (const incident of localIncidents) {
    const account = incident.accountId ? accountsById.get(incident.accountId) : undefined;
    const service = serviceForAccount(services, incident.accountId);
    const metadata = service ? metadataByService.get(service.id) : incident.accountId ? metadataByService.get(account?.groupId ?? `account:${incident.accountId}`) : undefined;
    rows.push([
      "local_incident",
      incident.id,
      incident.sourceUid ?? "",
      incident.sourceKind,
      incident.title,
      incident.status,
      incident.severity,
      incident.provider ? providerLabel(incident.provider) : "",
      account?.label ?? "",
      incident.accountId ?? "",
      account?.groupId ? groupsById.get(account.groupId)?.name ?? "" : "",
      account?.groupId ?? "",
      incident.updatedAt,
      incident.createdAt,
      incident.acknowledgedAt ?? "",
      "",
      incident.resolvedAt ?? "",
      incident.assignee ?? "",
      incident.rootCause ?? "",
      incident.resolvedReason ?? "",
      incident.relatedEventIds.length,
      incident.notes.length,
      incident.sourceUrl ?? "",
      ...metadataCells(metadata),
      incident.description ?? "",
    ]);
  }
  for (const item of liveItems) {
    const account = accountsById.get(item.accountId);
    const state = triage[item.uid];
    const service = serviceForAccount(services, item.accountId);
    const metadata = service ? metadataByService.get(service.id) : metadataByService.get(account?.groupId ?? `account:${item.accountId}`);
    rows.push([
      "live_source",
      item.uid,
      item.sourceUid ?? "",
      item.kind,
      item.title,
      item.status,
      item.severity,
      providerLabel(item.provider),
      account?.label ?? "",
      item.accountId,
      account?.groupId ? groupsById.get(account.groupId)?.name ?? "" : "",
      account?.groupId ?? "",
      item.updatedAt,
      "",
      state?.acknowledgedAt ?? "",
      state?.silencedUntil ?? "",
      "",
      "",
      "",
      "",
      "",
      "",
      item.url,
      ...metadataCells(metadata),
      item.subtitle,
    ]);
  }
  downloadCsv(`incidents-${new Date().toISOString().slice(0, 10)}.csv`, columns, rows);
}

interface CorrelationSubject {
  accountId?: string;
  provider?: Provider;
  sourceUid?: string;
  relatedEventIds?: string[];
  timestamp: string;
}

interface CorrelationHint {
  event: HistoryEvent;
  score: number;
  reason: string;
}

interface EvidenceLink {
  label: string;
  url: string;
  icon: typeof ExternalLink;
}

function correlationHints(subject: CorrelationSubject, events: HistoryEvent[]): CorrelationHint[] {
  const subjectTime = new Date(subject.timestamp).getTime();
  if (!Number.isFinite(subjectTime)) return [];
  const relatedIds = new Set(subject.relatedEventIds ?? []);
  return events
    .map((event): CorrelationHint | null => {
      const eventTime = new Date(event.ts).getTime();
      if (!Number.isFinite(eventTime)) return null;
      const minutesBefore = (subjectTime - eventTime) / 60_000;
      const nearWindow = minutesBefore >= -15 && minutesBefore <= 120;
      const sameSource = Boolean(subject.sourceUid && event.sourceUid === subject.sourceUid);
      const related = relatedIds.has(event.id);
      const sameAccount = Boolean(subject.accountId && event.accountId === subject.accountId);
      const sameProvider = Boolean(subject.provider && event.provider === subject.provider);
      if (!nearWindow && !sameSource && !related) return null;

      let score = 0;
      const reasons: string[] = [];
      if (related) {
        score += 90;
        reasons.push("linked incident event");
      }
      if (sameSource) {
        score += 80;
        reasons.push("same source");
      }
      if (sameAccount) {
        score += 35;
        reasons.push("same account");
      }
      if (sameProvider) {
        score += 20;
        reasons.push("same provider");
      }
      if (event.type === "deploy" && minutesBefore >= 0) {
        score += 35;
        reasons.push("deploy before incident");
      } else if ((event.type === "failure" || event.type === "alert" || event.type === "incident") && nearWindow) {
        score += 25;
        reasons.push("nearby active signal");
      } else if (event.type === "recovery" && minutesBefore <= 0) {
        score += 10;
        reasons.push("recovery after incident");
      }
      score += Math.max(0, 20 - Math.abs(minutesBefore) / 6);
      return { event, score, reason: reasons.join(" · ") || "near selected item" };
    })
    .filter((hint): hint is CorrelationHint => Boolean(hint))
    .sort((a, b) => b.score - a.score || new Date(b.event.ts).getTime() - new Date(a.event.ts).getTime())
    .slice(0, 6);
}

function InvestigationHints({ hints }: { hints: CorrelationHint[] }) {
  return (
    <div className="flex flex-col gap-1">
      <Text variant="strong">Investigation hints</Text>
      {hints.length === 0 ? (
        <Callout color="secondary">No nearby history events look strongly related in the selected range.</Callout>
      ) : (
        <div className="flex flex-col">
          {hints.map(({ event, reason }) => (
            <div key={event.id} className="grid grid-cols-[6rem_5rem_minmax(0,1fr)_auto] items-center gap-3 border-t border-separator py-2 first:border-t-0">
              <Text variant="small" color="tertiary" className="tabular-nums">{formatRelativeTime(event.ts)}</Text>
              <Badge color={event.type === "failure" || event.type === "incident" ? "red" : event.type === "deploy" ? "yellow" : "secondary"}>{eventIcon(event)}</Badge>
              <div className="min-w-0">
                <Text variant="small" truncate className="block">{event.title}</Text>
                <Text variant="small" color="tertiary" truncate className="block">{reason}</Text>
              </div>
              {event.url ? (
                <Button variant="transparent" size="small" iconOnly aria-label="Open history event" onClick={() => openUrl(event.url)}>
                  <ExternalLink className="size-4" />
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ServiceIncidentContext({
  service,
  metadata,
}: {
  service: ServiceHealth | undefined;
  metadata: ServiceMetadata | undefined;
}) {
  if (!service && !metadata) return null;
  const links = [
    metadata?.runbookUrl ? { label: "Runbook", url: metadata.runbookUrl, icon: BookOpen } : null,
    metadata?.dashboardUrl ? { label: "Dashboard", url: metadata.dashboardUrl, icon: LayoutDashboard } : null,
    metadata?.repositoryUrl ? { label: "Repository", url: metadata.repositoryUrl, icon: GitBranch } : null,
  ].filter((link): link is { label: string; url: string; icon: typeof BookOpen } => link !== null);

  return (
    <section className="rounded-md border border-separator p-3 flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Text variant="strong" truncate className="block">{service?.name ?? metadata?.serviceId ?? "Service context"}</Text>
          <Text variant="small" color="secondary" truncate className="block">
            {metadata?.owner ? `Owner: ${metadata.owner}` : "No owner assigned"}
            {metadata?.tier ? ` · ${SERVICE_TIERS[metadata.tier] ?? metadata.tier}` : ""}
          </Text>
        </div>
        {service ? <StatusBadge status={service.status} /> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {metadata?.owner ? <Badge color="secondary">{metadata.owner}</Badge> : null}
        {metadata?.tier ? <Badge color={metadata.tier === "critical" ? "red" : "secondary"}>{SERVICE_TIERS[metadata.tier] ?? metadata.tier}</Badge> : null}
        {service ? <Badge color="secondary">{service.accountIds.length} accounts</Badge> : null}
        {metadata?.dependencies?.map((dependency) => (
          <Badge key={dependency} color="secondary">{dependency}</Badge>
        ))}
      </div>
      {metadata?.notes ? <Text variant="small" color="secondary" className="whitespace-pre-wrap">{metadata.notes}</Text> : null}
      {links.length > 0 ? (
        <div className="flex min-w-0 flex-wrap gap-2">
          {links.map((link) => {
            const Icon = link.icon;
            return (
              <Button key={link.label} variant="glass" size="small" onClick={() => openUrl(link.url)}>
                <Icon className="size-4" />
                {link.label}
              </Button>
            );
          })}
        </div>
      ) : metadata ? null : (
        <Callout color="secondary">No local service metadata has been added for this service.</Callout>
      )}
    </section>
  );
}

function localIncidentNoteInput(incident: LocalIncident, note: string): LocalIncidentInput {
  return {
    id: incident.id,
    sourceKind: incident.sourceKind,
    sourceUid: incident.sourceUid,
    sourceUrl: incident.sourceUrl,
    accountId: incident.accountId,
    provider: incident.provider,
    title: incident.title,
    description: incident.description,
    status: incident.status,
    severity: incident.severity,
    assignee: incident.assignee,
    rootCause: incident.rootCause,
    resolvedReason: incident.resolvedReason,
    relatedEventIds: incident.relatedEventIds,
    note,
  };
}

function uniqueEvents(events: HistoryEvent[]): HistoryEvent[] {
  const byId = new Map<string, HistoryEvent>();
  for (const event of events) byId.set(event.id, event);
  return [...byId.values()].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
}

function markdownLink(label: string, url: string | undefined): string {
  return url ? `[${label}](${url})` : label;
}

function markdownField(label: string, value: string | undefined): string {
  return value && value.trim() !== "" ? `- **${label}:** ${value}` : "";
}

function incidentDuration(incident: LocalIncident): string {
  const start = new Date(incident.createdAt).getTime();
  const end = incident.resolvedAt ? new Date(incident.resolvedAt).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "Unknown";
  const minutes = Math.round((end - start) / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
}

function eventPostmortemLine(event: HistoryEvent): string {
  return `- ${event.ts} - ${event.type} - ${markdownLink(event.title, event.url)} (${event.status}, ${event.severity})`;
}

function buildPostmortemDraft({
  incident,
  evidence,
  account,
  service,
  metadata,
}: {
  incident: LocalIncident;
  evidence: HistoryEvent[];
  account: Account | undefined;
  service: ServiceHealth | undefined;
  metadata: ServiceMetadata | undefined;
}): string {
  const sortedEvidence = [...evidence].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  const notes = [...incident.notes].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const timeline = [
    `- ${incident.createdAt} - Incident created (${incident.severity}, ${incident.status})`,
    incident.acknowledgedAt ? `- ${incident.acknowledgedAt} - Incident acknowledged` : "",
    ...sortedEvidence.map(eventPostmortemLine),
    ...notes.map((note) => `- ${note.createdAt} - Note: ${note.body}`),
    incident.resolvedAt ? `- ${incident.resolvedAt} - Incident resolved${incident.resolvedReason ? `: ${incident.resolvedReason}` : ""}` : "",
  ].filter(Boolean);
  const actionItems = [
    !incident.rootCause ? "- [ ] Confirm and record root cause." : "",
    incident.status !== "resolved" ? "- [ ] Resolve or assign an explicit owner for continued monitoring." : "",
    incident.status === "resolved" && !incident.resolvedReason ? "- [ ] Record resolution details." : "",
    !metadata?.runbookUrl ? "- [ ] Add or link a service runbook." : "",
    !metadata?.owner ? "- [ ] Assign a service owner." : "",
    notes.length === 0 ? "- [ ] Add investigation notes or handoff context." : "",
    sortedEvidence.length === 0 ? "- [ ] Verify provider-side evidence because no retained local history was linked." : "",
  ].filter(Boolean);
  const serviceFields = [
    markdownField("Service", service?.name),
    markdownField("Owner", metadata?.owner),
    markdownField("Tier", metadata?.tier),
    markdownField("Account", account?.label),
    markdownField("Provider", incident.provider ? providerLabel(incident.provider) : undefined),
    markdownField("Runbook", metadata?.runbookUrl),
    markdownField("Dashboard", metadata?.dashboardUrl),
    markdownField("Repository", metadata?.repositoryUrl),
    metadata?.dependencies?.length ? `- **Dependencies:** ${metadata.dependencies.join(", ")}` : "",
  ].filter(Boolean);
  return [
    `# Postmortem: ${incident.title}`,
    "",
    "## Summary",
    "",
    incident.description || "TODO: Summarize what happened, who was affected, and how it was detected.",
    "",
    "## Incident Metadata",
    "",
    [
      markdownField("Status", incident.status),
      markdownField("Severity", incident.severity),
      markdownField("Duration", incidentDuration(incident)),
      markdownField("Created", incident.createdAt),
      markdownField("Acknowledged", incident.acknowledgedAt),
      markdownField("Resolved", incident.resolvedAt),
      markdownField("Assignee", incident.assignee),
      markdownField("Source", incident.sourceUrl),
    ].filter(Boolean).join("\n"),
    "",
    "## Impact",
    "",
    "TODO: Describe user/customer impact, affected services, and known scope.",
    "",
    "## Timeline",
    "",
    timeline.length > 0 ? timeline.join("\n") : "No timeline entries available.",
    "",
    "## Root Cause",
    "",
    incident.rootCause || "TODO: Confirm root cause from retained evidence and provider-side details.",
    "",
    "## Resolution",
    "",
    incident.resolvedReason || "TODO: Describe the mitigation or fix.",
    "",
    "## Evidence",
    "",
    sortedEvidence.length > 0 ? sortedEvidence.map(eventPostmortemLine).join("\n") : "No retained local history evidence is linked yet.",
    "",
    "## Service Context",
    "",
    serviceFields.length > 0 ? serviceFields.join("\n") : "No service metadata is linked.",
    "",
    "## Follow-up Actions",
    "",
    actionItems.length > 0 ? actionItems.join("\n") : "No obvious follow-up gaps were found from local incident metadata.",
  ].join("\n");
}

interface LocalIncidentLifecycleRow {
  ts: string;
  label: string;
  detail: string;
  color: "green" | "yellow" | "red" | "secondary";
}

function localIncidentLifecycle(incident: LocalIncident): LocalIncidentLifecycleRow[] {
  return [
    {
      ts: incident.createdAt,
      label: "Created",
      detail: `${incident.severity} incident opened${incident.assignee ? ` for ${incident.assignee}` : ""}.`,
      color: incident.severity === "critical" || incident.severity === "high" ? "red" : "yellow",
    },
    incident.acknowledgedAt
      ? {
        ts: incident.acknowledgedAt,
        label: "Acknowledged",
        detail: "Incident was acknowledged.",
        color: "yellow",
      }
      : null,
    ...incident.notes.map((note): LocalIncidentLifecycleRow => ({
      ts: note.createdAt,
      label: "Note",
      detail: note.body,
      color: "secondary",
    })),
    incident.resolvedAt
      ? {
        ts: incident.resolvedAt,
        label: "Resolved",
        detail: incident.resolvedReason ?? "Incident was marked resolved.",
        color: "green",
      }
      : null,
  ]
    .filter((row): row is LocalIncidentLifecycleRow => row !== null)
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
}

function InvestigationWorkspace({
  item,
  localIncident,
  account,
  service,
  metadata,
  scopedEvents,
  hints,
  note,
  onNoteChange,
  onSaveNote,
  savingNote,
  onCreateIncident,
}: {
  item: TriageItem | undefined;
  localIncident: LocalIncident | undefined;
  account: Account | undefined;
  service: ServiceHealth | undefined;
  metadata: ServiceMetadata | undefined;
  scopedEvents: HistoryEvent[];
  hints: CorrelationHint[];
  note: string;
  onNoteChange: (value: string) => void;
  onSaveNote: () => void;
  savingNote: boolean;
  onCreateIncident: (item: TriageItem, relatedEventIds?: string[]) => void;
}) {
  const evidence = uniqueEvents([...scopedEvents, ...hints.map((hint) => hint.event)]);
  const deploys = evidence.filter((event) => event.type === "deploy");
  const failures = evidence.filter((event) => event.type === "failure");
  const alerts = evidence.filter((event) => event.type === "alert" || event.type === "incident");
  const recoveries = evidence.filter((event) => event.type === "recovery");
  const links: EvidenceLink[] = [
    item?.url ? { label: "Provider source", url: item.url, icon: ExternalLink } : null,
    localIncident?.sourceUrl ? { label: "Provider source", url: localIncident.sourceUrl, icon: ExternalLink } : null,
    metadata?.runbookUrl ? { label: "Runbook", url: metadata.runbookUrl, icon: BookOpen } : null,
    metadata?.dashboardUrl ? { label: "Service dashboard", url: metadata.dashboardUrl, icon: LayoutDashboard } : null,
    metadata?.repositoryUrl ? { label: "Repository", url: metadata.repositoryUrl, icon: GitBranch } : null,
  ].filter((link): link is EvidenceLink => link !== null);

  return (
    <section className="rounded-md border border-separator p-3 flex flex-col gap-3">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0 flex-1">
          <Text variant="strong" className="block">Investigation workspace</Text>
          <Text variant="small" color="secondary" truncate className="block">
            {service?.name ?? account?.label ?? "Selected source"} · {evidence.length} related evidence items
          </Text>
        </div>
        {localIncident ? <Badge color={localIncidentStatusColor(localIncident.status)}>{localIncident.status}</Badge> : null}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <div className="flex min-w-0 flex-col gap-1 rounded-md border border-separator p-2">
          <Text variant="small" color="tertiary" className="block">Deploys</Text>
          <Text variant="title" className="block">{deploys.length}</Text>
        </div>
        <div className="flex min-w-0 flex-col gap-1 rounded-md border border-separator p-2">
          <Text variant="small" color="tertiary" className="block">Failures</Text>
          <Text variant="title" className="block">{failures.length}</Text>
        </div>
        <div className="flex min-w-0 flex-col gap-1 rounded-md border border-separator p-2">
          <Text variant="small" color="tertiary" className="block">Alerts</Text>
          <Text variant="title" className="block">{alerts.length}</Text>
        </div>
        <div className="flex min-w-0 flex-col gap-1 rounded-md border border-separator p-2">
          <Text variant="small" color="tertiary" className="block">Recoveries</Text>
          <Text variant="title" className="block">{recoveries.length}</Text>
        </div>
      </div>

      {links.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {links.map((link) => {
            const Icon = link.icon;
            return (
              <Button key={`${link.label}:${link.url}`} variant="glass" size="small" className="max-w-full" onClick={() => openUrl(link.url)}>
                <Icon className="size-4" />
                <span className="truncate">{link.label}</span>
              </Button>
            );
          })}
        </div>
      ) : null}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
        {[
          { title: "Recent deploys", rows: deploys },
          { title: "Failures and alerts", rows: [...failures, ...alerts].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime()) },
          { title: "Recoveries", rows: recoveries },
        ].map((section) => (
          <div key={section.title} className="rounded-md border border-separator p-2 min-w-0">
            <Text variant="small" color="secondary">{section.title}</Text>
            {section.rows.length === 0 ? (
              <Text variant="small" color="tertiary">No matching evidence.</Text>
            ) : (
              <div className="mt-1 flex flex-col">
                {section.rows.slice(0, 4).map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => openUrl(event.url)}
                    className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2 border-t border-separator py-1.5 text-left first:border-t-0"
                  >
                    <Text variant="small" color="tertiary" className="tabular-nums">{formatRelativeTime(event.ts)}</Text>
                    <Text variant="small" truncate className="block">{event.title}</Text>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {localIncident ? (
        <div className="flex flex-col gap-2">
          <Text variant="small" color="secondary">Add investigation note</Text>
          <textarea
            value={note}
            onChange={(event) => onNoteChange(event.target.value)}
            className="min-h-20 w-full resize-y rounded-md border border-separator bg-transparent px-3 py-2 text-sm text-primary outline-none focus:border-accent"
            placeholder="Record evidence, hypothesis, decision, or handoff note"
          />
          <div className="flex justify-end">
            <Button variant="accent" size="small" onClick={onSaveNote} disabled={!note.trim() || savingNote}>
              Save note
            </Button>
          </div>
        </div>
      ) : item ? (
        <Callout color="secondary">
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Text variant="small" color="secondary" className="min-w-0">
              Create a local incident from this live source to save investigation notes and export a report.
            </Text>
            <Button variant="glass" size="small" className="shrink-0" onClick={() => onCreateIncident(item, evidence.map((event) => event.id))}>
              <Plus className="size-4" />
              Create incident
            </Button>
          </div>
        </Callout>
      ) : null}
    </section>
  );
}

function TriageRow({
  item,
  state,
  selected,
  account,
  onSelect,
}: {
  item: TriageItem;
  state: TriageState | undefined;
  selected: boolean;
  account: Account | undefined;
  onSelect: () => void;
}) {
  const Icon = providerIcon(item.provider);
  const silenced = isSilenced(state);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`text-left rounded-lg border p-3 flex flex-col gap-2 ${
        selected ? "border-accent bg-control-subtle" : "border-separator hover:bg-control-subtle"
      }`}
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2">
        <Icon className="mt-0.5 size-4 shrink-0 text-tertiary" />
        <div className="min-w-0 flex-1">
          <Text variant="strong" truncate className="block">{item.title}</Text>
          <Text variant="small" color="secondary" truncate className="block">{account?.label ?? "Unknown account"} · {item.subtitle}</Text>
        </div>
        <Badge color={item.severity === "critical" || item.severity === "high" ? "red" : "yellow"}>{item.severity}</Badge>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {item.kind === "signal" && isNormalizedStatus(item.status) ? (
          <StatusBadge status={item.status} />
        ) : (
          <Badge color="secondary">{item.status}</Badge>
        )}
        {state?.acknowledgedAt ? <Badge color="secondary">Acknowledged</Badge> : null}
        {silenced ? <Badge color="secondary">Silenced</Badge> : null}
        <Text variant="small" color="tertiary" className="ml-auto shrink-0 tabular-nums">{formatRelativeTime(item.updatedAt)}</Text>
      </div>
    </button>
  );
}

function localIncidentStatusColor(status: LocalIncidentStatus): "red" | "yellow" | "green" | "secondary" {
  if (status === "resolved") return "green";
  if (status === "acknowledged") return "yellow";
  return "red";
}

function LocalIncidentRow({
  incident,
  selected,
  account,
  onSelect,
}: {
  incident: LocalIncident;
  selected: boolean;
  account: Account | undefined;
  onSelect: () => void;
}) {
  const Icon = incident.provider ? providerIcon(incident.provider) : Clock3;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`text-left rounded-lg border p-3 flex flex-col gap-2 ${
        selected ? "border-accent bg-control-subtle" : "border-separator hover:bg-control-subtle"
      }`}
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2">
        <Icon className="mt-0.5 size-4 shrink-0 text-tertiary" />
        <div className="min-w-0 flex-1">
          <Text variant="strong" truncate className="block">{incident.title}</Text>
          <Text variant="small" color="secondary" truncate className="block">
            {account?.label ?? (incident.provider ? providerLabel(incident.provider) : "Manual incident")}
            {incident.assignee ? ` · ${incident.assignee}` : ""}
          </Text>
        </div>
        <Badge color={incident.severity === "critical" || incident.severity === "high" ? "red" : "yellow"}>{incident.severity}</Badge>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Badge color={localIncidentStatusColor(incident.status)}>{incident.status}</Badge>
        <Text variant="small" color="tertiary" className="ml-auto shrink-0 tabular-nums">{formatRelativeTime(incident.updatedAt)}</Text>
      </div>
    </button>
  );
}

function LocalIncidentFollowUps({
  incident,
  metadata,
  evidenceCount,
  onEdit,
  onAddNote,
}: {
  incident: LocalIncident;
  metadata: ServiceMetadata | undefined;
  evidenceCount: number;
  onEdit: () => void;
  onAddNote: (body: string) => void;
}) {
  const followUps = [
    {
      id: "root-cause",
      done: Boolean(incident.rootCause),
      label: "Record root cause",
      detail: incident.rootCause ? "Root cause is recorded." : "Capture the suspected or confirmed cause before closing the incident.",
      actionLabel: "Edit",
      onAction: onEdit,
    },
    {
      id: "resolution",
      done: incident.status !== "resolved" || Boolean(incident.resolvedReason),
      label: "Record resolution",
      detail: incident.status === "resolved" && !incident.resolvedReason ? "Resolved incidents should include the resolution path." : "Resolution state is documented or not needed yet.",
      actionLabel: "Edit",
      onAction: onEdit,
    },
    {
      id: "owner",
      done: Boolean(metadata?.owner),
      label: "Assign service owner",
      detail: metadata?.owner ? `Owner: ${metadata.owner}` : "Add an owner in service metadata so future alerts have clear accountability.",
    },
    {
      id: "runbook",
      done: Boolean(metadata?.runbookUrl),
      label: "Link runbook",
      detail: metadata?.runbookUrl ? "Runbook is linked in service metadata." : "Add a runbook URL in service metadata for faster response.",
    },
    {
      id: "notes",
      done: incident.notes.length > 0,
      label: "Add investigation note",
      detail: incident.notes.length > 0 ? `${incident.notes.length} notes recorded.` : "Add at least one decision, hypothesis, or handoff note.",
      actionLabel: "Draft note",
      onAction: () => onAddNote("Follow-up: "),
    },
    {
      id: "evidence",
      done: evidenceCount > 0,
      label: "Attach evidence",
      detail: evidenceCount > 0 ? `${evidenceCount} evidence items linked.` : "No retained local history evidence is linked; verify provider-side evidence manually.",
    },
  ];
  const openItems = followUps.filter((item) => !item.done);
  const copyTasks = async () => {
    const lines = [
      `# Follow-ups: ${incident.title}`,
      "",
      ...followUps.map((item) => `- [${item.done ? "x" : " "}] ${item.label} — ${item.detail}`),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      toast.success("Follow-up tasks copied");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <section className="rounded-md border border-separator p-3 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Text variant="strong">Follow-ups</Text>
        <Badge color={openItems.length === 0 ? "green" : "secondary"}>{openItems.length} open</Badge>
        <Button variant="glass" size="small" className="ml-auto" onClick={() => void copyTasks()}>
          <Copy className="size-4" />
          Copy tasks
        </Button>
      </div>
      <div className="flex flex-col">
        {followUps.map((item) => (
          <div key={item.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 border-t border-separator py-2 first:border-t-0">
            {item.done ? <CheckCircle2 className="mt-0.5 size-4 text-support-green" /> : <AlertCircle className="mt-0.5 size-4 text-tertiary" />}
            <div className="min-w-0">
              <Text variant="small" truncate className="block">{item.label}</Text>
              <Text variant="small" color="tertiary" className="block min-w-0">{item.detail}</Text>
            </div>
            {!item.done && item.onAction ? (
              <Button variant="glass" size="small" onClick={item.onAction}>
                {item.actionLabel}
              </Button>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function IncidentDialog({
  open,
  editing,
  source,
  sourceEvent,
  sourceMonitorItem,
  sourceUptimeCheck,
  sourceRelatedEventIds,
  events,
  onOpenChange,
}: {
  open: boolean;
  editing: LocalIncident | null;
  source: TriageItem | null;
  sourceEvent: HistoryEvent | null;
  sourceMonitorItem: MonitorItem | null;
  sourceUptimeCheck: UptimeIncidentSource | null;
  sourceRelatedEventIds: string[];
  events: HistoryEvent[];
  onOpenChange: (open: boolean) => void;
}) {
  const { save } = useLocalIncidentMutations();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<ObservabilitySeverity>("medium");
  const [status, setStatus] = useState<LocalIncidentStatus>("open");
  const [assignee, setAssignee] = useState("");
  const [rootCause, setRootCause] = useState("");
  const [resolvedReason, setResolvedReason] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) return;
    const uptimeDescription = sourceUptimeCheck
      ? [
          `Synthetic check ${sourceUptimeCheck.status}.`,
          sourceUptimeCheck.statusCode ? `HTTP ${sourceUptimeCheck.statusCode}.` : undefined,
          sourceUptimeCheck.error,
          sourceUptimeCheck.latencyMs !== undefined ? `${sourceUptimeCheck.latencyMs} ms latency.` : undefined,
        ].filter(Boolean).join(" ")
      : "";
    setTitle(editing?.title ?? source?.title ?? sourceEvent?.title ?? sourceMonitorItem?.title ?? (sourceUptimeCheck ? `Uptime check: ${sourceUptimeCheck.name}` : ""));
    setDescription(editing?.description ?? source?.subtitle ?? (sourceEvent ? `${sourceEvent.type} event from retained history.` : sourceMonitorItem?.subtitle ?? uptimeDescription));
    setSeverity(editing?.severity ?? source?.severity ?? sourceEvent?.severity ?? (sourceMonitorItem ? severityForMonitorStatus(sourceMonitorItem.status) : sourceUptimeCheck?.status === "down" ? "critical" : "medium"));
    setStatus(editing?.status ?? "open");
    setAssignee(editing?.assignee ?? "");
    setRootCause(editing?.rootCause ?? "");
    setResolvedReason(editing?.resolvedReason ?? "");
    setNote("");
  }, [editing, open, source, sourceEvent, sourceMonitorItem, sourceUptimeCheck]);

  const matchingEventIds = source
    ? sourceRelatedEventIds.length > 0
      ? [...new Set(sourceRelatedEventIds)]
      : events
          .filter((event) => event.accountId === source.accountId && (!source.sourceUid || event.sourceUid === source.sourceUid || event.sourceUid === source.uid))
          .map((event) => event.id)
    : sourceEvent
    ? [sourceEvent.id]
    : sourceMonitorItem
    ? events
        .filter((event) => event.accountId === sourceMonitorItem.accountId && event.sourceUid === sourceMonitorItem.uid)
        .map((event) => event.id)
    : editing?.relatedEventIds ?? [];

  const onConfirm = async () => {
    const input: LocalIncidentInput = {
      id: editing?.id,
      sourceKind: editing?.sourceKind ?? source?.kind ?? "manual",
      sourceUid: editing?.sourceUid ?? source?.uid ?? sourceEvent?.sourceUid ?? sourceEvent?.id ?? sourceMonitorItem?.uid ?? sourceUptimeCheck?.checkId,
      sourceUrl: editing?.sourceUrl ?? source?.url ?? sourceEvent?.url ?? sourceMonitorItem?.url ?? sourceUptimeCheck?.url,
      accountId: editing?.accountId ?? source?.accountId ?? sourceEvent?.accountId ?? sourceMonitorItem?.accountId,
      provider: editing?.provider ?? source?.provider ?? sourceEvent?.provider ?? sourceMonitorItem?.provider,
      title,
      description,
      status,
      severity,
      assignee,
      rootCause,
      resolvedReason,
      relatedEventIds: matchingEventIds,
      note,
    };
    try {
      await save.mutateAsync(input);
      toast.success(editing ? "Incident updated" : "Incident created");
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Edit incident" : "Create incident"}
      confirmLabel="Save"
      confirmDisabled={title.trim() === ""}
      onConfirm={onConfirm}
      size="large"
    >
      <FieldSet>
        <Field label="Title" orientation="vertical" className="p-0">
          <Input value={title} onChange={(event) => setTitle(event.target.value)} />
        </Field>
        <Field label="Description" orientation="vertical" className="p-0">
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="min-h-20 w-full resize-y rounded-md border border-separator bg-transparent px-3 py-2 text-sm text-primary outline-none focus:border-accent"
          />
        </Field>
        {source && matchingEventIds.length > 0 ? (
          <Callout color="secondary">{matchingEventIds.length} related evidence item{matchingEventIds.length === 1 ? "" : "s"} will be linked to this incident.</Callout>
        ) : null}
        <div className="grid grid-cols-3 gap-3">
          <Field label="Severity" orientation="vertical" className="p-0">
            <Select value={severity} onValueChange={(value) => setSeverity(value as ObservabilitySeverity)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["critical", "high", "medium", "low", "info"].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Status" orientation="vertical" className="p-0">
            <Select value={status} onValueChange={(value) => setStatus(value as LocalIncidentStatus)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="open">open</SelectItem>
                <SelectItem value="acknowledged">acknowledged</SelectItem>
                <SelectItem value="resolved">resolved</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Assignee" orientation="vertical" className="p-0">
            <Input value={assignee} onChange={(event) => setAssignee(event.target.value)} placeholder="Optional" />
          </Field>
        </div>
        <Field label="Root cause" orientation="vertical" className="p-0">
          <Input value={rootCause} onChange={(event) => setRootCause(event.target.value)} placeholder="Optional" />
        </Field>
        <Field label="Resolved reason" orientation="vertical" className="p-0">
          <Input value={resolvedReason} onChange={(event) => setResolvedReason(event.target.value)} placeholder="Optional" />
        </Field>
        <Field label="Add note" orientation="vertical" className="p-0">
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="min-h-20 w-full resize-y rounded-md border border-separator bg-transparent px-3 py-2 text-sm text-primary outline-none focus:border-accent"
            placeholder="Optional update note"
          />
        </Field>
      </FieldSet>
    </Dialog>
  );
}

function DetailPanel({
  item,
  localIncident,
  state,
  events,
  account,
  service,
  serviceMetadata,
  onCreateIncident,
  onEditIncident,
}: {
  item: TriageItem | undefined;
  localIncident: LocalIncident | undefined;
  state: TriageState | undefined;
  events: HistoryEvent[];
  account: Account | undefined;
  service: ServiceHealth | undefined;
  serviceMetadata: ServiceMetadata | undefined;
  onCreateIncident: (item: TriageItem, relatedEventIds?: string[]) => void;
  onEditIncident: (incident: LocalIncident) => void;
}) {
  const triage = useTriageMutations();
  const localMutations = useLocalIncidentMutations();
  const [workspaceNote, setWorkspaceNote] = useState("");
  useEffect(() => {
    setWorkspaceNote("");
  }, [localIncident?.id, item?.uid]);
  if (!item && !localIncident) {
    return (
      <div className="rounded-lg border border-separator p-4">
        <Text variant="strong" className="block">No item selected</Text>
        <Text variant="small" color="secondary" className="block">Select an alert or incident to inspect its timeline.</Text>
      </div>
    );
  }
  const scopedEvents = localIncident
    ? events.filter((event) => localIncident.relatedEventIds.includes(event.id) || (localIncident.sourceUid && event.sourceUid === localIncident.sourceUid))
    : item
    ? events.filter((event) =>
        event.accountId === item.accountId && (!item.sourceUid || event.sourceUid === item.sourceUid || event.sourceUid === item.uid)
      )
    : [];
  const hints = localIncident
    ? correlationHints({
        accountId: localIncident.accountId,
        provider: localIncident.provider,
        sourceUid: localIncident.sourceUid,
        relatedEventIds: localIncident.relatedEventIds,
        timestamp: localIncident.createdAt,
      }, events)
    : item
    ? correlationHints({
        accountId: item.accountId,
        provider: item.provider,
        sourceUid: item.sourceUid ?? item.uid,
        timestamp: item.updatedAt,
      }, events)
    : [];
  const evidence = uniqueEvents([...scopedEvents, ...hints.map((hint) => hint.event)]);
  const relatedEvidenceIds = evidence.map((event) => event.id);
  const saveWorkspaceNote = () => {
    if (!localIncident || !workspaceNote.trim()) return;
    void localMutations.save.mutateAsync(localIncidentNoteInput(localIncident, workspaceNote))
      .then(() => {
        setWorkspaceNote("");
        toast.success("Investigation note saved");
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : String(error)));
  };
  const copyPostmortem = async () => {
    if (!localIncident) return;
    try {
      await navigator.clipboard.writeText(buildPostmortemDraft({
        incident: localIncident,
        evidence,
        account,
        service,
        metadata: serviceMetadata,
      }));
      toast.success("Postmortem draft copied");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  if (localIncident) {
    const lifecycleRows = localIncidentLifecycle(localIncident);
    return (
      <div className="rounded-lg border border-separator p-3 flex flex-col gap-4">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <Text variant="title" truncate className="block">{localIncident.title}</Text>
            <Text variant="small" color="secondary" className="block">
              {account?.label ?? (localIncident.provider ? providerLabel(localIncident.provider) : "Manual incident")}
              {localIncident.assignee ? ` · ${localIncident.assignee}` : ""}
            </Text>
          </div>
          <Badge color={localIncidentStatusColor(localIncident.status)}>{localIncident.status}</Badge>
          <Button variant="glass" size="small" onClick={() => onEditIncident(localIncident)}>
            <Edit3 className="size-4" />
            Edit
          </Button>
          {localIncident.sourceUrl ? (
            <Button variant="glass" size="small" onClick={() => openUrl(localIncident.sourceUrl ?? "")}>
              <ExternalLink className="size-4" />
              Source
            </Button>
          ) : null}
          <Button variant="glass" size="small" onClick={() => void copyPostmortem()}>
            <Copy className="size-4" />
            Postmortem
          </Button>
          <Button
            variant="glass"
            size="small"
            onClick={() =>
              void localMutations.exportReport.mutateAsync({ id: localIncident.id, format: "markdown" })
                .then((result) => {
                  if (result.ok) toast.success("Incident report exported");
                })
                .catch((error) => toast.error(error instanceof Error ? error.message : String(error)))}
          >
            <Download className="size-4" />
            Report
          </Button>
          <Button
            variant="glass"
            size="small"
            onClick={() =>
              void localMutations.exportReport.mutateAsync({ id: localIncident.id, format: "json" })
                .then((result) => {
                  if (result.ok) toast.success("Incident JSON exported");
                })
                .catch((error) => toast.error(error instanceof Error ? error.message : String(error)))}
          >
            <Download className="size-4" />
            JSON
          </Button>
        </div>
        {localIncident.description ? <Text variant="small" color="secondary">{localIncident.description}</Text> : null}
        <div className="flex flex-wrap gap-2">
          <Badge color={localIncident.severity === "critical" || localIncident.severity === "high" ? "red" : "yellow"}>{localIncident.severity}</Badge>
          {localIncident.rootCause ? <Badge color="secondary">Cause: {localIncident.rootCause}</Badge> : null}
          {localIncident.resolvedReason ? <Badge color="secondary">Resolution: {localIncident.resolvedReason}</Badge> : null}
        </div>
        <ServiceIncidentContext service={service} metadata={serviceMetadata} />
        <InvestigationWorkspace
          item={undefined}
          localIncident={localIncident}
          account={account}
          service={service}
          metadata={serviceMetadata}
          scopedEvents={scopedEvents}
          hints={hints}
          note={workspaceNote}
          onNoteChange={setWorkspaceNote}
          onSaveNote={saveWorkspaceNote}
          savingNote={localMutations.save.isPending}
          onCreateIncident={onCreateIncident}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            variant="filled"
            size="small"
            disabled={localIncident.status === "acknowledged"}
            onClick={() => void localMutations.updateStatus.mutateAsync({ id: localIncident.id, status: "acknowledged" }).catch((error) => toast.error(String(error)))}
          >
            <CheckCircle2 className="size-4" />
            Acknowledge
          </Button>
          {localIncident.status === "resolved" ? (
            <Button
              variant="glass"
              size="small"
              onClick={() => void localMutations.updateStatus.mutateAsync({ id: localIncident.id, status: "open" }).catch((error) => toast.error(String(error)))}
            >
              <RotateCcw className="size-4" />
              Reopen
            </Button>
          ) : (
            <Button
              variant="glass"
              size="small"
              onClick={() => void localMutations.updateStatus.mutateAsync({ id: localIncident.id, status: "resolved" }).catch((error) => toast.error(String(error)))}
            >
              Resolve
            </Button>
          )}
          <Button
            variant="transparent"
            size="small"
            onClick={() => {
              if (!window.confirm(`Delete local incident "${localIncident.title}"?`)) return;
              void localMutations.remove.mutateAsync(localIncident.id).catch((error) => toast.error(String(error)));
            }}
          >
            <Trash2 className="size-4 text-support-red" />
            Delete
          </Button>
        </div>
        <InvestigationHints hints={hints} />
        <LocalIncidentFollowUps
          incident={localIncident}
          metadata={serviceMetadata}
          evidenceCount={evidence.length}
          onEdit={() => onEditIncident(localIncident)}
          onAddNote={(body) => setWorkspaceNote((current) => current || body)}
        />
        <div className="flex flex-col gap-1">
          <Text variant="strong">Lifecycle</Text>
          <div className="flex flex-col">
            {lifecycleRows.map((row, index) => (
              <div key={`${row.ts}:${row.label}:${index}`} className="grid grid-cols-[6rem_7rem_minmax(0,1fr)] gap-3 border-t border-separator py-2 first:border-t-0 items-start">
                <Text variant="small" color="tertiary" className="tabular-nums">{formatRelativeTime(row.ts)}</Text>
                <Badge color={row.color}>{row.label}</Badge>
                <Text variant="small" className="min-w-0">{row.detail}</Text>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <Text variant="strong">Notes</Text>
          {localIncident.notes.length === 0 ? (
            <Callout color="secondary">No incident notes yet.</Callout>
          ) : (
            <div className="flex flex-col">
              {localIncident.notes.map((note) => (
                <div key={note.id} className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 border-t border-separator py-2 first:border-t-0">
                  <Text variant="small" color="tertiary" className="tabular-nums">{formatRelativeTime(note.createdAt)}</Text>
                  <Text variant="small" className="min-w-0">{note.body}</Text>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <Text variant="strong">Related timeline</Text>
          {scopedEvents.length === 0 ? (
            <Callout color="secondary">No related persisted events are linked yet.</Callout>
          ) : (
            <div className="flex flex-col">
              {scopedEvents.slice(0, 20).map((event) => (
                <div key={event.id} className="grid grid-cols-[6rem_5rem_minmax(0,1fr)_auto] items-center gap-3 border-t border-separator py-2 first:border-t-0">
                  <Text variant="small" color="tertiary" className="tabular-nums">{formatRelativeTime(event.ts)}</Text>
                  <Badge color={event.type === "failure" || event.type === "incident" ? "red" : "secondary"}>{eventIcon(event)}</Badge>
                  <Text variant="small" truncate className="block">{event.title}</Text>
                  <Button variant="transparent" size="small" iconOnly aria-label="Open related event" onClick={() => openUrl(event.url)}>
                    <ExternalLink className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!item) return null;

  return (
    <div className="rounded-lg border border-separator p-3 flex flex-col gap-4">
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0 flex-1">
          <Text variant="title" truncate className="block">{item.title}</Text>
          <Text variant="small" color="secondary" truncate className="block">{account?.label ?? "Unknown account"} · {providerLabel(item.provider)}</Text>
        </div>
        <div className="flex flex-wrap items-center gap-2 md:justify-end">
          <Button variant="glass" size="small" onClick={() => openUrl(item.url)}>
            <ExternalLink className="size-4" />
            Open
          </Button>
          <Button variant="accent" size="small" onClick={() => onCreateIncident(item, relatedEvidenceIds)}>
            <Plus className="size-4" />
            Create incident
          </Button>
        </div>
      </div>
      <ServiceIncidentContext service={service} metadata={serviceMetadata} />
      <InvestigationWorkspace
        item={item}
        localIncident={undefined}
        account={account}
        service={service}
        metadata={serviceMetadata}
        scopedEvents={scopedEvents}
        hints={hints}
        note={workspaceNote}
        onNoteChange={setWorkspaceNote}
        onSaveNote={saveWorkspaceNote}
        savingNote={localMutations.save.isPending}
        onCreateIncident={onCreateIncident}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="filled"
          size="small"
          onClick={() => void triage.acknowledge.mutateAsync(item.uid).catch((error) => toast.error(String(error)))}
          disabled={Boolean(state?.acknowledgedAt)}
        >
          <CheckCircle2 className="size-4" />
          Acknowledge
        </Button>
        <Button
          variant="glass"
          size="small"
          onClick={() => void triage.silence.mutateAsync({ uid: item.uid, minutes: 60 }).catch((error) => toast.error(String(error)))}
        >
          <VolumeX className="size-4" />
          Silence 1h
        </Button>
        <Button
          variant="transparent"
          size="small"
          onClick={() => void triage.clear.mutateAsync(item.uid).catch((error) => toast.error(String(error)))}
        >
          Clear
        </Button>
      </div>
      <InvestigationHints hints={hints} />
      <div className="flex flex-col gap-1">
        <Text variant="strong">Timeline</Text>
        {scopedEvents.length === 0 ? (
          <Callout color="secondary">No persisted events match this item yet.</Callout>
        ) : (
          <div className="flex flex-col">
            {scopedEvents.slice(0, 20).map((event) => (
              <div key={event.id} className="grid grid-cols-[6rem_5rem_minmax(0,1fr)] gap-3 border-t border-separator py-2 first:border-t-0">
                <Text variant="small" color="tertiary" className="tabular-nums">{formatRelativeTime(event.ts)}</Text>
                <Badge color={event.type === "failure" || event.type === "incident" ? "red" : "secondary"}>{eventIcon(event)}</Badge>
                <Text variant="small" truncate className="block">{event.title}</Text>
              </div>
            ))}
          </div>
        )}
      </div>
      {state?.silencedUntil ? (
        <Callout color="secondary" icon={<Clock3 />}>Silenced until {new Date(state.silencedUntil).toLocaleString()}.</Callout>
      ) : null}
    </div>
  );
}

export function IncidentsView() {
  const snapshotQuery = useMonitorData();
  const accountsQuery = useAccounts();
  const groupsQuery = useGroups();
  const providersQuery = useProviders();
  const triageQuery = useTriage();
  const localIncidentsQuery = useLocalIncidents();
  const serviceMetadataQuery = useServiceMetadata();
  const historyStatsQuery = useHistoryStats();
  const [storedFilters, setFilters, resetFilters] = useStoredState<IncidentsFilters>(FILTER_KEY, DEFAULT_FILTERS);
  const filters: IncidentsFilters = { ...DEFAULT_FILTERS, ...storedFilters, dateRange: storedFilters.dateRange ?? DEFAULT_FILTERS.dateRange };
  const dateBounds = retainedHistoryDateBounds(historyStatsQuery.data);
  const accounts = accountsQuery.data ?? [];
  const groups = groupsQuery.data ?? [];
  const accountsById = useMemo(() => accountMap(accounts), [accounts]);
  const groupsById = useMemo(() => groupMap(groups), [groups]);
  const historyQuery = useHistoryEvents({
    range: filters.dateRange,
    groupId: filters.group === ALL ? undefined : filters.group,
    accountId: filters.account === ALL ? undefined : filters.account,
    provider: filters.provider === "all" ? undefined : filters.provider,
    severity: filters.severity === "all" ? undefined : filters.severity,
    types: ["deploy", "failure", "recovery", "alert", "incident"],
  });
  const [selection, setSelection] = useState<IncidentSelection>(null);
  const [incidentDialogOpen, setIncidentDialogOpen] = useState(false);
  const [editingIncident, setEditingIncident] = useState<LocalIncident | null>(null);
  const [sourceForIncident, setSourceForIncident] = useState<TriageItem | null>(null);
  const [sourceEventForIncident, setSourceEventForIncident] = useState<HistoryEvent | null>(null);
  const [sourceMonitorItemForIncident, setSourceMonitorItemForIncident] = useState<MonitorItem | null>(null);
  const [sourceUptimeCheckForIncident, setSourceUptimeCheckForIncident] = useState<UptimeIncidentSource | null>(null);
  const [sourceRelatedEventIds, setSourceRelatedEventIds] = useState<string[]>([]);
  const setFilter = <K extends keyof IncidentsFilters>(key: K, value: IncidentsFilters[K]) => setFilters({ ...filters, [key]: value });

  useEffect(() => {
    const raw = localStorage.getItem(INCIDENTS_DRILLDOWN_KEY);
    if (!raw) return;
    localStorage.removeItem(INCIDENTS_DRILLDOWN_KEY);
    try {
      const parsed = incidentDrilldownFilters(JSON.parse(raw));
      if (!parsed) return;
      setFilters({ ...DEFAULT_FILTERS, ...parsed, dateRange: parsed.dateRange ?? DEFAULT_FILTERS.dateRange });
    } catch {
      // Ignore stale drilldown payloads.
    }
  }, []);

  useEffect(() => {
    const raw = localStorage.getItem(INCIDENT_CREATE_KEY);
    if (!raw) return;
    localStorage.removeItem(INCIDENT_CREATE_KEY);
    try {
      const parsed = JSON.parse(raw) as { event?: unknown; manual?: unknown; monitorItem?: unknown; source?: unknown; uptimeCheck?: unknown };
      if (parsed.manual === true) {
        setEditingIncident(null);
        setSourceForIncident(null);
        setSourceEventForIncident(null);
        setSourceMonitorItemForIncident(null);
        setSourceUptimeCheckForIncident(null);
        setSourceRelatedEventIds([]);
        setIncidentDialogOpen(true);
        return;
      }
      const uptimeCheck = uptimeIncidentPayload(parsed.uptimeCheck);
      if (uptimeCheck) {
        setFilters({
          ...DEFAULT_FILTERS,
          dateRange: uptimeCheck.checkedAt ? selectionDateRange(uptimeCheck.checkedAt) : DEFAULT_FILTERS.dateRange,
          status: "open",
        });
        setSelection(null);
        setEditingIncident(null);
        setSourceForIncident(null);
        setSourceEventForIncident(null);
        setSourceMonitorItemForIncident(null);
        setSourceUptimeCheckForIncident(uptimeCheck);
        setSourceRelatedEventIds([]);
        setIncidentDialogOpen(true);
        return;
      }
      const source = triageItemPayload(parsed.source);
      if (source) {
        setFilters({
          ...DEFAULT_FILTERS,
          dateRange: selectionDateRange(source.updatedAt),
          provider: source.provider,
          account: source.accountId,
          severity: source.severity,
          kind: source.kind,
          status: "open",
        });
        setSelection(null);
        setEditingIncident(null);
        setSourceForIncident(source);
        setSourceEventForIncident(null);
        setSourceMonitorItemForIncident(null);
        setSourceUptimeCheckForIncident(null);
        setSourceRelatedEventIds([]);
        setIncidentDialogOpen(true);
        return;
      }
      const monitorItem = monitorItemPayload(parsed.monitorItem);
      if (monitorItem) {
        setFilters({
          ...DEFAULT_FILTERS,
          dateRange: selectionDateRange(monitorItem.updatedAt),
          provider: monitorItem.provider,
          account: monitorItem.accountId,
          status: "open",
        });
        setSelection(null);
        setEditingIncident(null);
        setSourceForIncident(null);
        setSourceEventForIncident(null);
        setSourceMonitorItemForIncident(monitorItem);
        setSourceUptimeCheckForIncident(null);
        setSourceRelatedEventIds([]);
        setIncidentDialogOpen(true);
        return;
      }
      const event = historyEventPayload(parsed.event);
      if (!event) return;
      const groupId = event.groupId ?? accountsById.get(event.accountId)?.groupId;
      setFilters({
        ...DEFAULT_FILTERS,
        dateRange: selectionDateRange(event.ts),
        provider: event.provider,
        account: event.accountId,
        group: groupId ?? ALL,
        severity: event.severity,
        kind: event.type === "incident" ? "incident" : event.type === "alert" ? "signal" : "all",
      });
      setSelection(null);
      setEditingIncident(null);
      setSourceForIncident(null);
      setSourceEventForIncident(event);
      setSourceMonitorItemForIncident(null);
      setSourceUptimeCheckForIncident(null);
      setSourceRelatedEventIds([event.id]);
      setIncidentDialogOpen(true);
    } catch {
      // Ignore stale retained-event incident creation payloads.
    }
  }, [accountsById, setFilters]);

  const services = snapshotQuery.data?.services ?? [];
  const serviceMetadataById = useMemo(() => new Map((serviceMetadataQuery.data ?? []).map((metadata) => [metadata.serviceId, metadata])), [serviceMetadataQuery.data]);
  const metadataForAccount = (accountId: string | undefined): ServiceMetadata | undefined => {
    const service = serviceForAccount(services, accountId);
    if (service) return serviceMetadataById.get(service.id);
    const account = accountId ? accountsById.get(accountId) : undefined;
    return accountId ? serviceMetadataById.get(account?.groupId ?? `account:${accountId}`) : undefined;
  };
  const matchesServiceMetadataFilters = (accountId: string | undefined): boolean => {
    if (filters.owner === ALL && filters.tier === "all" && filters.dependency === ALL) return true;
    const metadata = metadataForAccount(accountId);
    if (filters.owner !== ALL && metadata?.owner !== filters.owner) return false;
    if (filters.tier !== "all" && metadata?.tier !== filters.tier) return false;
    if (filters.dependency !== ALL && !metadata?.dependencies?.includes(filters.dependency)) return false;
    return true;
  };
  const triage = triageQuery.data ?? {};
  const allLocalIncidents = localIncidentsQuery.data ?? [];
  const localIncidents = allLocalIncidents.filter((incident) => {
    if (!matchesDateRange(incident.updatedAt, filters.dateRange)) return false;
    if (filters.kind === "signal" || filters.kind === "incident") {
      if (incident.sourceKind !== filters.kind) return false;
    }
    if (filters.severity !== "all" && incident.severity !== filters.severity) return false;
    if (filters.provider !== ALL && incident.provider !== filters.provider) return false;
    if (filters.account !== ALL && incident.accountId !== filters.account) return false;
    if (!matchesServiceMetadataFilters(incident.accountId)) return false;
    if (filters.group !== ALL) {
      const account = incident.accountId ? accountsById.get(incident.accountId) : undefined;
      if (account?.groupId !== filters.group) return false;
    }
    if (filters.status === "acknowledged" && incident.status !== "acknowledged") return false;
    if (filters.status === "open" && incident.status === "resolved") return false;
    if (filters.status === "silenced") return false;
    return true;
  });

  useEffect(() => {
    if (!localIncidentsQuery.data) return;
    const raw = localStorage.getItem(INCIDENT_SELECT_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { kind?: unknown; id?: unknown };
      if (parsed.kind !== "local" || typeof parsed.id !== "string") {
        localStorage.removeItem(INCIDENT_SELECT_KEY);
        return;
      }
      const incident = localIncidentsQuery.data.find((candidate) => candidate.id === parsed.id);
      localStorage.removeItem(INCIDENT_SELECT_KEY);
      if (!incident) return;
      setFilters({
        ...DEFAULT_FILTERS,
        dateRange: selectionDateRange(incident.updatedAt),
        severity: incident.severity,
        provider: incident.provider ?? "all",
        account: incident.accountId ?? ALL,
        kind: incident.sourceKind === "signal" || incident.sourceKind === "incident" ? incident.sourceKind : "all",
      });
      setSelection({ kind: "local", id: incident.id });
    } catch {
      localStorage.removeItem(INCIDENT_SELECT_KEY);
    }
  }, [localIncidentsQuery.data, setFilters]);

  const items = toItems(snapshotQuery.data?.signals ?? [], snapshotQuery.data?.incidents ?? []);
  const visible = items.filter((item) => {
    const account = accountsById.get(item.accountId);
    const groupId = account?.groupId && groupsById.has(account.groupId) ? account.groupId : undefined;
    if (!matchesDateRange(item.updatedAt, filters.dateRange)) return false;
    if (filters.kind !== "all" && item.kind !== filters.kind) return false;
    if (filters.severity !== "all" && item.severity !== filters.severity) return false;
    if (filters.provider !== ALL && item.provider !== filters.provider) return false;
    if (filters.account !== ALL && item.accountId !== filters.account) return false;
    if (!matchesServiceMetadataFilters(item.accountId)) return false;
    if (filters.group !== ALL && groupId !== filters.group) return false;
    return matchesStatus(item, triage[item.uid], filters.status);
  });
  const selectedLocal = selection?.kind === "local" ? localIncidents.find((incident) => incident.id === selection.id) : undefined;
  const selectedSource = selection?.kind === "source"
    ? visible.find((item) => item.uid === selection.uid)
    : selectedLocal
    ? undefined
    : visible[0];
  const selectedAccountId = selectedLocal?.accountId ?? selectedSource?.accountId;
  const selectedService = serviceForAccount(services, selectedAccountId);
  const selectedServiceMetadata = selectedService ? serviceMetadataById.get(selectedService.id) : metadataForAccount(selectedAccountId);
  const openNewIncident = () => {
    setEditingIncident(null);
    setSourceForIncident(null);
    setSourceEventForIncident(null);
    setSourceMonitorItemForIncident(null);
    setSourceUptimeCheckForIncident(null);
    setSourceRelatedEventIds([]);
    setIncidentDialogOpen(true);
  };
  const createFromSource = (item: TriageItem, relatedEventIds: string[] = []) => {
    setEditingIncident(null);
    setSourceForIncident(item);
    setSourceEventForIncident(null);
    setSourceMonitorItemForIncident(null);
    setSourceUptimeCheckForIncident(null);
    setSourceRelatedEventIds([...new Set(relatedEventIds)]);
    setIncidentDialogOpen(true);
  };
  const editIncident = (incident: LocalIncident) => {
    setEditingIncident(incident);
    setSourceForIncident(null);
    setSourceEventForIncident(null);
    setSourceMonitorItemForIncident(null);
    setSourceUptimeCheckForIncident(null);
    setSourceRelatedEventIds([]);
    setIncidentDialogOpen(true);
  };
  const kindOptions = [{ value: "all", label: "All kinds" }, { value: "incident", label: "Incidents" }, { value: "signal", label: "Signals" }];
  const statusOptions = [{ value: "all", label: "All states" }, { value: "open", label: "Open" }, { value: "acknowledged", label: "Acknowledged" }, { value: "silenced", label: "Silenced" }];
  const groupOptions = [{ value: ALL, label: "All groups" }, ...groups.map((group) => ({ value: group.id, label: group.name }))];
  const providerOptions = [{ value: ALL, label: "All providers" }, ...(providersQuery.data ?? []).map((provider) => ({ value: provider.id, label: provider.label }))];
  const accountOptions = [{ value: ALL, label: "All accounts" }, ...accounts.map((account) => ({ value: account.id, label: account.label }))];
  const ownerOptions = [
    { value: ALL, label: "All owners" },
    ...[...new Set((serviceMetadataQuery.data ?? []).map((metadata) => metadata.owner).filter((owner): owner is string => Boolean(owner)))]
      .sort((a, b) => a.localeCompare(b))
      .map((owner) => ({ value: owner, label: owner })),
  ];
  const tierOptions = [
    { value: "all", label: "All tiers" },
    { value: "critical", label: "Critical" },
    { value: "standard", label: "Standard" },
    { value: "internal", label: "Internal" },
    { value: "experimental", label: "Experimental" },
  ];
  const dependencyOptions = [
    { value: ALL, label: "All dependencies" },
    ...[...new Set((serviceMetadataQuery.data ?? []).flatMap((metadata) => metadata.dependencies ?? []))]
      .sort((a, b) => a.localeCompare(b))
      .map((dependency) => ({ value: dependency, label: dependency })),
  ];
  const activeFilters: AppliedFilter[] = [
    !sameDateRange(filters.dateRange, DEFAULT_FILTERS.dateRange)
      ? { id: "dateRange", label: "Range", value: dateRangeLabel(filters.dateRange), onClear: () => setFilter("dateRange", DEFAULT_FILTERS.dateRange) }
      : null,
    filters.kind !== DEFAULT_FILTERS.kind
      ? { id: "kind", label: "Kind", value: optionLabel(kindOptions, filters.kind), onClear: () => setFilter("kind", DEFAULT_FILTERS.kind) }
      : null,
    filters.severity !== DEFAULT_FILTERS.severity
      ? { id: "severity", label: "Severity", value: optionLabel(SEVERITY_FILTER_OPTIONS, filters.severity), onClear: () => setFilter("severity", DEFAULT_FILTERS.severity) }
      : null,
    filters.status !== DEFAULT_FILTERS.status
      ? { id: "status", label: "State", value: optionLabel(statusOptions, filters.status), onClear: () => setFilter("status", DEFAULT_FILTERS.status) }
      : null,
    filters.group !== DEFAULT_FILTERS.group
      ? { id: "group", label: "Group", value: optionLabel(groupOptions, filters.group), onClear: () => setFilter("group", DEFAULT_FILTERS.group) }
      : null,
    filters.provider !== DEFAULT_FILTERS.provider
      ? { id: "provider", label: "Provider", value: optionLabel(providerOptions, filters.provider), onClear: () => setFilter("provider", DEFAULT_FILTERS.provider) }
      : null,
    filters.account !== DEFAULT_FILTERS.account
      ? { id: "account", label: "Account", value: optionLabel(accountOptions, filters.account), onClear: () => setFilter("account", DEFAULT_FILTERS.account) }
      : null,
    filters.owner !== DEFAULT_FILTERS.owner
      ? { id: "owner", label: "Owner", value: optionLabel(ownerOptions, filters.owner), onClear: () => setFilter("owner", DEFAULT_FILTERS.owner) }
      : null,
    filters.tier !== DEFAULT_FILTERS.tier
      ? { id: "tier", label: "Tier", value: optionLabel(tierOptions, filters.tier), onClear: () => setFilter("tier", DEFAULT_FILTERS.tier) }
      : null,
    filters.dependency !== DEFAULT_FILTERS.dependency
      ? { id: "dependency", label: "Dependency", value: optionLabel(dependencyOptions, filters.dependency), onClear: () => setFilter("dependency", DEFAULT_FILTERS.dependency) }
      : null,
  ].filter((filter): filter is AppliedFilter => filter !== null);
  const exportIncidents = () => {
    downloadIncidentsCsv({
      localIncidents,
      liveItems: visible,
      triage,
      accountsById,
      groupsById,
      services,
      metadataByService: serviceMetadataById,
    });
    toast.success(`Exported ${localIncidents.length} local and ${visible.length} live incident rows`);
  };

  return (
    <ScrollArea
      title="Incidents"
      actions={
        <div className="flex min-w-0 items-center gap-2 flex-wrap justify-end">
          <Button variant="glass" size="small" onClick={exportIncidents} disabled={localIncidents.length === 0 && visible.length === 0}>
            <Download className="size-4" />
            Export CSV
          </Button>
          <FilterMenu
            filters={activeFilters}
            onReset={resetFilters}
            presetKey={FILTER_PRESET_KEY}
            presetValue={filters}
            onApplyPreset={(value) => setFilters({ ...DEFAULT_FILTERS, ...value, dateRange: value.dateRange ?? DEFAULT_FILTERS.dateRange })}
          >
            <FilterDateRangeField label="Range" value={filters.dateRange} onChange={(value) => setFilter("dateRange", value)} bounds={dateBounds} />
            <FilterSelectField label="Kind" value={filters.kind} onChange={(value) => setFilter("kind", value as KindFilter)} options={kindOptions} />
            <FilterSelectField label="Severity" value={filters.severity} onChange={(value) => setFilter("severity", value as SeverityFilter)} options={SEVERITY_FILTER_OPTIONS} />
            <FilterSelectField label="State" value={filters.status} onChange={(value) => setFilter("status", value as StatusFilter)} options={statusOptions} />
            <FilterSelectField label="Group" value={filters.group} onChange={(value) => setFilter("group", value)} options={groupOptions} />
            <FilterSelectField label="Provider" value={filters.provider} onChange={(value) => setFilter("provider", value as IncidentsFilters["provider"])} options={providerOptions} />
            <FilterSelectField label="Account" value={filters.account} onChange={(value) => setFilter("account", value)} options={accountOptions} />
            <FilterSelectField label="Owner" value={filters.owner} onChange={(value) => setFilter("owner", value)} options={ownerOptions} />
            <FilterSelectField label="Tier" value={filters.tier} onChange={(value) => setFilter("tier", value as IncidentsFilters["tier"])} options={tierOptions} />
            <FilterSelectField label="Dependency" value={filters.dependency} onChange={(value) => setFilter("dependency", value)} options={dependencyOptions} />
          </FilterMenu>
          <Button variant="accent" size="large" onClick={openNewIncident}>
            <Plus className="size-4" />
            Incident
          </Button>
        </div>
      }
      className="h-full"
    >
      <div className="px-2 pb-8 grid grid-cols-1 2xl:grid-cols-[minmax(22rem,28rem)_1fr] gap-6">
        {items.length === 0 && allLocalIncidents.length === 0 ? (
          <EmptyState title="No active alerts or incidents" description="The incident center fills from local incidents and live provider signals." />
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 px-2">
                <Text variant="strong">Local incidents</Text>
                <Badge color="secondary">{localIncidents.length}</Badge>
              </div>
              {localIncidents.length === 0 ? (
                <Callout color="secondary">
                  <div className="flex items-center justify-between gap-3">
                    <Text variant="small">No local incidents match the current filters.</Text>
                    <Button variant="glass" size="small" onClick={resetFilters}>Reset filters</Button>
                  </div>
                </Callout>
              ) : localIncidents.map((incident) => (
                <LocalIncidentRow
                  key={incident.id}
                  incident={incident}
                  account={incident.accountId ? accountsById.get(incident.accountId) : undefined}
                  selected={selectedLocal?.id === incident.id}
                  onSelect={() => setSelection({ kind: "local", id: incident.id })}
                />
              ))}

              <div className="flex items-center gap-2 px-2 pt-3">
                <Text variant="strong">Live sources</Text>
                <Badge color="secondary">{visible.length}</Badge>
              </div>
              {visible.length === 0 ? (
                <Callout color="secondary">
                  <div className="flex items-center justify-between gap-3">
                    <Text variant="small">No live alerts or incidents match the current filters.</Text>
                    <Button variant="glass" size="small" onClick={resetFilters}>Reset filters</Button>
                  </div>
                </Callout>
              ) : visible.map((item) => (
                <TriageRow
                  key={item.uid}
                  item={item}
                  state={triage[item.uid]}
                  account={accountsById.get(item.accountId)}
                  selected={selectedSource?.uid === item.uid}
                  onSelect={() => setSelection({ kind: "source", uid: item.uid })}
                />
              ))}
            </div>
            <DetailPanel
              item={selectedSource}
              localIncident={selectedLocal}
              state={selectedSource ? triage[selectedSource.uid] : undefined}
              events={historyQuery.data ?? []}
              account={selectedLocal?.accountId ? accountsById.get(selectedLocal.accountId) : selectedSource ? accountsById.get(selectedSource.accountId) : undefined}
              service={selectedService}
              serviceMetadata={selectedServiceMetadata}
              onCreateIncident={createFromSource}
              onEditIncident={editIncident}
            />
          </>
        )}
      </div>
      <IncidentDialog
        open={incidentDialogOpen}
        editing={editingIncident}
        source={sourceForIncident}
        sourceEvent={sourceEventForIncident}
        sourceMonitorItem={sourceMonitorItemForIncident}
        sourceUptimeCheck={sourceUptimeCheckForIncident}
        sourceRelatedEventIds={sourceRelatedEventIds}
        events={historyQuery.data ?? []}
        onOpenChange={(open) => {
          if (!open) {
            setSourceEventForIncident(null);
            setSourceMonitorItemForIncident(null);
            setSourceUptimeCheckForIncident(null);
            setSourceRelatedEventIds([]);
          }
          setIncidentDialogOpen(open);
        }}
      />
    </ScrollArea>
  );
}
