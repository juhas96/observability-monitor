import { useState, useEffect } from "react";
import {
  Label,
  RadioGroup,
  RadioGroupItem,
  ScrollArea,
  Toolbar,
  ToolbarContent,
  ToolbarTitle,
  Field,
  FieldContent,
  FieldGroup,
  FieldLabel,
  FieldSet,
  Switch,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Button,
  Input,
  Text,
  toast,
} from "@glaze/core/components";
import type { NativeThemeInfo } from "@glaze/core/ipc";
import { NotificationChannels } from "./notification-channels";

interface DigestSettings {
  enabled: boolean;
  cadence: "daily" | "weekly";
  hour: number;
}

interface MaintenanceWindow {
  id: string;
  label: string;
  enabled: boolean;
  days: number[];
  startHour: number;
  endHour: number;
  scope?: MaintenanceWindowScope;
}

interface MaintenanceWindowScope {
  groupId?: string;
  accountId?: string;
  provider?: string;
  checkId?: string;
}

interface MonitorSettings {
  pollIntervalSeconds: number;
  notifyOnFailure: boolean;
  notifyOnSuccess: boolean;
  notifyOnlyOnChange: boolean;
  soundOnNotify: boolean;
  historyRetentionDays: number;
  digest: DigestSettings;
  maintenanceWindows: MaintenanceWindow[];
  launchAtLogin: boolean;
  mutedUntil?: string;
}

interface AccountOption {
  id: string;
  label: string;
  provider: string;
  groupId?: string;
}

interface GroupOption {
  id: string;
  name: string;
}

interface ProviderOption {
  id: string;
  label: string;
}

interface CheckOption {
  id: string;
  name: string;
  groupId?: string;
}

interface HistoryStats {
  retentionDays: number;
  storageBytes: number;
  sampleCount: number;
  eventCount: number;
  checkSampleCount: number;
  sloCount: number;
  oldestSampleAt?: string;
  newestSampleAt?: string;
  oldestEventAt?: string;
  newestEventAt?: string;
  oldestCheckSampleAt?: string;
  newestCheckSampleAt?: string;
}

type MaintenanceScopeType = "all" | "group" | "account" | "provider" | "check";

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => ({
  value: String(hour),
  label: `${String(hour).padStart(2, "0")}:00`,
}));

const DAY_PRESETS = [
  { value: "daily", label: "Every day", days: [0, 1, 2, 3, 4, 5, 6] },
  { value: "weekdays", label: "Weekdays", days: [1, 2, 3, 4, 5] },
  { value: "weekends", label: "Weekends", days: [0, 6] },
];

const DEFAULT_MAINTENANCE_WINDOW: MaintenanceWindow = {
  id: "maintenance-default",
  label: "Maintenance window",
  enabled: false,
  days: DAY_PRESETS[0].days,
  startHour: 22,
  endHour: 6,
};

const INTERVAL_OPTIONS = [
  { value: "30", label: "30 seconds" },
  { value: "60", label: "1 minute" },
  { value: "120", label: "2 minutes" },
  { value: "300", label: "5 minutes" },
];

const RETENTION_OPTIONS = [
  { value: "7", label: "7 days" },
  { value: "14", label: "14 days" },
  { value: "30", label: "30 days" },
  { value: "60", label: "60 days" },
  { value: "90", label: "90 days" },
];

const NONE = "none";

function tomorrowMorningIso(): string {
  const target = new Date();
  target.setDate(target.getDate() + 1);
  target.setHours(9, 0, 0, 0);
  return target.toISOString();
}

function maintenanceWindowId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `maintenance-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createMaintenanceWindow(index: number): MaintenanceWindow {
  return {
    ...DEFAULT_MAINTENANCE_WINDOW,
    id: maintenanceWindowId(),
    label: `Maintenance window ${index}`,
  };
}

function dayPresetValue(days: number[]): string {
  const sorted = [...days].sort().join(",");
  return DAY_PRESETS.find((preset) => preset.days.join(",") === sorted)?.value ?? "daily";
}

function maintenanceScopeType(scope: MaintenanceWindowScope | undefined): MaintenanceScopeType {
  if (scope?.checkId) return "check";
  if (scope?.accountId) return "account";
  if (scope?.groupId) return "group";
  if (scope?.provider) return "provider";
  return "all";
}

function maintenanceScopeValue(scope: MaintenanceWindowScope | undefined): string {
  return scope?.checkId ?? scope?.accountId ?? scope?.groupId ?? scope?.provider ?? NONE;
}

function formatHistoryDate(value: string | undefined): string {
  if (!value) return "No data yet";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "No data yet";
}

function formatBytes(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

export function SettingsView() {
  const [themeInfo, setThemeInfo] = useState<NativeThemeInfo | null>(null);
  const [_isLoading, setIsLoading] = useState(true);
  const [monitor, setMonitor] = useState<MonitorSettings | null>(null);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [checks, setChecks] = useState<CheckOption[]>([]);
  const [historyStats, setHistoryStats] = useState<HistoryStats | null>(null);
  const [clearingHistory, setClearingHistory] = useState(false);
  const [pruningHistory, setPruningHistory] = useState(false);

  // Close settings window on Escape, unless an interactive element is focused or a popover is open
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (event.defaultPrevented) return;

      const el = document.activeElement;
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement ||
        (el instanceof HTMLElement && el.isContentEditable)
      ) {
        return;
      }

      if (document.querySelector("[data-radix-popper-content-wrapper]")) {
        return;
      }

      event.preventDefault();
      window.glazeAPI.glaze.ipc.invoke("window:closeSettings");
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const refreshThemeInfo = async () => {
    try {
      const info = await window.glazeAPI.nativeTheme.getInfo();
      setThemeInfo(info);
    } catch (error) {
      toast.error(`Failed to get theme info: ${error}`);
    } finally {
      setIsLoading(false);
    }
  };

  const refreshHistoryStats = async () => {
    try {
      setHistoryStats(await window.glazeAPI.glaze.ipc.invoke<HistoryStats>("history:getStats"));
    } catch {
      setHistoryStats(null);
    }
  };

  useEffect(() => {
    refreshThemeInfo();
    void refreshHistoryStats();
    window.glazeAPI.glaze.ipc
      .invoke<MonitorSettings>("monitor:getSettings")
      .then(setMonitor)
      .catch((error) => toast.error(`Failed to load settings: ${error}`));
    void Promise.all([
      window.glazeAPI.glaze.ipc.invoke<AccountOption[]>("accounts:list"),
      window.glazeAPI.glaze.ipc.invoke<GroupOption[]>("groups:list"),
      window.glazeAPI.glaze.ipc.invoke<ProviderOption[]>("providers:list"),
      window.glazeAPI.glaze.ipc.invoke<CheckOption[]>("checks:list"),
    ])
      .then(([nextAccounts, nextGroups, nextProviders, nextChecks]) => {
        setAccounts(nextAccounts);
        setGroups(nextGroups);
        setProviders(nextProviders);
        setChecks(nextChecks);
      })
      .catch(() => {
        setAccounts([]);
        setGroups([]);
        setProviders([]);
        setChecks([]);
      });
  }, []);

  const updateMonitor = async (patch: Partial<MonitorSettings>) => {
    try {
      const next = await window.glazeAPI.glaze.ipc.invoke<MonitorSettings>("monitor:updateSettings", patch);
      setMonitor(next);
      void refreshHistoryStats();
    } catch (error) {
      toast.error(`Failed to save settings: ${error}`);
    }
  };

  const digest: DigestSettings = monitor?.digest ?? { enabled: false, cadence: "daily", hour: 9 };
  const maintenanceWindows = monitor?.maintenanceWindows ?? [];

  const mutedActive = monitor?.mutedUntil ? new Date(monitor.mutedUntil).getTime() > Date.now() : false;
  const snoozeDescription = mutedActive
    ? `Snoozed until ${new Date(monitor!.mutedUntil!).toLocaleString()}.`
    : "Temporarily silence all notifications.";
  const historyOldest = historyStats
    ? [historyStats.oldestSampleAt, historyStats.oldestEventAt, historyStats.oldestCheckSampleAt]
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0]
    : undefined;
  const historyRows = historyStats ? historyStats.sampleCount + historyStats.eventCount + historyStats.checkSampleCount : 0;

  const updateMaintenanceWindows = (next: MaintenanceWindow[]) => {
    void updateMonitor({ maintenanceWindows: next });
  };

  const updateMaintenanceWindow = (index: number, patch: Partial<MaintenanceWindow>) => {
    const windows = maintenanceWindows.length > 0 ? maintenanceWindows : [createMaintenanceWindow(1)];
    const nextWindow = { ...windows[index], ...patch };
    if ("scope" in patch && patch.scope === undefined) delete nextWindow.scope;
    updateMaintenanceWindows(windows.map((window, windowIndex) => windowIndex === index ? nextWindow : window));
  };

  const addMaintenanceWindow = () => {
    updateMaintenanceWindows([...maintenanceWindows, createMaintenanceWindow(maintenanceWindows.length + 1)]);
  };

  const deleteMaintenanceWindow = (index: number) => {
    const maintenanceWindow = maintenanceWindows[index];
    if (maintenanceWindow && !globalThis.confirm(`Delete maintenance window "${maintenanceWindow.label}"?`)) return;
    updateMaintenanceWindows(maintenanceWindows.filter((_, windowIndex) => windowIndex !== index));
  };

  const clearHistory = async () => {
    if (!historyStats || historyRows === 0) return;
    const message = [
      `Clear ${historyStats.sampleCount} samples, ${historyStats.eventCount} events, and ${historyStats.checkSampleCount} check samples from local history?`,
      "",
      `${historyStats.sloCount} SLO definition${historyStats.sloCount === 1 ? "" : "s"} will be kept. Accounts, dashboards, checks, rules, incidents, and tokens are not changed.`,
    ].join("\n");
    if (!globalThis.confirm(message)) return;
    setClearingHistory(true);
    try {
      const next = await window.glazeAPI.glaze.ipc.invoke<HistoryStats>("history:clear");
      setHistoryStats(next);
      toast.success("Retained history cleared.");
    } catch (error) {
      toast.error(`Failed to clear history: ${error}`);
      void refreshHistoryStats();
    } finally {
      setClearingHistory(false);
    }
  };

  const pruneHistory = async () => {
    if (!historyStats || historyStats.storageBytes === 0) return;
    setPruningHistory(true);
    try {
      const next = await window.glazeAPI.glaze.ipc.invoke<HistoryStats>("history:prune");
      setHistoryStats(next);
      toast.success("Retention applied to stored history.");
    } catch (error) {
      toast.error(`Failed to apply retention: ${error}`);
      void refreshHistoryStats();
    } finally {
      setPruningHistory(false);
    }
  };

  const scopeOptionsFor = (scopeType: MaintenanceScopeType) => {
    switch (scopeType) {
      case "group":
        return groups.map((group) => ({ value: group.id, label: group.name }));
      case "account":
        return accounts.map((account) => ({ value: account.id, label: account.label }));
      case "provider":
        return providers.map((provider) => ({ value: provider.id, label: provider.label }));
      case "check":
        return checks.map((check) => ({ value: check.id, label: check.name }));
      default:
        return [];
    }
  };

  const updateMaintenanceScopeType = (index: number, scopeType: MaintenanceScopeType) => {
    if (scopeType === "all") {
      updateMaintenanceWindow(index, { scope: undefined });
      return;
    }
    const firstOption = (() => {
      switch (scopeType) {
        case "group":
          return groups[0]?.id;
        case "account":
          return accounts[0]?.id;
        case "provider":
          return providers[0]?.id;
        case "check":
          return checks[0]?.id;
        default:
          return undefined;
      }
    })();
    if (!firstOption) {
      updateMaintenanceWindow(index, { scope: undefined });
      return;
    }
    updateMaintenanceScopeValue(index, scopeType, firstOption);
  };

  const updateMaintenanceScopeValue = (index: number, scopeType: MaintenanceScopeType, value: string) => {
    if (value === NONE) {
      updateMaintenanceWindow(index, { scope: undefined });
      return;
    }
    switch (scopeType) {
      case "group":
        updateMaintenanceWindow(index, { scope: { groupId: value } });
        break;
      case "account":
        updateMaintenanceWindow(index, { scope: { accountId: value } });
        break;
      case "provider":
        updateMaintenanceWindow(index, { scope: { provider: value } });
        break;
      case "check":
        updateMaintenanceWindow(index, { scope: { checkId: value } });
        break;
      default:
        updateMaintenanceWindow(index, { scope: undefined });
    }
  };

  const handleThemeChange = async (value: string) => {
    const source = value as "system" | "light" | "dark";
    try {
      await window.glazeAPI.nativeTheme.setThemeSource(source);
      await refreshThemeInfo();
    } catch (error) {
      toast.error(`Failed to set theme: ${error}`);
    }
  };

  return (
    <ScrollArea
      toolbar={
        <Toolbar>
          <ToolbarContent>
            <ToolbarTitle>Settings</ToolbarTitle>
          </ToolbarContent>
        </Toolbar>
      }
    >
      <div className="px-4 flex flex-col gap-8 mb-8">
        <FieldSet>
          <FieldGroup>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor="theme">Theme</FieldLabel>
              </FieldContent>
              <RadioGroup
                value={themeInfo?.themeSource ?? "system"}
                onValueChange={handleThemeChange}
                orientation="horizontal"
              >
                <Label>
                  <RadioGroupItem value="system" />
                  Auto
                </Label>
                <Label>
                  <RadioGroupItem value="light" />
                  Light
                </Label>
                <Label>
                  <RadioGroupItem value="dark" />
                  Dark
                </Label>
              </RadioGroup>
            </Field>
          </FieldGroup>
        </FieldSet>

        <FieldSet title="Monitoring">
          <FieldGroup>
            <Field label="Polling frequency" description="How often accounts are checked for updates.">
              <Select
                value={String(monitor?.pollIntervalSeconds ?? 60)}
                onValueChange={(v) => updateMonitor({ pollIntervalSeconds: Number(v) })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INTERVAL_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Notify on failure" description="Alert when a run or deployment fails.">
              <Switch
                checked={monitor?.notifyOnFailure ?? true}
                onCheckedChange={(checked) => updateMonitor({ notifyOnFailure: checked })}
              />
            </Field>
            <Field label="Notify on success" description="Alert when a run or deployment succeeds.">
              <Switch
                checked={monitor?.notifyOnSuccess ?? false}
                onCheckedChange={(checked) => updateMonitor({ notifyOnSuccess: checked })}
              />
            </Field>
            <Field label="Only on status change" description="Skip repeat alerts while a status stays the same.">
              <Switch
                checked={monitor?.notifyOnlyOnChange ?? true}
                onCheckedChange={(checked) => updateMonitor({ notifyOnlyOnChange: checked })}
              />
            </Field>
            <Field label="History retention" description="How long local history, dashboard points, SLO samples, and check latency are retained on this Mac.">
              <div className="flex flex-col gap-2">
                <Select
                  value={String(monitor?.historyRetentionDays ?? 14)}
                  onValueChange={(value) => updateMonitor({ historyRetentionDays: Number(value) })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RETENTION_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Text variant="small" color="tertiary">
                  {historyStats
                    ? `${historyStats.sampleCount} samples, ${historyStats.eventCount} events, ${historyStats.checkSampleCount} check samples, ${historyStats.sloCount} SLOs, ${formatBytes(historyStats.storageBytes)} on disk. Oldest retained: ${formatHistoryDate(historyOldest)}.`
                    : "History stats unavailable."}
                </Text>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    variant="transparent"
                    size="small"
                    onClick={() => void pruneHistory()}
                    disabled={!historyStats || historyStats.storageBytes === 0 || pruningHistory || clearingHistory}
                  >
                    {pruningHistory ? "Applying..." : "Apply retention now"}
                  </Button>
                  <Button
                    variant="destructive"
                    size="small"
                    onClick={() => void clearHistory()}
                    disabled={!historyStats || historyRows === 0 || clearingHistory || pruningHistory}
                  >
                    {clearingHistory ? "Clearing..." : "Clear retained history"}
                  </Button>
                </div>
              </div>
            </Field>
            <Field label="Play sound" description="Play a sound with each notification.">
              <Switch
                checked={monitor?.soundOnNotify ?? false}
                onCheckedChange={(checked) => updateMonitor({ soundOnNotify: checked })}
              />
            </Field>
            <Field label="Launch at login" description="Start the monitor automatically when you log in.">
              <Switch
                checked={monitor?.launchAtLogin ?? false}
                onCheckedChange={(checked) => updateMonitor({ launchAtLogin: checked })}
              />
            </Field>
            <Field label="Snooze notifications" description={snoozeDescription}>
              <div className="flex items-center gap-2">
                <Button
                  variant="glass"
                  size="small"
                  onClick={() => updateMonitor({ mutedUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString() })}
                >
                  1 hour
                </Button>
                <Button
                  variant="glass"
                  size="small"
                  onClick={() => updateMonitor({ mutedUntil: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString() })}
                >
                  8 hours
                </Button>
                <Button
                  variant="glass"
                  size="small"
                  onClick={() => updateMonitor({ mutedUntil: tomorrowMorningIso() })}
                >
                  Tomorrow
                </Button>
                <Button variant="transparent" size="small" onClick={() => updateMonitor({ mutedUntil: "" })}>
                  Clear
                </Button>
              </div>
            </Field>
            <Field label="Maintenance windows" description="Suppress failure, recovery, and alert delivery during recurring local windows. Evaluation and history still continue.">
              <div className="flex flex-col gap-2">
                {maintenanceWindows.length === 0 ? (
                  <Text variant="small" color="tertiary">No maintenance windows configured.</Text>
                ) : null}
                {maintenanceWindows.map((window, index) => {
                  const scopeType = maintenanceScopeType(window.scope);
                  const scopeValue = maintenanceScopeValue(window.scope);
                  const scopeOptions = scopeOptionsFor(scopeType);
                  return (
                    <div key={window.id} className="flex flex-col gap-2 rounded-lg border border-separator p-2">
                      <div className="flex items-center gap-2">
                        <Input
                          value={window.label}
                          onChange={(event) => updateMaintenanceWindow(index, { label: event.target.value })}
                          variant="filled"
                          size="small"
                          className="min-w-0 flex-1"
                          aria-label="Maintenance window label"
                        />
                        <Switch
                          checked={window.enabled}
                          onCheckedChange={(checked) => updateMaintenanceWindow(index, { enabled: checked })}
                          aria-label={`Enable ${window.label}`}
                        />
                        <Button variant="transparent" size="small" onClick={() => deleteMaintenanceWindow(index)}>
                          Delete
                        </Button>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 justify-end">
                        <Select
                          value={dayPresetValue(window.days)}
                          onValueChange={(value) => {
                            const preset = DAY_PRESETS.find((option) => option.value === value) ?? DAY_PRESETS[0];
                            updateMaintenanceWindow(index, { days: preset.days });
                          }}
                        >
                          <SelectTrigger className="w-32">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {DAY_PRESETS.map((preset) => (
                              <SelectItem key={preset.value} value={preset.value}>
                                {preset.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select
                          value={String(window.startHour)}
                          onValueChange={(value) => updateMaintenanceWindow(index, { startHour: Number(value) })}
                        >
                          <SelectTrigger className="w-24">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {HOUR_OPTIONS.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select
                          value={String(window.endHour)}
                          onValueChange={(value) => updateMaintenanceWindow(index, { endHour: Number(value) })}
                        >
                          <SelectTrigger className="w-24">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {HOUR_OPTIONS.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select value={scopeType} onValueChange={(value) => updateMaintenanceScopeType(index, value as MaintenanceScopeType)}>
                          <SelectTrigger className="w-32">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All</SelectItem>
                            <SelectItem value="group">Group</SelectItem>
                            <SelectItem value="account">Account</SelectItem>
                            <SelectItem value="provider">Provider</SelectItem>
                            <SelectItem value="check">Check</SelectItem>
                          </SelectContent>
                        </Select>
                        <Select
                          value={scopeValue}
                          onValueChange={(value) => updateMaintenanceScopeValue(index, scopeType, value)}
                          disabled={scopeType === "all" || scopeOptions.length === 0}
                        >
                          <SelectTrigger className="w-40">
                            <SelectValue placeholder="Target" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>{scopeType === "all" ? "All targets" : "Select target"}</SelectItem>
                            {scopeOptions.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  );
                })}
                <Button variant="glass" size="small" onClick={addMaintenanceWindow} className="self-end">
                  Add window
                </Button>
              </div>
            </Field>
          </FieldGroup>
        </FieldSet>

        <FieldSet title="Digest">
          <FieldGroup>
            <Field label="Scheduled digest" description="Deliver a periodic summary of health, deploys, and incidents.">
              <Switch
                checked={digest.enabled}
                onCheckedChange={(checked) => updateMonitor({ digest: { ...digest, enabled: checked } })}
              />
            </Field>
            <Field label="Cadence" description="How often the digest is delivered.">
              <Select
                value={digest.cadence}
                onValueChange={(value) => updateMonitor({ digest: { ...digest, cadence: value as "daily" | "weekly" } })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly (Mondays)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Delivery time" description="Local hour the digest is sent.">
              <Select
                value={String(digest.hour)}
                onValueChange={(value) => updateMonitor({ digest: { ...digest, hour: Number(value) } })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HOUR_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>
        </FieldSet>

        <NotificationChannels />
      </div>
    </ScrollArea>
  );
}
