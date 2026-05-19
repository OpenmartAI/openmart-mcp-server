# Openmart MCP Server

MCP server for Openmart business search and decision-maker enrichment.

It supports two transports:

- Local stdio for Claude Code CLI and local development.
- Remote Streamable HTTP for hosted MCP deployments like `https://mcp.openmart.ai/mcp`.

## Tools

Two jobs — finding companies and finding people — across three tools.

- `find_business` — find companies. Wraps `POST /api/v1/search`. Every filter
  (rating, reviews, location count, ownership type, price tier, keywords,
  dates, website flags) is a flat top-level parameter. Returns each matching
  business plus `total_count` and a `next_cursor` for pagination.
- `find_decision_maker` — find people. Wraps `POST /api/v1/task/batch/find_people`:
  submits one or more batches (company lists longer than 100 are split
  automatically), polls each batch, then fetches the completed task results.
  Transient HTTP failures are retried with exponential back-off.
- `get_batch_results` — collect the results of an async batch. When a large
  `find_decision_maker` run is still processing at its timeout it returns
  `pending_batch_ids`; pass them here to finish collecting the contacts.

## Getting an API Key

Every user brings their own Openmart API key:

1. Register at [app.openmart.com/register](https://app.openmart.com/register).
2. Subscribe to a paid plan.
3. Create a key on the [API management page](https://app.openmart.com/api-management).

Provide that key to the server as the `OPENMART_API_KEY` environment variable
(local stdio) or as an `X-API-Key` request header (remote HTTP).

## Install

Add the server to any MCP client with `npx` — no clone or build needed. For
Claude Code:

```bash
claude mcp add openmart -- env OPENMART_API_KEY="YOUR_OPENMART_API_KEY" npx -y openmart-mcp-server
```

For other MCP clients (Claude Desktop, Cursor, VS Code, …), add the equivalent
entry to their MCP config:

```json
{
  "mcpServers": {
    "openmart": {
      "command": "npx",
      "args": ["-y", "openmart-mcp-server"],
      "env": { "OPENMART_API_KEY": "YOUR_OPENMART_API_KEY" }
    }
  }
}
```

Then ask the assistant, for example:

```text
Use openmart to find 3 hair salons in San Francisco with valid websites.
```

### From source (development)

```bash
npm install
npm run build
claude mcp add openmart -- env OPENMART_API_KEY="YOUR_OPENMART_API_KEY" node "$(pwd)/dist/index.js"
```

## Desktop Extension (.mcpb)

The server can also be packed as an [MCPB desktop extension](https://github.com/modelcontextprotocol/mcpb)
— a single `.mcpb` file that installs into Claude Desktop in one click and
prompts the user for their API key, with no terminal or config editing.

Build the bundle:

```bash
npm run pack:mcpb
```

This bundles the stdio server into `openmart-mcp-server.mcpb`. To install it,
open Claude Desktop → Settings → Extensions and add the file, then paste your
Openmart API key when prompted. This bundle is also the artifact submitted to
Anthropic's Connectors Directory.

## Claude Code Plugin

This repo also exposes a Claude Code plugin marketplace. See `PLUGIN.md`.

Add the marketplace:

```text
/plugin marketplace add OpenmartAI/openmart-mcp-server
```

Install the plugin:

```text
/plugin install openmart@openmart-plugins
```

Use the namespaced skills:

```text
/openmart:find-leads 3 hair salons in San Francisco with valid websites
/openmart:enrich-contacts owner emails for these businesses
```

## Remote HTTP Usage

Run locally:

```bash
npm install
npm run build
PORT=3000 npm run start:http
```

Connect Claude Code to the hosted server:

```bash
claude mcp add --transport http openmart https://mcp.openmart.ai/mcp \
  --header "X-API-Key: YOUR_OPENMART_API_KEY"
```

Bearer auth also works:

```bash
claude mcp add --transport http openmart https://mcp.openmart.ai/mcp \
  --header "Authorization: Bearer YOUR_OPENMART_API_KEY"
```

The remote server does not use a shared server-side Openmart key. It reads the user key from each MCP request and forwards it to Openmart as `X-API-Key`.

## Deploy

The repo includes a `Dockerfile` and `render.yaml`.

Minimal Docker deploy:

```bash
docker build -t openmart-mcp-server .
docker run -p 3000:3000 openmart-mcp-server
```

Health check:

```bash
curl https://mcp.openmart.ai/healthz
```

MCP endpoint:

```text
https://mcp.openmart.ai/mcp
```

## NPM Publish

Before publishing:

```bash
npm test
npm run typecheck
npm run build
npm pack --dry-run
```

Publish:

```bash
npm publish --access public
```

The package exposes two binaries:

- `openmart-mcp-server`: stdio server
- `openmart-mcp-http`: HTTP server

## CI Workflows

Two workflow files live under `docs/github-workflows/`:

- `ci.yml` — runs tests, typecheck, and build on every push and pull request.
- `release.yml` — on a `v*` tag, builds the `.mcpb` bundle, creates the GitHub
  Release with it attached, and publishes the package to npm.

To activate them, move both into `.github/workflows/` and push from a
credential that holds the GitHub `workflow` OAuth scope
(`gh auth refresh -s workflow`). `release.yml` also needs an `NPM_TOKEN`
repository secret (an npm automation token) for the publish step.

## Shared Project Config

Use `.mcp.example.json` as a template if you want to commit a team-shared Claude Code project configuration:

```bash
cp .mcp.example.json .mcp.json
```

Each developer still needs to provide `OPENMART_API_KEY` in their shell environment.

## Environment

```bash
OPENMART_API_KEY=your_openmart_api_key
OPENMART_API_BASE_URL=https://api.openmart.ai
OPENMART_POLL_INTERVAL_MS=2000
OPENMART_TIMEOUT_MS=120000
PORT=3000
HOST=0.0.0.0
CORS_ORIGIN=*
```

`OPENMART_API_KEY` is required for stdio. It is not required at HTTP server startup because remote users pass the key per request.

## Tool Inputs

`find_business` — all filters are flat, top-level keys. There is no nested
`filters` object; anything wrapped in one is ignored by `/api/v1/search`.

```json
{
  "query": "hair salon",
  "location": [{ "country": "US", "state": "CA", "city": "San Francisco" }],
  "limit": 50,
  "has_valid_website": true,
  "has_contact_info": true,
  "max_locations": 5,
  "min_total_reviews": 20,
  "min_overall_rating": 4.0,
  "ownership_type": "INDEPENDENT",
  "open_date_after": "2025-01-01"
}
```

Search target: pass `query`, `tags`, or `store_name` — `tags` wins over
`store_name`, which wins over `query`.

The response carries `businesses`, `total_count` (full match count),
`has_more`, and `next_cursor`. To page, repeat the call with `cursor` set to
the previous `next_cursor` while `has_more` is true; stop when it is false.

`find_decision_maker` accepts either `companies` or the `businesses` returned by `find_business`:

```json
{
  "businesses": [
    {
      "openmart_id": "54ff8cd5-7497-4f46-9c0c-c6b8c0d10d04",
      "business_name": "Blue Bottle Coffee",
      "root_domain": "bluebottlecoffee.com",
      "city": "San Francisco",
      "state": "CA",
      "country": "US"
    }
  ],
  "title": "Owner",
  "max_k": 3,
  "info_access": ["EMAIL", "PHONE"]
}
```

Rows without a domain are skipped and returned in `skipped_rows` with `reason: "missing_domain"`.

`get_batch_results` resumes a `find_decision_maker` run that returned status `processing`:

```json
{
  "batch_ids": ["ccd0e75a-1d3f-449c-afa4-a687de36c994"]
}
```

It returns the contacts collected so far; if some batches are still running it returns status `processing` again with the remaining `pending_batch_ids` — wait a few seconds and call it again with those.

## Testing

### Automated

```bash
npm test
npm run typecheck
npm run build
```

`npm test` runs three layers:

- **unit** (`test/openmart.test.ts`) — pure helpers (domain parsing, list chunking).
- **contract** (`test/contract.test.ts`) — `openmart.ts` against canned responses
  shaped like the real Openmart API: flat search body, async batch flow, retries.
- **end-to-end** (`test/e2e.test.ts`) — spawns the real stdio server, connects a
  real MCP client, and drives `tools/list` plus every tool over JSON-RPC. A local
  HTTP server stands in for `api.openmart.ai`, so it needs no API key and no credits.

### Interactive (MCP Inspector)

Drive the server against the live Openmart API with the official inspector UI:

```bash
npm run build
OPENMART_API_KEY="YOUR_OPENMART_API_KEY" npx @modelcontextprotocol/inspector node dist/index.js
```

### In Claude Code

```bash
npm run build
claude mcp add openmart -- env OPENMART_API_KEY="YOUR_OPENMART_API_KEY" node "$(pwd)/dist/index.js"
```

Then ask Claude, for example: `find 3 coffee shops in San Francisco with valid websites and get their owner emails`.

## Privacy

This server holds no data of its own. It forwards the search and enrichment
parameters you pass to the Openmart API, authenticated with your own API key,
and returns the response. Data handling is governed by the
[Openmart privacy policy](https://www.openmart.com/privacy-policy).
