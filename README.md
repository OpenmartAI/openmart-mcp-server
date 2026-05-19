# Openmart MCP Server

MCP server for Openmart business search and decision-maker enrichment.

It supports two transports:

- Local stdio for Claude Code CLI and local development.
- Remote Streamable HTTP for hosted MCP deployments like `https://mcp.openmart.ai/mcp`.

## Tools

Two tools, for two jobs — finding companies and finding people.

- `find_business` — find companies. Wraps `POST /api/v1/search`. Every filter
  (rating, reviews, location count, ownership type, price tier, keywords,
  dates, website flags) is a flat top-level parameter. Returns each matching
  business plus `total_count` and a `next_cursor` for pagination.
- `find_decision_maker` — find people. Wraps `POST /api/v1/task/batch/find_people`:
  submits one or more batches (company lists longer than 100 are split
  automatically), polls each batch, then fetches the completed task results.
  Transient HTTP failures are retried with exponential back-off.

## Local Stdio Usage

From this repo:

```bash
npm install
npm run build
export OPENMART_API_KEY="YOUR_OPENMART_API_KEY"
claude mcp add openmart -- env OPENMART_API_KEY="$OPENMART_API_KEY" node "$(pwd)/dist/index.js"
```

After publishing to npm:

```bash
claude mcp add openmart -- env OPENMART_API_KEY="YOUR_OPENMART_API_KEY" npx -y openmart-mcp-server
```

Then ask Claude Code:

```text
Use openmart to find 3 hair salons in San Francisco with valid websites.
```

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

The CI, npm-publish, and Render-deploy workflow files are parked under
`docs/github-workflows/`. To activate them as real GitHub Actions, move them
into `.github/workflows/` and push from a credential that holds the GitHub
`workflow` OAuth scope (`gh auth refresh -s workflow`).

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
`store_name`, which wins over `query`. The response carries `businesses`,
`total_count`, and `next_cursor` (pass it back as `cursor` to page further).

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

## Verify

```bash
npm test
npm run typecheck
npm run build
```
