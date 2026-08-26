import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import logger from '../lib/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/**
 * /auth/magic/:token
 *
 * Landing page for the one-tap vendor sign-in link emailed by the admin's
 * "Resend Onboarding" flow. On mount we POST to /auth/magic/{token}/consume,
 * which atomically marks the token used and sets the session cookies.
 * Then we redirect the vendor straight to /vendor/dashboard.
 */
export default function MagicLinkConsumer() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState('loading');    // loading | ok | error
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await axios.post(
          `${API}/auth/magic/${encodeURIComponent(token)}/consume`,
          {},
          { withCredentials: true, timeout: 15000 },
        );
        if (cancelled) return;
        setState('ok');
        // Small pause so the user sees the "Signed in" screen before redirect.
        setTimeout(() => {
          const dest = data?.role === 'vendor' ? '/vendor/dashboard' : '/';
          navigate(dest, { replace: true });
        }, 900);
      } catch (e) {
        if (cancelled) return;
        logger.warn('Magic link consume failed', e);
        setError(e?.response?.data?.detail || 'This link could not be used.');
        setState('error');
      }
    })();
    return () => { cancelled = true; };
  }, [token, navigate]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-light via-white to-accent-light flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-xl border border-border-light max-w-md w-full p-8 text-center" data-testid="magic-link-panel">
        {state === 'loading' && (
          <>
            <Loader2 className="h-12 w-12 text-primary animate-spin mx-auto mb-5" />
            <h1 className="font-heading text-2xl font-semibold text-text-primary mb-2">Signing you in…</h1>
            <p className="text-sm text-text-secondary">One tap. No OTP. Almost there.</p>
          </>
        )}
        {state === 'ok' && (
          <>
            <div className="w-16 h-16 rounded-full bg-emerald-100 mx-auto mb-5 flex items-center justify-center">
              <CheckCircle2 className="h-10 w-10 text-emerald-600" />
            </div>
            <h1 className="font-heading text-2xl font-semibold text-text-primary mb-2">Signed in ✓</h1>
            <p className="text-sm text-text-secondary mb-6">Redirecting to your Vendor Panel…</p>
          </>
        )}
        {state === 'error' && (
          <>
            <div className="w-16 h-16 rounded-full bg-red-100 mx-auto mb-5 flex items-center justify-center">
              <AlertCircle className="h-10 w-10 text-red-600" />
            </div>
            <h1 className="font-heading text-2xl font-semibold text-text-primary mb-2">Link no longer works</h1>
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3 mb-6" data-testid="magic-link-error">{error}</p>
            <p className="text-xs text-text-muted mb-4">
              Ask your Cravitoo Admin to resend the onboarding link, or sign in with your Email Code below.
            </p>
            <button
              data-testid="magic-goto-login"
              onClick={() => navigate('/login', { replace: true })}
              className="w-full bg-primary hover:bg-primary-hover text-white px-4 py-3 rounded-xl text-sm font-semibold"
            >
              Sign in with Email Code
            </button>
          </>
        )}
      </div>
    </div>
  );
}
