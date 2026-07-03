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
import { Trash2, Send } from "lucide-react";

type ChannelType = "slack" | "webhook";
type DispatchEventKind = "failure" | "success" | "alert" | "digest";

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
  { key: "digest", label: "Digests" },
];

const invoke = <T,>(channel: string, ...args: unknown[]): Promise<T> =>
  window.glazeAPI.glaze.ipc.invoke<T>(channel, ...args);

export function NotificationChannels() {
  const [channels, setChannels] = useState<ChannelView[]>([]);
  const [name, setName] = useState("");
  const [type, setType] = useState<ChannelType>("slack");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

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
    try {
      await invoke("channels:delete", { id: channel.id });
      await reload();
    } catch (error) {
      toast.error(`Failed to delete channel: ${error}`);
    }
  };

  return (
    <FieldSet title="Notification channels" description="Forward events to Slack or a generic webhook.">
      <FieldGroup>
        {channels.length === 0 ? (
          <EmptyState title="No channels" description="Add a Slack incoming webhook or a generic webhook URL." />
        ) : (
          <div className="flex flex-col gap-3">
            {channels.map((channel) => (
              <div key={channel.id} className="flex flex-col gap-2 rounded-lg border border-separator p-3">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{channel.type === "slack" ? "Slack" : "Webhook"}</Badge>
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
                  <SelectItem value="webhook">Webhook</SelectItem>
                </SelectContent>
              </Select>
              <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} className="flex-1" />
            </div>
            <Input
              placeholder={type === "slack" ? "https://hooks.slack.com/services/…" : "https://example.com/webhook"}
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
