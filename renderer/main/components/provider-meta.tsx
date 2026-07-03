// Per-provider display metadata. Icons can't cross IPC, so this is the one
// place a new provider needs a manual entry (label comes from providers:list).

import {
  Github,
  Cloud,
  Database,
  Globe,
  Send,
  BellRing,
  Server,
  Activity,
  Rocket,
  FileClock,
  ScrollText,
  Mail,
  ShieldCheck,
  HardDrive,
  LayoutDashboard,
  MessageSquareText,
  Bug,
  Siren,
  RadioTower,
  Gauge,
  Hexagon,
  GitPullRequest,
  type LucideIcon,
} from "lucide-react";
import type { MonitorCategory, Provider } from "../types";

const PROVIDER_ICONS: Record<Provider, LucideIcon> = {
  github: Github,
  cloudflare: Cloud,
  supabase: Database,
  netlify: Globe,
  resend: Send,
  grafana: BellRing,
  heroku: Server,
  sentry: Bug,
  pagerduty: Siren,
  statuspage: RadioTower,
  datadog: Gauge,
  honeycomb: Hexagon,
};

const PROVIDER_LABELS: Record<Provider, string> = {
  github: "GitHub",
  cloudflare: "Cloudflare",
  supabase: "Supabase",
  netlify: "Netlify",
  resend: "Resend",
  grafana: "Grafana",
  heroku: "Heroku",
  sentry: "Sentry",
  pagerduty: "PagerDuty",
  statuspage: "Statuspage",
  datadog: "Datadog",
  honeycomb: "Honeycomb",
};

const CATEGORY_ICONS: Partial<Record<MonitorCategory, LucideIcon>> = {
  run: Activity,
  deploy: Rocket,
  migration: FileClock,
  log: ScrollText,
  alert: BellRing,
  datasource: HardDrive,
  dashboard: LayoutDashboard,
  annotation: MessageSquareText,
  incident: Siren,
  issue: GitPullRequest,
  monitor: RadioTower,
  metric: Gauge,
  slo: ShieldCheck,
  trace: Activity,
  statuspage: RadioTower,
  email: Mail,
  domain: ShieldCheck,
  release: Rocket,
};

export function providerIcon(provider: Provider): LucideIcon {
  return PROVIDER_ICONS[provider] ?? Cloud;
}

export function providerLabel(provider: Provider): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

export function categoryIcon(category: MonitorCategory, provider: Provider): LucideIcon {
  return CATEGORY_ICONS[category] ?? providerIcon(provider);
}
