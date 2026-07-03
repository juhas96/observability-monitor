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
  toast,
} from "@glaze/core/components";
import type { NativeThemeInfo } from "@glaze/core/ipc";
import { NotificationChannels } from "./notification-channels";

interface DigestSettings {
  enabled: boolean;
  cadence: "daily" | "weekly";
  hour: number;
}

interface MonitorSettings {
  pollIntervalSeconds: number;
  notifyOnFailure: boolean;
  notifyOnSuccess: boolean;
  notifyOnlyOnChange: boolean;
  soundOnNotify: boolean;
  digest: DigestSettings;
}

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => ({
  value: String(hour),
  label: `${String(hour).padStart(2, "0")}:00`,
}));

const INTERVAL_OPTIONS = [
  { value: "30", label: "30 seconds" },
  { value: "60", label: "1 minute" },
  { value: "120", label: "2 minutes" },
  { value: "300", label: "5 minutes" },
];

export function SettingsView() {
  const [themeInfo, setThemeInfo] = useState<NativeThemeInfo | null>(null);
  const [_isLoading, setIsLoading] = useState(true);
  const [monitor, setMonitor] = useState<MonitorSettings | null>(null);

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

  useEffect(() => {
    refreshThemeInfo();
    window.glazeAPI.glaze.ipc
      .invoke<MonitorSettings>("monitor:getSettings")
      .then(setMonitor)
      .catch((error) => toast.error(`Failed to load settings: ${error}`));
  }, []);

  const updateMonitor = async (patch: Partial<MonitorSettings>) => {
    try {
      const next = await window.glazeAPI.glaze.ipc.invoke<MonitorSettings>("monitor:updateSettings", patch);
      setMonitor(next);
    } catch (error) {
      toast.error(`Failed to save settings: ${error}`);
    }
  };

  const digest: DigestSettings = monitor?.digest ?? { enabled: false, cadence: "daily", hour: 9 };

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
            <Field label="Play sound" description="Play a sound with each notification.">
              <Switch
                checked={monitor?.soundOnNotify ?? false}
                onCheckedChange={(checked) => updateMonitor({ soundOnNotify: checked })}
              />
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
