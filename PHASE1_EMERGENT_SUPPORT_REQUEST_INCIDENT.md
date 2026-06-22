Subject: URGENT — Cravitoo production security check and deployment blockers

Production application: https://app.cravitoo.com

An unauthorized production registration request may have created an account matching:

email: pretest_*@cravitoo.com
requested role: master_admin

The client received HTTP 000, so the outcome is unknown. Please do not attempt to log into this account.

Please urgently:

1. Run a read-only search for every pretest_*@cravitoo.com user.
2. If found, immediately disable the account and revoke related sessions/tokens.
3. Preserve the record and relevant infrastructure/access logs long enough to document:
   - Creation timestamp
   - Stored role
   - Source IP/request metadata
   - Whether any session, token or related record exists
4. Confirm whether pre-Phase-1 registration allowed the requested role or forced another role.
5. After recording the evidence, provide an approved cleanup procedure.
6. Confirm that no other production records were created or modified by this request.

Deployment blockers:

7. Create and verify a production database snapshot before deployment.
8. Confirm exactly which saved GitHub commit/tag Emergent will deploy.
9. Confirm the database rollback procedure.
10. Provide written approval before we use Deploy to Production.

Please do not include database credentials, private keys, tokens or password hashes in the response.

---

Workspace evidence files for reviewers:

- /app/PHASE1_APPROVAL_REPORT.md
- /app/PHASE1_PROD_DEPLOY_RUNBOOK.md
- /app/backend/scripts/phase1_prod_smoke.py
- /app/PHASE1_EMERGENT_SUPPORT_REQUEST.md
