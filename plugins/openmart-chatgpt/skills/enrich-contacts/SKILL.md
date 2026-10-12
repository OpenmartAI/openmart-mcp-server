---
name: enrich-contacts
description: Find decision makers, owner emails or company email addresses with Openmart, enrich known people, and resume asynchronous contact work from saved business results or supplied company domains.
---

Choose the tool by the intended outcome:
- `find_contacts`: discover people at companies by role.
- `enrich_people`: enrich already known first/last names at known domains.
- `find_company_emails`: retrieve company-level email; requires company name and domain.

Reuse `result_set_id` and exact `selected_ids` for previously found businesses. Otherwise provide companies together in one call; the service handles groups of 100. Validate missing domains before starting. A company without a domain is not permission to guess one or broaden selection.

Unless the user asks otherwise, use Owner, one contact per company, and EMAIL only. Add PHONE only on explicit user request. Explain the target count and requested fields when useful; avoid repeated confirmations within the authorized scope. Record-count limits are not hard credit caps. If the user requires a strict credit cap, state that the upstream API cannot enforce it and resolve that constraint before paid work.

Create one stable `request_id` per authorized action and reuse it if the response is lost. The immediate acknowledgement is not a completed search. Keep the returned `operation_id`; use `get_operation` to collect progress. Respect `after_seconds` between polls, and report partial results as partial. If the host cannot wait, return the operation reference and resume it on follow-up. Do not launch another discovery to retrieve an existing result. `get_operation` with no ID lists recent operations for this connection.

For unknown submission outcomes, do not retry with a new request ID. Explain that the upstream service may have accepted the work; preserve known results and the operation reference for investigation. Treat insufficient credits, permission failure, rate limiting and temporary unavailability distinctly. Do not infer credit exhaustion from 429.

Preserve email verification flags and phone validity/confidence. “Returned” does not mean “verified”; no result does not prove no contact exists. Keep each person associated with their company and distinguish company emails from personal decision-maker emails. Never fabricate names, emails, phone numbers or source URLs.

Use `export_results` for saved/selected rows. Do not send email, SMS or LinkedIn outreach: this plugin retrieves data and has no sending capability.
