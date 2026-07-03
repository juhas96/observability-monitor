# Multi Monitor — Add Supabase, Netlify, Resend, Grafana, Heroku (provider registry)

## Context

Multi Monitor currently tracks GitHub Actions + Cloudflare across many accounts. The user wants to
broaden it into a general ops/observability monitor: **Supabase** (latest migration + error logs),
**Netlify** (deploys), **Resend** (domains + broadcasts), **Grafana** (firing alerts), and **Heroku**
(latest release), with more Supabase/other data likely later.

Today provider logic is hardcoded via `provider === "github" ? … : …` branches in the poller, the
accounts handler, and the add-account dialog, and the `Account`/`MonitorItem`/`NormalizedStatus`
types are GitHub/Cloudflare-shaped. Adding five providers this way would be brittle. This change
refactors to a small **provider registry (adapter pattern)** so each provider is one self-contained
module, and generalizes the credential + status models so logs/migrations/alerts fit. After this,
future providers are a single new adapter file + one icon entry.

**Confirmed scope:** Supabase = latest migration + rolled-up error logs; Netlify = site deploys;
Resend = domain verification status + recent broadcasts (per-email delivery needs webhooks, out of
scope); Grafana = currently firing/pending alert rules; Heroku = latest release status per app.
All auth stays token-based, stored encrypted (one secret per account), matching the current model.

## Architecture — provider registry

New `main/services/providers/` with a `ProviderDefinition` interface each provider implements:

```ts
interface CredentialField { key: string; label: string; type: "password" | "text";
  placeholder?: string; required: boolean; secret: boolean } // secret→token-store, else→account.config
interface ProviderDefinition {
  id: Provider; label: string; scopeHint: string; fields: CredentialField[];
  validate(creds: Record<string,string>): Promise<{ identity?: string }>;
  fetch(account: Account, creds: Record<string,string>): Promise<MonitorItem[]>;
}
```

- `registry.ts` — `register()`, `get(id)`, `list()`, and `publicList()` (metadata only: id/label/scopeHint/fields, no functions) for IPC.
- `index.ts` — registers all adapters (`github`, `cloudflare`, `supabase`, `netlify`, `resend`, `grafana`, `heroku`).
- Each provider has exactly one **secret** credential (the token/API key) → stays in the existing `token-store`; any extra **non-secret** fields (Supabase project ref, Grafana base URL, Cloudflare account id, GitHub repo filter) live in a generic `account.config: Record<string,string>`.

The poller, accounts handler, and dialog become **data-driven** off the registry — no per-provider branches.

## Data model changes (`main/services/types.ts` + renderer mirror `renderer/main/types.ts`)

- `Provider` union → add `"supabase" | "netlify" | "resend" | "grafana" | "heroku"`.
- Replace per-provider `GitHubAccount`/`CloudflareAccount` interfaces with a single generic shape:
  `AccountBase { id, provider, label, enabled, createdAt, lastSyncAt?, lastError?, identity?: string, config?: Record<string,string> }`; `Account = AccountBase`.
- `accounts-store.ts` `load()`: add a light migration shim mapping legacy fields on existing
  `accounts.json` → new shape (`login`/`accountName`→`identity`; `cloudflareAccountId`→`config.accountId`; `repoFilter[]`→`config.repos` comma-joined).
- `NormalizedStatus` → add `"warning"` and `"info"`.
- `MonitorItem` → broaden `kind` to include new kinds (`supabase-migration`, `supabase-log`, `netlify-deploy`, `resend-domain`, `resend-broadcast`, `grafana-alert`, `heroku-release`) and add optional `category` for row icon/labeling.
- Aggregate status priority (`aggregator.ts`): `failure > warning > running > queued > success > info > cancelled > unknown` (so firing alerts / error logs drive the tray red/orange).

## API specifics (validate uncertain endpoints with `curl` first — glaze-external-api skill)

- **Supabase** (`https://api.supabase.com`, `Bearer sbp_…`; fields: token[secret] + `projectRef`[text]): validate `GET /v1/projects/{ref}` → project name. Migration: `GET /v1/projects/{ref}/database/migrations` → newest `version`+`name` as an item (`info`/`success`). Logs: `GET /v1/projects/{ref}/analytics/endpoints/logs.all?sql=…` counting recent errors → `failure`/`warning` when errors present (query-based + rate-limited → **curl-validate**; fall back to migration-only if unavailable). url `https://supabase.com/dashboard/project/{ref}`.
- **Netlify** (`https://api.netlify.com/api/v1`, `Bearer PAT`; field: token): validate `GET /user`. `GET /sites?per_page=…` then `GET /sites/{id}/deploys?per_page=5` → `state` (ready→success, error→failure, building/enqueued→running). url = deploy `admin_url`.
- **Resend** (`https://api.resend.com`, `Bearer re_…`; field: token): validate `GET /domains`. Domains → `status` (verified→success, failed→failure, pending→warning). Broadcasts `GET /broadcasts` recent sends (**curl-validate** availability). urls `https://resend.com/domains` / `/broadcasts`.
- **Grafana** (base = instance URL; fields: `baseUrl`[text] + token[secret]): validate `GET {baseUrl}/api/health`. Firing alerts: `GET {baseUrl}/api/prometheus/grafana/api/v1/rules` → per-rule `state` (firing→failure, pending→warning, inactive→success) (**curl-validate** path; alertmanager `/api/alertmanager/grafana/api/v2/alerts` fallback). url `{baseUrl}/alerting/list`.
- **Heroku** (`https://api.heroku.com`, `Bearer key`, `Accept: application/vnd.heroku+json; version=3`; field: token): validate `GET /account` → email. `GET /apps` then `GET /apps/{id}/releases` with `Range: version ..; order=desc,max=5` → release `status` (succeeded→success, failed→failure, pending→running). url `https://dashboard.heroku.com/apps/{name}`.

Concurrency/rate-limits: reuse the existing per-account batching (`CONCURRENCY=4`) and per-account try/catch in `poller.ts`; cap items per project/app/site as the GitHub/Cloudflare clients already do.

## Files

**Backend new:** `main/services/providers/{registry.ts,index.ts,supabase.ts,netlify.ts,resend.ts,grafana.ts,heroku.ts}`; wrap existing `github-api.ts`/`cloudflare-api.ts` fetch/validate fns in `providers/github.ts` + `providers/cloudflare.ts` adapters (reuse the functions, adapt to the generic `creds` shape — don't rewrite the API logic).
**Backend modified:** `types.ts` (unions/Account/status/item), `accounts-store.ts` (generic + migration shim), `handlers/accounts.ts` (generic add/update/test driven by `definition.fields`: split secret→token-store, rest→config, call `validate`), `services/poller.ts` (`registry.get(provider).fetch(account, creds)`), `services/aggregator.ts` (status priority), new `handlers/providers.ts` (`providers:list` → `registry.publicList()`) registered in `handlers/index.ts`.
**Frontend modified:** `renderer/main/types.ts` (mirror), `renderer/main/ipc.ts` (+`providers:list`, generic add/update payloads with `config`), new `renderer/main/hooks/use-providers.ts`, `components/add-account-dialog.tsx` (fully data-driven: provider `Select` + dynamic fields from `providers:list`; remove hardcoded github/cloudflare branches + `SCOPE_HINTS`), new `renderer/main/components/provider-meta.tsx` (provider id → `{ label, Icon }`; lucide `Github`, `Cloud`, `Database`(Supabase), `Globe`(Netlify), `Send`(Resend), `BellRing`(Grafana), `Server`(Heroku) — the one place a new provider needs a manual entry), `components/account-section.tsx` + `run-row.tsx` (icons via provider-meta + `category`), `components/status-badge.tsx` (map `warning`→warning, `info`→neutral), `dashboard-view.tsx` (provider filter options from `providers:list`). `settings-view.tsx` unchanged.

## Verification

- `npm run type-check && npm run lint`; then build.
- Launch; on **Accounts → Add account**, confirm the provider dropdown lists all 7 and that selecting each renders the correct dynamic fields (e.g. Supabase shows Project ref, Grafana shows Instance URL) with working **Test connection**.
- With one real token per new provider, confirm items appear grouped under the account with correct status mapping (Supabase migration + error-log rollup, Netlify deploy state, Resend domain status, a Grafana firing alert → red, Heroku release), relative time, and open-in-browser.
- Confirm the tray color reflects the broadened aggregate status (firing alert / error logs → red/orange) and notifications fire on failure transitions.
- Confirm existing GitHub/Cloudflare accounts still load (migration shim) and that `tokens.bin.json` holds only the secret credential while non-secret fields live in `accounts.json` `config`.
- DOM snapshot for the add-account dynamic fields + dashboard grouping; preview capture only for tray color.
