/**
 * Local incident lifecycle IPC handlers.
 */

import * as fs from "fs/promises";

import { dialog, ipcMain, logger } from "@glaze/core/backend";

import { listAccounts, listGroups } from "../services/accounts-store.js";
import { getAllEvents } from "../services/history-store.js";
import {
  deleteLocalIncident,
  getLocalIncident,
  listLocalIncidents,
  saveLocalIncident,
  updateLocalIncidentStatus,
} from "../services/local-incidents-store.js";
import { listServiceMetadata } from "../services/service-metadata-store.js";
import type {
  Account,
  HistoryEvent,
  LocalIncident,
  LocalIncidentInput,
  LocalIncidentSourceKind,
  LocalIncidentStatus,
  ObservabilitySeverity,
  ProjectGroup,
  Provider,
  ServiceMetadata,
} from "../services/types.js";

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) return {};
  return value as Record<string, unknown>;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function asString(value: unknown, label: string): string {
  const text = optionalString(value);
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function asInput(payload: unknown): LocalIncidentInput {
  const req = asRecord(payload);
  const relatedEventIds = Array.isArray(req.relatedEventIds)
    ? req.relatedEventIds.filter((value): value is string => typeof value === "string" && value.trim() !== "")
    : undefined;
  return {
    id: optionalString(req.id),
    sourceKind: optionalString(req.sourceKind) as LocalIncidentSourceKind | undefined,
    sourceUid: optionalString(req.sourceUid),
    sourceUrl: optionalString(req.sourceUrl),
    accountId: optionalString(req.accountId),
    provider: optionalString(req.provider) as Provider | undefined,
    title: asString(req.title, "Incident title"),
    description: optionalString(req.description),
    status: optionalString(req.status) as LocalIncidentStatus | undefined,
    severity: optionalString(req.severity) as ObservabilitySeverity | undefined,
    assignee: optionalString(req.assignee),
    rootCause: optionalString(req.rootCause),
    resolvedReason: optionalString(req.resolvedReason),
    relatedEventIds,
    note: optionalString(req.note),
  };
}

function safeFilename(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "incident";
}

function line(label: string, value: string | undefined): string {
  return value ? `- **${label}:** ${value}` : "";
}

function eventLine(event: HistoryEvent): string {
  const title = event.url ? `[${event.title}](${event.url})` : event.title;
  return `- ${event.ts} — ${event.type} — ${title} (${event.provider}${event.status ? `, ${event.status}` : ""})`;
}

function eventEvidenceLine(event: HistoryEvent): string {
  return [
    `- **${event.ts}**`,
    `  - Type: ${event.type}`,
    `  - Provider: ${event.provider}`,
    `  - Status: ${event.status}`,
    `  - Severity: ${event.severity}`,
    `  - Title: ${event.url ? `[${event.title}](${event.url})` : event.title}`,
  ].join("\n");
}

interface IncidentServiceContext {
  serviceId?: string;
  serviceName?: string;
  accountLabel?: string;
  provider?: Provider;
  groupName?: string;
  metadata?: ServiceMetadata;
}

function accountServiceId(account: Account): string {
  return account.groupId ?? `account:${account.id}`;
}

function serviceContextForIncident(
  incident: LocalIncident,
  accounts: Account[],
  groups: ProjectGroup[],
  metadata: ServiceMetadata[],
): IncidentServiceContext {
  const account = incident.accountId ? accounts.find((candidate) => candidate.id === incident.accountId) : undefined;
  if (!account) return {};
  const group = account.groupId ? groups.find((candidate) => candidate.id === account.groupId) : undefined;
  const serviceId = accountServiceId(account);
  return {
    serviceId,
    serviceName: group?.name ?? account.label,
    accountLabel: account.label,
    provider: account.provider,
    groupName: group?.name,
    metadata: metadata.find((candidate) => candidate.serviceId === serviceId),
  };
}

function relatedEventsForIncident(incident: LocalIncident, events: HistoryEvent[]): HistoryEvent[] {
  const relatedIds = new Set(incident.relatedEventIds);
  return events
    .filter((event) => relatedIds.has(event.id) || Boolean(incident.sourceUid && event.sourceUid === incident.sourceUid))
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
}

function evidenceEventsForIncident(incident: LocalIncident, events: HistoryEvent[]): HistoryEvent[] {
  const createdAt = new Date(incident.createdAt).getTime();
  const start = Number.isFinite(createdAt) ? createdAt - 6 * 60 * 60 * 1000 : 0;
  const end = Number.isFinite(createdAt) ? createdAt + 2 * 60 * 60 * 1000 : Number.MAX_SAFE_INTEGER;
  const related = new Set(relatedEventsForIncident(incident, events).map((event) => event.id));
  return events
    .filter((event) => {
      if (related.has(event.id)) return true;
      if (incident.accountId && event.accountId !== incident.accountId) return false;
      const ts = new Date(event.ts).getTime();
      return Number.isFinite(ts) && ts >= start && ts <= end;
    })
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
}

function durationLine(incident: LocalIncident): string {
  const start = new Date(incident.createdAt).getTime();
  const end = incident.resolvedAt ? new Date(incident.resolvedAt).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "";
  const minutes = Math.round((end - start) / 60_000);
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function groupedEvidence(events: HistoryEvent[], type: HistoryEvent["type"]): HistoryEvent[] {
  return events.filter((event) => event.type === type);
}

function suspectedCauseSection(incident: LocalIncident, evidence: HistoryEvent[]): string {
  if (incident.rootCause) return `## Suspected / Confirmed Cause\n\n${incident.rootCause}`;
  const deploys = groupedEvidence(evidence, "deploy").slice(-3);
  const failures = groupedEvidence(evidence, "failure").slice(-5);
  const candidates = [
    ...deploys.map((event) => `- Recent deploy/release before or near incident: ${event.url ? `[${event.title}](${event.url})` : event.title} (${event.ts})`),
    ...failures.map((event) => `- Nearby failure signal: ${event.url ? `[${event.title}](${event.url})` : event.title} (${event.ts})`),
  ];
  return [
    "## Suspected / Confirmed Cause",
    "",
    candidates.length > 0
      ? ["No root cause has been confirmed. Candidate evidence:", ...candidates].join("\n")
      : "No root cause has been confirmed, and retained history has no nearby deploy/failure evidence for this incident.",
  ].join("\n");
}

function followUpSection(incident: LocalIncident, context: IncidentServiceContext, evidence: HistoryEvent[]): string {
  const items = [
    !incident.rootCause ? "- Confirm and record root cause." : "",
    incident.status !== "resolved" ? "- Resolve or explicitly keep incident open with an owner." : "",
    incident.status === "resolved" && !incident.resolvedReason ? "- Record resolution details." : "",
    !context.metadata?.runbookUrl ? "- Add or link a service runbook." : "",
    !context.metadata?.owner ? "- Assign a service owner in local service metadata." : "",
    incident.notes.length === 0 ? "- Add investigation notes or handoff context." : "",
    evidence.length === 0 ? "- Verify provider-side evidence because no retained local history events were linked." : "",
  ].filter(Boolean);
  return ["## Follow-up Actions", "", items.length > 0 ? items.join("\n") : "No obvious follow-up gaps were found from local incident metadata."].join("\n");
}

function serviceContextSection(context: IncidentServiceContext): string {
  if (!context.serviceId && !context.metadata) return "## Service Context\n\nNo service context found for this incident.";
  const metadata = context.metadata;
  const links = [
    metadata?.runbookUrl ? `- [Runbook](${metadata.runbookUrl})` : "",
    metadata?.dashboardUrl ? `- [Dashboard](${metadata.dashboardUrl})` : "",
    metadata?.repositoryUrl ? `- [Repository](${metadata.repositoryUrl})` : "",
  ].filter(Boolean);
  const parts = [
    "## Service Context",
    "",
    line("Service", context.serviceName ?? context.serviceId),
    line("Owner", metadata?.owner),
    line("Tier", metadata?.tier),
    line("Account", context.accountLabel),
    line("Provider", context.provider),
    line("Group", context.groupName),
    metadata?.dependencies?.length ? `- **Dependencies:** ${metadata.dependencies.join(", ")}` : "",
    "",
    metadata?.notes ? `### Notes\n\n${metadata.notes}` : "",
    "",
    links.length > 0 ? `### Links\n\n${links.join("\n")}` : "### Links\n\nNo service links recorded.",
  ];
  return parts.filter((part) => part !== "").join("\n");
}

function incidentReport(incident: LocalIncident, events: HistoryEvent[], context: IncidentServiceContext): string {
  const relatedEvents = relatedEventsForIncident(incident, events);
  const evidence = evidenceEventsForIncident(incident, events);
  const notes = [...incident.notes].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const deploys = groupedEvidence(evidence, "deploy");
  const failures = groupedEvidence(evidence, "failure");
  const alerts = evidence.filter((event) => event.type === "alert" || event.type === "incident");
  const recoveries = groupedEvidence(evidence, "recovery");
  return [
    `# ${incident.title}`,
    "",
    "## Summary",
    line("Status", incident.status),
    line("Severity", incident.severity),
    line("Assignee", incident.assignee),
    line("Provider", incident.provider),
    line("Account", incident.accountId),
    line("Duration", durationLine(incident)),
    line("Created", incident.createdAt),
    line("Acknowledged", incident.acknowledgedAt),
    line("Resolved", incident.resolvedAt),
    line("Source", incident.sourceUrl),
    "",
    "## Impact",
    line("Service", context.serviceName ?? context.serviceId),
    line("Owner", context.metadata?.owner),
    line("Tier", context.metadata?.tier),
    incident.description ? `\n${incident.description}` : "\nNo impact description recorded.",
    "",
    serviceContextSection(context),
    "",
    "## Evidence Summary",
    line("Evidence items", String(evidence.length)),
    line("Deploys", String(deploys.length)),
    line("Failures", String(failures.length)),
    line("Alerts/incidents", String(alerts.length)),
    line("Recoveries", String(recoveries.length)),
    "",
    "## Timeline",
    evidence.length > 0 ? evidence.map(eventLine).join("\n") : "No retained local history evidence was found for the incident window.",
    "",
    "## Linked Evidence",
    evidence.length > 0 ? evidence.map(eventEvidenceLine).join("\n\n") : "No linked provider evidence found in retained local history.",
    "",
    suspectedCauseSection(incident, evidence),
    "",
    incident.resolvedReason ? `## Resolution\n\n${incident.resolvedReason}` : "## Resolution\n\nNot recorded.",
    "",
    "## Notes",
    notes.length > 0 ? notes.map((note) => `- ${note.createdAt} — ${note.body}`).join("\n") : "No notes recorded.",
    "",
    "## Related Events",
    relatedEvents.length > 0 ? relatedEvents.map(eventLine).join("\n") : "No related history events found in retained local history.",
    "",
    followUpSection(incident, context, evidence),
    "",
  ].filter((part) => part !== "").join("\n");
}

function redactedIncidentExport(incident: LocalIncident, events: HistoryEvent[], context: IncidentServiceContext) {
  const evidence = evidenceEventsForIncident(incident, events);
  return {
    exportedAt: new Date().toISOString(),
    incident: {
      id: incident.id,
      sourceKind: incident.sourceKind,
      sourceUid: incident.sourceUid,
      accountId: incident.accountId,
      provider: incident.provider,
      title: incident.title,
      description: incident.description,
      status: incident.status,
      severity: incident.severity,
      assignee: incident.assignee,
      rootCause: incident.rootCause,
      resolvedReason: incident.resolvedReason,
      createdAt: incident.createdAt,
      updatedAt: incident.updatedAt,
      acknowledgedAt: incident.acknowledgedAt,
      resolvedAt: incident.resolvedAt,
      notes: incident.notes,
    },
    service: {
      serviceId: context.serviceId,
      serviceName: context.serviceName,
      accountLabel: context.accountLabel,
      provider: context.provider,
      groupName: context.groupName,
      owner: context.metadata?.owner,
      tier: context.metadata?.tier,
      dependencies: context.metadata?.dependencies ?? [],
      hasRunbook: Boolean(context.metadata?.runbookUrl),
      hasDashboard: Boolean(context.metadata?.dashboardUrl),
      hasRepository: Boolean(context.metadata?.repositoryUrl),
    },
    evidence: evidence.map((event) => ({
      id: event.id,
      ts: event.ts,
      type: event.type,
      provider: event.provider,
      accountId: event.accountId,
      groupId: event.groupId,
      sourceUid: event.sourceUid,
      category: event.category,
      title: event.title,
      status: event.status,
      severity: event.severity,
      hasUrl: Boolean(event.url),
    })),
    followUp: {
      rootCauseRecorded: Boolean(incident.rootCause),
      resolutionRecorded: Boolean(incident.resolvedReason),
      notesRecorded: incident.notes.length,
      evidenceCount: evidence.length,
    },
  };
}

export function registerLocalIncidentHandlers(): void {
  ipcMain.handle("localIncidents:list", async (): Promise<LocalIncident[]> => {
    return await listLocalIncidents();
  });

  ipcMain.handle("localIncidents:save", async (_event, payload: unknown): Promise<LocalIncident> => {
    return await saveLocalIncident(asInput(payload));
  });

  ipcMain.handle("localIncidents:updateStatus", async (_event, payload: unknown): Promise<LocalIncident> => {
    const req = asRecord(payload);
    const id = asString(req.id, "Incident id");
    const status = asString(req.status, "Incident status") as LocalIncidentStatus;
    return await updateLocalIncidentStatus(id, status, optionalString(req.reason));
  });

  ipcMain.handle("localIncidents:delete", async (_event, payload: unknown): Promise<{ ok: true }> => {
    const req = asRecord(payload);
    await deleteLocalIncident(asString(req.id, "Incident id"));
    return { ok: true };
  });

  ipcMain.handle("localIncidents:export", async (_event, payload: unknown): Promise<{ ok: boolean; filePath?: string }> => {
    const req = asRecord(payload);
    const format = req.format === "json" ? "json" : "markdown";
    const incident = await getLocalIncident(asString(req.id, "Incident id"));
    if (!incident) throw new Error("Incident not found.");
    const result = await dialog.showSaveDialog({
      title: "Export incident report",
      defaultPath: `${safeFilename(incident.title)}.${format === "json" ? "json" : "md"}`,
      filters: [format === "json" ? { name: "JSON", extensions: ["json"] } : { name: "Markdown", extensions: ["md"] }],
    });
    if (result.canceled || !result.filePath) return { ok: false };
    const [events, accounts, groups, metadata] = await Promise.all([getAllEvents(), listAccounts(), listGroups(), listServiceMetadata()]);
    const context = serviceContextForIncident(incident, accounts, groups, metadata);
    const content = format === "json"
      ? JSON.stringify(redactedIncidentExport(incident, events, context), null, 2)
      : incidentReport(incident, events, context);
    await fs.writeFile(result.filePath, content, "utf-8");
    return { ok: true, filePath: result.filePath };
  });

  logger.info("local-incidents", "✓ Local incident handlers registered");
}
