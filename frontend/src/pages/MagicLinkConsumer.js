import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { CheckCircle2, AlertCircle, Loader2, Eye, EyeOff, KeyRound } from 'lucide-react';
import logger from '../lib/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/**
 * /auth/magic/:token
 *
 * Two-step landing page:
 *   1. GET /auth/magic/{token}   → validate the link, decide screen
 *   2. POST /auth/magic/{token}/complete { password } → set password + auto-login
 *
 * Handles both `onboarding` (first-time set) and `password_reset` purposes.
 */
export default function MagicLinkConsumer() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState('checking');   // checking | ready | submitting | done | error
  const [meta, setMeta] = useState(null);           // {email, vendor_name, purpose, user_name}
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await axios.get(
          `${API}/auth/magic/${encodeURIComponent(token)}`,
          { timeout: 15000 },
        );
        if (cancelled) return;
        setMeta(data);
        setState('ready');
      } catch (e) {
        if (cancelled) return;
        logger.warn('Magic link verify failed', e);
        setError(e?.response?.data?.detail || 'This link could not be used.');
        setState('error');
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const submit = async () => {
    setError('');
    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }
    if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
      setError('Password must contain at least one letter and one number.');
      return;
    }
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setState('submitting');
    try {
      const { data } = await axios.post(
        `${API}/auth/magic/${encodeURIComponent(token)}/complete`,
        { password },
        { withCredentials: true, timeout: 15000 },
      );
      setState('done');
      setTimeout(() => {
        const dest = data?.role === 'vendor' ? '/vendor/dashboard'
                   : data?.role === 'master_admin' ? '/master/dashboard'
                   : data?.role === 'corporate_admin' ? '/admin/dashboard'
                   : '/';
        // Hard redirect (not client-side navigate) so AuthProvider re-mounts
        // and re-reads the freshly-set auth cookies — otherwise the stale
        // AuthContext (user=null) makes ProtectedRoute bounce us to /login.
        window.location.replace(dest);
      }, 900);
    } catch (e) {
      logger.warn('Magic link complete failed', e);
      setError(e?.response?.data?.detail || 'Could not set your password. Please try again.');
      setState('ready');
    }
  };

  const isReset = meta?.purpose === 'password_reset';
  const heading = isReset ? 'Set a new password' : 'Welcome — set your password';
  const subheading = isReset
    ? 'Choose a new password to sign back in.'
    : `Sign-in with email + password from now on.`;

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-light via-white to-accent-light flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-xl border border-border-light max-w-md w-full p-8" data-testid="magic-link-panel">
        {state === 'checking' && (
          <div className="text-center">
            <Loader2 className="h-10 w-10 text-primary animate-spin mx-auto mb-4" />
            <p className="text-sm text-text-secondary">Checking your link…</p>
          </div>
        )}

        {(state === 'ready' || state === 'submitting') && meta && (
          <>
            <div className="flex items-center gap-3 mb-5">
              <div className="rounded-full bg-primary-light p-2.5">
                <KeyRound className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h1 className="font-heading text-xl font-semibold text-text-primary">{heading}</h1>
                <p className="text-xs text-text-muted">{subheading}</p>
              </div>
            </div>

            <div className="mb-4 rounded-xl bg-background border border-border-light p-3">
              <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">Account</p>
              <p className="text-sm font-medium text-text-primary font-mono" data-testid="magic-email">{meta.email}</p>
              {meta.vendor_name && (
                <p className="text-xs text-text-secondary mt-0.5">{meta.vendor_name}</p>
              )}
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider">New password</label>
                <div className="relative mt-1">
                  <input
                    data-testid="magic-password-input"
                    type={show ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={state === 'submitting'}
                    placeholder="At least 8 characters"
                    className="w-full px-3 py-2.5 pr-10 border border-border-light rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    onKeyDown={(e) => e.key === 'Enter' && confirm && submit()}
                  />
                  <button
                    type="button"
                    onClick={() => setShow(!show)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary p-1"
                    aria-label="Toggle password visibility"
                  >
                    {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p className="text-[11px] text-text-muted mt-1">Must contain at least one letter and one number.</p>
              </div>

              <div>
                <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Confirm password</label>
                <input
                  data-testid="magic-confirm-input"
                  type={show ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  disabled={state === 'submitting'}
                  placeholder="Type it again"
                  className="mt-1 w-full px-3 py-2.5 border border-border-light rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  onKeyDown={(e) => e.key === 'Enter' && submit()}
                />
              </div>

              {error && (
                <div data-testid="magic-error-msg" className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-2.5 text-xs text-red-800">
                  <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <button
                data-testid="magic-submit-btn"
                onClick={submit}
                disabled={state === 'submitting' || !password || !confirm}
                className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary-hover text-white px-4 py-3 rounded-xl text-sm font-semibold disabled:opacity-50"
              >
                {state === 'submitting' ? <><Loader2 className="h-4 w-4 animate-spin" /> Setting password…</> : (isReset ? 'Reset password & sign in' : 'Set password & sign in')}
              </button>
            </div>
          </>
        )}

        {state === 'done' && (
          <div className="text-center py-4">
            <div className="w-16 h-16 rounded-full bg-emerald-100 mx-auto mb-4 flex items-center justify-center">
              <CheckCircle2 className="h-10 w-10 text-emerald-600" />
            </div>
            <h1 className="font-heading text-xl font-semibold text-text-primary mb-1">Password saved ✓</h1>
            <p className="text-sm text-text-secondary">Signing you in…</p>
          </div>
        )}

        {state === 'error' && (
          <div className="text-center py-4">
            <div className="w-16 h-16 rounded-full bg-red-100 mx-auto mb-4 flex items-center justify-center">
              <AlertCircle className="h-10 w-10 text-red-600" />
            </div>
            <h1 className="font-heading text-xl font-semibold text-text-primary mb-2">Link no longer works</h1>
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3 mb-6" data-testid="magic-link-error">{error}</p>
            <div className="flex flex-col gap-2">
              <button
                data-testid="magic-goto-login"
                onClick={() => navigate('/login', { replace: true })}
                className="w-full bg-primary hover:bg-primary-hover text-white px-4 py-3 rounded-xl text-sm font-semibold"
              >
                Go to Sign In
              </button>
              <button
                data-testid="magic-goto-forgot"
                onClick={() => navigate('/forgot-password', { replace: true })}
                className="w-full bg-background hover:bg-background/80 border border-border-light text-text-primary px-4 py-3 rounded-xl text-sm font-medium"
              >
                Forgot password
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
