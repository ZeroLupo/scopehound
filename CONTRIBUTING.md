# Contributing to ScopeHound

Thanks for your interest in contributing.

## How to Help

- **Bug reports** — Open an issue with steps to reproduce
- **Feature requests** — Open an issue describing the use case
- **Pull requests** — Fork, create a branch, submit a PR

## Local Development

ScopeHound is a single Cloudflare Worker. No build step.

1. Install Wrangler: `npm install -g wrangler`
2. Clone the repo
3. Create a KV namespace: `wrangler kv namespace create STATE`
4. Update `wrangler.toml` with your namespace ID
5. Set secrets: `wrangler secret put ADMIN_TOKEN`
6. Run locally: `wrangler dev`

## Code Style

- Single file (`workers/src/index.js`) — keep it that way
- No external dependencies — everything runs on Cloudflare's runtime
- Functions are grouped by section with comment headers
- Keep AI prompts concise — the 8B model has limited context

## Guidelines

- Don't add npm dependencies
- Don't break the single-file deployment model
- Test with `wrangler dev` before submitting
- Keep PRs focused — one feature or fix per PR
