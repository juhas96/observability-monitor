import { useMemo, useState } from "react";
import { Edit3, Plus, Trash2 } from "lucide-react";
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
import { useAccounts, useGroups } from "./hooks/use-accounts";
import { useChecks } from "./hooks/use-checks";
import { useProviders } from "./hooks/use-providers";
import { useRuleMutations, useRuleStates, useRules } from "./hooks/use-rules";
import type { AlertRule, Provider, RuleMetric, RuleOperator, RuleScope, RuleState } from "./types";

type ScopeType = "all" | "group" | "account" | "provider" | "check";

const METRIC_OPTIONS: { value: RuleMetric; label: string; unit: string }[] = [
  { value: "failureRate", label: "Failure rate", unit: "%" },
  { value: "latency", label: "Check latency", unit: "ms" },
  { value: "openIncidents", label: "Open incidents", unit: "" },
];

const OPERATOR_OPTIONS: { value: RuleOperator; label: string }[] = [
  { value: "gt", label: "greater than" },
  { value: "lt", label: "less than" },
];

const NONE = "none";

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

function AlertDialog({
  open,
  editing,
  onOpenChange,
}: {
  open: boolean;
  editing: AlertRule | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { save } = useRuleMutations();
  const groupsQuery = useGroups();
  const accountsQuery = useAccounts();
  const providersQuery = useProviders();
  const checksQuery = useChecks();

  const [name, setName] = useState("");
  const [metric, setMetric] = useState<RuleMetric>("failureRate");
  const [operator, setOperator] = useState<RuleOperator>("gt");
  const [threshold, setThreshold] = useState("");
  const [scopeType, setScopeType] = useState<ScopeType>("all");
  const [scopeValue, setScopeValue] = useState(NONE);
  const [enabled, setEnabled] = useState(true);
  const [forMinutes, setForMinutes] = useState("");
  const [cooldownMinutes, setCooldownMinutes] = useState("");

  useMemo(() => {
    if (!open) return;
    setName(editing?.name ?? "");
    setMetric(editing?.metric ?? "failureRate");
    setOperator(editing?.operator ?? "gt");
    setThreshold(editing?.threshold != null ? String(editing.threshold) : "");
    setScopeType(editing ? scopeTypeOf(editing.scope) : "all");
    setScopeValue(editing ? scopeValueOf(editing.scope) : NONE);
    setEnabled(editing?.enabled ?? true);
    setForMinutes(editing?.forMinutes != null ? String(editing.forMinutes) : "");
    setCooldownMinutes(editing?.cooldownMinutes != null ? String(editing.cooldownMinutes) : "");
  }, [open, editing]);

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

  const saveRule = async () => {
    const value = Number(threshold);
    if (!Number.isFinite(value)) {
      toast.error("Threshold must be a number.");
      return;
    }
    try {
      await save.mutateAsync({
        id: editing?.id,
        name: name.trim(),
        metric,
        operator,
        threshold: value,
        scope: buildScope(),
        enabled,
        forMinutes: forMinutes.trim() !== "" ? Number(forMinutes) : undefined,
        cooldownMinutes: cooldownMinutes.trim() !== "" ? Number(cooldownMinutes) : undefined,
      });
      onOpenChange(false);
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
        {metric === "latency" && scopeType !== "check" ? (
          <Callout color="yellow">Latency rules only evaluate when scoped to an uptime check.</Callout>
        ) : null}
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

function formatValue(rule: AlertRule, state: RuleState | undefined): string {
  if (!state || state.value === null) return "No data";
  const unit = metricUnit(rule.metric);
  const value = rule.metric === "failureRate" ? state.value.toFixed(0) : String(Math.round(state.value));
  return `${value}${unit}`;
}

function RuleCard({
  rule,
  state,
  scopeText,
  onEdit,
}: {
  rule: AlertRule;
  state: RuleState | undefined;
  scopeText: string;
  onEdit: () => void;
}) {
  const { save, remove } = useRuleMutations();
  const operator = rule.operator === "gt" ? ">" : "<";

  return (
    <div className="rounded-lg border border-separator p-3 flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <Text variant="strong" truncate>{rule.name}</Text>
        <Text variant="small" color="secondary" truncate>
          {scopeText} · {METRIC_OPTIONS.find((option) => option.value === rule.metric)?.label} {operator} {rule.threshold}
          {metricUnit(rule.metric)}
        </Text>
        <Text variant="small" color="tertiary">Current: {formatValue(rule, state)}</Text>
      </div>
      {!rule.enabled ? (
        <Badge color="secondary">Disabled</Badge>
      ) : state?.firing ? (
        <Badge color="red">Firing</Badge>
      ) : state?.breaching ? (
        <Badge color="yellow">Pending</Badge>
      ) : (
        <Badge color="green">OK</Badge>
      )}
      <Switch
        checked={rule.enabled}
        onCheckedChange={(checked) =>
          void save
            .mutateAsync({
              id: rule.id,
              name: rule.name,
              metric: rule.metric,
              operator: rule.operator,
              threshold: rule.threshold,
              scope: rule.scope,
              enabled: checked,
            })
            .catch((error) => toast.error(String(error)))
        }
      />
      <Button variant="transparent" size="small" iconOnly aria-label="Edit rule" onClick={onEdit}>
        <Edit3 className="size-4" />
      </Button>
      <Button
        variant="transparent"
        size="small"
        iconOnly
        aria-label="Delete rule"
        onClick={() => void remove.mutateAsync(rule.id).catch((error) => toast.error(String(error)))}
      >
        <Trash2 className="size-4 text-support-red" />
      </Button>
    </div>
  );
}

export function AlertsView() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AlertRule | null>(null);
  const rulesQuery = useRules();
  const statesQuery = useRuleStates();
  const groupsQuery = useGroups();
  const accountsQuery = useAccounts();
  const checksQuery = useChecks();

  const statesById = useMemo(() => {
    const map = new Map<string, RuleState>();
    for (const state of statesQuery.data ?? []) map.set(state.ruleId, state);
    return map;
  }, [statesQuery.data]);

  const groupNames = useMemo(() => new Map((groupsQuery.data ?? []).map((g) => [g.id, g.name])), [groupsQuery.data]);
  const accountNames = useMemo(() => new Map((accountsQuery.data ?? []).map((a) => [a.id, a.label])), [accountsQuery.data]);
  const checkNames = useMemo(() => new Map((checksQuery.data ?? []).map((c) => [c.id, c.name])), [checksQuery.data]);

  const rules = rulesQuery.data ?? [];

  const openNew = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const actions = (
    <Button variant="accent" size="large" onClick={openNew}>
      <Plus className="size-4" /> Add rule
    </Button>
  );

  return (
    <ScrollArea title="Alert rules" actions={actions} className="h-full">
      <div className="px-2 pb-8 flex flex-col gap-3">
        {rules.length === 0 ? (
          <EmptyState
            title="No alert rules"
            description="Create a threshold rule to be notified when failure rate, latency, or incidents cross a limit."
          />
        ) : (
          rules.map((rule) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              state={statesById.get(rule.id)}
              scopeText={scopeLabel(rule.scope, groupNames, accountNames, checkNames)}
              onEdit={() => {
                setEditing(rule);
                setDialogOpen(true);
              }}
            />
          ))
        )}
      </div>
      <AlertDialog open={dialogOpen} editing={editing} onOpenChange={setDialogOpen} />
    </ScrollArea>
  );
}
