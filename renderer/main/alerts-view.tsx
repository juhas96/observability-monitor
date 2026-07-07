import { useEffect, useMemo, useState } from "react";
import { Bell, BellOff, Download, Edit3, ExternalLink, Plus, Trash2 } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
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
  Switch,
  Text,
  toast,
} from "@glaze/core/components";

import { providerLabel } from "./components/provider-meta";
import { ALL, SEVERITY_FILTER_OPTIONS, type AppliedFilter, FilterMenu, FilterSelectField, optionLabel, useStoredState } from "./components/filters";
import { useAccounts, useGroups } from "./hooks/use-accounts";
import { useChannels } from "./hooks/use-channels";
import { useCheckLatency, useChecks } from "./hooks/use-checks";
import { useHistoryEvents, useHistorySeries } from "./hooks/use-history";
import { useMonitorData } from "./hooks/use-monitor-data";
import { useProviders } from "./hooks/use-providers";
import { useRuleMutations, useRuleStates, useRules } from "./hooks/use-rules";
import { useServiceMetadata } from "./hooks/use-service-metadata";
import { downloadCsv } from "./utils/csv";
import type { Account, AlertRule, AlertRuleInput, ChannelView, CheckSeries, HistoryEvent, HistoryEventType, HistorySample, HttpCheck, ObservabilitySeverity, Provider, ProviderInfo, RuleMetric, RuleOperator, RulePreview, RuleScope, RuleState, ServiceHealth, ServiceMetadata, ServiceTier } from "./types";

type ScopeType = "all" | "group" | "account" | "provider" | "check";
type RuleHealthStatus = "ok" | "firing" | "pending" | "nodata" | "disabled" | "suppressed" | "missingTarget" | "noisy" | "delivery";
const FILTER_KEY = "alerts.filters.v1";
const FILTER_PRESET_KEY = `${FILTER_KEY}.presets`;
const ALERT_RULE_SELECT_KEY = "alerts.select.v1";
const ALERT_RULE_DRAFT_KEY = "alerts.draft.v1";
const ACCOUNT_SELECT_KEY = "accounts.select.v1";
const UPTIME_DRILLDOWN_KEY = "uptime.drilldown.v1";

interface AlertFilters {
  enabled: "all" | "enabled" | "disabled";
  state: "all" | "firing" | "pending" | "ok" | "nodata";
  health: "all" | RuleHealthStatus;
  metric: "all" | RuleMetric;
  scopeType: ScopeType;
  group: string;
  account: string;
  provider: "all" | Provider;
  check: string;
  owner: string;
  tier: "all" | ServiceTier;
  dependency: string;
}

const DEFAULT_FILTERS: AlertFilters = {
  enabled: "all",
  state: "all",
  health: "all",
  metric: "all",
  scopeType: "all",
  group: ALL,
  account: ALL,
  provider: "all",
  check: ALL,
  owner: ALL,
  tier: "all",
  dependency: ALL,
};

const METRIC_OPTIONS: { value: RuleMetric; label: string; unit: string }[] = [
  { value: "failureRate", label: "Failure rate", unit: "%" },
  { value: "latency", label: "Check latency", unit: "ms" },
  { value: "checkDown", label: "Uptime down", unit: "" },
  { value: "openIncidents", label: "Open incidents", unit: "" },
];

const OPERATOR_OPTIONS: { value: RuleOperator; label: string }[] = [
  { value: "gt", label: "greater than" },
  { value: "lt", label: "less than" },
];

interface RuleTemplate {
  id: string;
  title: string;
  description: string;
  input: Omit<AlertRuleInput, "id" | "scope"> & { scopeType: ScopeType; minSeverity?: ObservabilitySeverity | null };
}

const RULE_TEMPLATES: RuleTemplate[] = [
  {
    id: "failure-spike",
    title: "Failure spike",
    description: "Any monitored account crosses a 20% failure rate for 5 minutes.",
    input: {
      name: "Failure rate spike",
      metric: "failureRate",
      operator: "gt",
      threshold: 20,
      scopeType: "all",
      enabled: true,
      channelIds: null,
      minSeverity: null,
      forMinutes: 5,
      cooldownMinutes: 30,
      dedupeMinutes: 30,
    },
  },
  {
    id: "uptime-down",
    title: "Uptime down",
    description: "A selected uptime check is down for 2 minutes.",
    input: {
      name: "Uptime check down",
      metric: "checkDown",
      operator: "gt",
      threshold: 0,
      scopeType: "check",
      enabled: true,
      channelIds: null,
      minSeverity: null,
      forMinutes: 2,
      cooldownMinutes: 15,
      dedupeMinutes: 30,
    },
  },
  {
    id: "latency-regression",
    title: "Latency regression",
    description: "A selected uptime check exceeds 1000ms for 3 minutes.",
    input: {
      name: "Uptime latency regression",
      metric: "latency",
      operator: "gt",
      threshold: 1000,
      scopeType: "check",
      enabled: true,
      channelIds: null,
      minSeverity: null,
      forMinutes: 3,
      cooldownMinutes: 15,
      dedupeMinutes: 30,
    },
  },
  {
    id: "open-incidents",
    title: "Open incidents",
    description: "Any high-severity incident or alert signal appears.",
    input: {
      name: "High-severity incident opened",
      metric: "openIncidents",
      operator: "gt",
      threshold: 0,
      scopeType: "all",
      enabled: true,
      channelIds: null,
      minSeverity: "high",
      forMinutes: 0,
      cooldownMinutes: 30,
      dedupeMinutes: 60,
    },
  },
  {
    id: "provider-failures",
    title: "Provider failures",
    description: "A selected provider has any failed runs or deploys.",
    input: {
      name: "Provider monitor failures",
      metric: "failureRate",
      operator: "gt",
      threshold: 0,
      scopeType: "provider",
      enabled: true,
      channelIds: null,
      minSeverity: null,
      forMinutes: 0,
      cooldownMinutes: 20,
      dedupeMinutes: 30,
    },
  },
];

const NONE = "none";
const SERVICE_TIERS: { value: ServiceTier; label: string }[] = [
  { value: "critical", label: "Critical" },
  { value: "standard", label: "Standard" },
  { value: "internal", label: "Internal" },
  { value: "experimental", label: "Experimental" },
];

const SEVERITY_RANK: Record<ObservabilitySeverity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function metricUnit(metric: RuleMetric): string {
  return METRIC_OPTIONS.find((option) => option.value === metric)?.unit ?? "";
}

function scopeTypeOf(scope: RuleScope): ScopeType {
  if (scope.checkId) return "check";
  if (scope.accountId) return "account";
  if (scope.groupId) return "group";
  if (scope.provider) return "provider";
  return "all";
}

function scopeValueOf(scope: RuleScope): string {
  return scope.checkId ?? scope.accountId ?? scope.groupId ?? scope.provider ?? NONE;
}

function eventTypesForMetric(metric: RuleMetric): HistoryEventType[] {
  if (metric === "openIncidents") return ["alert", "incident"];
  if (metric === "failureRate") return ["failure", "recovery"];
  return ["check"];
}

function eventMatchesSeverity(event: HistoryEvent, minSeverity: ObservabilitySeverity | "all"): boolean {
  if (minSeverity === "all") return true;
  return SEVERITY_RANK[event.severity] >= SEVERITY_RANK[minSeverity];
}

interface RuleHistorySimulation {
  evaluated: number;
  breaches: number;
  latestValue: number | null;
  maxValue: number | null;
  thresholdApplied?: boolean;
  suggestedThreshold?: number;
  suggestionBasis?: string;
  firstBreachAt?: string;
  lastBreachAt?: string;
  note?: string;
}

function numericThreshold(value: string): number | null {
  const threshold = Number(value);
  return Number.isFinite(threshold) ? threshold : null;
}

function formatRuleValue(metric: RuleMetric, value: number | null): string {
  if (value === null) return "—";
  if (metric === "failureRate") return `${value.toFixed(1)}%`;
  if (metric === "latency") return `${Math.round(value)}ms`;
  if (metric === "checkDown") return value > 0 ? "down" : "up";
  return String(Math.round(value));
}

function compareRuleValue(operator: RuleOperator, value: number, threshold: number): boolean {
  return operator === "gt" ? value > threshold : value < threshold;
}

function percentile(values: number[], percentileValue: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(percentileValue * sorted.length) - 1));
  return sorted[index] ?? null;
}

function suggestThreshold(metric: RuleMetric, operator: RuleOperator, values: number[]): { value: number; basis: string } | null {
  if (metric === "checkDown") return null;
  const basisPercentile = operator === "gt" ? 0.95 : 0.05;
  const raw = percentile(values, basisPercentile);
  if (raw === null) return null;
  const basis = operator === "gt" ? "p95 of retained 24h" : "p5 of retained 24h";
  if (metric === "failureRate") return { value: Math.min(100, Math.max(0, Number(raw.toFixed(1)))), basis };
  if (metric === "latency") return { value: Math.max(1, operator === "gt" ? Math.ceil(raw) : Math.floor(raw)), basis };
  return { value: Math.max(0, operator === "gt" ? Math.floor(raw) : Math.ceil(raw)), basis };
}

function thresholdInputValue(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(1)));
}

function simulateSampleRule(
  metric: RuleMetric,
  operator: RuleOperator,
  threshold: number | null,
  samples: HistorySample[],
  minSeverity: ObservabilitySeverity | "all",
): RuleHistorySimulation | null {
  if (metric !== "failureRate" && metric !== "openIncidents") return null;
  const values = samples
    .map((sample) => {
      if (metric === "failureRate") {
        const total = sample.successCount + sample.failureCount;
        return total > 0 ? { ts: sample.ts, value: (100 * sample.failureCount) / total } : null;
      }
      return { ts: sample.ts, value: sample.openIncidentCount + sample.alertCount };
    })
    .filter((value): value is { ts: string; value: number } => value !== null);
  if (values.length === 0) return { evaluated: 0, breaches: 0, latestValue: null, maxValue: null };
  const suggestion = suggestThreshold(metric, operator, values.map((point) => point.value));
  const breaching = threshold === null ? [] : values.filter((point) => compareRuleValue(operator, point.value, threshold));
  return {
    evaluated: values.length,
    breaches: breaching.length,
    latestValue: values[values.length - 1]?.value ?? null,
    maxValue: Math.max(...values.map((point) => point.value)),
    thresholdApplied: threshold !== null,
    suggestedThreshold: suggestion?.value,
    suggestionBasis: suggestion?.basis,
    firstBreachAt: breaching[0]?.ts,
    lastBreachAt: breaching[breaching.length - 1]?.ts,
    note: metric === "openIncidents" && minSeverity !== "all"
      ? "Retained samples count all open incidents/alerts; severity filtering is checked by current preview and recent event evidence."
      : undefined,
  };
}

function sampleAccountGroupId(accountId: string, row: HistorySample["perAccount"][string], accountsById: Map<string, Account>): string | undefined {
  return row.groupId ?? accountsById.get(accountId)?.groupId;
}

function sampleAccountMatchesRule(rule: AlertRule, accountId: string, row: HistorySample["perAccount"][string], accountsById: Map<string, Account>): boolean {
  if (rule.scope.accountId && accountId !== rule.scope.accountId) return false;
  if (rule.scope.groupId && sampleAccountGroupId(accountId, row, accountsById) !== rule.scope.groupId) return false;
  if (rule.scope.provider && row.provider !== rule.scope.provider) return false;
  return true;
}

function simulateRuleFromSamples(rule: AlertRule, samples: HistorySample[], accountsById: Map<string, Account>): RuleHistorySimulation | null {
  if (rule.metric !== "failureRate" && rule.metric !== "openIncidents") return null;
  const values = samples
    .map((sample) => {
      const scopedRows = Object.entries(sample.perAccount).filter(([accountId, row]) => sampleAccountMatchesRule(rule, accountId, row, accountsById));
      if (scopedRows.length === 0) return null;
      if (rule.metric === "failureRate") {
        const counts = scopedRows.reduce((acc, [, row]) => {
          acc.success += row.counts.success;
          acc.failure += row.counts.failure;
          return acc;
        }, { success: 0, failure: 0 });
        const total = counts.success + counts.failure;
        return total > 0 ? { ts: sample.ts, value: (100 * counts.failure) / total } : null;
      }
      const value = scopedRows.reduce((sum, [, row]) => sum + (row.openIncidentCount ?? 0) + (row.alertCount ?? 0), 0);
      return { ts: sample.ts, value };
    })
    .filter((value): value is { ts: string; value: number } => value !== null);
  if (values.length === 0) return { evaluated: 0, breaches: 0, latestValue: null, maxValue: null };
  const suggestion = suggestThreshold(rule.metric, rule.operator, values.map((point) => point.value));
  const breaching = values.filter((point) => compareRuleValue(rule.operator, point.value, rule.threshold));
  return {
    evaluated: values.length,
    breaches: breaching.length,
    latestValue: values[values.length - 1]?.value ?? null,
    maxValue: Math.max(...values.map((point) => point.value)),
    thresholdApplied: true,
    suggestedThreshold: suggestion?.value,
    suggestionBasis: suggestion?.basis,
    firstBreachAt: breaching[0]?.ts,
    lastBreachAt: breaching[breaching.length - 1]?.ts,
    note: rule.metric === "openIncidents" && rule.minSeverity
      ? "Severity is checked against recent event evidence in the editor."
      : undefined,
  };
}

function simulateCheckRule(
  metric: RuleMetric,
  operator: RuleOperator,
  threshold: number | null,
  checkHistory: CheckSeries | undefined,
): RuleHistorySimulation | null {
  if (metric !== "latency" && metric !== "checkDown") return null;
  const values = (checkHistory?.points ?? [])
    .map((point) => {
      if (metric === "latency") return point.latencyMs === null ? null : { ts: point.ts, value: point.latencyMs };
      return { ts: point.ts, value: point.ok ? 0 : 1 };
    })
    .filter((value): value is { ts: string; value: number } => value !== null);
  if (values.length === 0) return { evaluated: 0, breaches: 0, latestValue: null, maxValue: null };
  const suggestion = suggestThreshold(metric, operator, values.map((point) => point.value));
  const breaching = threshold === null ? [] : values.filter((point) => compareRuleValue(operator, point.value, threshold));
  return {
    evaluated: values.length,
    breaches: breaching.length,
    latestValue: values[values.length - 1]?.value ?? null,
    maxValue: Math.max(...values.map((point) => point.value)),
    thresholdApplied: threshold !== null,
    suggestedThreshold: suggestion?.value,
    suggestionBasis: suggestion?.basis,
    firstBreachAt: breaching[0]?.ts,
    lastBreachAt: breaching[breaching.length - 1]?.ts,
  };
}

function shortTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function serviceForRule(rule: AlertRule, services: ServiceHealth[], checks: HttpCheck[]): ServiceHealth | undefined {
  if (rule.scope.groupId) return services.find((service) => service.id === rule.scope.groupId || service.groupId === rule.scope.groupId);
  if (rule.scope.accountId) return services.find((service) => service.accountIds.includes(rule.scope.accountId as string));
  if (rule.scope.checkId) {
    const check = checks.find((candidate) => candidate.id === rule.scope.checkId);
    if (check?.groupId) return services.find((service) => service.id === check.groupId || service.groupId === check.groupId);
  }
  return undefined;
}

function AlertDialog({
  open,
  editing,
  draft,
  onOpenChange,
}: {
  open: boolean;
  editing: AlertRule | null;
  draft: AlertRuleInput | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { save, preview, testDelivery } = useRuleMutations();
  const groupsQuery = useGroups();
  const accountsQuery = useAccounts();
  const providersQuery = useProviders();
  const checksQuery = useChecks();
  const channelsQuery = useChannels();

  const [name, setName] = useState("");
  const [metric, setMetric] = useState<RuleMetric>("failureRate");
  const [operator, setOperator] = useState<RuleOperator>("gt");
  const [threshold, setThreshold] = useState("");
  const [scopeType, setScopeType] = useState<ScopeType>("all");
  const [scopeValue, setScopeValue] = useState(NONE);
  const [enabled, setEnabled] = useState(true);
  const [minSeverity, setMinSeverity] = useState<ObservabilitySeverity | "all">("all");
  const [forMinutes, setForMinutes] = useState("");
  const [cooldownMinutes, setCooldownMinutes] = useState("");
  const [dedupeMinutes, setDedupeMinutes] = useState("");
  const [channelIds, setChannelIds] = useState<string[]>([]);
  const [rulePreview, setRulePreview] = useState<RulePreview | null>(null);

  useMemo(() => {
    if (!open) return;
    const initial = editing ?? draft;
    setName(initial?.name ?? "");
    setMetric(initial?.metric ?? "failureRate");
    setOperator(initial?.operator ?? "gt");
    setThreshold(initial?.threshold != null ? String(initial.threshold) : "");
    setScopeType(initial ? scopeTypeOf(initial.scope) : "all");
    setScopeValue(initial ? scopeValueOf(initial.scope) : NONE);
    setEnabled(initial?.enabled ?? true);
    setMinSeverity(initial?.minSeverity ?? "all");
    setForMinutes(initial?.forMinutes != null ? String(initial.forMinutes) : "");
    setCooldownMinutes(initial?.cooldownMinutes != null ? String(initial.cooldownMinutes) : "");
    setDedupeMinutes(initial?.dedupeMinutes != null ? String(initial.dedupeMinutes) : "");
    setChannelIds(initial?.channelIds ?? []);
    setRulePreview(null);
  }, [open, editing, draft]);

  const channels = channelsQuery.data ?? [];
  const selectedChannels = new Set(channelIds);
  const toggleChannel = (channelId: string, checked: boolean) => {
    setChannelIds((current) => checked ? [...new Set([...current, channelId])] : current.filter((id) => id !== channelId));
  };

  const applyTemplate = (template: RuleTemplate) => {
    const targetOptions = template.input.scopeType === "provider"
      ? (providersQuery.data ?? []).map((provider) => provider.id)
      : template.input.scopeType === "check"
      ? (checksQuery.data ?? []).map((check) => check.id)
      : [];
    setName(template.input.name);
    setMetric(template.input.metric);
    setOperator(template.input.operator);
    setThreshold(String(template.input.threshold));
    setScopeType(template.input.scopeType);
    setScopeValue(template.input.scopeType === "all" ? NONE : targetOptions[0] ?? NONE);
    setEnabled(template.input.enabled ?? true);
    setMinSeverity(template.input.minSeverity ?? "all");
    setForMinutes(template.input.forMinutes != null ? String(template.input.forMinutes) : "");
    setCooldownMinutes(template.input.cooldownMinutes != null ? String(template.input.cooldownMinutes) : "");
    setDedupeMinutes(template.input.dedupeMinutes != null ? String(template.input.dedupeMinutes) : "");
    setChannelIds(template.input.channelIds ?? []);
    setRulePreview(null);
  };

  const scopeOptions = useMemo(() => {
    switch (scopeType) {
      case "group":
        return (groupsQuery.data ?? []).map((group) => ({ value: group.id, label: group.name }));
      case "account":
        return (accountsQuery.data ?? []).map((account) => ({ value: account.id, label: account.label }));
      case "provider":
        return (providersQuery.data ?? []).map((provider) => ({ value: provider.id, label: provider.label }));
      case "check":
        return (checksQuery.data ?? []).map((check) => ({ value: check.id, label: check.name }));
      default:
        return [];
    }
  }, [scopeType, groupsQuery.data, accountsQuery.data, providersQuery.data, checksQuery.data]);

  const historyEventsQuery = useHistoryEvents({
    range: "24h",
    groupId: scopeType === "group" && scopeValue !== NONE ? scopeValue : undefined,
    accountId: scopeType === "account" && scopeValue !== NONE ? scopeValue : undefined,
    provider: scopeType === "provider" && scopeValue !== NONE ? scopeValue : undefined,
    types: eventTypesForMetric(metric),
  });
  const historySeriesQuery = useHistorySeries("24h", {
    groupId: scopeType === "group" && scopeValue !== NONE ? scopeValue : undefined,
    accountId: scopeType === "account" && scopeValue !== NONE ? scopeValue : undefined,
    provider: scopeType === "provider" && scopeValue !== NONE ? scopeValue : undefined,
  });
  const scopedCheckId = scopeType === "check" && scopeValue !== NONE ? scopeValue : "";
  const checkHistoryQuery = useCheckLatency(scopedCheckId, "24h");

  const recentHistoryEvents = useMemo(() => (historyEventsQuery.data ?? [])
    .filter((event) => metric !== "openIncidents" || eventMatchesSeverity(event, minSeverity))
    .slice(0, 5), [historyEventsQuery.data, metric, minSeverity]);
  const checkHistory = checkHistoryQuery.data;
  const checkDownSamples = checkHistory?.points.filter((point) => !point.ok).length ?? 0;
  const historySimulation = useMemo(() => {
    const thresholdValue = numericThreshold(threshold);
    return metric === "latency" || metric === "checkDown"
      ? simulateCheckRule(metric, operator, thresholdValue, checkHistory)
      : simulateSampleRule(metric, operator, thresholdValue, historySeriesQuery.data ?? [], minSeverity);
  }, [checkHistory, historySeriesQuery.data, metric, minSeverity, operator, threshold]);

  const buildScope = (): RuleScope => {
    switch (scopeType) {
      case "group":
        return { groupId: scopeValue };
      case "account":
        return { accountId: scopeValue };
      case "provider":
        return { provider: scopeValue as Provider };
      case "check":
        return { checkId: scopeValue };
      default:
        return {};
    }
  };

  const buildInput = (): AlertRuleInput | null => {
    const value = Number(threshold);
    if (!Number.isFinite(value)) {
      toast.error("Threshold must be a number.");
      return null;
    }
    return {
      id: editing?.id,
      name: name.trim(),
      metric,
      operator,
      threshold: value,
      scope: buildScope(),
      channelIds: channelIds.length > 0 ? channelIds : null,
      enabled,
      minSeverity: metric === "openIncidents" && minSeverity !== "all" ? minSeverity : null,
      forMinutes: forMinutes.trim() !== "" ? Number(forMinutes) : undefined,
      cooldownMinutes: cooldownMinutes.trim() !== "" ? Number(cooldownMinutes) : undefined,
      dedupeMinutes: dedupeMinutes.trim() !== "" ? Number(dedupeMinutes) : undefined,
    };
  };

  const saveRule = async () => {
    const input = buildInput();
    if (!input) return;
    try {
      await save.mutateAsync(input);
      onOpenChange(false);
    } catch (error) {
      toast.error(String(error));
    }
  };

  const previewCurrentRule = async () => {
    const input = buildInput();
    if (!input) return;
    try {
      setRulePreview(await preview.mutateAsync(input));
    } catch (error) {
      toast.error(String(error));
    }
  };

  const sendTest = async () => {
    const input = buildInput();
    if (!input) return;
    try {
      setRulePreview(await testDelivery.mutateAsync(input));
      toast.success("Sent test alert through the selected routing.");
    } catch (error) {
      toast.error(String(error));
    }
  };

  const needsScopeValue = scopeType !== "all";

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Edit rule" : "Add rule"}
      confirmLabel="Save"
      confirmDisabled={name.trim() === "" || threshold.trim() === "" || (needsScopeValue && scopeValue === NONE)}
      onConfirm={saveRule}
      size="medium"
    >
      <FieldSet>
        {!editing ? (
          <div className="grid grid-cols-2 gap-2">
            {RULE_TEMPLATES.map((template) => (
              <button
                key={template.id}
                type="button"
                className="rounded-md border border-separator bg-bg-secondary p-2 text-left transition hover:border-fg-tertiary"
                onClick={() => applyTemplate(template)}
              >
                <Text variant="small" className="block font-medium">{template.title}</Text>
                <Text variant="small" color="tertiary" className="block">{template.description}</Text>
              </button>
            ))}
          </div>
        ) : null}
        <Field label="Name" orientation="vertical" className="p-0">
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="High failure rate" />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Metric" orientation="vertical" className="p-0">
            <Select value={metric} onValueChange={(value) => setMetric(value as RuleMetric)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {METRIC_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Condition" orientation="vertical" className="p-0">
            <Select value={operator} onValueChange={(value) => setOperator(value as RuleOperator)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {OPERATOR_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label={`Threshold ${metricUnit(metric)}`.trim()} orientation="vertical" className="p-0">
            <Input value={threshold} onChange={(event) => setThreshold(event.target.value)} placeholder="10" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Scope" orientation="vertical" className="p-0">
            <Select
              value={scopeType}
              onValueChange={(value) => {
                setScopeType(value as ScopeType);
                setScopeValue(NONE);
              }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All activity</SelectItem>
                <SelectItem value="group">Group</SelectItem>
                <SelectItem value="account">Account</SelectItem>
                <SelectItem value="provider">Provider</SelectItem>
                <SelectItem value="check">Uptime check</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Target" orientation="vertical" className="p-0">
            <Select value={scopeValue} onValueChange={setScopeValue} disabled={!needsScopeValue}>
              <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{needsScopeValue ? "Select…" : "All"}</SelectItem>
                {scopeOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="For (minutes)" orientation="vertical" className="p-0">
            <Input value={forMinutes} onChange={(event) => setForMinutes(event.target.value)} placeholder="0 = instant" />
          </Field>
          <Field label="Cooldown (minutes)" orientation="vertical" className="p-0">
            <Input value={cooldownMinutes} onChange={(event) => setCooldownMinutes(event.target.value)} placeholder="0" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Minimum severity" orientation="vertical" className="p-0">
            <Select value={minSeverity} onValueChange={(value) => setMinSeverity(value as ObservabilitySeverity | "all")} disabled={metric !== "openIncidents"}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SEVERITY_FILTER_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Dedupe window (minutes)" orientation="vertical" className="p-0">
            <Input value={dedupeMinutes} onChange={(event) => setDedupeMinutes(event.target.value)} placeholder="Off" />
          </Field>
        </div>
        {(metric === "latency" || metric === "checkDown") && scopeType !== "check" ? (
          <Callout color="yellow">Uptime check rules only evaluate when scoped to an uptime check.</Callout>
        ) : null}
        {metric === "openIncidents" && minSeverity !== "all" ? (
          <Callout color="secondary">Only open incidents and alert signals at {minSeverity}+ count toward this rule.</Callout>
        ) : null}
        <Field label="Delivery channels" orientation="vertical" className="p-0">
          <div className="flex flex-col gap-2 rounded-md border border-separator p-2">
            {channels.length === 0 ? (
              <Text variant="small" color="secondary">No Slack, Teams, or webhook channels are configured.</Text>
            ) : (
              channels.map((channel) => (
                <div key={channel.id} className="grid grid-cols-[auto_1fr_auto] gap-2 items-center">
                  <Switch
                    checked={selectedChannels.has(channel.id)}
                    onCheckedChange={(checked) => toggleChannel(channel.id, checked)}
                    aria-label={`Route this rule to ${channel.name}`}
                  />
                  <div className="min-w-0">
                    <Text variant="small" truncate className="block">{channel.name}</Text>
                    <Text variant="small" color="tertiary" truncate className="block">
                      {channel.type === "slack" ? "Slack" : channel.type === "teams" ? "Teams" : "Webhook"}{!channel.enabled ? " · disabled" : ""}{!channel.hasUrl ? " · missing URL" : ""}
                    </Text>
                  </div>
                  {channel.events.includes("alert") || channel.events.includes("recovery") ? (
                    <Badge color="secondary">global</Badge>
                  ) : null}
                </div>
              ))
            )}
            <Text variant="small" color="tertiary">
              No selection uses all enabled channels subscribed to alert or recovery events. Selected channels override that global routing.
            </Text>
          </div>
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button variant="glass" size="small" onClick={() => void previewCurrentRule()} disabled={preview.isPending || threshold.trim() === ""}>
            Preview rule
          </Button>
          <Button variant="glass" size="small" onClick={() => void sendTest()} disabled={testDelivery.isPending || threshold.trim() === ""}>
            Send test
          </Button>
        </div>
        {rulePreview ? (
          <Callout color={rulePreview.breaching ? "yellow" : "secondary"}>
            {rulePreview.value === null ? rulePreview.description : `${rulePreview.description} · ${rulePreview.breaching ? "Would fire" : "Would not fire"}`}
          </Callout>
        ) : null}
        <div className="rounded-md border border-separator p-2">
          <div className="flex items-center justify-between gap-2">
            <Text variant="small" className="font-medium">Retained-history simulation</Text>
            <Badge color="secondary">24h</Badge>
          </div>
          {(metric === "latency" || metric === "checkDown" ? checkHistoryQuery.isLoading : historySeriesQuery.isLoading) ? (
            <Text variant="small" color="tertiary">Loading retained samples…</Text>
          ) : historySimulation === null ? (
            <Text variant="small" color="tertiary">This rule cannot be simulated from retained local history.</Text>
          ) : historySimulation.evaluated === 0 ? (
            <Text variant="small" color="tertiary">No retained samples match this rule scope yet.</Text>
          ) : (
            <div className="mt-2 flex flex-col gap-2">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="flex min-w-0 flex-col gap-1 rounded-md bg-bg-secondary p-2">
                  <Text variant="small" color="tertiary" className="block">Samples</Text>
                  <Text variant="strong" className="block">{historySimulation.evaluated}</Text>
                </div>
                <div className="flex min-w-0 flex-col gap-1 rounded-md bg-bg-secondary p-2">
                  <Text variant="small" color="tertiary" className="block">Breaches</Text>
                  <Text variant="strong" className="block">{historySimulation.thresholdApplied ? historySimulation.breaches : "—"}</Text>
                </div>
                <div className="flex min-w-0 flex-col gap-1 rounded-md bg-bg-secondary p-2">
                  <Text variant="small" color="tertiary" className="block">Latest</Text>
                  <Text variant="strong" className="block">{formatRuleValue(metric, historySimulation.latestValue)}</Text>
                </div>
                <div className="flex min-w-0 flex-col gap-1 rounded-md bg-bg-secondary p-2">
                  <Text variant="small" color="tertiary" className="block">Max</Text>
                  <Text variant="strong" className="block">{formatRuleValue(metric, historySimulation.maxValue)}</Text>
                </div>
              </div>
              {historySimulation.suggestedThreshold != null ? (
                <div className="flex flex-wrap items-center gap-2 rounded-md bg-bg-secondary p-2">
                  <div className="min-w-0 flex-1">
                    <Text variant="small" className="font-medium">
                      Suggested threshold {formatRuleValue(metric, historySimulation.suggestedThreshold)}
                    </Text>
                    <Text variant="small" color="tertiary">
                      Based on {historySimulation.suggestionBasis}; apply it, then preview and adjust before saving.
                    </Text>
                  </div>
                  <Button variant="glass" size="small" onClick={() => setThreshold(thresholdInputValue(historySimulation.suggestedThreshold as number))}>
                    Use suggestion
                  </Button>
                </div>
              ) : !historySimulation.thresholdApplied ? (
                <Text variant="small" color="tertiary">Enter a numeric threshold to simulate breach counts against retained history.</Text>
              ) : null}
              {historySimulation.thresholdApplied && historySimulation.breaches > 0 ? (
                <Text variant="small" color="tertiary">
                  First breach {historySimulation.firstBreachAt ? shortTime(historySimulation.firstBreachAt) : "—"} · Last breach {historySimulation.lastBreachAt ? shortTime(historySimulation.lastBreachAt) : "—"}
                </Text>
              ) : null}
              {historySimulation.note ? <Text variant="small" color="tertiary">{historySimulation.note}</Text> : null}
            </div>
          )}
        </div>
        <div className="rounded-md border border-separator p-2">
          <div className="flex items-center justify-between gap-2">
            <Text variant="small" className="font-medium">Recent matching history</Text>
            <Badge color="secondary">24h</Badge>
          </div>
          {metric === "latency" || metric === "checkDown" ? (
            scopedCheckId === "" ? (
              <Text variant="small" color="tertiary">Select an uptime check to show retained check samples.</Text>
            ) : checkHistoryQuery.isLoading ? (
              <Text variant="small" color="tertiary">Loading retained check samples…</Text>
            ) : !checkHistory || checkHistory.points.length === 0 ? (
              <Text variant="small" color="tertiary">No retained check samples for this check yet.</Text>
            ) : (
              <div className="mt-2 grid grid-cols-3 gap-2">
                <div className="flex min-w-0 flex-col gap-1 rounded-md bg-bg-secondary p-2">
                  <Text variant="small" color="tertiary" className="block">Uptime</Text>
                  <Text variant="strong" className="block">{checkHistory.uptime == null ? "—" : `${(checkHistory.uptime * 100).toFixed(2)}%`}</Text>
                </div>
                <div className="flex min-w-0 flex-col gap-1 rounded-md bg-bg-secondary p-2">
                  <Text variant="small" color="tertiary" className="block">Down samples</Text>
                  <Text variant="strong" className="block">{checkDownSamples}</Text>
                </div>
                <div className="flex min-w-0 flex-col gap-1 rounded-md bg-bg-secondary p-2">
                  <Text variant="small" color="tertiary" className="block">Avg latency</Text>
                  <Text variant="strong" className="block">{checkHistory.avgLatencyMs == null ? "—" : `${checkHistory.avgLatencyMs} ms`}</Text>
                </div>
              </div>
            )
          ) : historyEventsQuery.isLoading ? (
            <Text variant="small" color="tertiary">Loading retained history…</Text>
          ) : recentHistoryEvents.length === 0 ? (
            <Text variant="small" color="tertiary">No matching retained events for this scope.</Text>
          ) : (
            <div className="mt-2 flex flex-col gap-1">
              {recentHistoryEvents.map((event) => (
                <div key={event.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
                  <Badge color={event.type === "failure" || event.type === "incident" ? "red" : event.type === "alert" ? "yellow" : "secondary"}>{event.type}</Badge>
                  <Text variant="small" truncate className="block">{event.title}</Text>
                  <Text variant="small" color="tertiary" className="block">{shortTime(event.ts)}</Text>
                </div>
              ))}
            </div>
          )}
        </div>
        <Field label="Enabled" orientation="horizontal" className="p-0">
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </Field>
      </FieldSet>
    </Dialog>
  );
}

function scopeLabel(
  scope: RuleScope,
  groups: Map<string, string>,
  accounts: Map<string, string>,
  checks: Map<string, string>,
): string {
  if (scope.checkId) return `Check · ${checks.get(scope.checkId) ?? scope.checkId}`;
  if (scope.accountId) return `Account · ${accounts.get(scope.accountId) ?? scope.accountId}`;
  if (scope.groupId) return `Group · ${groups.get(scope.groupId) ?? scope.groupId}`;
  if (scope.provider) return `Provider · ${providerLabel(scope.provider)}`;
  return "All activity";
}

function downloadAlertRulesCsv({
  rules,
  statesById,
  healthById,
  historyById,
  groups,
  accounts,
  checks,
  checkList,
  services,
  metadataByService,
}: {
  rules: AlertRule[];
  statesById: Map<string, RuleState>;
  healthById: Map<string, RuleHealth>;
  historyById: Map<string, RuleHistorySimulation>;
  groups: Map<string, string>;
  accounts: Map<string, string>;
  checks: Map<string, string>;
  checkList: HttpCheck[];
  services: ServiceHealth[];
  metadataByService: Map<string, ServiceMetadata>;
}): void {
  const columns = [
    "id",
    "name",
    "enabled",
    "state",
    "health",
    "healthDetail",
    "metric",
    "operator",
    "threshold",
    "currentValue",
    "scope",
    "scopeType",
    "minSeverity",
    "forMinutes",
    "cooldownMinutes",
    "dedupeMinutes",
    "historyEvaluated24h",
    "historyBreaches24h",
    "historyMax24h",
    "historySuggestedThreshold24h",
    "historySuggestionBasis24h",
    "channelCount",
    "snoozedUntil",
    "service",
    "owner",
    "tier",
    "dependencies",
    "createdAt",
    "updatedAt",
  ];
  const rows = rules.map((rule) => {
    const state = statesById.get(rule.id);
    const health = healthById.get(rule.id);
    const history = historyById.get(rule.id);
    const service = serviceForRule(rule, services, checkList);
    const metadata = service ? metadataByService.get(service.id) : undefined;
    const status = state?.firing ? "firing" : state?.breaching ? "pending" : state?.value == null ? "no data" : "ok";
    return [
      rule.id,
      rule.name,
      rule.enabled ? "enabled" : "disabled",
      status,
      health?.label ?? "",
      health?.detail ?? "",
      METRIC_OPTIONS.find((option) => option.value === rule.metric)?.label ?? rule.metric,
      rule.operator === "gt" ? ">" : "<",
      rule.threshold,
      formatValue(rule, state),
      scopeLabel(rule.scope, groups, accounts, checks),
      scopeTypeOf(rule.scope),
      rule.minSeverity ?? "",
      rule.forMinutes ?? "",
      rule.cooldownMinutes ?? "",
      rule.dedupeMinutes ?? "",
      history?.evaluated ?? "",
      history?.breaches ?? "",
      history ? formatRuleValue(rule.metric, history.maxValue) : "",
      history?.suggestedThreshold != null ? formatRuleValue(rule.metric, history.suggestedThreshold) : "",
      history?.suggestionBasis ?? "",
      rule.channelIds?.length ?? 0,
      rule.mutedUntil ?? "",
      service?.name ?? "",
      metadata?.owner ?? "",
      metadata?.tier ?? "",
      (metadata?.dependencies ?? []).join("; "),
      rule.createdAt,
      rule.updatedAt,
    ];
  });
  downloadCsv(`alert-rules-${new Date().toISOString().slice(0, 10)}.csv`, columns, rows);
}

function formatValue(rule: AlertRule, state: RuleState | undefined): string {
  if (!state || state.value === null) return "No data";
  if (rule.metric === "checkDown") return state.value > 0 ? "Down" : "Up";
  const unit = metricUnit(rule.metric);
  const value = rule.metric === "failureRate" ? state.value.toFixed(0) : String(Math.round(state.value));
  return `${value}${unit}`;
}

function ruleToInput(rule: AlertRule, patch: Partial<Omit<AlertRuleInput, "id">> = {}): AlertRuleInput {
  return {
    id: rule.id,
    name: patch.name ?? rule.name,
    metric: patch.metric ?? rule.metric,
    operator: patch.operator ?? rule.operator,
    threshold: patch.threshold ?? rule.threshold,
    scope: patch.scope ?? rule.scope,
    channelIds: "channelIds" in patch ? patch.channelIds : rule.channelIds,
    enabled: patch.enabled ?? rule.enabled,
    minSeverity: "minSeverity" in patch ? patch.minSeverity : rule.minSeverity,
    forMinutes: patch.forMinutes ?? rule.forMinutes,
    cooldownMinutes: patch.cooldownMinutes ?? rule.cooldownMinutes,
    dedupeMinutes: patch.dedupeMinutes ?? rule.dedupeMinutes,
    mutedUntil: "mutedUntil" in patch ? patch.mutedUntil ?? null : rule.mutedUntil,
  };
}

function targetPayloadForRule(rule: AlertRule): { route: "/accounts" | "/uptime"; payload: unknown } | null {
  if (rule.scope.checkId) {
    return {
      route: "/uptime",
      payload: {
        search: rule.scope.checkId,
        status: rule.metric === "checkDown" ? "down" : "all",
      },
    };
  }
  if (rule.scope.accountId) {
    return {
      route: "/accounts",
      payload: { accountId: rule.scope.accountId },
    };
  }
  if (rule.scope.groupId) {
    return {
      route: "/accounts",
      payload: { filters: { group: rule.scope.groupId } },
    };
  }
  if (rule.scope.provider) {
    return {
      route: "/accounts",
      payload: { filters: { provider: rule.scope.provider } },
    };
  }
  return null;
}

interface RuleHealth {
  status: RuleHealthStatus;
  label: string;
  detail: string;
  color: "green" | "yellow" | "red" | "secondary";
}

function ruleHasMissingTarget(
  rule: AlertRule,
  groups: Map<string, string>,
  accounts: Map<string, string>,
  checks: Map<string, string>,
  providers: ProviderInfo[],
): boolean {
  if (rule.scope.checkId) return !checks.has(rule.scope.checkId);
  if (rule.scope.accountId) return !accounts.has(rule.scope.accountId);
  if (rule.scope.groupId) return !groups.has(rule.scope.groupId);
  if (rule.scope.provider) return !providers.some((provider) => provider.id === rule.scope.provider);
  return false;
}

function ruleHasBrokenDelivery(rule: AlertRule, channels: ChannelView[]): boolean {
  if (!rule.channelIds?.length) return false;
  const byId = new Map(channels.map((channel) => [channel.id, channel]));
  return rule.channelIds.some((id) => {
    const channel = byId.get(id);
    return !channel || !channel.enabled || !channel.hasUrl;
  });
}

function ruleLooksNoisy(rule: AlertRule): boolean {
  if (!rule.enabled) return false;
  const immediate = !rule.forMinutes || rule.forMinutes <= 0;
  const noDedupe = !rule.dedupeMinutes || rule.dedupeMinutes <= 0;
  const noCooldown = !rule.cooldownMinutes || rule.cooldownMinutes <= 0;
  const sensitiveThreshold = rule.threshold <= 0 && (rule.metric === "failureRate" || rule.metric === "openIncidents" || rule.metric === "checkDown");
  return immediate && noDedupe && noCooldown && sensitiveThreshold;
}

function classifyRuleHealth(
  rule: AlertRule,
  state: RuleState | undefined,
  groups: Map<string, string>,
  accounts: Map<string, string>,
  checks: Map<string, string>,
  providers: ProviderInfo[],
  channels: ChannelView[],
): RuleHealth {
  const mutedActive = rule.mutedUntil ? new Date(rule.mutedUntil).getTime() > Date.now() : false;
  if (ruleHasMissingTarget(rule, groups, accounts, checks, providers)) {
    return { status: "missingTarget", label: "Missing target", detail: "The scoped account, group, provider, or check no longer exists.", color: "red" };
  }
  if (ruleHasBrokenDelivery(rule, channels)) {
    return { status: "delivery", label: "Delivery issue", detail: "A selected notification channel is disabled, missing its URL, or no longer exists.", color: "yellow" };
  }
  if (mutedActive) return { status: "suppressed", label: "Suppressed", detail: `Snoozed until ${new Date(rule.mutedUntil as string).toLocaleString()}.`, color: "secondary" };
  if (!rule.enabled) return { status: "disabled", label: "Disabled", detail: "Rule is saved but not evaluated.", color: "secondary" };
  if (state?.firing) return { status: "firing", label: "Firing", detail: "Rule has fired and has not recovered.", color: "red" };
  if (state?.breaching) return { status: "pending", label: "Pending", detail: "Threshold is currently breached and waiting for sustain/cooldown logic.", color: "yellow" };
  if (!state || state.value === null) return { status: "nodata", label: "No data", detail: "No current snapshot data matches this rule scope.", color: "yellow" };
  if (ruleLooksNoisy(rule)) return { status: "noisy", label: "Noisy", detail: "Immediate rule with a zero threshold and no dedupe/cooldown.", color: "yellow" };
  return { status: "ok", label: "Healthy", detail: "Rule target and delivery look valid, with current data available.", color: "green" };
}

function RuleCard({
  rule,
  state,
  health,
  scopeText,
  service,
  metadata,
  history,
  historyLoading,
  onEdit,
}: {
  rule: AlertRule;
  state: RuleState | undefined;
  health: RuleHealth;
  scopeText: string;
  service: ServiceHealth | undefined;
  metadata: ServiceMetadata | undefined;
  history: RuleHistorySimulation | undefined;
  historyLoading: boolean;
  onEdit: () => void;
}) {
  const { save, remove } = useRuleMutations();
  const navigate = useNavigate();
  const operator = rule.operator === "gt" ? ">" : "<";
  const mutedActive = rule.mutedUntil ? new Date(rule.mutedUntil).getTime() > Date.now() : false;
  const targetPayload = targetPayloadForRule(rule);
  const historyRatio = history && history.evaluated > 0 ? history.breaches / history.evaluated : 0;
  const historyBadgeColor = historyRatio > 0.5 ? "red" : history && history.breaches > 0 ? "yellow" : "green";
  const suggestedThreshold = history?.suggestedThreshold;
  const canApplySuggestion = suggestedThreshold != null && Math.abs(suggestedThreshold - rule.threshold) > 0.0001;
  const historyDetail = history
    ? history.evaluated === 0
      ? "No retained samples match this rule scope in the last 24h."
      : `${history.breaches}/${history.evaluated} retained 24h samples breached; max ${formatRuleValue(rule.metric, history.maxValue)}${history.suggestedThreshold != null ? `; suggested ${formatRuleValue(rule.metric, history.suggestedThreshold)}` : ""}.`
    : rule.metric === "latency" || rule.metric === "checkDown"
      ? "Open the rule to inspect retained check samples."
      : undefined;
  const snoozeRule = () =>
    save
      .mutateAsync(ruleToInput(rule, { mutedUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString() }))
      .then(() => toast.success("Rule snoozed for 1 hour"))
      .catch((error) => toast.error(String(error)));
  const clearSnooze = () =>
    save
      .mutateAsync(ruleToInput(rule, { mutedUntil: null }))
      .then(() => toast.success("Rule snooze cleared"))
      .catch((error) => toast.error(String(error)));
  const applySuggestedThreshold = () => {
    if (suggestedThreshold == null) return;
    const formatted = formatRuleValue(rule.metric, suggestedThreshold);
    if (!window.confirm(`Update "${rule.name}" threshold to ${formatted}?`)) return;
    void save
      .mutateAsync(ruleToInput(rule, { threshold: suggestedThreshold }))
      .then(() => toast.success("Rule threshold updated."))
      .catch((error) => toast.error(String(error)));
  };
  const deleteRule = async () => {
    if (!window.confirm(`Delete alert rule "${rule.name}"?`)) return;
    try {
      await remove.mutateAsync(rule.id);
      toast.success("Rule deleted.");
    } catch (error) {
      toast.error(String(error));
    }
  };
  const openTarget = () => {
    if (!targetPayload) return;
    localStorage.setItem(targetPayload.route === "/uptime" ? UPTIME_DRILLDOWN_KEY : ACCOUNT_SELECT_KEY, JSON.stringify(targetPayload.payload));
    void navigate({ to: targetPayload.route });
  };

  return (
    <div className="rounded-lg border border-separator p-3 flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <Text variant="strong" truncate className="block">{rule.name}</Text>
        <Text variant="small" color="secondary" truncate className="block">
          {scopeText} · {METRIC_OPTIONS.find((option) => option.value === rule.metric)?.label} {operator} {rule.threshold}
          {metricUnit(rule.metric)}
        </Text>
        <Text variant="small" color="tertiary">Current: {formatValue(rule, state)} · {health.detail}</Text>
        {historyLoading && (rule.metric === "failureRate" || rule.metric === "openIncidents") ? (
          <Text variant="small" color="tertiary">Loading 24h tuning context…</Text>
        ) : historyDetail ? (
          <Text variant="small" color="tertiary">{historyDetail}</Text>
        ) : null}
      </div>
      <Badge color={health.color}>{health.label}</Badge>
      {service ? <Badge color="secondary">{service.name}</Badge> : null}
      {metadata?.owner ? <Badge color="secondary">{metadata.owner}</Badge> : null}
      {metadata?.tier ? <Badge color={metadata.tier === "critical" ? "red" : "secondary"}>{SERVICE_TIERS.find((option) => option.value === metadata.tier)?.label ?? metadata.tier}</Badge> : null}
      {rule.channelIds && rule.channelIds.length > 0 ? <Badge color="secondary">{rule.channelIds.length} channels</Badge> : null}
      {rule.metric === "openIncidents" && rule.minSeverity ? <Badge color="secondary">{rule.minSeverity}+ only</Badge> : null}
      {history && history.evaluated > 0 ? <Badge color={historyBadgeColor}>24h {history.breaches} breaches</Badge> : null}
      {history?.suggestedThreshold != null ? <Badge color="secondary">Suggest {formatRuleValue(rule.metric, history.suggestedThreshold)}</Badge> : null}
      {rule.dedupeMinutes ? <Badge color="secondary">Dedupe {rule.dedupeMinutes}m</Badge> : null}
      {mutedActive ? <Badge color="secondary">Snoozed</Badge> : null}
      {!rule.enabled ? (
        <Badge color="secondary">Disabled</Badge>
      ) : state?.firing ? (
        <Badge color="red">Firing</Badge>
      ) : state?.breaching ? (
        <Badge color="yellow">Pending</Badge>
      ) : (
          <Badge color="green">OK</Badge>
        )}
      {canApplySuggestion ? (
        <Button variant="glass" size="small" onClick={applySuggestedThreshold}>
          Use suggestion
        </Button>
      ) : null}
      <Switch
        checked={rule.enabled}
        onCheckedChange={(checked) =>
          void save
            .mutateAsync(ruleToInput(rule, { enabled: checked }))
            .catch((error) => toast.error(String(error)))
        }
      />
      <Button
        variant="transparent"
        size="small"
        iconOnly
        aria-label={mutedActive ? "Clear rule snooze" : "Snooze rule"}
        onClick={() => void (mutedActive ? clearSnooze() : snoozeRule())}
      >
        {mutedActive ? <Bell className="size-4" /> : <BellOff className="size-4" />}
      </Button>
      {targetPayload ? (
        <Button variant="transparent" size="small" iconOnly aria-label="Open rule target" onClick={openTarget}>
          <ExternalLink className="size-4" />
        </Button>
      ) : null}
      <Button variant="transparent" size="small" iconOnly aria-label="Edit rule" onClick={onEdit}>
        <Edit3 className="size-4" />
      </Button>
      <Button
        variant="transparent"
        size="small"
        iconOnly
        aria-label="Delete rule"
        onClick={() => void deleteRule()}
      >
        <Trash2 className="size-4 text-support-red" />
      </Button>
    </div>
  );
}

export function AlertsView() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AlertRule | null>(null);
  const [draft, setDraft] = useState<AlertRuleInput | null>(null);
  const [storedFilters, setFilters, resetFilters] = useStoredState<AlertFilters>(FILTER_KEY, DEFAULT_FILTERS);
  const filters: AlertFilters = { ...DEFAULT_FILTERS, ...storedFilters };
  const rulesQuery = useRules();
  const statesQuery = useRuleStates();
  const groupsQuery = useGroups();
  const accountsQuery = useAccounts();
  const providersQuery = useProviders();
  const checksQuery = useChecks();
  const channelsQuery = useChannels();
  const snapshotQuery = useMonitorData();
  const serviceMetadataQuery = useServiceMetadata();
  const ruleHistoryQuery = useHistorySeries("24h");
  const setFilter = <K extends keyof AlertFilters>(key: K, value: AlertFilters[K]) => setFilters({ ...filters, [key]: value });

  const statesById = useMemo(() => {
    const map = new Map<string, RuleState>();
    for (const state of statesQuery.data ?? []) map.set(state.ruleId, state);
    return map;
  }, [statesQuery.data]);

  const groupNames = useMemo(() => new Map((groupsQuery.data ?? []).map((g) => [g.id, g.name])), [groupsQuery.data]);
  const accountNames = useMemo(() => new Map((accountsQuery.data ?? []).map((a) => [a.id, a.label])), [accountsQuery.data]);
  const accountsById = useMemo(() => new Map((accountsQuery.data ?? []).map((account) => [account.id, account])), [accountsQuery.data]);
  const checkNames = useMemo(() => new Map((checksQuery.data ?? []).map((c) => [c.id, c.name])), [checksQuery.data]);
  const ruleHealthById = useMemo(() => {
    const map = new Map<string, RuleHealth>();
    for (const rule of rulesQuery.data ?? []) {
      map.set(rule.id, classifyRuleHealth(
        rule,
        statesById.get(rule.id),
        groupNames,
        accountNames,
        checkNames,
        providersQuery.data ?? [],
        channelsQuery.data ?? [],
      ));
    }
    return map;
  }, [accountNames, channelsQuery.data, checkNames, groupNames, providersQuery.data, rulesQuery.data, statesById]);
  const ruleHistoryById = useMemo(() => {
    const map = new Map<string, RuleHistorySimulation>();
    for (const rule of rulesQuery.data ?? []) {
      const simulation = simulateRuleFromSamples(rule, ruleHistoryQuery.data ?? [], accountsById);
      if (simulation) map.set(rule.id, simulation);
    }
    return map;
  }, [accountsById, ruleHistoryQuery.data, rulesQuery.data]);
  const services = snapshotQuery.data?.services ?? [];
  const serviceMetadataById = useMemo(() => new Map((serviceMetadataQuery.data ?? []).map((metadata) => [metadata.serviceId, metadata])), [serviceMetadataQuery.data]);

  useEffect(() => {
    const raw = localStorage.getItem(ALERT_RULE_DRAFT_KEY);
    if (!raw) return;
    localStorage.removeItem(ALERT_RULE_DRAFT_KEY);
    try {
      const parsed = JSON.parse(raw) as AlertRuleInput;
      if (!parsed.name || !parsed.metric || !parsed.operator || parsed.threshold == null || !parsed.scope) return;
      setEditing(null);
      setDraft(parsed);
      setDialogOpen(true);
    } catch {
      // Ignore stale dashboard rule draft payloads.
    }
  }, []);

  useEffect(() => {
    if (!rulesQuery.data) return;
    const raw = localStorage.getItem(ALERT_RULE_SELECT_KEY);
    if (!raw) return;
    localStorage.removeItem(ALERT_RULE_SELECT_KEY);
    try {
      const parsed = JSON.parse(raw) as { ruleId?: unknown };
      const ruleId = typeof parsed.ruleId === "string" ? parsed.ruleId : "";
      const rule = rulesQuery.data.find((candidate) => candidate.id === ruleId);
      if (!rule) return;
      setDraft(null);
      setEditing(rule);
      setDialogOpen(true);
    } catch {
      // Ignore stale command-palette selection payloads.
    }
  }, [rulesQuery.data]);

  const rules = (rulesQuery.data ?? []).filter((rule) => {
    const state = statesById.get(rule.id);
    const service = serviceForRule(rule, services, checksQuery.data ?? []);
    const metadata = service ? serviceMetadataById.get(service.id) : undefined;
    if (filters.enabled === "enabled" && !rule.enabled) return false;
    if (filters.enabled === "disabled" && rule.enabled) return false;
    if (filters.health !== "all" && ruleHealthById.get(rule.id)?.status !== filters.health) return false;
    if (filters.metric !== "all" && rule.metric !== filters.metric) return false;
    if (filters.scopeType !== "all" && scopeTypeOf(rule.scope) !== filters.scopeType) return false;
    if (filters.group !== ALL && rule.scope.groupId !== filters.group) return false;
    if (filters.account !== ALL && rule.scope.accountId !== filters.account) return false;
    if (filters.provider !== "all" && rule.scope.provider !== filters.provider) return false;
    if (filters.check !== ALL && rule.scope.checkId !== filters.check) return false;
    if (filters.owner !== ALL && metadata?.owner !== filters.owner) return false;
    if (filters.tier !== "all" && metadata?.tier !== filters.tier) return false;
    if (filters.dependency !== ALL && !metadata?.dependencies?.includes(filters.dependency)) return false;
    if (filters.state === "firing" && !state?.firing) return false;
    if (filters.state === "pending" && (!state?.breaching || state.firing)) return false;
    if (filters.state === "ok" && (!state || state.value === null || state.firing || state.breaching)) return false;
    if (filters.state === "nodata" && state?.value != null) return false;
    return true;
  });

  const openNew = () => {
    setDraft(null);
    setEditing(null);
    setDialogOpen(true);
  };

  const enabledOptions = [{ value: "all", label: "All rules" }, { value: "enabled", label: "Enabled" }, { value: "disabled", label: "Disabled" }];
  const stateOptions = [{ value: "all", label: "All states" }, { value: "firing", label: "Firing" }, { value: "pending", label: "Pending" }, { value: "ok", label: "OK" }, { value: "nodata", label: "No data" }];
  const healthOptions = [
    { value: "all", label: "All health" },
    { value: "ok", label: "Healthy" },
    { value: "firing", label: "Firing" },
    { value: "pending", label: "Pending" },
    { value: "nodata", label: "No data" },
    { value: "disabled", label: "Disabled" },
    { value: "suppressed", label: "Suppressed" },
    { value: "missingTarget", label: "Missing target" },
    { value: "noisy", label: "Noisy" },
    { value: "delivery", label: "Delivery issue" },
  ];
  const metricOptions = [{ value: "all", label: "All metrics" }, ...METRIC_OPTIONS.map((option) => ({ value: option.value, label: option.label }))];
  const scopeOptions = [{ value: "all", label: "All scopes" }, { value: "group", label: "Group" }, { value: "account", label: "Account" }, { value: "provider", label: "Provider" }, { value: "check", label: "Uptime check" }];
  const groupOptions = [{ value: ALL, label: "All groups" }, ...(groupsQuery.data ?? []).map((group) => ({ value: group.id, label: group.name }))];
  const accountOptions = [{ value: ALL, label: "All accounts" }, ...(accountsQuery.data ?? []).map((account) => ({ value: account.id, label: account.label }))];
  const providerOptions = [{ value: "all", label: "All providers" }, ...(providersQuery.data ?? []).map((provider) => ({ value: provider.id, label: provider.label }))];
  const checkOptions = [{ value: ALL, label: "All checks" }, ...(checksQuery.data ?? []).map((check) => ({ value: check.id, label: check.name }))];
  const ownerOptions = [
    { value: ALL, label: "All owners" },
    ...[...new Set((serviceMetadataQuery.data ?? []).map((metadata) => metadata.owner).filter((owner): owner is string => Boolean(owner)))]
      .sort((a, b) => a.localeCompare(b))
      .map((owner) => ({ value: owner, label: owner })),
  ];
  const tierOptions = [{ value: "all", label: "All tiers" }, ...SERVICE_TIERS];
  const dependencyOptions = [
    { value: ALL, label: "All dependencies" },
    ...[...new Set((serviceMetadataQuery.data ?? []).flatMap((metadata) => metadata.dependencies ?? []))]
      .sort((a, b) => a.localeCompare(b))
      .map((dependency) => ({ value: dependency, label: dependency })),
  ];
  const activeFilters: AppliedFilter[] = [
    filters.enabled !== DEFAULT_FILTERS.enabled
      ? { id: "enabled", label: "Rules", value: optionLabel(enabledOptions, filters.enabled), onClear: () => setFilter("enabled", DEFAULT_FILTERS.enabled) }
      : null,
    filters.state !== DEFAULT_FILTERS.state
      ? { id: "state", label: "State", value: optionLabel(stateOptions, filters.state), onClear: () => setFilter("state", DEFAULT_FILTERS.state) }
      : null,
    filters.health !== DEFAULT_FILTERS.health
      ? { id: "health", label: "Health", value: optionLabel(healthOptions, filters.health), onClear: () => setFilter("health", DEFAULT_FILTERS.health) }
      : null,
    filters.metric !== DEFAULT_FILTERS.metric
      ? { id: "metric", label: "Metric", value: optionLabel(metricOptions, filters.metric), onClear: () => setFilter("metric", DEFAULT_FILTERS.metric) }
      : null,
    filters.scopeType !== DEFAULT_FILTERS.scopeType
      ? { id: "scopeType", label: "Scope", value: optionLabel(scopeOptions, filters.scopeType), onClear: () => setFilter("scopeType", DEFAULT_FILTERS.scopeType) }
      : null,
    filters.group !== DEFAULT_FILTERS.group
      ? { id: "group", label: "Group", value: optionLabel(groupOptions, filters.group), onClear: () => setFilter("group", DEFAULT_FILTERS.group) }
      : null,
    filters.account !== DEFAULT_FILTERS.account
      ? { id: "account", label: "Account", value: optionLabel(accountOptions, filters.account), onClear: () => setFilter("account", DEFAULT_FILTERS.account) }
      : null,
    filters.provider !== DEFAULT_FILTERS.provider
      ? { id: "provider", label: "Provider", value: optionLabel(providerOptions, filters.provider), onClear: () => setFilter("provider", DEFAULT_FILTERS.provider) }
      : null,
    filters.check !== DEFAULT_FILTERS.check
      ? { id: "check", label: "Check", value: optionLabel(checkOptions, filters.check), onClear: () => setFilter("check", DEFAULT_FILTERS.check) }
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
  const exportRules = () => {
    downloadAlertRulesCsv({
      rules,
      statesById,
      healthById: ruleHealthById,
      historyById: ruleHistoryById,
      groups: groupNames,
      accounts: accountNames,
      checks: checkNames,
      checkList: checksQuery.data ?? [],
      services,
      metadataByService: serviceMetadataById,
    });
    toast.success(`Exported ${rules.length} alert ${rules.length === 1 ? "rule" : "rules"}`);
  };

  const actions = (
    <div className="flex min-w-0 items-center gap-2 flex-wrap justify-end">
      <Button variant="glass" size="small" onClick={exportRules} disabled={rules.length === 0}>
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
        <FilterSelectField label="Rules" value={filters.enabled} onChange={(value) => setFilter("enabled", value as AlertFilters["enabled"])} options={enabledOptions} />
        <FilterSelectField label="State" value={filters.state} onChange={(value) => setFilter("state", value as AlertFilters["state"])} options={stateOptions} />
        <FilterSelectField label="Health" value={filters.health} onChange={(value) => setFilter("health", value as AlertFilters["health"])} options={healthOptions} />
        <FilterSelectField label="Metric" value={filters.metric} onChange={(value) => setFilter("metric", value as AlertFilters["metric"])} options={metricOptions} />
        <FilterSelectField label="Scope" value={filters.scopeType} onChange={(value) => setFilter("scopeType", value as ScopeType)} options={scopeOptions} />
        <FilterSelectField label="Group" value={filters.group} onChange={(value) => setFilter("group", value)} options={groupOptions} />
        <FilterSelectField label="Account" value={filters.account} onChange={(value) => setFilter("account", value)} options={accountOptions} />
        <FilterSelectField label="Provider" value={filters.provider} onChange={(value) => setFilter("provider", value as AlertFilters["provider"])} options={providerOptions} />
        <FilterSelectField label="Check" value={filters.check} onChange={(value) => setFilter("check", value)} options={checkOptions} />
        <FilterSelectField label="Owner" value={filters.owner} onChange={(value) => setFilter("owner", value)} options={ownerOptions} />
        <FilterSelectField label="Tier" value={filters.tier} onChange={(value) => setFilter("tier", value as AlertFilters["tier"])} options={tierOptions} />
        <FilterSelectField label="Dependency" value={filters.dependency} onChange={(value) => setFilter("dependency", value)} options={dependencyOptions} />
      </FilterMenu>
      <Button variant="accent" size="large" onClick={openNew}>
        <Plus className="size-4" /> Add rule
      </Button>
    </div>
  );

  return (
    <ScrollArea title="Alert rules" actions={actions} className="h-full">
      <div className="px-2 pb-8 flex flex-col gap-3">
        {(rulesQuery.data ?? []).length === 0 ? (
          <EmptyState
            title="No alert rules"
            description="Create a threshold rule to be notified when failure rate, latency, or incidents cross a limit."
          />
        ) : rules.length === 0 ? (
          <EmptyState
            title="No rules match filters"
            description="Adjust or reset filters to show more rules."
          >
            <Button variant="glass" size="small" onClick={resetFilters}>Reset filters</Button>
          </EmptyState>
        ) : (
          rules.map((rule) => {
            const service = serviceForRule(rule, services, checksQuery.data ?? []);
            const metadata = service ? serviceMetadataById.get(service.id) : undefined;
            return (
              <RuleCard
                key={rule.id}
                rule={rule}
                state={statesById.get(rule.id)}
                health={ruleHealthById.get(rule.id) ?? classifyRuleHealth(rule, statesById.get(rule.id), groupNames, accountNames, checkNames, providersQuery.data ?? [], channelsQuery.data ?? [])}
                scopeText={scopeLabel(rule.scope, groupNames, accountNames, checkNames)}
                service={service}
                metadata={metadata}
                history={ruleHistoryById.get(rule.id)}
                historyLoading={ruleHistoryQuery.isLoading}
                onEdit={() => {
                  setDraft(null);
                  setEditing(rule);
                  setDialogOpen(true);
                }}
              />
            );
          })
        )}
      </div>
      <AlertDialog
        open={dialogOpen}
        editing={editing}
        draft={draft}
        onOpenChange={(open) => {
          if (!open) setDraft(null);
          setDialogOpen(open);
        }}
      />
    </ScrollArea>
  );
}
