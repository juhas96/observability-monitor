import { Status } from "@glaze/core/components";
import type { NormalizedStatus } from "../types";

const STATUS_META: Record<NormalizedStatus, { variant: "neutral" | "loading" | "error" | "warning" | "success"; label: string }> = {
  success: { variant: "success", label: "Passed" },
  failure: { variant: "error", label: "Failed" },
  warning: { variant: "warning", label: "Warning" },
  running: { variant: "loading", label: "Running" },
  queued: { variant: "warning", label: "Queued" },
  cancelled: { variant: "neutral", label: "Cancelled" },
  info: { variant: "neutral", label: "Info" },
  unknown: { variant: "neutral", label: "Unknown" },
};

export function StatusBadge({ status }: { status: NormalizedStatus }) {
  const meta = STATUS_META[status];
  return <Status variant={meta.variant}>{meta.label}</Status>;
}

export function statusLabel(status: NormalizedStatus): string {
  return STATUS_META[status].label;
}
