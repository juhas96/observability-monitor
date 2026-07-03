/**
 * Native notification wrapper. Fires notifications for status transitions,
 * honoring the user's notification preferences. Clicking opens the item URL.
 */

import { Notification, shell, logger } from "@glaze/core/backend";

import type { StatusTransition } from "./diff-engine.js";
import type { MonitorSettings } from "./types.js";

function providerLabel(kind: string): string {
  switch (kind) {
    case "github-run":
      return "GitHub Actions";
    case "cf-pages":
      return "Cloudflare Pages";
    case "cf-worker":
      return "Cloudflare Workers";
    default:
      return "CI/CD";
  }
}

export function notifyTransitions(transitions: StatusTransition[], settings: MonitorSettings): void {
  if (!Notification.isSupported()) return;

  for (const t of transitions) {
    const isFailure = t.next === "failure";
    const isSuccess = t.next === "success";

    if (isFailure && !settings.notifyOnFailure) continue;
    if (isSuccess && !settings.notifyOnSuccess) continue;
    if (!isFailure && !isSuccess) continue; // only notify terminal states

    // When "only notify on change" is off we still only fire on transitions
    // here (the diff-engine only yields transitions), so the flag mainly
    // guards future non-transition notification paths.

    const title = isFailure ? `❌ ${t.item.title}` : `✅ ${t.item.title}`;
    const body = [t.item.subtitle, t.item.commitMessage].filter(Boolean).join(" — ");

    try {
      const notification = new Notification({
        title,
        subtitle: providerLabel(t.item.kind),
        body: body || (isFailure ? "Run failed" : "Run succeeded"),
        silent: !settings.soundOnNotify,
      });
      notification.on("click", () => {
        void shell.openExternal(t.item.url).catch((err) => {
          logger.warn("notifier", "Failed to open URL from notification", { err: String(err) });
        });
      });
      notification.show();
    } catch (err) {
      logger.warn("notifier", "Failed to show notification", { err: String(err) });
    }
  }
}
