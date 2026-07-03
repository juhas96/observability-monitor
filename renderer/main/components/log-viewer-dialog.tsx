import { useEffect, useMemo, useState } from "react";
import { Copy, ExternalLink, Search } from "lucide-react";
import { Button, Callout, Dialog, Input, Text, toast } from "@glaze/core/components";

import { monitorApi } from "../ipc";
import type { MonitorItem, MonitorLogLine, MonitorLogResponse } from "../types";

function lineText(line: MonitorLogLine): string {
  return [line.timestamp, line.section, line.stream, line.level, line.message].filter(Boolean).join(" ");
}

function renderLine(line: MonitorLogLine): string {
  const prefix = [line.timestamp, line.section, line.stream, line.level].filter(Boolean).join("  ");
  return prefix ? `${prefix}\n${line.message}` : line.message;
}

function responseText(response: MonitorLogResponse | null): string {
  return response?.lines.map(renderLine).join("\n\n") ?? "";
}

export function LogViewerDialog({
  item,
  open,
  onOpenChange,
}: {
  item: MonitorItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<MonitorLogResponse | null>(null);

  useEffect(() => {
    if (!open || !item) return;
    let cancelled = false;
    setQuery("");
    setLoading(true);
    setError(null);
    setResponse(null);
    monitorApi.getItemLogs(item.uid)
      .then((logs) => {
        if (!cancelled) setResponse(logs);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [item, open]);

  const visibleLines = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const lines = response?.lines ?? [];
    if (!needle) return lines;
    return lines.filter((line) => lineText(line).toLowerCase().includes(needle));
  }, [query, response]);

  const fallbackUrl = response?.fallbackUrl ?? item?.logFallbackUrl ?? item?.url;
  const copyLogs = async () => {
    try {
      await navigator.clipboard.writeText(responseText(response));
      toast.success("Logs copied");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };
  const openFallback = () => {
    if (!fallbackUrl) return;
    void monitorApi.openExternal(fallbackUrl).catch((err) => toast.error(String(err)));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={response?.title ?? item?.title ?? "Logs"}
      description={response?.subtitle ?? item?.subtitle ?? "Provider logs and details"}
      size="2xl"
      showCloseButton
    >
      <div className="flex flex-col gap-3 min-h-[420px]">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="size-4 text-tertiary absolute left-2 top-1/2 -translate-y-1/2" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search logs"
              className="pl-8"
              disabled={!response || response.lines.length === 0}
            />
          </div>
          <Button variant="filled" size="small" onClick={copyLogs} disabled={!response || response.lines.length === 0}>
            <Copy className="size-4" />
            Copy
          </Button>
          {fallbackUrl ? (
            <Button variant="filled" size="small" onClick={openFallback}>
              <ExternalLink className="size-4" />
              Open
            </Button>
          ) : null}
        </div>

        {loading ? (
          <Callout color="secondary">Fetching logs…</Callout>
        ) : error ? (
          <Callout color="red">{error}</Callout>
        ) : response && response.lines.length === 0 ? (
          <Callout color="secondary">No logs were returned.</Callout>
        ) : response && visibleLines.length === 0 ? (
          <Callout color="secondary">No log lines match the search.</Callout>
        ) : (
          <div className="rounded-md border border-border-subtle bg-control-subtle overflow-hidden">
            <div className="max-h-[520px] overflow-auto p-3">
              <pre className="text-xs leading-5 whitespace-pre-wrap break-words font-mono text-primary">
                {visibleLines.map(renderLine).join("\n\n")}
              </pre>
            </div>
          </div>
        )}

        {response ? (
          <Text variant="small" color="tertiary">
            Fetched {new Date(response.fetchedAt).toLocaleString()}
          </Text>
        ) : null}
      </div>
    </Dialog>
  );
}
