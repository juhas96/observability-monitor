import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import {
  Badge,
  Button,
  Callout,
  EmptyState,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Text,
  toast,
} from "@glaze/core/components";
import {
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import type { TooltipContentProps } from "recharts";

import { formatRelativeTime } from "./components/relative-time";
import { providerIcon, providerLabel } from "./components/provider-meta";
import { useAccounts, useGroups } from "./hooks/use-accounts";
import { useHistoryEvents } from "./hooks/use-history";
import { useProviders } from "./hooks/use-providers";
import { monitorApi } from "./ipc";
import type { Account, HistoryEvent, HistoryRange, ProjectGroup, Provider } from "./types";

const ALL = "all";
const RANGE_OPTIONS: { value: HistoryRange; label: string }[] = [
  { value: "15m", label: "15 minutes" },
  { value: "1h", label: "1 hour" },
  { value: "6h", label: "6 hours" },
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "14d", label: "14 days" },
];

function rangeMs(range: HistoryRange): number {
  switch (range) {
    case "15m":
      return 15 * 60 * 1000;
    case "1h":
      return 60 * 60 * 1000;
    case "6h":
      return 6 * 60 * 60 * 1000;
    case "24h":
      return 24 * 60 * 60 * 1000;
    case "7d":
      return 7 * 24 * 60 * 60 * 1000;
    case "14d":
      return 14 * 24 * 60 * 60 * 1000;
  }
}

function accountMap(accounts: Account[]): Map<string, Account> {
  return new Map(accounts.map((account) => [account.id, account]));
}

function groupMap(groups: ProjectGroup[]): Map<string, ProjectGroup> {
  return new Map(groups.map((group) => [group.id, group]));
}

function eventColor(event: HistoryEvent): string {
  if (event.type === "failure" || event.type === "incident") return "var(--red)";
  if (event.type === "alert") return "var(--yellow)";
  if (event.type === "recovery") return "var(--green)";
  return "var(--accent)";
}

function eventBadge(event: HistoryEvent): "red" | "yellow" | "secondary" {
  if (event.type === "failure" || event.type === "incident") return "red";
  if (event.type === "alert") return "yellow";
  return "secondary";
}

function openUrl(url: string): void {
  void monitorApi.openExternal(url).catch((error) => toast.error(error instanceof Error ? error.message : String(error)));
}

function laneLabel(id: string, laneBy: "group" | "provider", groupsById: Map<string, ProjectGroup>): string {
  if (laneBy === "provider") return id === "unknown" ? "Unknown provider" : providerLabel(id as Provider);
  if (id === "ungrouped") return "Ungrouped";
  return groupsById.get(id)?.name ?? "Unknown group";
}

interface TimelinePoint {
  x: number;
  y: string;
  z: number;
  event: HistoryEvent;
}

function dateTick(value: number): string {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function pointFromPayload(value: unknown): TimelinePoint | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Partial<TimelinePoint>;
  if (typeof candidate.x !== "number" || typeof candidate.y !== "string" || typeof candidate.z !== "number") return undefined;
  if (typeof candidate.event !== "object" || candidate.event === null) return undefined;
  return candidate as TimelinePoint;
}

function pointFromScatterClick(value: unknown): TimelinePoint | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const withPayload = value as { payload?: unknown };
  return pointFromPayload(withPayload.payload) ?? pointFromPayload(value);
}

function TimelineTooltip({ active, payload }: TooltipContentProps) {
  if (!active) return null;
  const point = pointFromPayload(payload?.[0]?.payload);
  if (!point) return null;
  return (
    <div className="rounded-lg border border-separator bg-background-solid p-3 shadow-sm max-w-[280px]">
      <Text variant="small" color="tertiary">{point.y}</Text>
      <Text variant="strong">{point.event.title}</Text>
      <Text variant="small" color="secondary">
        {point.event.type} · {providerLabel(point.event.provider)} · {new Date(point.event.ts).toLocaleString()}
      </Text>
    </div>
  );
}

function TimelineChart({
  events,
  range,
  laneBy,
  groupsById,
}: {
  events: HistoryEvent[];
  range: HistoryRange;
  laneBy: "group" | "provider";
  groupsById: Map<string, ProjectGroup>;
}) {
  const start = Date.now() - rangeMs(range);
  const end = Date.now();
  const points = events.map((event): TimelinePoint => {
    const laneId = laneBy === "provider" ? event.provider : event.groupId ?? "ungrouped";
    return {
      x: new Date(event.ts).getTime(),
      y: laneLabel(laneId, laneBy, groupsById),
      z: event.type === "deploy" ? 64 : event.type === "failure" || event.type === "incident" ? 100 : 80,
      event,
    };
  });
  const lanes = [...new Set(points.map((point) => point.y))];
  const height = Math.max(260, lanes.length * 48 + 88);

  return (
    <div className="min-w-0" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 18, right: 20, bottom: 8, left: 16 }}>
          <CartesianGrid stroke="var(--color-border-separator)" strokeDasharray="3 3" />
          <XAxis
            type="number"
            dataKey="x"
            domain={[start, end]}
            tickFormatter={dateTick}
            tick={{ fill: "var(--color-text-tertiary)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            type="category"
            dataKey="y"
            width={132}
            allowDuplicatedCategory={false}
            tick={{ fill: "var(--color-text-secondary)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <ZAxis dataKey="z" range={[56, 112]} />
          <Tooltip
            cursor={{ stroke: "var(--color-border-separator)", strokeDasharray: "3 3" }}
            content={(props) => <TimelineTooltip {...props} />}
          />
          {events.filter((event) => event.type === "deploy").map((event) => (
            <ReferenceLine
              key={`deploy:${event.id}`}
              x={new Date(event.ts).getTime()}
              stroke="var(--accent)"
              strokeOpacity={0.3}
              strokeDasharray="4 4"
            />
          ))}
          <Scatter
            name="Events"
            data={points}
            cursor="pointer"
            onClick={(value) => {
              const point = pointFromScatterClick(value);
              if (point) openUrl(point.event.url);
            }}
          >
            {points.map((point) => (
              <Cell key={point.event.id} fill={eventColor(point.event)} stroke="var(--background-solid)" strokeWidth={1.5} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

function EventRow({ event, account }: { event: HistoryEvent; account: Account | undefined }) {
  const Icon = providerIcon(event.provider);
  return (
    <div className="grid grid-cols-[7rem_6rem_1fr_2rem] gap-3 py-2 border-t border-separator first:border-t-0 items-center">
      <Text variant="small" color="tertiary" className="tabular-nums">{formatRelativeTime(event.ts)}</Text>
      <Badge color={eventBadge(event)}>{event.type}</Badge>
      <div className="min-w-0 flex items-center gap-2">
        <Icon className="size-4 text-tertiary shrink-0" />
        <div className="min-w-0">
          <Text variant="strong" truncate>{event.title}</Text>
          <Text variant="small" color="secondary" truncate>{account?.label ?? providerLabel(event.provider)}</Text>
        </div>
      </div>
      <Button variant="transparent" size="small" iconOnly aria-label="Open event" onClick={() => openUrl(event.url)}>
        <ExternalLink className="size-4" />
      </Button>
    </div>
  );
}

export function TimelineView() {
  const [range, setRange] = useState<HistoryRange>("24h");
  const [groupFilter, setGroupFilter] = useState(ALL);
  const [providerFilter, setProviderFilter] = useState(ALL);
  const [laneBy, setLaneBy] = useState<"group" | "provider">("group");
  const eventsQuery = useHistoryEvents({
    range,
    groupId: groupFilter === ALL ? undefined : groupFilter,
    provider: providerFilter === ALL ? undefined : providerFilter,
    types: ["deploy", "failure", "recovery", "alert", "incident"],
  });
  const accountsQuery = useAccounts();
  const groupsQuery = useGroups();
  const providersQuery = useProviders();
  const accountsById = useMemo(() => accountMap(accountsQuery.data ?? []), [accountsQuery.data]);
  const groupsById = useMemo(() => groupMap(groupsQuery.data ?? []), [groupsQuery.data]);
  const events = eventsQuery.data ?? [];

  return (
    <ScrollArea
      title="Timeline"
      actions={
        <div className="flex items-center gap-2">
          <Select value={range} onValueChange={(value) => setRange(value as HistoryRange)}>
            <SelectTrigger variant="glass" size="large"><SelectValue /></SelectTrigger>
            <SelectContent>
              {RANGE_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={laneBy} onValueChange={(value) => setLaneBy(value as "group" | "provider")}>
            <SelectTrigger variant="glass" size="large"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="group">Group lanes</SelectItem>
              <SelectItem value="provider">Provider lanes</SelectItem>
            </SelectContent>
          </Select>
          <Select value={groupFilter} onValueChange={setGroupFilter}>
            <SelectTrigger variant="glass" size="large"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All groups</SelectItem>
              {(groupsQuery.data ?? []).map((group) => <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={providerFilter} onValueChange={setProviderFilter}>
            <SelectTrigger variant="glass" size="large"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All providers</SelectItem>
              {(providersQuery.data ?? []).map((provider) => <SelectItem key={provider.id} value={provider.id}>{provider.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      }
      className="h-full"
    >
      <div className="px-2 pb-8 flex flex-col gap-6">
        {events.length === 0 ? (
          <EmptyState title="No correlation events yet" description="Deploys, failures, recoveries, alerts, and incidents appear after polling records history." />
        ) : (
          <>
            <section className="rounded-lg border border-separator p-3">
              <TimelineChart events={events} range={range} laneBy={laneBy} groupsById={groupsById} />
            </section>
            <section className="flex flex-col gap-2">
              <div className="px-2">
                <Text variant="strong">Recent Events</Text>
              </div>
              <div className="rounded-lg border border-separator p-3">
                {events.length === 0 ? (
                  <Callout color="secondary">No events match the current filters.</Callout>
                ) : (
                  <div className="flex flex-col">
                    {events.slice(0, 60).map((event) => (
                      <EventRow key={event.id} event={event} account={accountsById.get(event.accountId)} />
                    ))}
                  </div>
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </ScrollArea>
  );
}
