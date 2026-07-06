import type { InvestigationTrigger } from "../types";

export const INVESTIGATION_OPEN_EVENT = "investigation:open";
export const INVESTIGATION_CONTEXT_KEY = "investigation.context.v1";

export function openInvestigation(payload: Partial<InvestigationTrigger>): void {
  localStorage.setItem(INVESTIGATION_CONTEXT_KEY, JSON.stringify(payload));
  window.dispatchEvent(new CustomEvent(INVESTIGATION_OPEN_EVENT, { detail: payload }));
}
