import { useMemo, useState } from "react";
import { Edit3, Plus, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
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

import { LineChart, type ChartPoint } from "./components/charts";
import { useGroups } from "./hooks/use-accounts";
import { useChecks, useCheckLatency, useCheckMutations } from "./hooks/use-checks";
import { useMonitorData } from "./hooks/use-monitor-data";
import type { HistoryRange, HttpCheck, HttpCheckResult } from "./types";

const RANGE_OPTIONS: { value: HistoryRange; label: string }[] = [
  { value: "1h", label: "1 hour" },
  { value: "6h", label: "6 hours" },
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "14d", label: "14 days" },
];

const NONE = "none";
const METHODS = ["GET", "HEAD", "POST"];

function timeLabel(ts: string): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function pct(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${(value * 100).toFixed(2)}%`;
}

function StatCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-lg border border-separator p-3">
      <Text variant="small" color="tertiary">{label}</Text>
      <Text variant="strong">{value}</Text>
      {detail ? <Text variant="small" color="secondary">{detail}</Text> : null}
    </div>
  );
}

function CheckDialog({
  open,
  editing,
  onOpenChange,
}: {
  open: boolean;
  editing: HttpCheck | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { save } = useCheckMutations();
  const groupsQuery = useGroups();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [method, setMethod] = useState("GET");
  const [expectedStatus, setExpectedStatus] = useState("");
  const [groupId, setGroupId] = useState(NONE);
  const [enabled, setEnabled] = useState(true);

  // Seed the form whenever the dialog opens for a (new or existing) check.
  useMemo(() => {
    if (!open) return;
    setName(editing?.name ?? "");
    setUrl(editing?.url ?? "");
    setMethod(editing?.method ?? "GET");
    setExpectedStatus(editing?.expectedStatus ? String(editing.expectedStatus) : "");
    setGroupId(editing?.groupId ?? NONE);
    setEnabled(editing?.enabled ?? true);
  }, [open, editing]);

  const saveCheck = async () => {
    const expected = Number(expectedStatus);
    try {
      await save.mutateAsync({
        id: editing?.id,
        name: name.trim(),
        url: url.trim(),
        method,
        expectedStatus: expectedStatus.trim() !== "" && Number.isFinite(expected) ? expected : undefined,
        groupId: groupId === NONE ? undefined : groupId,
        enabled,
      });
      onOpenChange(false);
    } catch (error) {
      toast.error(String(error));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Edit check" : "Add check"}
      confirmLabel="Save"
      confirmDisabled={name.trim() === "" || url.trim() === ""}
      onConfirm={saveCheck}
      size="medium"
    >
      <FieldSet>
        <Field label="Name" orientation="vertical" className="p-0">
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="API health" />
        </Field>
        <Field label="URL" orientation="vertical" className="p-0">
          <Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://api.example.com/health" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Method" orientation="vertical" className="p-0">
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Expected status (optional)" orientation="vertical" className="p-0">
            <Input value={expectedStatus} onChange={(event) => setExpectedStatus(event.target.value)} placeholder="200" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Group" orientation="vertical" className="p-0">
            <Select value={groupId} onValueChange={setGroupId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No group</SelectItem>
                {(groupsQuery.data ?? []).map((group) => <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Enabled" orientation="vertical" className="p-0">
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </Field>
        </div>
      </FieldSet>
    </Dialog>
  );
}

function CheckCard({
  check,
  result,
  range,
  onEdit,
}: {
  check: HttpCheck;
  result: HttpCheckResult | undefined;
  range: HistoryRange;
  onEdit: () => void;
}) {
  const { remove } = useCheckMutations();
  const latencyQuery = useCheckLatency(check.id, range);
  const points: ChartPoint[] = (latencyQuery.data?.points ?? []).map((point) => ({
    label: timeLabel(point.ts),
    value: point.latencyMs ?? 0,
  }));

  const status = result === undefined
    ? { color: "secondary" as const, label: "Pending" }
    : result.ok
    ? { color: "green" as const, label: "Up" }
    : { color: "red" as const, label: "Down" };
  const detail = result
    ? [result.statusCode ? `HTTP ${result.statusCode}` : undefined, result.error, `${result.latencyMs} ms`]
        .filter(Boolean)
        .join(" · ")
    : "Awaiting first check";

  return (
    <div className="rounded-lg border border-separator p-3 flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Text variant="strong" truncate>{check.name}</Text>
          <Text variant="small" color="secondary" truncate>{check.method} · {check.url}</Text>
        </div>
        <Badge color={status.color}>{status.label}</Badge>
        {!check.enabled ? <Badge color="secondary">Disabled</Badge> : null}
        <Button variant="transparent" size="small" iconOnly aria-label="Edit check" onClick={onEdit}>
          <Edit3 className="size-4" />
        </Button>
        <Button
          variant="transparent"
          size="small"
          iconOnly
          aria-label="Delete check"
          onClick={() => void remove.mutateAsync(check.id).catch((error) => toast.error(String(error)))}
        >
          <Trash2 className="size-4 text-support-red" />
        </Button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <StatCard label="Status" value={status.label} detail={detail} />
        <StatCard label="Uptime" value={pct(latencyQuery.data?.uptime)} />
        <StatCard
          label="Avg latency"
          value={latencyQuery.data?.avgLatencyMs != null ? `${latencyQuery.data.avgLatencyMs} ms` : "—"}
        />
      </div>
      <LineChart points={points} label="Latency (ms)" />
    </div>
  );
}

export function UptimeView() {
  const [range, setRange] = useState<HistoryRange>("24h");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<HttpCheck | null>(null);
  const checksQuery = useChecks();
  const snapshotQuery = useMonitorData();

  const resultsByCheck = useMemo(() => {
    const map = new Map<string, HttpCheckResult>();
    for (const result of snapshotQuery.data?.checks ?? []) map.set(result.checkId, result);
    return map;
  }, [snapshotQuery.data]);

  const openNew = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (check: HttpCheck) => {
    setEditing(check);
    setDialogOpen(true);
  };

  const checks = checksQuery.data ?? [];

  const actions = (
    <div className="flex items-center gap-2">
      <Select value={range} onValueChange={(value) => setRange(value as HistoryRange)}>
        <SelectTrigger variant="glass" size="large"><SelectValue /></SelectTrigger>
        <SelectContent>
          {RANGE_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button variant="accent" size="large" onClick={openNew}>
        <Plus className="size-4" /> Add check
      </Button>
    </div>
  );

  return (
    <ScrollArea title="Uptime" actions={actions} className="h-full">
      <div className="px-2 pb-8 flex flex-col gap-4">
        {checks.length === 0 ? (
          <EmptyState
            title="No uptime checks"
            description="Add an HTTP endpoint to monitor its availability and response time."
          />
        ) : (
          checks.map((check) => (
            <CheckCard
              key={check.id}
              check={check}
              result={resultsByCheck.get(check.id)}
              range={range}
              onEdit={() => openEdit(check)}
            />
          ))
        )}
      </div>
      <CheckDialog open={dialogOpen} editing={editing} onOpenChange={setDialogOpen} />
    </ScrollArea>
  );
}
