# Openmart Claude Code Plugin

This plugin adds Openmart MCP tools and workflow skills to Claude Code.

## Requirements

Set your Openmart API key before starting Claude Code:

```bash
export OPENMART_API_KEY="YOUR_OPENMART_API_KEY"
```

By default the plugin connects to:

```text
https://mcp.openmart.ai/mcp
```

For local testing, override:

```bash
export OPENMART_MCP_URL="http://127.0.0.1:3000/mcp"
```

## Skills

- `/openmart:find-leads`
- `/openmart:enrich-contacts`

## Example

```text
/openmart:find-leads 50 independent hair salons in San Francisco with valid websites, then enrich owner emails
```
