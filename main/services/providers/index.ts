/**
 * Registers every provider adapter. Import this once at startup (before the
 * poller runs) so the registry is populated.
 */

import { register } from "./registry.js";
import { githubProvider } from "./github.js";
import { cloudflareProvider } from "./cloudflare.js";
import { supabaseProvider } from "./supabase.js";
import { netlifyProvider } from "./netlify.js";
import { resendProvider } from "./resend.js";
import { grafanaProvider } from "./grafana.js";
import { herokuProvider } from "./heroku.js";

let registered = false;

export function registerProviders(): void {
  if (registered) return;
  register(githubProvider);
  register(cloudflareProvider);
  register(supabaseProvider);
  register(netlifyProvider);
  register(resendProvider);
  register(grafanaProvider);
  register(herokuProvider);
  registered = true;
}

export * from "./registry.js";
