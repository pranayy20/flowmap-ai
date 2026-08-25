# Chrome Web Store private/unlisted test-submission allowlist

Per `_protocol/04-git-cicd-protocol.md` Section 8.2 (Stage A). Populated ahead of the first private/unlisted CWS test submission (M3–M4).

## Current status: not yet populated

No real testers have been identified for this pre-launch product — there is no QA tester pool with Google accounts to add yet. Per org guardrails, this table is intentionally left empty rather than filled with placeholder or fabricated names/emails. An honest "not yet identified" state is correct here; do not populate this file with sample data to make it look complete.

| Tester | Google account email | Role | Added by | Date added |
|---|---|---|---|---|
| _(none yet — see "How to populate" below)_ | | | | |

## How to populate this table (for `release-manager-lead`)

When real testers are identified ahead of the first Stage A submission, add one row per tester with:

- **Tester** — the individual's name or the org/team they represent (e.g. `qa-team-lead`, an internal beta user, a design partner contact).
- **Google account email** — the exact Google account (Gmail or Google Workspace) that will be added to the CWS Developer Dashboard's private/unlisted tester list. Chrome Web Store requires the literal Google account, not just any email — verify the tester actually has one before adding the row.
- **Role** — why this person needs Stage A access (e.g. "internal QA," "design partner pilot," "IT/Ops MVP wedge beta").
- **Added by** — the agent_id who added the row (per the authorization note below).
- **Date added** — for traceability; Notion `Notes` on the linked ticket should carry the same event as a compact JSON line.

### Who's authorized to add entries

Per Section 8.1's narrower CWS credential-distribution list, only `release-manager-lead` is authorized to *add* testers to this file (this mirrors `release-manager-lead` being the sole authorizing agent for CWS submissions in the 8.1 table). `release-deployment-engineer` may execute the actual CWS Developer Dashboard tester-list update using the provisioned credential (see `docs/cws/credential-provisioning.md`), but only once `release-manager-lead` has approved the specific tester entries here — do not add testers to the live CWS dashboard ahead of this file being updated and approved.

This is narrower than general Notion ticket write access: any agent can read this file, but only `release-manager-lead` edits the tester roster itself.

### Before the first Stage A submission

1. `release-manager-lead` populates this table with real testers per the format above.
2. `release-manager-lead` or `release-deployment-engineer` mirrors the list into the CWS Developer Dashboard's tester allow-list using the provisioned credential.
3. Log `APPROVED-FOR-PUBLISH by release-manager-lead: <version>` in the linked ticket's `Notes` per Section 8.1 before triggering `chrome-store-submit.yml` Stage A.

Owner: release-manager-lead / release-deployment-engineer.
