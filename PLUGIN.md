# Openmart Claude Code Plugin

This repo is also a Claude Code plugin marketplace.

## Marketplace Install

After this repo is public or the user has access to the private repo, add the marketplace in Claude Code:

```text
/plugin marketplace add OpenmartAI/openmart-mcp-server
```

Then install:

```text
/plugin install openmart@openmart-plugins
```

Reload:

```text
/reload-plugins
```

Set the API key before starting Claude Code:

```bash
export OPENMART_API_KEY="YOUR_OPENMART_API_KEY"
```

The plugin connects to `https://mcp.openmart.ai/mcp` by default. For local testing:

```bash
export OPENMART_MCP_URL="http://127.0.0.1:3000/mcp"
npm run build
PORT=3000 npm run start:http
claude --plugin-dir ./plugins/openmart
```

Then run:

```text
/openmart:find-leads 3 hair salons in San Francisco with valid websites
```

## Included Components

- `.mcp.json`: configures the Openmart remote HTTP MCP server.
- `/openmart:find-leads`: skill for search + optional enrichment.
- `/openmart:enrich-contacts`: skill for decision-maker enrichment.

## Notes

The repo must contain `.claude-plugin/marketplace.json` at the marketplace root. The plugin source path is `./plugins/openmart`.
