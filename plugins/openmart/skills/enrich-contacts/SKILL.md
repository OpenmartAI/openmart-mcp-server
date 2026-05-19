---
description: Enrich decision-maker contacts for businesses with Openmart. Use when the user asks for owner, founder, manager, email, phone, or decision-maker contact info for known businesses or domains.
---

# Enrich Openmart Contacts

Use the Openmart MCP server to enrich decision-maker contacts for "$ARGUMENTS".

Call `mcp__openmart__find_decision_maker` with:
- `businesses` when the user provides Openmart business rows or previous `find_business` results.
- `companies` when the user provides domains, company names, or websites directly.
- `title`: default to `Owner` for local businesses unless the user asks for another role such as Founder or Manager.
- `max_k`: default to 3 unless the user requests a different number.
- `info_access`: use `["EMAIL", "PHONE"]` unless the user asks for only one.

After results return:
- Present contacts in a compact table with business or tracking ID, full name, title, email, verified status if present, phones, LinkedIn URL, and task ID.
- Include `skipped_rows` with reasons when businesses cannot be enriched.
- If a batch is still processing, return the batch ID and status instead of retrying indefinitely.

Do not invent missing emails or phone numbers.
