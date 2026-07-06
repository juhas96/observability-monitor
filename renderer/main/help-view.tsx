import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { BookOpen, CircleHelp, ExternalLink, KeyRound, Search, ShieldCheck } from "lucide-react";
import { Badge, Button, Callout, EmptyState, Input, ScrollArea, Text } from "@glaze/core/components";

import { useProviders } from "./hooks/use-providers";
import type { ProviderInfo } from "./types";

interface HelpStep {
  title: string;
  body: string;
}

interface HelpArticle {
  id: string;
  sectionId: string;
  title: string;
  summary: string;
  route?: string;
  steps: HelpStep[];
  outputs: string[];
  gotchas: string[];
  keywords: string[];
}

interface HelpSection {
  id: string;
  title: string;
  summary: string;
}

const HELP_SECTIONS: HelpSection[] = [
  { id: "setup", title: "Setup", summary: "Connect providers, group services, verify credentials, and keep setup portable." },
  { id: "daily", title: "Daily operations", summary: "Use the live operational views for triage and service health." },
  { id: "reliability", title: "Reliability", summary: "Track history, SLOs, uptime checks, alerts, incidents, and timelines." },
  { id: "dashboards", title: "Dashboards and exports", summary: "Build custom dashboards, use filters, and export retained evidence." },
  { id: "settings", title: "Settings and notifications", summary: "Tune polling, retention, notifications, digests, maintenance, and channels." },
  { id: "troubleshooting", title: "Troubleshooting", summary: "Resolve common setup, history, dashboard, and secure storage issues." },
];

const HELP_ARTICLES: HelpArticle[] = [
  {
    id: "first-run",
    sectionId: "setup",
    title: "First-time setup checklist",
    summary: "The shortest path from an empty app to useful monitoring.",
    route: "/accounts",
    steps: [
      { title: "Add at least one provider account", body: "Open Accounts, choose Add account, select a provider, enter the required token and non-secret configuration fields, then test the connection before saving." },
      { title: "Use project groups for services", body: "Assign related provider accounts to the same project group so Apps, Dashboard, Timeline, SLOs, uptime checks, and scoped rules can treat them as one service." },
      { title: "Run live smoke verification", body: "Use Accounts -> Live smoke verification after adding credentials. Leave channel delivery tests disabled unless you intentionally want to send real test messages." },
      { title: "Add reliability surfaces", body: "Create uptime checks, alert rules, and dashboards only after the first poll has produced real account data." },
    ],
    outputs: ["Connected account rows", "Project groups", "Credential diagnostics", "Provider capability matrix", "Smoke verification report"],
    gotchas: ["Imported setup bundles never include tokens, so imported accounts stay disabled until credentials are added.", "History starts after polling; a fresh install will not have trends immediately."],
    keywords: ["setup", "first run", "accounts", "groups", "verification", "diagnostics", "tokens"],
  },
  {
    id: "provider-accounts",
    sectionId: "setup",
    title: "Provider accounts and credentials",
    summary: "How account setup works without exposing secrets.",
    route: "/accounts",
    steps: [
      { title: "Read the provider hint", body: "Each provider declares its required scopes and fields. The add-account dialog is generated from the provider registry." },
      { title: "Separate secrets from configuration", body: "Secret fields are saved through encrypted storage. Non-secret fields such as account ids, project refs, regions, filters, or URLs are saved as local account metadata." },
      { title: "Validate before enabling workflows", body: "Use Test connection when creating or editing an account, then use Run on account diagnostics if a token, permission, rate limit, or provider error appears later." },
      { title: "Refresh intentionally", body: "Use single-account refresh for one integration or Refresh all from the command palette when you need a fresh snapshot across providers." },
    ],
    outputs: ["Encrypted credential entry", "Non-secret account config", "Account identity", "Last sync and stale-state diagnostics"],
    gotchas: ["Leave a secret field blank while editing to keep the current stored secret.", "Do not paste provider tokens into notes, dashboard queries, docs, localStorage, or JSON files."],
    keywords: ["provider", "credential", "secret", "safeStorage", "token", "account", "refresh"],
  },
  {
    id: "portable-setup",
    sectionId: "setup",
    title: "Portable setup import and export",
    summary: "Move app configuration without moving credentials or runtime history.",
    route: "/accounts",
    steps: [
      { title: "Export selected accounts", body: "Use Accounts -> Export setup and choose which accounts to include. Related groups, dashboards, checks, rules, SLOs, settings, channel metadata, service metadata, and UI filters are included when compatible." },
      { title: "Import in merge mode", body: "Use Import setup on another install. The app remaps account, group, check, dashboard, rule, channel, and service metadata references where possible." },
      { title: "Re-add secrets", body: "Imported accounts and channels are intentionally disabled because provider tokens and webhook URLs are excluded from the bundle." },
    ],
    outputs: ["Portable setup JSON", "Imported disabled accounts", "Imported dashboards, rules, checks, SLOs, filters, and metadata"],
    gotchas: ["Runtime history, local incidents, triage state, provider tokens, and webhook URLs are not exported.", "Imported dashboards may skip panels that cannot be matched to local accounts or checks."],
    keywords: ["portable", "setup", "import", "export", "filters", "metadata", "secrets"],
  },
  {
    id: "command-center",
    sectionId: "daily",
    title: "Command Center",
    summary: "Use the first screen to decide what needs attention now.",
    route: "/",
    steps: [
      { title: "Start with current issues", body: "Review the system health band for live failures, warnings, incidents, alert rules, SLO risk, down checks, stale accounts, and notification suppression." },
      { title: "Follow suggested actions", body: "Rows hand off to the exact destination view, such as a specific account diagnostic, uptime check filter, firing alert rule, SLO scope, incident, or dashboard item logs." },
      { title: "Check suppression before paging", body: "Use the suppression panel to see global snooze, maintenance windows, and per-rule snoozes before assuming notifications are broken." },
    ],
    outputs: ["Current issue count", "Suggested next actions", "Live attention queue", "Firing rule evidence", "SLO risk evidence", "Suppression status"],
    gotchas: ["Command Center summarizes existing data; it does not add storage or provider calls beyond the shared app queries.", "A clean page with no accounts may still need setup rather than triage."],
    keywords: ["command center", "summary", "issues", "suppression", "slo", "alerts", "incidents"],
  },
  {
    id: "dashboard",
    sectionId: "daily",
    title: "Detailed Dashboard",
    summary: "Review live provider rows grouped by project and account.",
    route: "/dashboard",
    steps: [
      { title: "Filter the current view", body: "Use date, group, provider, account, status, category, owner, tier, and dependency filters to narrow live rows and retained activity." },
      { title: "Open evidence", body: "Use row actions to open provider pages, inspect logs when available, start an investigation, or draft an alert rule from a failure or incident." },
      { title: "Export the filtered evidence", body: "Export CSV to capture account summaries, current monitor items, and retained activity rows with provider, account, group, status, category, link, and service metadata." },
    ],
    outputs: ["Grouped account sections", "Current monitor rows", "Activity in range", "Log/detail dialogs", "Filtered CSV"],
    gotchas: ["Live log polling is available only for providers that expose it.", "Retained activity depends on local history retention and polling cadence."],
    keywords: ["dashboard", "logs", "activity", "csv", "filters", "provider rows"],
  },
  {
    id: "apps",
    sectionId: "daily",
    title: "Apps cockpit and service metadata",
    summary: "Turn provider accounts into service-level health views.",
    route: "/apps",
    steps: [
      { title: "Select a service", body: "Apps derives services from project groups and accounts. Select a service to inspect provider coverage, active incidents, signals, metric summaries, uptime checks, deep links, and recent activity." },
      { title: "Add local metadata", body: "Edit service metadata to store owner, tier, runbook URL, dashboard URL, repository URL, dependencies, and notes." },
      { title: "Use metadata in workflows", body: "Owner, tier, runbook, dashboard, repository, and dependency context appears in filters, incident workflows, and alert channel payloads when the scope maps to a service." },
    ],
    outputs: ["Service health contributors", "Provider coverage", "Deep links", "Dependency overview", "Service metadata"],
    gotchas: ["Service metadata is local only and does not write back to providers.", "Apps needs at least one account and a poll snapshot before health can be derived."],
    keywords: ["apps", "services", "owner", "tier", "runbook", "dependencies", "metadata"],
  },
  {
    id: "insights",
    sectionId: "reliability",
    title: "Insights and SLOs",
    summary: "Analyze retained history and track local error budgets.",
    route: "/insights",
    steps: [
      { title: "Choose a retained-history range", body: "Use relative or custom ranges to view success/failure trends, activity volume, alert volume, and retained history exports." },
      { title: "Create an SLO", body: "Add an SLO with a group, provider, or account scope, target percentage, and window. The app calculates compliance, remaining budget, burn rate, and risk from retained samples." },
      { title: "Export evidence", body: "Export retained events or samples, or export the visible SLO cards as CSV for review." },
    ],
    outputs: ["Trend charts", "SLO compliance", "Error budget", "Burn rate", "Filtered history exports"],
    gotchas: ["SLOs use local samples only, so short retention windows limit historical evidence.", "No-history and filter-miss states are different: reset filters before assuming data is missing."],
    keywords: ["insights", "slo", "error budget", "history", "retention", "export"],
  },
  {
    id: "incidents",
    sectionId: "reliability",
    title: "Incident center",
    summary: "Consolidate live provider signals with durable local incident work.",
    route: "/incidents",
    steps: [
      { title: "Review live and local incidents", body: "The Incident center shows provider incidents/signals and durable local incidents in one workspace with filters for group, provider, account, severity, status, owner, tier, and dependency." },
      { title: "Create a local incident", body: "Create incidents manually or from Dashboard, Apps, Timeline, or Uptime evidence. Local incidents can store notes, assignee, root cause, resolution, and linked retained events." },
      { title: "Export reports", body: "Export a structured Markdown incident report or redacted JSON. Provider URLs and service context are included where appropriate, but secrets are not." },
    ],
    outputs: ["Investigation workspace", "Evidence summaries", "Notes", "Lifecycle timeline", "Markdown report", "Redacted JSON"],
    gotchas: ["Acknowledging or silencing local triage state does not acknowledge incidents in external providers.", "Local incidents are excluded from portable setup exports."],
    keywords: ["incidents", "triage", "investigation", "postmortem", "notes", "report"],
  },
  {
    id: "timeline",
    sectionId: "reliability",
    title: "Correlation Timeline",
    summary: "Correlate deploys, failures, recoveries, alerts, and incidents.",
    route: "/timeline",
    steps: [
      { title: "Pick lanes and filters", body: "Display retained events by group or provider, then filter by date range, event type, status, severity, category, account, owner, tier, or dependency." },
      { title: "Act from evidence", body: "Open provider evidence, create a local incident, or draft a scoped alert rule from retained failure, alert, or incident events." },
      { title: "Export the view", body: "Export the currently filtered retained events as CSV with provider, account, group, status, severity, category, source, and link fields." },
    ],
    outputs: ["Event correlation chart", "Filtered event rows", "Incident and alert-rule handoffs", "CSV export"],
    gotchas: ["Timeline is retained-history based; if polling has not recorded events yet, it will be empty.", "Group filters fall back to current account group metadata for older events missing group ids."],
    keywords: ["timeline", "correlation", "deploy", "failure", "recovery", "alert", "incident"],
  },
  {
    id: "uptime",
    sectionId: "reliability",
    title: "Uptime checks",
    summary: "Probe HTTP endpoints every poll cycle and track latency.",
    route: "/uptime",
    steps: [
      { title: "Add a check", body: "Create an HTTP check with name, URL, method, optional expected status, optional project group, and enabled state." },
      { title: "Review current and historical state", body: "Each check shows up/down state, latest status or error, latency, uptime percentage, and retained latency sparkline." },
      { title: "Act on down checks", body: "Open the endpoint, start an incident, edit or delete the check, or create a check-down alert rule." },
    ],
    outputs: ["Current check result", "Latency history", "Uptime percentage", "Down-check alert draft", "Filtered CSV"],
    gotchas: ["Checks run from the local app during polling and may see different network behavior than external monitors.", "Latency history depends on retained check samples."],
    keywords: ["uptime", "checks", "http", "latency", "down", "synthetic"],
  },
  {
    id: "alert-rules",
    sectionId: "reliability",
    title: "Alert rules",
    summary: "Create threshold rules for local reliability signals.",
    route: "/alerts",
    steps: [
      { title: "Choose a metric and scope", body: "Rules can track failure rate, check latency, check down, or open incidents. Scope them to all data, a group, provider, account, or uptime check where the metric supports it." },
      { title: "Tune delivery behavior", body: "Use sustained breach, cooldown, dedupe, incident severity, enabled state, per-rule snooze, and optional Slack/webhook channel routing." },
      { title: "Use previews and suggestions", body: "Preview against the current snapshot and use 24h retained-history simulation plus suggested thresholds for sample-backed rules." },
    ],
    outputs: ["Rule health badge", "Current value", "Firing state", "Retained-history tuning", "Notification and channel dispatch"],
    gotchas: ["Check-down rules only evaluate when scoped to an uptime check.", "Suppressed, disabled, missing-target, no-data, noisy, and delivery-issue badges explain why a rule may not notify."],
    keywords: ["alerts", "rules", "threshold", "failure rate", "latency", "channels", "snooze"],
  },
  {
    id: "custom-dashboards",
    sectionId: "dashboards",
    title: "Custom Dashboards",
    summary: "Build persistent local and live provider dashboards.",
    route: "/dashboards",
    steps: [
      { title: "Create from scratch or template", body: "Create dashboards manually or from templates, then add panels for local monitor history, uptime checks, snapshot stats, retained events, or provider-declared live query capabilities." },
      { title: "Configure panels", body: "Choose visualization, width, height, range override, refresh override, source scope, default panel, custom query, provider params, and x/y mappings where applicable." },
      { title: "Use variables and runtime filters", body: "Dashboard variables persist non-secret defaults for group, provider, account, check, owner, tier, and dependency. Runtime filters temporarily override local panels unless a panel has a narrower explicit scope." },
      { title: "Import, export, and copy", body: "Export dashboards without secrets, import compatible dashboards, duplicate dashboards, and copy panels between dashboards." },
    ],
    outputs: ["Timeseries, stat, table, log, trace, and event panels", "Row links", "Panel CSV export", "Dashboard JSON export"],
    gotchas: ["Live provider panels never receive dashboard runtime filters; they use their configured account, capability, params, and query.", "Custom SQL or HogQL panels are read-only, SELECT-only, semicolon-free, and capped by provider limits."],
    keywords: ["dashboards", "panels", "recharts", "provider query", "variables", "import", "export"],
  },
  {
    id: "filters-exports",
    sectionId: "dashboards",
    title: "Filters, presets, and exports",
    summary: "Use consistent filtering and CSV exports across data-heavy views.",
    steps: [
      { title: "Open Filters", body: "Most views use a Filters popover with applied-filter chips. Date-backed views support relative and custom ranges bounded by retained history." },
      { title: "Save useful views", body: "Create saved filter presets, update or rename them, delete stale presets, and pin one as the default for a tab when no stored filter state exists." },
      { title: "Export after filtering", body: "Export CSV from each view after applying filters. Exports contain visible or scoped metadata and never include provider tokens or notification webhook URLs." },
    ],
    outputs: ["Applied filter chips", "Saved presets", "Pinned defaults", "Per-view CSV exports"],
    gotchas: ["Portable setup exports include only allowlisted UI filter state and presets.", "Reset filters before treating an empty view as missing data."],
    keywords: ["filters", "presets", "csv", "export", "date range", "localStorage"],
  },
  {
    id: "settings",
    sectionId: "settings",
    title: "Settings, polling, retention, digest, and maintenance",
    summary: "Tune how the app polls, stores local history, and suppresses notifications.",
    steps: [
      { title: "Set polling and notifications", body: "Use Settings to control poll interval, failure/success notifications, notify-only-on-change, notification sound, launch at login, and temporary snooze." },
      { title: "Manage retained history", body: "Choose retention days, inspect retained sample/event/check/SLO counts and storage size, apply retention now, or clear retained history while keeping SLO definitions." },
      { title: "Schedule digests", body: "Enable a daily or weekly digest and choose the hour for health summary notifications and channel dispatch." },
      { title: "Create maintenance windows", body: "Add recurring maintenance windows scoped to all data, group, account, provider, or check. Active windows suppress matching alert delivery." },
    ],
    outputs: ["Polling settings", "History retention stats", "Digest schedule", "Notification snooze", "Scoped maintenance windows"],
    gotchas: ["Maintenance and snooze suppress notifications; they do not pause polling or erase data.", "Clear retained history removes samples, events, and check samples, but leaves SLO definitions."],
    keywords: ["settings", "polling", "retention", "digest", "maintenance", "snooze", "notifications"],
  },
  {
    id: "notification-channels",
    sectionId: "settings",
    title: "Notification channels",
    summary: "Forward failures, recoveries, alerts, successes, and digests to Slack or webhooks.",
    steps: [
      { title: "Add a channel", body: "Open Settings -> Notification channels, choose Slack or generic webhook, enter a display name and webhook URL, and save." },
      { title: "Choose event kinds", body: "Toggle which event kinds each channel receives: failures, successes, alerts, recoveries, and digests." },
      { title: "Test intentionally", body: "Use per-channel Test for a single real delivery test. Smoke verification channel tests are opt-in because they also send real messages." },
    ],
    outputs: ["Channel metadata", "Encrypted webhook URL", "Event subscriptions", "Delivery tests", "Filtered channel CSV"],
    gotchas: ["Webhook URLs are stored encrypted and never returned to the renderer after save.", "Channel metadata can be exported, but webhook URLs are never included."],
    keywords: ["channels", "slack", "webhook", "notification", "digest", "test"],
  },
  {
    id: "common-issues",
    sectionId: "troubleshooting",
    title: "Common issues",
    summary: "How to interpret the most common empty, warning, and error states.",
    steps: [
      { title: "Auth or permission errors", body: "Run account diagnostics, confirm the provider token has the read scopes listed in the provider setup reference, then edit the account and test the connection." },
      { title: "Missing token", body: "A missing-token diagnostic means the account metadata exists but encrypted storage has no secret for it. Edit the account and enter the secret field again." },
      { title: "Stale accounts", body: "A stale account means recent polling has not produced fresh data. Refresh the account, check provider availability, and inspect retry backoff details." },
      { title: "No history or no SLO data", body: "Wait for polling to record samples, widen the date range, reset filters, or increase retention if older data has already been pruned." },
      { title: "No dashboard capabilities", body: "Run diagnostics. Local panels need connected accounts or checks; live provider panels require adapters that expose dashboard capabilities and credentials/config that allow them to load." },
      { title: "Encrypted storage unavailable", body: "If secure storage is unavailable, the app refuses to save account secrets safely. Fix the macOS secure storage environment before adding credentials." },
    ],
    outputs: ["Diagnostic category", "Backoff detail", "Filter-miss versus no-data empty state", "Capability availability detail"],
    gotchas: ["Never work around secure storage by placing tokens in plain JSON, docs, notes, dashboard queries, or localStorage.", "Some provider endpoints are best-effort and require live credentials to validate."],
    keywords: ["troubleshooting", "auth", "permission", "rate limit", "stale", "missing token", "no history", "encrypted storage"],
  },
];

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function articleText(article: HelpArticle): string {
  return [
    article.title,
    article.summary,
    ...article.steps.flatMap((step) => [step.title, step.body]),
    ...article.outputs,
    ...article.gotchas,
    ...article.keywords,
  ].join(" ");
}

function providerSearchText(provider: ProviderInfo): string {
  return [
    provider.label,
    provider.scopeHint,
    ...provider.fields.flatMap((field) => [field.label, field.key, field.placeholder ?? "", field.required ? "required" : "optional", field.secret ? "secret token credential" : "non-secret config"]),
  ].join(" ");
}

function sectionLabel(sectionId: string): string {
  return HELP_SECTIONS.find((section) => section.id === sectionId)?.title ?? sectionId;
}

function ProviderReference({ providers }: { providers: ProviderInfo[] }) {
  return (
    <section id="provider-reference" className="rounded-lg border border-separator p-3">
      <div className="mb-3 flex items-start gap-3">
        <KeyRound className="mt-0.5 size-4 text-tertiary" />
        <div className="min-w-0">
          <Text variant="strong">Provider setup reference</Text>
          <Text variant="small" color="secondary">
            This reference is rendered from the live provider registry metadata returned by providers:list. It lists fields and scope hints, not credential values.
          </Text>
        </div>
      </div>

      {providers.length === 0 ? (
        <Callout color="secondary">Provider metadata is still loading.</Callout>
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {providers.map((provider) => {
            const requiredFields = provider.fields.filter((field) => field.required);
            const optionalFields = provider.fields.filter((field) => !field.required);
            return (
              <article key={provider.id} className="rounded-md border border-separator p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Text variant="strong">{provider.label}</Text>
                    <Text variant="small" color="secondary">{provider.scopeHint}</Text>
                  </div>
                  <Badge color="secondary">{provider.fields.length} fields</Badge>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2">
                  <FieldList title="Required" fields={requiredFields} />
                  <FieldList title="Optional" fields={optionalFields} empty="No optional fields" />
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function FieldList({
  title,
  fields,
  empty = "No fields",
}: {
  title: string;
  fields: ProviderInfo["fields"];
  empty?: string;
}) {
  return (
    <div>
      <Text variant="small" color="tertiary">{title}</Text>
      {fields.length === 0 ? (
        <Text variant="small" color="secondary">{empty}</Text>
      ) : (
        <div className="mt-1 flex flex-wrap gap-1">
          {fields.map((field) => (
            <Badge key={field.key} color={field.secret ? "yellow" : "secondary"}>
              {field.label} - {field.secret ? "encrypted secret" : "local config"}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function ArticleCard({ article }: { article: HelpArticle }) {
  const navigate = useNavigate();
  return (
    <article id={article.id} className="rounded-lg border border-separator p-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <Text variant="strong">{article.title}</Text>
            <Badge color="secondary">{sectionLabel(article.sectionId)}</Badge>
          </div>
          <Text variant="small" color="secondary">{article.summary}</Text>
        </div>
        {article.route ? (
          <Button variant="glass" size="small" onClick={() => void navigate({ to: article.route })}>
            Open view
            <ExternalLink className="size-4" />
          </Button>
        ) : null}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.6fr)]">
        <div className="rounded-md border border-separator">
          {article.steps.map((step, index) => (
            <div key={step.title} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-2 border-t border-separator p-3 first:border-t-0">
              <div className="flex size-6 items-center justify-center rounded-md bg-control-subtle text-xs tabular-nums text-secondary">{index + 1}</div>
              <div className="min-w-0">
                <Text variant="strong" className="block">{step.title}</Text>
                <Text variant="small" color="secondary">{step.body}</Text>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-3">
          <InfoList title="What you should see" items={article.outputs} />
          <InfoList title="Gotchas" items={article.gotchas} />
        </div>
      </div>
    </article>
  );
}

function InfoList({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="rounded-md border border-separator p-3">
      <Text variant="strong" className="block">{title}</Text>
      <div className="mt-2 flex flex-col gap-2">
        {items.map((item) => (
          <div key={item} className="grid grid-cols-[auto_minmax(0,1fr)] gap-2">
            <span className="mt-1 size-1.5 rounded-full bg-secondary" />
            <Text variant="small" color="secondary">{item}</Text>
          </div>
        ))}
      </div>
    </section>
  );
}

export function HelpView() {
  const providersQuery = useProviders();
  const [query, setQuery] = useState("");
  const [sectionId, setSectionId] = useState<string>("all");
  const providers = providersQuery.data ?? [];
  const normalizedQuery = normalize(query);

  const visibleArticles = useMemo(() => {
    return HELP_ARTICLES.filter((article) => {
      if (sectionId !== "all" && article.sectionId !== sectionId) return false;
      if (!normalizedQuery) return true;
      return normalize(articleText(article)).includes(normalizedQuery);
    });
  }, [normalizedQuery, sectionId]);

  const visibleProviders = useMemo(() => {
    if (!normalizedQuery) return providers;
    return providers.filter((provider) => normalize(providerSearchText(provider)).includes(normalizedQuery));
  }, [normalizedQuery, providers]);

  const actions = (
    <div className="flex min-w-0 items-center gap-2">
      <Search className="size-4 text-tertiary" />
      <Input
        className="w-64"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search docs, setup, token, alerts..."
      />
    </div>
  );

  return (
    <ScrollArea title="Help" actions={actions} className="h-full">
      <div className="flex flex-col gap-4 px-2 pb-8">
        <section className="rounded-lg border border-separator p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 max-w-3xl">
              <div className="mb-2 flex items-center gap-2 text-secondary">
                <CircleHelp className="size-5" />
                <Text variant="small" color="secondary">Multi Monitor user docs</Text>
              </div>
              <h1 className="text-2xl font-semibold tracking-normal text-primary">Set up and operate the app from one place.</h1>
              <Text variant="small" color="secondary" className="mt-2">
                These guides cover provider setup, daily operations, reliability workflows, dashboards, settings, notifications, exports, and troubleshooting from a user perspective.
              </Text>
            </div>
            <div className="grid grid-cols-2 gap-2 lg:min-w-72">
              <div className="rounded-md border border-separator p-2">
                <Text variant="small" color="tertiary">Guides</Text>
                <div className="mt-1 text-xl font-semibold tabular-nums text-primary">{HELP_ARTICLES.length}</div>
              </div>
              <div className="rounded-md border border-separator p-2">
                <Text variant="small" color="tertiary">Providers</Text>
                <div className="mt-1 text-xl font-semibold tabular-nums text-primary">{providers.length}</div>
              </div>
            </div>
          </div>
          <div className="mt-4">
            <Callout color="secondary" icon={<ShieldCheck />}>
              User-facing functionality changes should update these in-app docs in the same change. Secrets, tokens, and webhook URLs must never be written into docs or exported setup files.
            </Callout>
          </div>
        </section>

        <section className="rounded-lg border border-separator p-3">
          <div className="mb-3 flex items-center gap-2">
            <BookOpen className="size-4 text-tertiary" />
            <Text variant="strong">Browse by area</Text>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant={sectionId === "all" ? "accent" : "glass"} size="small" onClick={() => setSectionId("all")}>
              All docs
            </Button>
            {HELP_SECTIONS.map((section) => (
              <Button key={section.id} variant={sectionId === section.id ? "accent" : "glass"} size="small" onClick={() => setSectionId(section.id)}>
                {section.title}
              </Button>
            ))}
          </div>
          {sectionId !== "all" ? (
            <Text variant="small" color="secondary" className="mt-3">
              {HELP_SECTIONS.find((section) => section.id === sectionId)?.summary}
            </Text>
          ) : null}
        </section>

        {visibleArticles.length === 0 && visibleProviders.length === 0 ? (
          <EmptyState title="No help results" description="Try a different search, or clear the search to browse all guides." />
        ) : null}

        {visibleArticles.length > 0 ? (
          <section className="flex flex-col gap-3">
            {visibleArticles.map((article) => <ArticleCard key={article.id} article={article} />)}
          </section>
        ) : null}

        {visibleProviders.length > 0 ? <ProviderReference providers={visibleProviders} /> : null}
      </div>
    </ScrollArea>
  );
}
