import { Text } from "@glaze/core/components";
import type { ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart as RechartsBarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface ChartPoint {
  label: string;
  value: number;
  secondary?: number;
}

export type VisualTone = "good" | "warn" | "bad" | "neutral" | "info";

export interface BreakdownSegment {
  id: string;
  label: string;
  value: number;
  tone: VisualTone;
  onClick?: () => void;
}

export interface DensityPoint {
  id: string;
  label: string;
  value: number;
  tone?: VisualTone;
  onClick?: () => void;
}

export interface HeatmapCell {
  id: string;
  label: string;
  value: number;
  detail?: string;
  tone: VisualTone;
  icon?: ReactNode;
  onClick?: () => void;
}

interface ChartDatum {
  label: string;
  value: number;
  secondary?: number;
}

const VALUE_COLOR = "var(--accent)";
const SECONDARY_COLOR = "var(--red)";
const GRID_COLOR = "var(--color-border-separator)";
const TEXT_COLOR = "var(--color-text-tertiary)";

const TONE_TEXT: Record<VisualTone, string> = {
  good: "text-support-green",
  warn: "text-support-yellow",
  bad: "text-support-red",
  neutral: "text-secondary",
  info: "text-accent",
};

const TONE_BG: Record<VisualTone, string> = {
  good: "bg-support-green",
  warn: "bg-support-yellow",
  bad: "bg-support-red",
  neutral: "bg-control-subtle",
  info: "bg-accent",
};

const TONE_SOFT: Record<VisualTone, string> = {
  good: "bg-support-green/10",
  warn: "bg-support-yellow/10",
  bad: "bg-support-red/10",
  neutral: "bg-control-subtle",
  info: "bg-accent/10",
};

const TONE_BORDER: Record<VisualTone, string> = {
  good: "border-support-green/35",
  warn: "border-support-yellow/35",
  bad: "border-support-red/35",
  neutral: "border-separator",
  info: "border-accent/35",
};

function dataFor(points: ChartPoint[]): ChartDatum[] {
  return points.map((point) => ({
    label: point.label,
    value: point.value,
    secondary: point.secondary,
  }));
}

function EmptyChart() {
  return <Text variant="small" color="tertiary">No history recorded for this range.</Text>;
}

export function LineChart({
  points,
  label,
  secondaryLabel,
}: {
  points: ChartPoint[];
  label: string;
  secondaryLabel?: string;
}) {
  if (points.length === 0) return <EmptyChart />;
  return (
    <div className="h-48 min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={dataFor(points)} margin={{ top: 8, right: 12, bottom: 0, left: -20 }}>
          <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: TEXT_COLOR, fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={18} />
          <YAxis tick={{ fill: TEXT_COLOR, fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip
            contentStyle={{
              background: "var(--background)",
              border: "1px solid var(--color-border-separator)",
              borderRadius: 8,
              color: "var(--color-text-primary)",
            }}
            labelStyle={{ color: "var(--color-text-secondary)" }}
          />
          <Legend wrapperStyle={{ color: "var(--color-text-secondary)", fontSize: 12 }} />
          <Area
            type="monotone"
            dataKey="value"
            name={label}
            stroke={VALUE_COLOR}
            fill={VALUE_COLOR}
            fillOpacity={0.16}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
          {secondaryLabel ? (
            <Area
              type="monotone"
              dataKey="secondary"
              name={secondaryLabel}
              stroke={SECONDARY_COLOR}
              fill={SECONDARY_COLOR}
              fillOpacity={0.12}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          ) : null}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BarChart({ points, label }: { points: ChartPoint[]; label: string }) {
  if (points.length === 0) return <EmptyChart />;
  return (
    <div className="h-48 min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <RechartsBarChart data={dataFor(points)} margin={{ top: 8, right: 12, bottom: 0, left: -20 }}>
          <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: TEXT_COLOR, fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={18} />
          <YAxis tick={{ fill: TEXT_COLOR, fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip
            contentStyle={{
              background: "var(--background)",
              border: "1px solid var(--color-border-separator)",
              borderRadius: 8,
              color: "var(--color-text-primary)",
            }}
            labelStyle={{ color: "var(--color-text-secondary)" }}
          />
          <Legend wrapperStyle={{ color: "var(--color-text-secondary)", fontSize: 12 }} />
          <Bar dataKey="value" name={label} fill={VALUE_COLOR} radius={[3, 3, 0, 0]} />
        </RechartsBarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ProgressBar({ value, danger }: { value: number | null; danger?: boolean }) {
  const pct = value === null ? 0 : Math.max(0, Math.min(100, value * 100));
  return (
    <div className="h-2 rounded-full bg-control-subtle overflow-hidden">
      <div className={`h-full rounded-full ${danger ? "bg-support-red" : "bg-accent"}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function StatusStackBar({ segments, emptyLabel = "No matching rows" }: { segments: BreakdownSegment[]; emptyLabel?: string }) {
  const active = segments.filter((segment) => segment.value > 0);
  const total = active.reduce((sum, segment) => sum + segment.value, 0);
  if (total === 0) {
    return (
      <div className="flex h-9 items-center rounded-lg border border-separator bg-control-subtle px-3">
        <Text variant="small" color="tertiary">{emptyLabel}</Text>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-3 overflow-hidden rounded-full bg-control-subtle">
        {active.map((segment) => {
          const width = `${Math.max(4, (segment.value / total) * 100)}%`;
          const className = `${TONE_BG[segment.tone]} h-full`;
          if (!segment.onClick) return <div key={segment.id} className={className} style={{ width }} title={`${segment.label}: ${segment.value}`} />;
          return (
            <button
              key={segment.id}
              className={`${className} transition hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-accent`}
              style={{ width }}
              title={`${segment.label}: ${segment.value}`}
              aria-label={`${segment.label}: ${segment.value}`}
              onClick={segment.onClick}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {active.map((segment) => (
          <button
            key={segment.id}
            className={`flex items-center gap-1 rounded-md px-1 py-0.5 text-left ${segment.onClick ? "hover:bg-control-subtle focus:outline-none focus:ring-2 focus:ring-accent" : ""}`}
            onClick={segment.onClick}
            disabled={!segment.onClick}
          >
            <span className={`size-2 rounded-full ${TONE_BG[segment.tone]}`} />
            <Text variant="small" color="secondary">{segment.label}</Text>
            <Text variant="small" color="tertiary" className="tabular-nums">{segment.value}</Text>
          </button>
        ))}
      </div>
    </div>
  );
}

export function EventDensityStrip({ points, emptyLabel = "No retained events in this range" }: { points: DensityPoint[]; emptyLabel?: string }) {
  const max = Math.max(0, ...points.map((point) => point.value));
  if (max === 0) {
    return (
      <div className="flex h-12 items-center rounded-lg border border-separator bg-control-subtle px-3">
        <Text variant="small" color="tertiary">{emptyLabel}</Text>
      </div>
    );
  }
  return (
    <div className="grid gap-1" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(0.75rem, 1fr))" }}>
      {points.map((point) => {
        const intensity = point.value === 0 ? "opacity-25" : point.value >= max ? "opacity-100" : point.value >= max * 0.66 ? "opacity-80" : point.value >= max * 0.33 ? "opacity-60" : "opacity-40";
        const tone = point.value > 0 ? point.tone ?? "info" : "neutral";
        const className = `h-9 rounded-md border border-separator ${TONE_BG[tone]} ${intensity} transition`;
        if (!point.onClick || point.value === 0) return <div key={point.id} className={className} title={`${point.label}: ${point.value}`} />;
        return (
          <button
            key={point.id}
            className={`${className} hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-accent`}
            title={`${point.label}: ${point.value}`}
            aria-label={`${point.label}: ${point.value}`}
            onClick={point.onClick}
          />
        );
      })}
    </div>
  );
}

export function HeatmapGrid({ cells, emptyLabel = "No affected scope" }: { cells: HeatmapCell[]; emptyLabel?: string }) {
  const visible = cells.filter((cell) => cell.value > 0);
  if (visible.length === 0) {
    return (
      <div className="rounded-lg border border-separator bg-control-subtle p-3">
        <Text variant="small" color="tertiary">{emptyLabel}</Text>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {visible.map((cell) => {
        const content = (
          <>
            <span className={`flex items-center gap-2 ${TONE_TEXT[cell.tone]}`}>
              {cell.icon}
              <Text variant="small" color="secondary" truncate>{cell.label}</Text>
            </span>
            <span className="mt-2 flex items-end justify-between gap-3">
              <span className="text-2xl font-semibold tracking-normal text-primary tabular-nums">{cell.value}</span>
              {cell.detail ? <Text variant="small" color="tertiary" truncate>{cell.detail}</Text> : null}
            </span>
          </>
        );
        const className = `min-w-0 rounded-lg border ${TONE_BORDER[cell.tone]} ${TONE_SOFT[cell.tone]} p-3 text-left`;
        if (!cell.onClick) return <div key={cell.id} className={className}>{content}</div>;
        return (
          <button key={cell.id} className={`${className} transition hover:bg-control-hover focus:outline-none focus:ring-2 focus:ring-accent`} onClick={cell.onClick}>
            {content}
          </button>
        );
      })}
    </div>
  );
}
