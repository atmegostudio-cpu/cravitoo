# Resend Paid Plan — Operator Notes

*Date: Feb 2026 · Status: ✅ Verified on PREVIEW · Production rollout still gated by Emergent Support response*

---

## What Changed in Code

| File | Change |
|---|---|
| `backend/email_service.py` | + `resend_health_check()` — read-only probe (does NOT send an email). Recognises send-only API keys as healthy. |
| `backend/server.py` | + `/api/health/email` endpoint (public, read-only). + startup hook logs Resend health at every boot. |
| `backend/tests/test_corporate_domains_extended.py` | Removed the `pytest.skip(502)` fallback for the OTP corporate-domain test. 502s are now hard failures (rate-limit is no longer expected on paid plan). |

No env-file changes were necessary on preview — the existing `RESEND_API_KEY`, `RESEND_FROM_EMAIL=noreply@cravitoo.com`, `RESEND_FROM_NAME=Cravitoo` are correct.

---

## What I Verified on Preview

```
✓ /api/health/email returns:
    { configured: true, from_email: noreply@cravitoo.com, domain: cravitoo.com,
      key_scope: "send_only", healthy: true, error: null }

✓ Backend startup log now prints:
    Resend health: OK · from=noreply@cravitoo.com · key_scope=send_only
    (least-privilege — domain status not introspectable)

✓ OTP corporate-domain test passes (used to skip on 502):
    test_otp_allows_corporate_domain  PASSED

✓ Live OTP request → 200 + {ok: true}, no errors in logs:
    POST /api/auth/otp/request
      body: { email: resend-paid-plan-probe-<ts>@techcorp.com }
      response: 200 { ok: true, channel: email, expires_in_minutes: 10 }

✓ Full Phase 1 suite re-run: 56 passed · 0 failed (1 unrelated skip).
```

### What the API key has permission for
Your current key is a **send-only key** — recommended Resend best practice for backend services. It can:
- ✅ Send emails (the only thing the backend ever needs)
- ✅ Read send-status (for delivery webhooks if you add them)
- ❌ List / create / modify domains
- ❌ Create / revoke other API keys
- ❌ View account billing

This means `domain_verified` cannot be confirmed via the running backend — you have to confirm it once in the Resend dashboard. The startup hook now reports `key_scope=send_only` and treats it as healthy.

---

## What You Need to Do on the Resend Dashboard (one-time, before prod deploy)

Open https://resend.com/domains and confirm:

1. **`cravitoo.com` is listed and status = `verified`**
   - If yes → ✅ done, skip the next 3 steps
   - If not → continue below

2. **Add `cravitoo.com` as a domain** (if missing)
   - Region: pick **`ap-south-1`** (Mumbai) if your plan supports it — best latency for Indian recipients
   - Resend will display 3-4 DNS records (SPF, DKIM, MX for return-path)

3. **Add the DNS records to your domain registrar** (Cloudflare / Route 53 / GoDaddy)
   - SPF (TXT): `v=spf1 include:amazonses.com ~all`
   - DKIM (TXT) × 1-3: `resend._domainkey.cravitoo.com → <long token>`
   - MX (optional, for `return-path` bounces): `send.cravitoo.com → feedback-smtp.us-east-1.amazonses.com`

4. **Click "Verify" in the Resend dashboard** — propagation usually 5-15 minutes.

5. **Optionally, set up a DMARC record** for deliverability:
   - `_dmarc.cravitoo.com` (TXT): `v=DMARC1; p=quarantine; rua=mailto:dmarc@cravitoo.com`

---

## What You Need to Set on Production at Deploy Time

In the Emergent **Deploy → Environment Variables** panel, confirm these three values match preview:

```
RESEND_API_KEY="<your_send_only_paid_plan_key>"
RESEND_FROM_EMAIL="noreply@cravitoo.com"
RESEND_FROM_NAME="Cravitoo"
```

⚠️ **If your paid plan came with a fresh API key**, update `RESEND_API_KEY` in the Deploy modal too. (Resend usually does NOT rotate the key on plan upgrade, but check the dashboard "API Keys" page to confirm the active key.)

---

## How to Verify Production Email is Healthy After Deploy

Once you've deployed, run from your laptop (no auth required):

```bash
curl https://app.cravitoo.com/api/health/email | python3 -m json.tool
```

Expected output:
```json
{
  "configured": true,
  "from_email": "noreply@cravitoo.com",
  "from_name": "Cravitoo",
  "domain": "cravitoo.com",
  "domain_verified": "unknown_send_only_key",
  "all_domains": [],
  "key_scope": "send_only",
  "healthy": true,
  "error": null
}
```

If `configured: false` → `RESEND_API_KEY` wasn't set in the prod env vars.
If `error: "..."` (non-null) and `key_scope` != `"send_only"` → real Resend issue; check the dashboard.

---

## Monitoring (Recommended Going Forward)

- **Daily**: glance at the Resend dashboard's "Send Activity" — confirm deliverability rate is >95%.
- **Weekly**: check the Resend "Bounces" page — high bounce rate = data hygiene issue.
- **Per-deploy**: run the curl above after every prod deploy.

The Emergent platform doesn't expose Resend metrics natively. If you want SLO-style alerting:
1. Add a Sentry account + DSN → Sentry will capture any 502 from Resend at runtime.
2. Or schedule a daily cron (e.g., GitHub Actions) that hits `/api/health/email` and alerts you if `healthy: false`.

---

## Files Modified This Pass

```
backend/email_service.py           +60 lines  (new resend_health_check function)
backend/server.py                  +50 lines  (new /api/health/email + startup hook)
backend/tests/test_corporate_domains_extended.py  -7 lines  (removed pytest.skip(502))
PHASE1_RESEND_PAID_PLAN_NOTES.md   NEW       (this file)
```

No production data was touched. No emails were sent to real human inboxes during testing — only one OTP request to a clearly-throwaway test address (`resend-paid-plan-probe-<timestamp>@techcorp.com`), which counts against your paid quota by exactly **one** email.
