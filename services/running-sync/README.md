# Running sync backend

A personal Cloudflare Worker and SQLite-backed Durable Object that connect the running planner to Strava's official MCP. The frontend remains on GitHub Pages.

The service handles OAuth authorization, encrypted credential storage, browser sessions, and bounded activity requests. It does not retain activity responses, generate AI requests, or change training plans. Automatic refresh requires a verified mapping of the official connector's activity tool; live Strava authorization and imports remain unverified.

- `worker.mjs`: request routing, origin and session checks, authorization, encrypted storage, and refresh timing.
- `mcp.mjs`: official MCP transport, OAuth discovery, activity mapping, and validation.
- `wrangler.jsonc`: public deployment configuration. Credentials are held in Cloudflare secrets.

Personal setup instructions and deployment notes are kept locally in `local-notes/`, which is ignored by Git and excluded from Jekyll. This service directory is also excluded from the built website; its source code is intended to be versioned. Public service URLs are configuration, not credentials.

Run protocol and security checks from the repository root:

```sh
node --test tests/milepost-sync.test.js
```

With Node 22 or newer, run `npm ci` and `npm run test:runtime` from this directory to bundle the Worker and exercise authorization, token renewal, MCP reads, revocation, and redirect rejection in Cloudflare's workerd runtime. Every upstream response uses synthetic data. `npm run check` only verifies the bundle without deploying. These checks do not establish live Strava access or successful activity synchronization.
