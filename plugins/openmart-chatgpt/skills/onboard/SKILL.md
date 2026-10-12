---
name: onboard
description: Check an Openmart plugin connection and help a newly connected user start business discovery or contact enrichment. Use during Openmart onboarding or connection troubleshooting.
---

Call `get_account_status` once. Explain the available balance and offer a concrete first task, such as finding 10 coffee shops in a city. Do not start a paid search during onboarding unless the user requested one.

If authentication is missing or expired, use the host's Connect/Reconnect flow. Never ask the user to paste API keys, passwords, or OAuth tokens in chat. Use the existing Openmart login page, which supports the account's enabled sign-in methods, including Google and email/password. The user chooses a team and permissions on Openmart's consent page. If enrichment or exclusion editing is not permitted, explain the missing permission. Openmart Settings → Connected apps can disconnect or reset the connection before a new connection requests different permissions; explain that disconnect removes saved plugin results before taking this action. Connections can be revoked in Openmart Settings → Connected apps.

Mention credit usage when relevant to the next action. A displayed balance is not a guaranteed price quote; the API cannot enforce a strict per-request credit ceiling. Default search size is 10 rows; contact discovery defaults to one Owner email per company. Phone enrichment is opt-in.

Once connected, follow the user's requested workflow. Do not repeat onboarding on every tool call or ask for confirmation of work already authorized.
