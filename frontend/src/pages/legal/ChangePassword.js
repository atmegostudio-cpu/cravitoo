/**
 * Change Password page — /settings/security
 * Available to every authenticated user.  Requires the current password
 * (defence against stolen-token attacks) and enforces the 8-char minimum
 * that the backend also validates.
 */
import React, { useState } from 'react';
import axios from 'axios';
import { KeyRound, ShieldCheck, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import Navbar from '../../components/Navbar';
import { useAuth } from '../../context/AuthContext';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const ChangePassword = () => {
  const { user } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setOk('');
    if (next.length < 8) { setError('New password must be at least 8 characters'); return; }
    if (next !== confirm) { setError('New passwords do not match'); return; }
    if (next === current) { setError('New password must be different from current'); return; }
    setBusy(true);
    try {
      await axios.post(`${API}/auth/change-password`,
        { current_password: current, new_password: next },
        { withCredentials: true }
      );
      setOk('Password updated. You can keep using the app — no need to log back in.');
      setCurrent(''); setNext(''); setConfirm('');
    } catch (err) {
      setError(err?.response?.data?.detail || 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-background py-10">
        <div className="max-w-lg mx-auto px-4">
          <div className="flex items-center gap-3 mb-8">
            <div className="p-3 bg-primary-light rounded-xl">
              <ShieldCheck className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 data-testid="change-password-title" className="text-2xl font-heading font-semibold">Change Password</h1>
              <p className="text-sm text-text-secondary">Signed in as {user?.email}</p>
            </div>
          </div>

          <form onSubmit={submit} className="bg-card border border-border-light rounded-2xl p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Current password</label>
              <input
                data-testid="current-password-input"
                type="password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full px-4 py-2 border border-border-light rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">New password</label>
              <input
                data-testid="new-password-input"
                type="password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                className="w-full px-4 py-2 border border-border-light rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
              <p className="text-xs text-text-muted mt-1">Minimum 8 characters.</p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Confirm new password</label>
              <input
                data-testid="confirm-password-input"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                autoComplete="new-password"
                className="w-full px-4 py-2 border border-border-light rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>

            {error && (
              <div data-testid="change-password-error" className="flex items-start gap-2 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
                <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}
            {ok && (
              <div data-testid="change-password-success" className="flex items-start gap-2 p-3 bg-emerald-50 text-emerald-700 rounded-lg text-sm">
                <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>{ok}</span>
              </div>
            )}

            <button
              data-testid="change-password-submit"
              type="submit"
              disabled={busy}
              className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary-dark disabled:opacity-60 text-white py-2.5 rounded-lg font-medium transition-all"
            >
              {busy ? (<><Loader2 className="h-4 w-4 animate-spin" /> Updating…</>) : (<><KeyRound className="h-4 w-4" /> Update Password</>)}
            </button>
          </form>
        </div>
      </div>
    </>
  );
};

export default ChangePassword;
