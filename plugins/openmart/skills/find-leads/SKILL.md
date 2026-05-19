---
description: Find local business leads with Openmart. Use when the user asks to find businesses by category, city, rating, reviews, website presence, contact info, location count, or opening date.
---

# Find Openmart Leads

Use the Openmart MCP server to find businesses matching "$ARGUMENTS".

Call `mcp__openmart__find_business` with:
- `query`: the business category or keyword.
- `location`: city, state, and country when present.
- `limit`: requested result count, defaulting to 50.
- `filters`: map explicit constraints such as valid website, contact info, max locations, minimum reviews, minimum rating, or opening date.

After results return:
- Present a compact table with business name, domain or website, city, phone, rating, review count, tags, and Openmart ID.
- If the user asks for owner, founder, manager, email, or phone contacts, call `mcp__openmart__find_decision_maker` with the businesses returned by `find_business`.
- Skip businesses without domains and report skipped rows if enrichment is requested.

Do not invent contact information. If Openmart returns no contact or null email/phone, say so plainly.
