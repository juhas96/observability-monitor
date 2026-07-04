import type { MaintenanceWindow, MonitorSettings, RuleScope } from "./types.js";

export type NotificationMuteTarget = RuleScope;

function previousDay(day: number): number {
  return day === 0 ? 6 : day - 1;
}

function windowActive(window: MaintenanceWindow, at: Date): boolean {
  if (!window.enabled) return false;
  const day = at.getDay();
  const hour = at.getHours();

  if (window.startHour === window.endHour) {
    return window.days.includes(day);
  }

  if (window.startHour < window.endHour) {
    return window.days.includes(day) && hour >= window.startHour && hour < window.endHour;
  }

  return (window.days.includes(day) && hour >= window.startHour) ||
    (window.days.includes(previousDay(day)) && hour < window.endHour);
}

function scopeMatchesTarget(scope: RuleScope | undefined, target: NotificationMuteTarget | undefined): boolean {
  if (!scope || Object.values(scope).every((value) => !value)) return true;
  if (!target) return false;
  if (scope.groupId && scope.groupId !== target.groupId) return false;
  if (scope.accountId && scope.accountId !== target.accountId) return false;
  if (scope.provider && scope.provider !== target.provider) return false;
  if (scope.checkId && scope.checkId !== target.checkId) return false;
  return true;
}

export function isMaintenanceWindowActive(settings: MonitorSettings, at = new Date(), target?: NotificationMuteTarget): boolean {
  return settings.maintenanceWindows.some((window) => windowActive(window, at) && scopeMatchesTarget(window.scope, target));
}

export function isNotificationMuted(settings: MonitorSettings, at = new Date(), target?: NotificationMuteTarget): boolean {
  if (settings.mutedUntil && new Date(settings.mutedUntil).getTime() > at.getTime()) return true;
  return isMaintenanceWindowActive(settings, at, target);
}
