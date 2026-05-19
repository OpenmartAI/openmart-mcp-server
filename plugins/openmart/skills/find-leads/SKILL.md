---
description: Find local business leads with Openmart. Use when the user asks to find businesses by category, city, rating, reviews, website presence, contact info, location count, or opening date.
---

# Find Openmart Leads

Use the Openmart MCP server to find businesses matching "$ARGUMENTS".

Call `mcp__openmart__find_business` with:
- `query`, `tags`, or `store_name`: what to find. `query` is a single short category term; `tags` wins over `store_name`, which wins over `query`.
- `location`: an array of `{city, state, country}` (and/or `zip_code`, `lat`/`long`/`geo_radius`).
- `limit`: requested result count, defaulting to 50.
- Explicit constraints map to top-level filters — `has_valid_website`, `has_contact_info`, `min/max_locations`, `min/max_total_reviews`, `min/max_overall_rating`, `ownership_type`, `min/max_price_tier`, `include/exclude_keywords`, `open_date_after/before`. There is no nested `filters` object.

After results return:
- Present a compact table with business name, domain or website, city, phone, rating, review count, tags, and Openmart ID.
- `total_count` shows how many businesses match overall; pass `next_cursor` back as `cursor` to page further.
- If the user asks for owner, founder, manager, email, or phone contacts, call `mcp__openmart__find_decision_maker` with the businesses returned by `find_business`.
- Skip businesses without domains and report skipped rows if enrichment is requested.

Do not invent contact information. If Openmart returns no contact or null email/phone, say so plainly.
