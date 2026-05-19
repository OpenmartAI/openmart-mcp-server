# Deployment Runbook

## Current Status

The code is ready and pushed to:

```text
https://github.com/kathrynwu/openmart-mcp-server
```

Local verification passes:

```bash
npm test
npm run typecheck
npm run build
npm pack --dry-run
```

## Publish to npm

Package name:

```text
openmart-mcp-server
```

This name is currently available on npm.

Option A, publish from your laptop:

```bash
cd /Users/kathrynwu/conductor/workspaces/mcp-server/baton-rouge
npm adduser
npm publish --access public
```

Option B, publish from GitHub Actions:

1. Create an npm access token at `https://www.npmjs.com/settings/<your-user>/tokens`.
2. Add it to the GitHub repo as an Actions secret named `NPM_TOKEN`.
3. Run the `Publish npm` workflow manually.

After publish, local Claude Code users can install with:

```bash
claude mcp add openmart -- env OPENMART_API_KEY="THEIR_OPENMART_API_KEY" npx -y openmart-mcp-server
```

## Deploy Remote MCP on Render

1. Go to `https://dashboard.render.com/`.
2. New + -> Web Service.
3. Connect `kathrynwu/openmart-mcp-server`.
4. Render should detect `render.yaml`.
5. Confirm:
   - Runtime: Docker
   - Branch: `main`
   - Health check path: `/healthz`
6. Deploy.

The MCP endpoint will be:

```text
https://<render-service>.onrender.com/mcp
```

Test it with Claude Code:

```bash
claude mcp add --transport http openmart-render https://<render-service>.onrender.com/mcp \
  --header "X-API-Key: YOUR_OPENMART_API_KEY"
```

## Optional Render Deploy Hook

If you create a Render deploy hook, add it to GitHub Actions as:

```text
RENDER_DEPLOY_HOOK_URL
```

Then run the `Deploy Render` workflow manually.

## Custom Domain

After the Render service works:

1. In Render, add custom domain:

```text
mcp.openmart.ai
```

2. In DNS, add the CNAME Render gives you.

Final customer command:

```bash
claude mcp add --transport http openmart https://mcp.openmart.ai/mcp \
  --header "X-API-Key: THEIR_OPENMART_API_KEY"
```

## Security

The API key that appeared in chat should be rotated before public launch.
