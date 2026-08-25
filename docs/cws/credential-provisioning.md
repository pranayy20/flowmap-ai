# Chrome Web Store Developer Dashboard credential — provisioning runbook

Per `_protocol/04-git-cicd-protocol.md` Section 8.1. This is a **planning/documentation runbook only** — it does not provision a real account or spend any money. No CWS Developer Dashboard account has been created as part of producing this document.

## Why this is a separate credential

The CWS Developer Dashboard credential is **not** the org's shared GitHub account (Section 0 of the protocol). Holding GitHub write access implies nothing about CWS publish access, and the two must never be cross-provisioned or share a password/secret store entry. Distribution is intentionally narrower than GitHub feature-branch access: per Section 8.1, direct possession of the CWS API credential is limited to `release-manager-lead` and, for execution only, `release-deployment-engineer`. No individual engineer role holds it.

## Step-by-step provisioning process

This is the process to follow **when the org is ready to actually provision** — i.e. ahead of the first real Stage A (private/unlisted) submission per `chrome-store-submit.yml`. None of these steps have been executed yet.

### 1. Register a Chrome Web Store Developer Dashboard account
- Go to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/).
- Sign in with (or create) a Google account designated for this purpose — see "Which Google account" below.
- Pay the one-time $5.00 USD registration fee. This is a real charge; `release-manager-lead` must confirm budget/payment-method authorization before this step is executed — out of scope for this documentation task.
- Enable 2FA on the Google account used, per the protocol's note that this account is 2FA-protected. Do not skip this step; it is the primary control on an otherwise very sensitive credential (a compromised credential risks the entire extension listing being suspended, not just one bad build).

**Which Google account:** use an org-controlled Google account (e.g. a role account under the org's Google Workspace, if one exists), not a personal Gmail belonging to an individual agent's human counterpart. This document does not create or designate that account — flagging that account selection is itself an open decision for `release-manager-lead`, not something to default silently.

### 2. Register the extension listing (draft state)
- From the Developer Dashboard, create a new item / listing for FlowMap AI.
- Upload the initial packaged artifact (`extension/dist/`, built from a tagged `main` commit per Section 8.1) as a **draft** — this does not submit for review; it only establishes the listing ID needed for API calls in the next step.
- Leave visibility unset/private until Stage A (per `chrome-store-submit.yml`'s two-stage design) is actually run.

### 3. Enable the Chrome Web Store Publish API in Google Cloud Console
- Create (or reuse an org-designated) Google Cloud project.
- Enable the **Chrome Web Store API** for that project.
- Under "APIs & Services -> Credentials," create an **OAuth 2.0 Client ID** (type: Desktop app or Web application, per Google's current CWS API guidance at provisioning time — verify against Google's docs since OAuth client-type requirements can change).
- Record the generated **Client ID** and **Client Secret**.

### 4. Generate a refresh token for the CWS Publish API
- Using the OAuth client from Step 3, run the standard Google OAuth consent flow, granting the `https://www.googleapis.com/auth/chromewebstore` scope.
- Exchange the resulting authorization code for a **refresh token** (one-time interactive step; the refresh token itself is what `chrome-store-submit.yml` will use non-interactively going forward).
- Verify the refresh token works by making one read-only test call (e.g. `GET` the draft item's status) before treating provisioning as complete.

### 5. Inventory of what must be stored
At the end of provisioning, four secrets exist and must be retained together as one credential set:
1. CWS Developer Dashboard account credentials (Google account email + password, 2FA recovery codes)
2. OAuth Client ID
3. OAuth Client Secret
4. Refresh token (scoped to `chromewebstore` publish)

## Where/how this credential should be stored — OPEN DEPENDENCY

**This org has no secrets-management tooling set up yet.** There is currently no vault, no CI/CD secrets store integration confirmed for this repo's GitHub Actions, and no documented process for how any credential (this one or otherwise) is held outside of individual agents' own access.

This runbook deliberately does **not** invent a storage mechanism (e.g. "just put it in GitHub Actions secrets" or "store it in a password manager") because:
- No secrets-management tool has been selected or provisioned for this org as of this writing.
- `chrome-store-submit.yml` is still a structural placeholder (see the file's own header) — its real implementation, owned by `cicd-pipeline-engineer`, will need to consume this credential from wherever it ends up living, and that consumption method should inform (or be informed by) the storage decision rather than this doc guessing first.
- Given the narrow-distribution requirement in Section 8.1 (only `release-manager-lead` and `release-deployment-engineer` hold this credential), whatever mechanism is chosen must support scoping access to exactly those two agents/roles — a general-purpose team secrets store without per-secret access control would not satisfy that constraint.

**Flagging as an explicit open dependency, not resolving it here:**
- `release-manager-lead` should raise secrets-management tooling selection (e.g. a proper CI/CD secrets store, a vault, or at minimum a documented, access-controlled password-manager entry restricted to the two authorized roles) as a prerequisite ticket before real CWS provisioning (Steps 1–4 above) is executed for real.
- Until that tooling exists, do not provision the real credential — there is nowhere safe and access-controlled to put it yet, and storing OAuth secrets/refresh tokens in the repo, in plaintext ticket `Notes`, or in any location without access control would itself be a guardrail violation of the narrow-distribution requirement in Section 8.1.
- `cicd-pipeline-engineer` needs this dependency resolved before `chrome-store-submit.yml` can move from skeleton to real implementation, since the workflow will need to read the credential from wherever it's stored.

## Authorization reminder (Section 8.1)

| Action | Authorizing agent | Executing agent |
|---|---|---|
| CWS submission — private/unlisted test | `release-manager-lead` | `release-manager-lead` or `release-deployment-engineer` |
| CWS submission — public (first release or permission/manifest change) | `release-manager-lead`, after Security sign-off | `release-manager-lead` or `release-deployment-engineer` |
| CWS submission — public (no permission/manifest change) | `release-manager-lead` | `release-manager-lead` or `release-deployment-engineer` |

Provisioning the credential itself is not a submission action, but the same two-role limit applies to who may hold/use it once provisioned.

## Status

- [ ] Google account designated (open — `release-manager-lead`)
- [ ] Secrets-management tooling selected (open dependency — blocks real provisioning)
- [ ] Developer Dashboard account registered ($5 fee) — **not done**
- [ ] Extension listing created in draft — **not done**
- [ ] OAuth Client ID/Secret generated — **not done**
- [ ] Refresh token generated and verified — **not done**

No steps above have been executed as part of this documentation task, per this task's guardrails.
