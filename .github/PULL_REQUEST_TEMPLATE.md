<!--
Fill in every section below. pr-checks.yml verifies this PR body contains:
  - A line matching "Closes TCK-<number>" (or "Refs TCK-<number>")
  - A line matching "APPROVED-BY: <agent_id>" for the correct authorizing role for this merge target
Both are required checks — the PR will not be mergeable without them.
-->

## Ticket

Closes TCK-____

## What this PR does

<!-- One or two sentences. -->

## Merge target and required authorization

- [ ] Target branch: `dev` / `uat` / `main` (delete two)
- [ ] Authorizing agent has written `APPROVED-FOR-MERGE by <agent_id>: <target>` in the linked ticket's Notion `Notes` field **before** this PR is merged
- [ ] `APPROVED-BY: <agent_id>` line included below, matching the agent_id in that Notes entry

APPROVED-BY:

## Checklist

- [ ] CI is green (lint, tests, security scan, build)
- [ ] For `uat`/`main` targets: linked ticket's QA testing / UAT verification is recorded in `Notes`
- [ ] No unresolved critical vulnerability (see `security-scan` check)
