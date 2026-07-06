import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Activity, ExternalLink, GitCommitHorizontal, Radio, Search, Siren } from "lucide-react";
import { Badge, Button, Callout, Dialog, ScrollArea, Text, toast } from "@glaze/core/components";

import { monitorApi } from "../ipc";
import type { InvestigationContext, InvestigationTrigger, NormalizedStatus } from "../types";
import { formatRelativeTime } from "./relative-time";
import { INVESTIGATION_CONTEXT_KEY, INVESTIGATION_OPEN_EVENT } from "./investigation";

function readPayload(value: unknown): Partial<InvestigationTrigger> | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<InvestigationTrigger>;
  if (
    typeof candidate.itemUid === "string" ||
    typeof candidate.eventId === "string" ||
    typeof candidate.accountId === "string" ||
    typeof candidate.title === "string"
  ) {
    return candidate;
  }
  return null;
}

function statusColor(status: string | undefined): "green" | "yellow" | "red" | "secondary" | "blue" {
  if (status === "success" || status === "resolved") return "green";
  if (status === "failure" || status === "open") return "red";
  if (status === "warning" || status === "acknowledged" || status === "scheduled") return "yellow";
  if (status === "running" || status === "queued") return "blue";
  return "secondary";
}

function openUrl(url: string | undefined): void {
  if (!url) return;
  void monitorApi.openExternal(url).catch((error) => toast.error(error instanceof Error ? error.message : String(error)));
}

function EvidenceRow({
  title,
  subtitle,
  status,
  time,
  url,
}: {
  title: string;
  subtitle?: string;
  status?: string;
  time?: string;
  url?: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md border border-separator px-2 py-2">
      <div className="min-w-0 flex-1">
        <Text variant="strong" truncate>{title}</Text>
        {subtitle ? <Text variant="small" color="secondary" truncate>{subtitle}</Text> : null}
      </div>
      {time ? <Text variant="small" color="tertiary" className="shrink-0 tabular-nums">{formatRelativeTime(time)}</Text> : null}
      {status ? <Badge color={statusColor(status)}>{status}</Badge> : null}
      {url ? (
        <Button variant="transparent" size="small" iconOnly aria-label="Open evidence" onClick={() => openUrl(url)}>
          <ExternalLink className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center gap-2">
        <Text variant="strong">{title}</Text>
        {typeof count === "number" ? <Badge color="secondary">{count}</Badge> : null}
      </div>
      {children}
    </section>
  );
}

function TriggerSummary({ context }: { context: InvestigationContext }) {
  const trigger = context.trigger;
  const title = trigger.title ?? context.service?.name ?? context.account?.label ?? "Investigation";
  return (
    <div className="rounded-lg border border-separator p-3">
      <div className="flex min-w-0 items-start gap-3">
        <Search className="mt-0.5 size-4 shrink-0 text-tertiary" />
        <div className="min-w-0 flex-1">
          <Text variant="title" truncate>{title}</Text>
          <Text variant="small" color="secondary" truncate>
            {[context.service?.name, context.account?.label, context.group?.name, trigger.provider].filter(Boolean).join(" · ") || "Local evidence context"}
          </Text>
          {trigger.subtitle ? <Text variant="small" color="tertiary" truncate>{trigger.subtitle}</Text> : null}
        </div>
        {trigger.status ? <Badge color={statusColor(String(trigger.status))}>{String(trigger.status)}</Badge> : null}
        {trigger.url ? (
          <Button variant="glass" size="small" onClick={() => openUrl(trigger.url)}>
            <ExternalLink className="size-4" />
            Open
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function ContextLinks({ context }: { context: InvestigationContext }) {
  const metadata = context.serviceMetadata;
  const links = [
    metadata?.runbookUrl ? { label: "Runbook", url: metadata.runbookUrl } : null,
    metadata?.dashboardUrl ? { label: "Service dashboard", url: metadata.dashboardUrl } : null,
    metadata?.repositoryUrl ? { label: "Repository", url: metadata.repositoryUrl } : null,
    ...context.deepLinks.slice(0, 4).map((link) => ({ label: link.label, url: link.url })),
  ].filter((link): link is { label: string; url: string } => Boolean(link));
  return (
    <div className="flex flex-wrap gap-2">
      {metadata?.owner ? <Badge color="secondary">Owner {metadata.owner}</Badge> : null}
      {metadata?.tier ? <Badge color="secondary">Tier {metadata.tier}</Badge> : null}
      {links.map((link) => (
        <Button key={`${link.label}:${link.url}`} variant="glass" size="small" onClick={() => openUrl(link.url)}>
          <ExternalLink className="size-4" />
          {link.label}
        </Button>
      ))}
      {links.length === 0 && !metadata?.owner && !metadata?.tier ? <Text variant="small" color="tertiary">No local service metadata links yet.</Text> : null}
    </div>
  );
}

function InvestigationContent({ context }: { context: InvestigationContext }) {
  return (
    <div className="flex min-h-[520px] flex-col gap-4">
      <TriggerSummary context={context} />
      <ContextLinks context={context} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Section title="Active incidents and signals" count={context.relatedIncidents.length + context.relatedSignals.length}>
          {context.relatedIncidents.length === 0 && context.relatedSignals.length === 0 ? (
            <Text variant="small" color="tertiary">No active incident or alert evidence in the current snapshot.</Text>
          ) : (
            <div className="flex flex-col gap-2">
              {context.relatedIncidents.slice(0, 6).map((incident) => (
                <EvidenceRow key={incident.uid} title={incident.title} subtitle={incident.subtitle} status={incident.status} time={incident.updatedAt} url={incident.url} />
              ))}
              {context.relatedSignals.slice(0, 6).map((signal) => (
                <EvidenceRow key={signal.uid} title={signal.title} subtitle={signal.subtitle} status={signal.status} time={signal.updatedAt} url={signal.url} />
              ))}
            </div>
          )}
        </Section>

        <Section title="Current provider items" count={context.currentItems.length}>
          {context.currentItems.length === 0 ? (
            <Text variant="small" color="tertiary">No current snapshot rows match this investigation scope.</Text>
          ) : (
            <div className="flex flex-col gap-2">
              {context.currentItems.slice(0, 8).map((item) => (
                <EvidenceRow key={item.uid} title={item.title} subtitle={item.subtitle} status={item.status} time={item.updatedAt} url={item.url} />
              ))}
            </div>
          )}
        </Section>

        <Section title="Retained 24h timeline" count={context.relatedEvents.length}>
          {context.relatedEvents.length === 0 ? (
            <Text variant="small" color="tertiary">No retained timeline events match this scope.</Text>
          ) : (
            <div className="flex flex-col gap-2">
              {context.relatedEvents.slice(0, 8).map((event) => (
                <EvidenceRow key={event.id} title={event.title} subtitle={`${event.type} · ${event.provider}`} status={String(event.status)} time={event.ts} url={event.url} />
              ))}
            </div>
          )}
        </Section>

        <Section title="Checks and metrics" count={context.relatedChecks.length + context.relatedMetrics.length}>
          {context.relatedChecks.length === 0 && context.relatedMetrics.length === 0 ? (
            <Text variant="small" color="tertiary">No uptime checks or metric summaries match this scope.</Text>
          ) : (
            <div className="flex flex-col gap-2">
              {context.relatedChecks.slice(0, 5).map((check) => (
                <EvidenceRow key={check.checkId} title={check.name} subtitle={`${check.url} · ${check.latencyMs}ms`} status={check.ok ? "success" : "failure"} time={check.checkedAt} url={check.url} />
              ))}
              {context.relatedMetrics.slice(0, 5).map((metric) => (
                <EvidenceRow key={metric.uid} title={metric.title} subtitle={metric.metrics.map((item) => `${item.label}: ${item.value}${item.unit ? ` ${item.unit}` : ""}`).join(" · ")} status={metric.status as NormalizedStatus} time={metric.updatedAt} url={metric.url} />
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

export function InvestigationDrawer() {
  const [payload, setPayload] = useState<Partial<InvestigationTrigger> | null>(null);
  const [context, setContext] = useState<InvestigationContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const open = Boolean(payload);

  useEffect(() => {
    const onOpen = (event: Event) => {
      const next = readPayload((event as CustomEvent).detail);
      if (next) setPayload(next);
    };
    window.addEventListener(INVESTIGATION_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(INVESTIGATION_OPEN_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!payload) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    monitorApi.getInvestigationContext(payload)
      .then((next) => {
        if (!cancelled) setContext(next);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [payload]);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          localStorage.removeItem(INVESTIGATION_CONTEXT_KEY);
          setPayload(null);
          setContext(null);
          setError(null);
        }
      }}
      title="Investigation"
      description="Local evidence, related events, and provider links for this scope."
      size="2xl"
      showCloseButton
    >
      {loading ? (
        <Callout color="secondary">Assembling investigation context...</Callout>
      ) : error ? (
        <Callout color="red">{error}</Callout>
      ) : context ? (
        <ScrollArea className="max-h-[70vh] pr-2">
          <InvestigationContent context={context} />
        </ScrollArea>
      ) : (
        <Callout color="secondary">Choose an item, event, or service to investigate.</Callout>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-tertiary">
        <Activity className="size-4" />
        <Text variant="small">Uses current snapshot and retained local history only.</Text>
        <Siren className="size-4 ml-2" />
        <GitCommitHorizontal className="size-4" />
        <Radio className="size-4" />
      </div>
    </Dialog>
  );
}
