# Getting Started with Openmart for Claude

Connect Claude to Openmart and search local businesses and find decision-maker
contacts — without leaving your chat. This guide walks you through setup in a
few minutes.

## What you'll need

1. **The Claude Desktop app** — Openmart currently runs in Claude Desktop on
   macOS and Windows. (See *Where Openmart works today* below.)
2. **An Openmart API key** — your personal key:
   - Register at <https://app.openmart.com/register>
   - Subscribe to a paid plan
   - Create a key on the [API management page](https://app.openmart.com/api-management)

Keep the key handy — you'll paste it in during setup.

## Install in Claude Desktop

1. **Download the Openmart connector:**
   [openmart-mcp-server-0.1.5.mcpb](https://github.com/OpenmartAI/openmart-mcp-server/releases/download/v0.1.5/openmart-mcp-server-0.1.5.mcpb)

2. In Claude Desktop, open **Settings → Extensions** and add the file you just
   downloaded. If you see an "unsigned extension" notice, that's expected —
   choose to continue.

3. When prompted, **paste your Openmart API key**.

4. **Turn the Openmart extension's toggle ON.** This step is required — a
   newly added extension stays switched off until you enable it.

5. **Start a new conversation.** Tools aren't added to chats that were already
   open. If they still don't appear, fully quit and reopen Claude Desktop.

That's it. To confirm it's working, ask Claude *"what tools do you have?"* —
you should see **find_business**, **find_decision_maker**, and
**get_batch_results**.

## How to use it

Just ask Claude in plain language. For example:

> Use Openmart to find 3 hair salons in San Francisco with valid websites.

> Find coffee shops in Oakland, CA and get their owners' email addresses.

What Openmart can do for you:

- **Find businesses** — search by location, category, rating, review count,
  price tier, and more.
- **Find decision-makers** — get contact details (email, phone, LinkedIn) for
  owners and other roles at those businesses.

**Tip for large searches:** results come back a page at a time. For a big pull
(say, hundreds of businesses across a whole region), ask Claude to go city by
city — it works through the pages more reliably that way.

## Where Openmart works today

| Where | Status |
|---|---|
| **Claude Desktop** (macOS / Windows) | ✅ Available now — follow the steps above |
| **Claude Code / Cursor / VS Code** (for developers) | ✅ Available now — see below |
| **Claude on the web** (claude.ai in a browser) | 🚧 Not yet supported. Web access is under active development — please use Claude Desktop for now. |

A one-click listing in Claude's official plugin marketplace has been submitted
to Anthropic and is **currently under review**. Once it's approved, you'll be
able to add Openmart without downloading a file. Until then, the steps above
are the way to get started.

## For developers

If you use Claude Code, you can add Openmart from npm — no download needed:

```bash
claude mcp add openmart -- env OPENMART_API_KEY="YOUR_OPENMART_API_KEY" npx -y openmart-mcp-server
```

Other MCP-compatible clients (Cursor, VS Code, …) accept the equivalent config:

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

## Troubleshooting

**Claude says it can't find Openmart, or has no such tools.**
The extension is installed but not switched on. Go to **Settings → Extensions →
openmart-mcp-server**, turn the toggle **ON**, and start a new conversation.

**Claude reports a missing API key.**
Your key wasn't saved. Open the Openmart extension's settings and paste your
key again.

## Privacy

Openmart's connector stores none of your data. It passes your search request
to the Openmart API using your own API key and returns the results. Data
handling is governed by the
[Openmart privacy policy](https://www.openmart.com/privacy-policy).

## Need help?

Email us or open an issue at
<https://github.com/OpenmartAI/openmart-mcp-server/issues>.
