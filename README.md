# ScopeHound

AI-powered competitive intelligence agent. Monitors competitor pricing, features, SEO, blogs, and Product Hunt launches. Delivers prioritized, AI-analyzed alerts to Slack.

Runs on Cloudflare Workers. Free to self-host. Zero dependencies.

## What It Does

ScopeHound checks your competitors daily and tells you what changed, why it matters, and what to do about it.

- **Pricing monitoring** — AI extracts plans and prices, detects changes, compares before/after
- **Page monitoring** — Track any URL (homepage, features, landing pages). Content-aware change detection
- **SEO tracking** — Title tags, meta descriptions, OG tags, H1 changes
- **Blog & announcements** — RSS monitoring with AI classification (funding, partnerships, product launches)
- **Product Hunt** — New launches in your categories with vote tracking
- **AI analysis** — Every change gets a priority rating (HIGH/MEDIUM/LOW), impact analysis, and recommended action
- **Slack delivery** — Daily digest with changes grouped by priority
- **Slack commands** — `/scopehound scan`, `/scopehound add <url>`, `/scopehound status`, `/scopehound ads <company>`
- **Competitor discovery** — Weekly AI-powered suggestions for new competitors to track
- **Deep discovery** — Monthly web-search-powered competitor discovery via Brave Search API (optional)
- **Ad library** — `/ads` command surfaces Meta ad library data for any competitor
- **Web dashboard** — Overview, change history, pricing comparison, SEO signals

## Quick Start

### 1. Create Cloudflare Resources

1. Log into [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Go to **Workers & Pages** > **Create**
3. Create a new Worker named `scopehound`
4. Go to **Workers & Pages** > **KV** > **Create a namespace** named `scopehound-state`
5. In your Worker **Settings** > **Bindings**, add:
   - KV namespace: variable name `STATE`, select your namespace
   - Workers AI: variable name `AI`
6. In **Settings** > **Variables** > **Secrets**, add:
   - `ADMIN_TOKEN` — any strong password (protects your config API)

### 2. Deploy

Copy the contents of `workers/src/index.js` and paste it into your Worker's code editor. Click **Deploy**.

Or via CLI:
```bash
npx wrangler deploy
```

### 3. Configure

Visit `https://your-worker.your-subdomain.workers.dev/setup` and follow the 4-step wizard:

1. Enter your admin token + Slack webhook URL
2. Add competitors (name, website, pricing URL, optional RSS)
3. Optional: Product Hunt API token + topics
4. Review and launch first scan

That's it. ScopeHound runs daily at 9am UTC.

## Optional Secrets

Set via Cloudflare dashboard or `wrangler secret put <NAME>`:

| Secret | Purpose |
|--------|---------|
| `ADMIN_TOKEN` | **Required.** Protects config API and setup wizard |
| `SLACK_WEBHOOK_URL` | Fallback if not set via setup wizard |
| `ANTHROPIC_API_KEY` | Upgrades AI analysis from Workers AI (free) to Claude (much better) |
| `BRAVE_SEARCH_API_KEY` | Enables deep web-search-powered competitor discovery (monthly) |
| `META_APP_TOKEN` | Enables live Meta ad library data for `/ads` command |
| `SLACK_CLIENT_ID` | Enables "Add to Slack" OAuth + slash commands |
| `SLACK_CLIENT_SECRET` | Slack OAuth (paired with client ID) |
| `SLACK_SIGNING_SECRET` | Verifies slash command requests from Slack |

## Architecture

Single file. No build step. No dependencies.

- **Runtime:** Cloudflare Workers
- **AI:** Cloudflare Workers AI (free) or Anthropic Claude (optional, better analysis)
- **Storage:** Cloudflare KV
- **Alerts:** Slack webhooks + optional slash commands
- **Search:** Brave Search API (optional, for competitor discovery)
- **Schedule:** Cron trigger, daily at 9am UTC

### Cost (Self-Hosted)

$0 on Cloudflare free tier for up to ~25 competitors. Optional Anthropic API key for enhanced AI analysis (~$0.10/day for 10 competitors).

## Hosted Version

Don't want to self-host? [ScopeHound Cloud](https://scopehound.app) handles everything.

| Plan | Competitors | Pages | Scans | Price |
|------|-------------|-------|-------|-------|
| Scout | 3 | 6 | Manual | $29/mo |
| Operator | 15 | 60 | Daily automated | $79/mo |
| Command | 50 | 400 | Daily automated | $199/mo |

All paid plans include AI analysis, Slack alerts, web dashboard, and change history. Operator and Command add automated scans, RSS monitoring, competitor discovery, and slash commands.

### Partner Program

Earn 50% recurring commission for 24 months on every referral. [Apply here](https://scopehound.app/partner/apply).

## License

MIT
