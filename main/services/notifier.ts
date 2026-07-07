/**
 * Native notification wrapper. Fires notifications for status transitions,
 * honoring the user's notification preferences. Clicking opens the item URL.
 */

import { Notification, shell, logger } from "@glaze/core/backend";

import type { StatusTransition } from "./diff-engine.js";
import { dispatch } from "./dispatch.js";
import { isNotificationMuted } from "./notification-mute.js";
import { isSilenced } from "./triage-store.js";
import { listAccounts } from "./accounts-store.js";
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

export async function notifyTransitions(transitions: StatusTransition[], settings: MonitorSettings): Promise<void> {
  const nativeSupported = Notification.isSupported();
  const accounts = await listAccounts().catch(() => []);
  const groupByAccount = new Map(accounts.map((account) => [account.id, account.groupId]));

  for (const t of transitions) {
    // Global snooze suppresses all delivery. Scoped recurring maintenance windows
    // suppress only matching provider/account/group rows.
    if (isNotificationMuted(settings, new Date(), {
      accountId: t.item.accountId,
      provider: t.item.provider,
      groupId: groupByAccount.get(t.item.accountId),
    })) continue;

    const isFailure = t.next === "failure";
    const isSuccess = t.next === "success";

    if (isFailure && !settings.notifyOnFailure) continue;
    if (isSuccess && !settings.notifyOnSuccess) continue;
    if (!isFailure && !isSuccess) continue; // only notify terminal states
    if (await isSilenced(t.item.uid)) continue;

    // When "only notify on change" is off we still only fire on transitions
    // here (the diff-engine only yields transitions), so the flag mainly
    // guards future non-transition notification paths.

    const title = isFailure ? `❌ ${t.item.title}` : `✅ ${t.item.title}`;
    const body = [t.item.subtitle, t.item.commitMessage].filter(Boolean).join(" — ");
    const bodyText = body || (isFailure ? "Run failed" : "Run succeeded");

    if (nativeSupported) {
      try {
        const notification = new Notification({
          title,
          subtitle: providerLabel(t.item.kind),
          body: bodyText,
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

    // Forward to configured Slack, Teams, and webhook channels (never throws into the poll cycle).
    void dispatch({
      kind: isFailure ? "failure" : "success",
      title: `${isFailure ? "Failure" : "Success"}: ${t.item.title}`,
      body: bodyText,
      url: t.item.url,
    });
  }
}
