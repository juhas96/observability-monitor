import type { ReactNode } from "react";
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Text } from "@glaze/core/components";
import { Popover } from "radix-ui";
import { Bookmark, Filter, Pencil, RotateCcw, Save, Star, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type {
  HistoryDateRange,
  HistoryEventType,
  HistoryRange,
  HistoryStats,
  MonitorCategory,
  NormalizedStatus,
  ObservabilitySeverity,
} from "../types";

export const ALL = "all";
export const NONE = "none";

export const HISTORY_RANGE_OPTIONS: { value: HistoryRange; label: string }[] = [
  { value: "15m", label: "15 minutes" },
  { value: "1h", label: "1 hour" },
  { value: "6h", label: "6 hours" },
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "14d", label: "14 days" },
];

const RANGE_MS: Record<HistoryRange, number> = {
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "14d": 14 * 24 * 60 * 60 * 1000,
};

export interface DateRangeInputBounds {
  min?: string;
  max?: string;
}

export const STATUS_FILTER_OPTIONS: { value: NormalizedStatus | "all"; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "failure", label: "Failed" },
  { value: "warning", label: "Warning" },
  { value: "running", label: "Running" },
  { value: "queued", label: "Queued" },
  { value: "success", label: "Passed" },
  { value: "info", label: "Info" },
  { value: "cancelled", label: "Cancelled" },
  { value: "unknown", label: "Unknown" },
];

export const CATEGORY_FILTER_OPTIONS: { value: MonitorCategory | "all"; label: string }[] = [
  { value: "all", label: "All categories" },
  { value: "run", label: "Runs" },
  { value: "deploy", label: "Deploys" },
  { value: "release", label: "Releases" },
  { value: "migration", label: "Migrations" },
  { value: "log", label: "Logs" },
  { value: "alert", label: "Alerts" },
  { value: "incident", label: "Incidents" },
  { value: "issue", label: "Issues" },
  { value: "monitor", label: "Monitors" },
  { value: "metric", label: "Metrics" },
  { value: "slo", label: "SLOs" },
  { value: "trace", label: "Traces" },
  { value: "datasource", label: "Data sources" },
  { value: "dashboard", label: "Dashboards" },
  { value: "annotation", label: "Annotations" },
  { value: "statuspage", label: "Status pages" },
  { value: "email", label: "Email" },
  { value: "domain", label: "Domains" },
  { value: "other", label: "Other" },
];

export const EVENT_TYPE_OPTIONS: { value: HistoryEventType | "all"; label: string }[] = [
  { value: "all", label: "All events" },
  { value: "deploy", label: "Deploys" },
  { value: "failure", label: "Failures" },
  { value: "recovery", label: "Recoveries" },
  { value: "alert", label: "Alerts" },
  { value: "incident", label: "Incidents" },
  { value: "check", label: "Checks" },
];

export const SEVERITY_FILTER_OPTIONS: { value: ObservabilitySeverity | "all"; label: string }[] = [
  { value: "all", label: "All severities" },
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
  { value: "info", label: "Info" },
];

export function defaultDateRange(range: HistoryRange = "24h"): HistoryDateRange {
  return { mode: "relative", range };
}

export function useStoredState<T>(key: string, fallback: T): [T, (next: T) => void, () => void] {
  const [value, setValue] = useState<T>(() => {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  });

  const setStored = (next: T) => {
    setValue(next);
    localStorage.setItem(key, JSON.stringify(next));
  };
  const reset = () => {
    setValue(fallback);
    localStorage.removeItem(key);
  };
  return [value, setStored, reset];
}

export function dateRangeBounds(value: HistoryDateRange, now = Date.now()): { start: number; end: number } {
  if (value.mode === "relative") return { start: now - RANGE_MS[value.range], end: now };
  const from = value.from ? new Date(value.from).getTime() : NaN;
  const to = value.to ? new Date(value.to).getTime() : NaN;
  return {
    start: Number.isFinite(from) ? from : now - RANGE_MS["24h"],
    end: Number.isFinite(to) ? to : now,
  };
}

export function dateRangeLabel(value: HistoryDateRange): string {
  if (value.mode === "custom") return "Custom range";
  return HISTORY_RANGE_OPTIONS.find((option) => option.value === value.range)?.label ?? value.range;
}

export function sameDateRange(a: HistoryDateRange, b: HistoryDateRange): boolean {
  if (a.mode !== b.mode) return false;
  if (a.mode === "relative" && b.mode === "relative") return a.range === b.range;
  if (a.mode === "custom" && b.mode === "custom") return (a.from ?? "") === (b.from ?? "") && (a.to ?? "") === (b.to ?? "");
  return false;
}

export function matchesDateRange(ts: string | undefined, value: HistoryDateRange): boolean {
  if (!ts) return false;
  const parsed = new Date(ts).getTime();
  if (!Number.isFinite(parsed)) return false;
  const { start, end } = dateRangeBounds(value);
  return parsed >= start && parsed <= end;
}

function toDateTimeLocal(ms: number): string {
  const date = new Date(ms);
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function clampDateTimeLocal(value: string | undefined, bounds?: DateRangeInputBounds): string | undefined {
  if (!value) return undefined;
  if (bounds?.min && value < bounds.min) return bounds.min;
  if (bounds?.max && value > bounds.max) return bounds.max;
  return value;
}

export function retainedHistoryDateBounds(stats: HistoryStats | undefined, now = Date.now()): DateRangeInputBounds {
  const retentionDays = Math.max(1, stats?.retentionDays ?? 14);
  const minByRetention = now - retentionDays * 24 * 60 * 60 * 1000;
  const oldestRows = [
    stats?.oldestSampleAt,
    stats?.oldestEventAt,
    stats?.oldestCheckSampleAt,
  ].map((value) => value ? new Date(value).getTime() : NaN).filter(Number.isFinite);
  return {
    min: toDateTimeLocal(Math.max(minByRetention, oldestRows.length > 0 ? Math.min(...oldestRows) : minByRetention)),
    max: toDateTimeLocal(now),
  };
}

export function toSingleEventType(value: string): HistoryEventType[] | undefined {
  return value === ALL ? undefined : [value as HistoryEventType];
}

export function optionLabel(options: { value: string; label: string }[], value: string): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

export interface AppliedFilter {
  id: string;
  label: string;
  value: string;
  onClear: () => void;
}

interface FilterPreset<TValue> {
  id: string;
  name: string;
  value: TValue;
  createdAt: string;
  updatedAt: string;
}

function filterPresetId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `preset-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function useFilterPresets<TValue>(storageKey: string | undefined) {
  const defaultStorageKey = storageKey ? `${storageKey}.default` : undefined;
  const [presets, setPresets] = useState<FilterPreset<TValue>[]>(() => {
    if (!storageKey) return [];
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((item): item is FilterPreset<TValue> => {
        if (!item || typeof item !== "object") return false;
        const candidate = item as Partial<FilterPreset<TValue>>;
        return typeof candidate.id === "string" && typeof candidate.name === "string" && typeof candidate.value === "object" && candidate.value !== null;
      });
    } catch {
      return [];
    }
  });
  const [defaultPresetId, setDefaultPresetId] = useState(() => {
    if (!defaultStorageKey) return NONE;
    const raw = localStorage.getItem(defaultStorageKey);
    if (!raw) return NONE;
    try {
      const parsed = JSON.parse(raw) as unknown;
      return typeof parsed === "string" ? parsed : NONE;
    } catch {
      return raw;
    }
  });

  const writePresets = (next: FilterPreset<TValue>[]) => {
    setPresets(next);
    if (!storageKey) return;
    if (next.length === 0) localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, JSON.stringify(next));
  };
  const writeDefaultPreset = (id: string) => {
    setDefaultPresetId(id);
    if (!defaultStorageKey) return;
    if (id === NONE) localStorage.removeItem(defaultStorageKey);
    else localStorage.setItem(defaultStorageKey, JSON.stringify(id));
  };

  return {
    presets,
    defaultPresetId,
    setDefaultPreset: writeDefaultPreset,
    savePreset: (name: string, value: TValue) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const now = new Date().toISOString();
      const existing = presets.find((preset) => preset.name.toLowerCase() === trimmed.toLowerCase());
      const next = existing
        ? presets.map((preset) => preset.id === existing.id ? { ...preset, name: trimmed, value, updatedAt: now } : preset)
        : [...presets, { id: filterPresetId(), name: trimmed, value, createdAt: now, updatedAt: now }];
      writePresets(next.sort((a, b) => a.name.localeCompare(b.name)));
    },
    renamePreset: (id: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const now = new Date().toISOString();
      writePresets(presets
        .map((preset) => preset.id === id ? { ...preset, name: trimmed, updatedAt: now } : preset)
        .sort((a, b) => a.name.localeCompare(b.name)));
    },
    updatePreset: (id: string, value: TValue) => {
      const now = new Date().toISOString();
      writePresets(presets.map((preset) => preset.id === id ? { ...preset, value, updatedAt: now } : preset));
    },
    deletePreset: (id: string) => {
      writePresets(presets.filter((preset) => preset.id !== id));
      if (defaultPresetId === id) writeDefaultPreset(NONE);
    },
  };
}

export function FilterSelect({
  value,
  onChange,
  options,
  size = "large",
  variant = "glass",
  triggerClassName,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  size?: "small" | "medium" | "large";
  variant?: "default" | "glass" | "transparent";
  triggerClassName?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger variant={variant} size={size} className={triggerClassName}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function FilterSelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="grid min-w-0 grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-3">
      <Text variant="small" color="secondary" truncate>{label}</Text>
      <FilterSelect value={value} onChange={onChange} options={options} size="small" variant="default" triggerClassName="w-full" />
    </label>
  );
}

export function DateRangeFilter({ value, onChange, bounds }: { value: HistoryDateRange; onChange: (value: HistoryDateRange) => void; bounds?: DateRangeInputBounds }) {
  const selected = value.mode === "custom" ? "custom" : value.range;
  const customValue = value.mode === "custom"
    ? {
        ...value,
        from: clampDateTimeLocal(value.from, bounds),
        to: clampDateTimeLocal(value.to, bounds),
      }
    : undefined;

  useEffect(() => {
    if (value.mode !== "custom") return;
    const from = clampDateTimeLocal(value.from, bounds);
    const to = clampDateTimeLocal(value.to, bounds);
    if (from !== value.from || to !== value.to) onChange({ ...value, from, to });
  }, [bounds?.max, bounds?.min, onChange, value]);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Select
        value={selected}
        onValueChange={(next) => {
          if (next === "custom") onChange({ mode: "custom", from: value.mode === "custom" ? value.from : undefined, to: value.mode === "custom" ? value.to : undefined });
          else onChange({ mode: "relative", range: next as HistoryRange });
        }}
      >
        <SelectTrigger variant="default" size="small" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {HISTORY_RANGE_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
          <SelectItem value="custom">Custom range</SelectItem>
        </SelectContent>
      </Select>
      {value.mode === "custom" ? (
        <div className="grid grid-cols-1 gap-2">
          <Input
            type="datetime-local"
            value={customValue?.from ?? ""}
            min={bounds?.min}
            max={bounds?.max}
            onChange={(event) => onChange({ ...value, from: clampDateTimeLocal(event.target.value || undefined, bounds) })}
            variant="filled"
            size="small"
            aria-label="From date"
          />
          <Input
            type="datetime-local"
            value={customValue?.to ?? ""}
            min={bounds?.min}
            max={bounds?.max}
            onChange={(event) => onChange({ ...value, to: clampDateTimeLocal(event.target.value || undefined, bounds) })}
            variant="filled"
            size="small"
            aria-label="To date"
          />
        </div>
      ) : null}
    </div>
  );
}

export function FilterDateRangeField({ label, value, onChange, bounds }: { label: string; value: HistoryDateRange; onChange: (value: HistoryDateRange) => void; bounds?: DateRangeInputBounds }) {
  return (
    <div className="grid min-w-0 grid-cols-[6.5rem_minmax(0,1fr)] items-start gap-3">
      <Text variant="small" color="secondary" className="pt-1.5" truncate>{label}</Text>
      <DateRangeFilter value={value} onChange={onChange} bounds={bounds} />
    </div>
  );
}

export function FilterSearchField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="grid min-w-0 grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-3">
      <Text variant="small" color="secondary" truncate>{label}</Text>
      <Input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} variant="filled" size="small" />
    </label>
  );
}

export function AppliedFilterChips({ filters, maxVisible = 3 }: { filters: AppliedFilter[]; maxVisible?: number }) {
  if (filters.length === 0) return null;
  const visible = filters.slice(0, maxVisible);
  const hidden = filters.length - visible.length;
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
      {visible.map((filter) => (
        <button
          key={filter.id}
          type="button"
          onClick={filter.onClear}
          className="inline-flex h-8 max-w-48 items-center gap-1.5 rounded-full border border-separator bg-control-subtle px-2.5 text-xs text-primary transition-colors hover:bg-control-hover"
          title={`Clear ${filter.label}`}
          aria-label={`Clear ${filter.label} filter`}
        >
          <span className="truncate">
            {filter.label}: {filter.value}
          </span>
          <X className="size-3.5 shrink-0 text-tertiary" />
        </button>
      ))}
      {hidden > 0 ? (
        <span className="inline-flex h-8 items-center rounded-full border border-separator bg-control-subtle px-2.5 text-xs text-secondary">
          +{hidden}
        </span>
      ) : null}
    </div>
  );
}

export function FilterMenu<TValue = unknown>({
  filters,
  onReset,
  children,
  presetKey,
  presetValue,
  onApplyPreset,
}: {
  filters: AppliedFilter[];
  onReset: () => void;
  children: ReactNode;
  presetKey?: string;
  presetValue?: TValue;
  onApplyPreset?: (value: TValue) => void;
}) {
  const [presetName, setPresetName] = useState("");
  const [selectedPreset, setSelectedPreset] = useState(NONE);
  const { presets, defaultPresetId, setDefaultPreset, savePreset, renamePreset, updatePreset, deletePreset } = useFilterPresets<TValue>(presetKey);
  const preset = presets.find((candidate) => candidate.id === selectedPreset);
  const defaultPreset = presets.find((candidate) => candidate.id === defaultPresetId);
  const presetsEnabled = Boolean(presetKey && onApplyPreset);
  const trimmedPresetName = presetName.trim();
  const nameDuplicate = presets.some((candidate) => candidate.id !== selectedPreset && candidate.name.toLowerCase() === trimmedPresetName.toLowerCase());
  const filterStorageKey = presetKey?.endsWith(".presets") ? presetKey.slice(0, -".presets".length) : undefined;
  const didApplyDefault = useRef(false);

  useEffect(() => {
    setPresetName(preset?.name ?? "");
  }, [preset?.name]);

  useEffect(() => {
    if (didApplyDefault.current) return;
    if (!presetsEnabled || !defaultPreset || !onApplyPreset) return;
    if (filterStorageKey && localStorage.getItem(filterStorageKey)) {
      didApplyDefault.current = true;
      return;
    }
    didApplyDefault.current = true;
    onApplyPreset(defaultPreset.value);
  }, [defaultPreset, filterStorageKey, onApplyPreset, presetsEnabled]);

  return (
    <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
      <AppliedFilterChips filters={filters} />
      <Popover.Root>
        <Popover.Trigger asChild>
          <Button variant="glass" size="large" aria-label="Open filters">
            <Filter className="size-4" />
            Filters
            {filters.length > 0 ? (
              <span className="ml-0.5 inline-flex min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-xs text-accent-foreground">
                {filters.length}
              </span>
            ) : null}
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="end"
            sideOffset={6}
            collisionPadding={12}
            className="z-50 w-[min(34rem,calc(100vw-1.5rem))] overflow-hidden rounded-popover bg-popover p-2 shadow-popover ring-1 ring-foreground-20"
          >
            {presetsEnabled ? (
              <div className="mb-2 rounded-lg border border-separator bg-control-subtle p-2">
                <div className="mb-2 flex items-center gap-2">
                  <Bookmark className="size-4 text-tertiary" />
                  <Text variant="small" color="secondary">Filter presets</Text>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] gap-2">
                  <Select value={selectedPreset} onValueChange={setSelectedPreset}>
                    <SelectTrigger variant="default" size="small" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Select preset</SelectItem>
                      {presets.map((item) => (
                        <SelectItem key={item.id} value={item.id}>{item.name}{item.id === defaultPresetId ? " (default)" : ""}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="transparent"
                    size="small"
                    disabled={!preset}
                      onClick={() => {
                        if (!preset || !onApplyPreset) return;
                        onApplyPreset(preset.value);
                      }}
                  >
                    Apply
                  </Button>
                  <Button
                    variant="transparent"
                    size="small"
                    disabled={!preset || presetValue === undefined}
                    onClick={() => {
                      if (!preset || presetValue === undefined) return;
                      updatePreset(preset.id, presetValue);
                    }}
                  >
                    Update
                  </Button>
                  <Button
                    variant="transparent"
                    size="small"
                    iconOnly
                    aria-label={preset && preset.id === defaultPresetId ? "Clear default filter preset" : "Use filter preset as default"}
                    title={preset && preset.id === defaultPresetId ? "Clear default filter preset" : "Use filter preset as default"}
                    disabled={!preset}
                    onClick={() => {
                      if (!preset) return;
                      setDefaultPreset(preset.id === defaultPresetId ? NONE : preset.id);
                    }}
                  >
                    <Star className={`size-3.5 ${preset && preset.id === defaultPresetId ? "fill-current text-accent" : ""}`} />
                  </Button>
                  <Button
                    variant="transparent"
                    size="small"
                    iconOnly
                    aria-label="Delete filter preset"
                    title="Delete filter preset"
                    disabled={!preset}
                    onClick={() => {
                      if (!preset) return;
                      deletePreset(preset.id);
                      setSelectedPreset(NONE);
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
                <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                  <Input
                    value={presetName}
                    onChange={(event) => setPresetName(event.target.value)}
                    placeholder={preset ? "Preset name" : "New preset name"}
                    variant="filled"
                    size="small"
                  />
                  <div className="flex items-center gap-2">
                    {preset ? (
                      <Button
                        variant="transparent"
                        size="small"
                        disabled={!trimmedPresetName || trimmedPresetName === preset.name || nameDuplicate}
                        onClick={() => renamePreset(preset.id, presetName)}
                      >
                        <Pencil className="size-3.5" />
                        Rename
                      </Button>
                    ) : null}
                    <Button
                      variant="transparent"
                      size="small"
                      disabled={!trimmedPresetName || nameDuplicate || presetValue === undefined}
                      onClick={() => {
                        if (presetValue === undefined) return;
                        savePreset(presetName, presetValue);
                        setSelectedPreset(NONE);
                        setPresetName("");
                      }}
                    >
                      <Save className="size-3.5" />
                      Save
                    </Button>
                  </div>
                </div>
                {nameDuplicate ? (
                  <Text variant="small" color="tertiary" className="mt-1">A preset with this name already exists.</Text>
                ) : null}
              </div>
            ) : null}
            <div className="grid grid-cols-1 gap-2 py-1">
              {children}
            </div>
            <div className="mt-2 flex items-center justify-end border-t border-separator px-1 pt-2">
              <Button variant="transparent" size="small" onClick={onReset}>
                <RotateCcw className="size-3.5" />
                Reset filters
              </Button>
            </div>
            <Popover.Arrow className="fill-popover" width={14} height={7} />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

export function ResetFiltersButton({ onReset }: { onReset: () => void }) {
  return (
    <Button variant="transparent" size="large" iconOnly aria-label="Reset filters" title="Reset filters" onClick={onReset}>
      <RotateCcw className="size-4" />
    </Button>
  );
}
