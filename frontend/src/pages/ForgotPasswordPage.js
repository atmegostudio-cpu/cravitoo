import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { CheckCircle2, ArrowLeft, Loader2, Mail } from 'lucide-react';
import logger from '../lib/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState('idle');   // idle | submitting | done
  const [msg, setMsg] = useState('');

  const submit = async (e) => {
    e?.preventDefault();
    if (!email.includes('@')) {
      setMsg('Please enter a valid email address.');
      return;
    }
    setState('submitting');
    try {
      const { data } = await axios.post(
        `${API}/auth/forgot-password`,
        { email: email.trim().toLowerCase() },
        { timeout: 15000 },
      );
      setMsg(data?.message || 'If this email is registered, a reset link has been sent.');
      setState('done');
    } catch (e) {
      logger.warn('Forgot password failed', e);
      // We still show the neutral message — never reveal whether the email exists.
      setMsg('If this email is registered, a reset link has been sent.');
      setState('done');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-light via-white to-accent-light flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-xl border border-border-light max-w-md w-full p-8" data-testid="forgot-password-panel">
        <Link
          to="/login"
          data-testid="back-to-login"
          className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-primary mb-6"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
        </Link>

        {state !== 'done' && (
          <>
            <div className="flex items-center gap-3 mb-5">
              <div className="rounded-full bg-primary-light p-2.5">
                <Mail className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h1 className="font-heading text-xl font-semibold text-text-primary">Forgot password?</h1>
                <p className="text-xs text-text-muted">Enter your email and we'll send you a reset link.</p>
              </div>
            </div>

            <form onSubmit={submit} className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Email</label>
                <input
                  data-testid="forgot-email-input"
                  type="email"
                  autoFocus
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={state === 'submitting'}
                  placeholder="you@company.com"
                  className="mt-1 w-full px-3 py-2.5 border border-border-light rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>

              {msg && state !== 'done' && (
                <p data-testid="forgot-msg" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">{msg}</p>
              )}

              <button
                data-testid="forgot-submit-btn"
                type="submit"
                disabled={state === 'submitting' || !email}
                className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary-hover text-white px-4 py-3 rounded-xl text-sm font-semibold disabled:opacity-50"
              >
                {state === 'submitting' ? <><Loader2 className="h-4 w-4 animate-spin" /> Sending…</> : 'Send reset link'}
              </button>
            </form>
          </>
        )}

        {state === 'done' && (
          <div className="text-center py-2" data-testid="forgot-done">
            <div className="w-16 h-16 rounded-full bg-emerald-100 mx-auto mb-4 flex items-center justify-center">
              <CheckCircle2 className="h-10 w-10 text-emerald-600" />
            </div>
            <h1 className="font-heading text-xl font-semibold text-text-primary mb-2">Check your inbox</h1>
            <p className="text-sm text-text-secondary mb-6">{msg}</p>
            <p className="text-xs text-text-muted">
              If it doesn't arrive within a few minutes, check your Junk/Spam folder — or try again.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
