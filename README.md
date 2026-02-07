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

### 3. Configure

Visit `https://your-worker.your-subdomain.workers.dev/setup` and follow the 4-step wizard:

1. Enter your admin token + Slack webhook URL
2. Add competitors (name, website, pricing URL, optional RSS)
3. Optional: Product Hunt API token + topics
4. Review and launch first scan

That's it. ScopeHound runs daily at 9am UTC.

## Endpoints

| Path | Description |
|------|-------------|
| `/dashboard` | Web dashboard |
| `/setup` | Configuration wizard |
| `/test` | Run monitor manually |
| `/state` | View raw state JSON |
| `/history` | View change history |
| `/test-slack` | Send test Slack message |
| `/reset` | Reset all state |
| `/reset-pricing` | Reset pricing data only |
| `/api/config` | Read config (requires auth) |

## Architecture

Single file. No build step. No dependencies.

- **Runtime:** Cloudflare Workers (free tier)
- **AI:** Cloudflare Workers AI — Llama 3.1 8B (free tier)
- **Storage:** Cloudflare KV (free tier)
- **Alerts:** Slack webhooks
- **Schedule:** Cron trigger, daily at 9am UTC

### Cost

$0 on Cloudflare free tier for up to ~25 competitors.

## Hosted Version

Don't want to self-host? ScopeHound Cloud handles everything — no Cloudflare account needed, team features, advanced analytics.

| Plan | Competitors | Price |
|------|-------------|-------|
| Recon | 3 | Free |
| Operator | 15 | $49/mo |
| Commander | 25 | $99/mo |
| Strategic | 50 | $199/mo |

### Partner Program

Earn 50% recurring commission for 24 months on every referral.

## License

MIT
