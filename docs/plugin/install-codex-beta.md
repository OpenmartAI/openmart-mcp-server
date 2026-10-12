# Openmart for Codex — production Beta

Status: release candidate, not yet listed in the public plugin directory. Do not
send a customer an internal test package or claim directory approval.

## Install a released Beta package

Prerequisites: a current Codex desktop app and CLI, an Openmart account, and access
to the team you want to use. Search and enrichment use that team's credits.

1. Download the `openmart-codex-VERSION.zip` asset and its SHA-256 file from an
   Openmart release. Verify the checksum and extract it into a permanent folder.
2. Add the extracted folder (the folder containing `.agents`) and install:

   ```sh
   codex plugin marketplace add /absolute/path/to/extracted-openmart-package
   codex plugin add openmart@openmart-beta
   ```

3. In Codex, open the Openmart plugin and choose Connect. Sign in to Openmart,
   select your team and permissions, then approve the connection.
4. Start a new chat: “Check my Openmart connection and credit balance.” This check
   should not start a paid search.
5. Try: “Find 3 coffee shops in Austin.” Select one result and ask for one owner
   email. Contact discovery runs asynchronously; wait for its final job status.

Do not paste an API key, password or OAuth token into chat. The browser returning
to `127.0.0.1` is the Codex app's local OAuth callback. Keep Codex running through
this step. This candidate uses local port 43872; if it is occupied, stop and report
the connection error rather than editing callback settings independently.

## Data and credits

- Searches and contact enrichment may consume credits. A row limit is not a
  spending cap. Phone enrichment is optional.
- Results can be missing or unmatched; do not treat a missing field as verified.
- File download buttons depend on the host's support. Do not promise a downloadable
  CSV in every client.
- Disconnect in Openmart **Settings → Connected apps**. Disconnecting also removes
  saved plugin results associated with that connection.

## Before inviting customers

Verify this exact package from a clean Codex installation and a separate Openmart
account: sign-in, correct team/balance, one small search, asynchronous contact
completion, reconnect and revocation. The developer's existing connection does
not satisfy this check. Record the client version and ZIP checksum.

## Rebuild (maintainers)

```sh
node scripts/package-production-plugin.mjs PUBLIC_CODEX_OAUTH_CLIENT_ID 0.2.1 codex
node scripts/package-production-plugin.mjs PUBLIC_PORTAL_OAUTH_CLIENT_ID 0.2.1 portal
```

Artifacts are under `dist/release`. The public OAuth client ID is not a secret;
never add a client secret, service key or user access token to a package. Register
only the actual callback URLs required by each client. Use separate clients for
Codex Beta and public-directory submission. The portal ZIP is not the Codex
marketplace ZIP.
