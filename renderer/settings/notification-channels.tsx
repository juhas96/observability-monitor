import { useEffect, useState } from "react";
import {
  Button,
  Input,
  Field,
  FieldGroup,
  FieldSet,
  Switch,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Badge,
  Text,
  EmptyState,
  toast,
} from "@glaze/core/components";
import { Download, Trash2, Send } from "lucide-react";

import {
  ALL,
  type AppliedFilter,
  FilterMenu,
  FilterSearchField,
  FilterSelectField,
  optionLabel,
  useStoredState,
} from "../main/components/filters";
import { downloadCsv } from "../main/utils/csv";

type ChannelType = "slack" | "teams" | "webhook";
type DispatchEventKind = "failure" | "success" | "alert" | "recovery" | "digest";

interface ChannelView {
  id: string;
  type: ChannelType;
  name: string;
  enabled: boolean;
  events: DispatchEventKind[];
  hasUrl: boolean;
}

const EVENT_OPTIONS: { key: DispatchEventKind; label: string }[] = [
  { key: "failure", label: "Failures" },
  { key: "success", label: "Successes" },
  { key: "alert", label: "Alerts" },
  { key: "recovery", label: "Recoveries" },
  { key: "digest", label: "Digests" },
];

const FILTER_KEY = "notificationChannels.filters.v1";
const FILTER_PRESET_KEY = `${FILTER_KEY}.presets`;

interface ChannelFilters {
  search: string;
  type: "all" | ChannelType;
  enabled: "all" | "enabled" | "disabled";
  url: "all" | "configured" | "missing";
  event: "all" | DispatchEventKind;
}

const DEFAULT_FILTERS: ChannelFilters = {
  search: "",
  type: ALL,
  enabled: "all",
  url: "all",
  event: "all",
};

const invoke = <T,>(channel: string, ...args: unknown[]): Promise<T> =>
  window.glazeAPI.glaze.ipc.invoke<T>(channel, ...args);

function channelTypeLabel(type: ChannelType): string {
  if (type === "slack") return "Slack";
  if (type === "teams") return "Teams";
  return "Webhook";
}

function placeholderForType(type: ChannelType): string {
  if (type === "slack") return "https://hooks.slack.com/services/…";
  if (type === "teams") return "https://...";
  return "https://example.com/webhook";
}

function downloadChannelsCsv(channels: ChannelView[]): void {
  const columns = ["id", "name", "type", "enabled", "urlConfigured", "events"];
  const rows = channels.map((channel) => [
    channel.id,
    channel.name,
    channel.type,
    channel.enabled ? "enabled" : "disabled",
    channel.hasUrl ? "configured" : "missing",
    channel.events.join("; "),
  ]);
  downloadCsv(`notification-channels-${new Date().toISOString().slice(0, 10)}.csv`, columns, rows);
}

export function NotificationChannels() {
  const [channels, setChannels] = useState<ChannelView[]>([]);
  const [storedFilters, setFilters, resetFilters] = useStoredState<ChannelFilters>(FILTER_KEY, DEFAULT_FILTERS);
  const filters: ChannelFilters = { ...DEFAULT_FILTERS, ...storedFilters };
  const [name, setName] = useState("");
  const [type, setType] = useState<ChannelType>("slack");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const setFilter = <K extends keyof ChannelFilters>(key: K, value: ChannelFilters[K]) => setFilters({ ...filters, [key]: value });

  const reload = async () => {
    try {
      setChannels(await invoke<ChannelView[]>("channels:list"));
    } catch (error) {
      toast.error(`Failed to load channels: ${error}`);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const addChannel = async () => {
    if (name.trim() === "" || url.trim() === "") {
      toast.error("Name and webhook URL are required.");
      return;
    }
    setBusy(true);
    try {
      await invoke<ChannelView>("channels:save", {
        type,
        name: name.trim(),
        enabled: true,
        events: ["failure", "alert"] as DispatchEventKind[],
        url: url.trim(),
      });
      setName("");
      setUrl("");
      await reload();
    } catch (error) {
      toast.error(`Failed to save channel: ${error}`);
    } finally {
      setBusy(false);
    }
  };

  const patchChannel = async (channel: ChannelView, patch: Partial<Pick<ChannelView, "enabled" | "events">>) => {
    try {
      await invoke<ChannelView>("channels:save", {
        id: channel.id,
        type: channel.type,
        name: channel.name,
        enabled: patch.enabled ?? channel.enabled,
        events: patch.events ?? channel.events,
      });
      await reload();
    } catch (error) {
      toast.error(`Failed to update channel: ${error}`);
    }
  };

  const toggleEvent = (channel: ChannelView, kind: DispatchEventKind) => {
    const events = channel.events.includes(kind)
      ? channel.events.filter((e) => e !== kind)
      : [...channel.events, kind];
    void patchChannel(channel, { events });
  };

  const testChannel = async (channel: ChannelView) => {
    try {
      await invoke("channels:test", { id: channel.id });
      toast.success(`Sent a test message to ${channel.name}.`);
    } catch (error) {
      toast.error(`Test failed: ${error}`);
    }
  };

  const deleteChannel = async (channel: ChannelView) => {
    if (!window.confirm(`Delete notification channel "${channel.name}"?`)) return;
    try {
      await invoke("channels:delete", { id: channel.id });
      await reload();
      toast.success("Channel deleted.");
    } catch (error) {
      toast.error(`Failed to delete channel: ${error}`);
    }
  };

  const typeOptions = [
    { value: ALL, label: "All channel types" },
    { value: "slack", label: "Slack" },
    { value: "teams", label: "Teams" },
    { value: "webhook", label: "Webhook" },
  ];
  const enabledOptions = [
    { value: "all", label: "All states" },
    { value: "enabled", label: "Enabled" },
    { value: "disabled", label: "Disabled" },
  ];
  const urlOptions = [
    { value: "all", label: "All URL states" },
    { value: "configured", label: "URL configured" },
    { value: "missing", label: "URL missing" },
  ];
  const eventOptions = [
    { value: "all", label: "All events" },
    ...EVENT_OPTIONS.map((event) => ({ value: event.key, label: event.label })),
  ];
  const filteredChannels = channels.filter((channel) => {
    const search = filters.search.trim().toLowerCase();
    if (search) {
      const subscribedEvents = EVENT_OPTIONS
        .filter((event) => channel.events.includes(event.key))
        .map((event) => event.label)
        .join(" ");
      const haystack = [
        channel.name,
        channelTypeLabel(channel.type),
        channel.enabled ? "enabled" : "disabled",
        channel.hasUrl ? "url configured" : "url missing",
        subscribedEvents,
      ].join(" ").toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    if (filters.type !== ALL && channel.type !== filters.type) return false;
    if (filters.enabled === "enabled" && !channel.enabled) return false;
    if (filters.enabled === "disabled" && channel.enabled) return false;
    if (filters.url === "configured" && !channel.hasUrl) return false;
    if (filters.url === "missing" && channel.hasUrl) return false;
    if (filters.event !== "all" && !channel.events.includes(filters.event)) return false;
    return true;
  });
  const activeFilters: AppliedFilter[] = [
    filters.search.trim()
      ? { id: "search", label: "Search", value: filters.search.trim(), onClear: () => setFilter("search", DEFAULT_FILTERS.search) }
      : null,
    filters.type !== DEFAULT_FILTERS.type
      ? { id: "type", label: "Type", value: optionLabel(typeOptions, filters.type), onClear: () => setFilter("type", DEFAULT_FILTERS.type) }
      : null,
    filters.enabled !== DEFAULT_FILTERS.enabled
      ? { id: "enabled", label: "State", value: optionLabel(enabledOptions, filters.enabled), onClear: () => setFilter("enabled", DEFAULT_FILTERS.enabled) }
      : null,
    filters.url !== DEFAULT_FILTERS.url
      ? { id: "url", label: "URL", value: optionLabel(urlOptions, filters.url), onClear: () => setFilter("url", DEFAULT_FILTERS.url) }
      : null,
    filters.event !== DEFAULT_FILTERS.event
      ? { id: "event", label: "Event", value: optionLabel(eventOptions, filters.event), onClear: () => setFilter("event", DEFAULT_FILTERS.event) }
      : null,
  ].filter((filter): filter is AppliedFilter => filter !== null);
  const exportChannels = () => {
    downloadChannelsCsv(filteredChannels);
    toast.success(`Exported ${filteredChannels.length} notification ${filteredChannels.length === 1 ? "channel" : "channels"}`);
  };

  return (
    <FieldSet title="Notification channels" description="Forward events to Slack, Teams, or a generic webhook.">
      <FieldGroup>
        {channels.length === 0 ? (
          <EmptyState title="No channels" description="Add a Slack, Teams, or generic webhook URL." />
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <Text variant="small" color="secondary">
                {filteredChannels.length} of {channels.length} channels
              </Text>
              <div className="flex items-center gap-2">
                <Button variant="glass" size="small" onClick={exportChannels} disabled={filteredChannels.length === 0}>
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
                  <FilterSearchField label="Search" value={filters.search} onChange={(value) => setFilter("search", value)} placeholder="Name, event, state..." />
                  <FilterSelectField label="Type" value={filters.type} onChange={(value) => setFilter("type", value as ChannelFilters["type"])} options={typeOptions} />
                  <FilterSelectField label="State" value={filters.enabled} onChange={(value) => setFilter("enabled", value as ChannelFilters["enabled"])} options={enabledOptions} />
                  <FilterSelectField label="URL" value={filters.url} onChange={(value) => setFilter("url", value as ChannelFilters["url"])} options={urlOptions} />
                  <FilterSelectField label="Event" value={filters.event} onChange={(value) => setFilter("event", value as ChannelFilters["event"])} options={eventOptions} />
                </FilterMenu>
              </div>
            </div>
            {filteredChannels.length === 0 ? (
              <EmptyState title="No channels match" description="Reset filters or adjust the selected channel filters.">
                <Button variant="glass" size="small" onClick={resetFilters}>
                  Reset filters
                </Button>
              </EmptyState>
            ) : null}
            {filteredChannels.map((channel) => (
              <div key={channel.id} className="flex flex-col gap-2 rounded-lg border border-separator p-3">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{channelTypeLabel(channel.type)}</Badge>
                  <Text weight="medium" className="flex-1 truncate">
                    {channel.name}
                  </Text>
                  <Switch
                    checked={channel.enabled}
                    onCheckedChange={(checked) => patchChannel(channel, { enabled: checked })}
                  />
                  <Button variant="transparent" size="small" iconOnly onClick={() => testChannel(channel)} aria-label="Send test">
                    <Send className="size-4" />
                  </Button>
                  <Button variant="transparent" size="small" iconOnly onClick={() => deleteChannel(channel)} aria-label="Delete channel">
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {EVENT_OPTIONS.map((opt) => {
                    const on = channel.events.includes(opt.key);
                    return (
                      <Button
                        key={opt.key}
                        variant={on ? "accent" : "glass"}
                        size="small"
                        onClick={() => toggleEvent(channel, opt.key)}
                      >
                        {opt.label}
                      </Button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        <Field label="Add a channel" description="The URL is stored encrypted and never leaves your device except to deliver notifications.">
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <Select value={type} onValueChange={(v) => setType(v as ChannelType)}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="slack">Slack</SelectItem>
                  <SelectItem value="teams">Teams</SelectItem>
                  <SelectItem value="webhook">Webhook</SelectItem>
                </SelectContent>
              </Select>
              <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} className="flex-1" />
            </div>
            <Input
              placeholder={placeholderForType(type)}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <Button variant="accent" size="small" onClick={addChannel} disabled={busy} className="self-start">
              Add channel
            </Button>
          </div>
        </Field>
      </FieldGroup>
    </FieldSet>
  );
}
