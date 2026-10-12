---
name: manage-exclusions
description: Check or update explicit email and phone exclusions in Openmart when the user asks to suppress contacts or undo a suppression rule.
---

For “is this excluded?”, use `check_contact_exclusions` with the exact supplied values. The API cannot list all exclusion rules. Do not claim that these rules constitute a complete legal consent registry or that they modify a CRM.

Use `update_contact_exclusions` only when the user explicitly requests a change. Map “exclude/do not contact” to add and “remove this exclusion” to remove. If the request is ambiguous, clarify the action and values before mutation. A clear user instruction already authorizes the change; do not require a second confirmation.

Use a stable request ID when retrying the same change. Report only the values and action acknowledged by the API. Never broaden a single email or phone exclusion to a domain or company exclusion. Never infer permission to send outreach from removing an exclusion.
