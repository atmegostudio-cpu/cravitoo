Subject: Pre-Deploy Verification for app.cravitoo.com — Phase 1 security release

Hi Emergent Support,

Job ID:               <please paste from the info button in the Emergent UI>
Production URL:       https://app.cravitoo.com
Preview URL:          https://corporate-feast.preview.emergentagent.com
Pending release:      "Phase 1 — Critical Security Fix" (privilege escalation,
                      demo gating, order state machine, expired-session loop fix)

Before pressing the "Deploy to Production" button I need written confirmation
on the five items below. The Emergent UI lets me self-verify items 1, 3, 4 but
not 2 and 5.  Items 2 and 5 are blockers because this release touches
authentication, role-based access control and an environment-gated security
feature (CRAVITOO_ENV) for an app that handles real Razorpay payments.

1. PRODUCTION ENVIRONMENT VARIABLE
   Required value:  CRAVITOO_ENV=production
   - Please confirm production env vars are isolated from the preview pod's
     /app/backend/.env (which currently has CRAVITOO_ENV="preview").
   - Please confirm setting CRAVITOO_ENV in the Deploy modal will NOT be
     overridden by anything in the preview .env at deploy time.
   - Please confirm the value is persisted across rolling restarts and
     subsequent deploys (i.e. that I do not need to re-enter it every deploy).

2. PRE-DEPLOYMENT DATABASE SNAPSHOT — BLOCKER
   - Does Emergent automatically snapshot the production MongoDB *before*
     applying a new deployment?  If yes, please tell me where to view/download
     the snapshot for THIS upcoming deploy.  Please include timestamp, size and
     a SHA hash if available.
   - If no, please run a manual mongodump of the production database BEFORE
     I press Deploy, store it in the platform's standard backup location, and
     send me the location + hash here so I can include it in the audit trail.
   - Retention period and integrity-check procedure please.

3. CODE ROLLBACK
   - Confirmed in UI:  Home → app → version history.
   - Please confirm in writing: rollback restores the *code* (backend +
     frontend) to the previous release.  I understand rollback does NOT touch
     the database.  Is that correct?
   - Please confirm the time window over which rollback remains available
     (24h? 7d? indefinite?) and the number of historical versions retained.

4. PREVIEW → PRODUCTION CONFIG ISOLATION
   - Already confirmed in support's earlier reply that preview .env is NOT
     auto-copied to production.  Just looking for written confirmation here so
     it is on the record alongside this deploy.

5. EXACT CODE VERSION TO BE DEPLOYED — BLOCKER
   - The Emergent UI does not show a Git commit hash for what would be
     deployed.  Please confirm via support which commit / workspace snapshot
     would be shipped if I press Deploy right now.
   - I will also use "Save to GitHub" immediately before pressing Deploy and
     tag the commit `phase-1-security-fix-vYYYYMMDD`.  Please confirm the
     deploy will ship that commit and that the deploy is atomic across
     backend, frontend and (if applicable) mobile.

Phase 1 review evidence (already produced inside the workspace) for your
reference if needed:

  /app/PHASE1_APPROVAL_REPORT.md       — pre-approval pass, 328 tests green
  /app/PHASE1_PROD_DEPLOY_RUNBOOK.md   — operator runbook
  /app/backend/scripts/phase1_prod_smoke.py
                                        — non-destructive post-deploy smoke

I will press Deploy only after items 2 and 5 are confirmed in writing.  Please
also let me know whether support can run the pre-deploy mongodump on my behalf
or whether I need to provide a service account.

Thank you.

— <your name>
