import { Text } from "@glaze/core/components";
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

interface ChartDatum {
  label: string;
  value: number;
  secondary?: number;
}

const VALUE_COLOR = "var(--accent)";
const SECONDARY_COLOR = "var(--red)";
const GRID_COLOR = "var(--color-border-separator)";
const TEXT_COLOR = "var(--color-text-tertiary)";

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
