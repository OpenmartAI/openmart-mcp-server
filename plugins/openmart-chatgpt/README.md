# Openmart hosted plugin source

The skills and assets in this directory are shared by the production Codex Beta
and OpenAI portal artifacts. This directory is a source template, not a customer
installation package. Its staging MCP configuration is intentionally replaced by
the production packager.

Build an allowlisted production artifact with:

```sh
node scripts/package-production-plugin.mjs PUBLIC_OAUTH_CLIENT_ID 0.2.1 portal
node scripts/package-production-plugin.mjs PUBLIC_OAUTH_CLIENT_ID 0.2.1 codex
```

Use a separate registered public OAuth client for each distribution. Register the
callback required by that client. Output contains only skills, assets and
manifests, with a SHA-256 checksum. Credentials and internal repository documents
are never copied. The hosted production service is implemented in gopenmart;
users do not deploy a local server or provide an API key.

See [installation and acceptance requirements](../../docs/plugin/install-codex-beta.md).
