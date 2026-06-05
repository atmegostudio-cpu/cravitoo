import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import Navbar from '../../components/Navbar';
import { Link } from 'react-router-dom';
import { Shield, Download, Trash2, AlertTriangle, CheckCircle2, Mail, Loader2, Bell } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const PREF_LABELS = [
  { key: 'daily_digest_email', label: 'Daily recap email', description: 'One end-of-day summary (~8:30 PM IST) with your orders and pre-orders. Recommended.' },
  { key: 'order_confirm_email', label: 'Per-order confirmation email', description: 'Receive a separate email for every order. Off by default to keep your inbox clean.' },
  { key: 'reservation_confirm_email', label: 'Pre-order confirmation email', description: 'Email each time you reserve a meal. Pre-orders also send a push notification.' },
  { key: 'push_notifications', label: 'Push notifications', description: 'Order updates, pre-order reminders, and Cravitoo announcements (free, no email).' },
  { key: 'marketing_email', label: 'Announcements & offers via email', description: 'Occasional product updates and partner offers from Cravitoo.' },
];

const NotificationPrefsCard = () => {
  const [prefs, setPrefs] = useState(null);
  const [saving, setSaving] = useState({});
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/me/notification-preferences`, { withCredentials: true });
      setPrefs(data.preferences);
    } catch (e) {
      setMessage(e?.response?.data?.detail || 'Could not load preferences');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = async (key) => {
    if (!prefs) return;
    const next = !prefs[key];
    setSaving((s) => ({ ...s, [key]: true }));
    setMessage('');
    // Optimistic update
    setPrefs((p) => ({ ...p, [key]: next }));
    try {
      const { data } = await axios.patch(`${API}/me/notification-preferences`, { [key]: next }, { withCredentials: true });
      setPrefs(data.preferences);
      setMessage('Preference saved');
      setTimeout(() => setMessage(''), 2000);
    } catch (e) {
      setPrefs((p) => ({ ...p, [key]: !next })); // rollback
      setMessage(e?.response?.data?.detail || 'Could not save — try again');
    } finally {
      setSaving((s) => ({ ...s, [key]: false }));
    }
  };

  if (!prefs) {
    return (
      <div className="bg-card border border-border-light rounded-2xl p-6 mb-6" data-testid="notification-prefs-loading">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="bg-card border border-border-light rounded-2xl p-6 mb-6" data-testid="notification-prefs-card">
      <div className="flex items-start space-x-4">
        <div className="bg-primary-light rounded-xl p-3">
          <Bell className="h-6 w-6 text-primary" />
        </div>
        <div className="flex-1">
          <h2 className="font-heading text-xl font-semibold text-text-primary">Notification preferences</h2>
          <p className="text-text-secondary text-sm mt-1 mb-5">
            Choose which alerts you want from Cravitoo. Push notifications are always free; opting out of emails helps us reduce delivery costs and keeps your inbox clean.
          </p>
          <div className="space-y-3">
            {PREF_LABELS.map((p) => (
              <div key={p.key} className="flex items-start justify-between gap-4 py-3 border-b border-border-light last:border-b-0">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-text-primary text-sm">{p.label}</p>
                  <p className="text-text-muted text-xs mt-0.5">{p.description}</p>
                </div>
                <button
                  data-testid={`pref-toggle-${p.key}`}
                  onClick={() => toggle(p.key)}
                  disabled={saving[p.key]}
                  aria-pressed={prefs[p.key]}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 ${prefs[p.key] ? 'bg-primary' : 'bg-border-light'} ${saving[p.key] ? 'opacity-50' : ''}`}
                >
                  <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${prefs[p.key] ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
            ))}
          </div>
          {message && (
            <p data-testid="prefs-message" className="text-xs text-text-muted mt-3">{message}</p>
          )}
        </div>
      </div>
    </div>
  );
};

const DataSettings = () => {
  const { user, logout } = useAuth();
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState('');
  const [deleteStep, setDeleteStep] = useState('idle'); // idle | confirm | confirming | done
  const [confirmText, setConfirmText] = useState('');
  const [deleteError, setDeleteError] = useState('');

  const handleExport = async () => {
    setExporting(true);
    setExportMessage('');
    try {
      const { data } = await axios.get(`${API}/me/data`, { withCredentials: true });
      // Trigger browser download as JSON
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cravitoo-my-data-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setExportMessage('Your data has been downloaded as a JSON file.');
    } catch (e) {
      setExportMessage(e.response?.data?.detail || 'Failed to export data. Please try again or contact privacy@cravitoo.com.');
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = async () => {
    if (confirmText !== 'DELETE') {
      setDeleteError('Please type DELETE in capital letters to confirm.');
      return;
    }
    setDeleteStep('confirming');
    setDeleteError('');
    try {
      await axios.delete(`${API}/me/data?confirm=DELETE`, { withCredentials: true });
      setDeleteStep('done');
      // Logout after 3 seconds
      setTimeout(() => {
        logout();
        window.location.href = '/';
      }, 3000);
    } catch (e) {
      setDeleteError(e.response?.data?.detail || 'Deletion failed. Please contact privacy@cravitoo.com.');
      setDeleteStep('confirm');
    }
  };

  if (deleteStep === 'done') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="bg-card border border-border-light rounded-2xl p-12 max-w-md text-center" data-testid="deletion-success">
          <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto mb-4" />
          <h2 className="font-heading text-2xl font-semibold text-text-primary mb-2">Account Deleted</h2>
          <p className="text-text-secondary mb-4">
            Your personal data has been deleted. Order records required for tax purposes have been anonymised.
          </p>
          <p className="text-sm text-text-muted">Logging you out in a moment...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-background">
        <div className="max-w-4xl mx-auto px-6 py-8">
          <div className="mb-8">
            <h1 className="font-heading text-4xl sm:text-5xl tracking-tighter font-semibold text-text-primary">
              Data &amp; Privacy
            </h1>
            <p className="text-text-secondary mt-2">
              Manage the personal data Cravitoo holds about you, under India&apos;s DPDP Act 2023 and GDPR.
            </p>
          </div>

          <div className="bg-primary-light border border-primary/20 rounded-2xl p-5 mb-8 flex items-start space-x-3">
            <Shield className="h-6 w-6 text-primary flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-text-primary mb-1">Your data rights</h3>
              <p className="text-sm text-text-secondary">
                You have the right to access, correct, and delete your personal data. Review our full{' '}
                <Link to="/privacy" className="text-primary font-semibold hover:underline">Privacy Policy</Link>{' '}
                for details.
              </p>
            </div>
          </div>

          {/* Account snapshot */}
          <div className="bg-card border border-border-light rounded-2xl p-6 mb-6" data-testid="account-snapshot">
            <h2 className="font-heading text-xl font-semibold text-text-primary mb-4">Account snapshot</h2>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-text-muted">Name</dt>
                <dd className="font-medium text-text-primary mt-1">{user?.name || '—'}</dd>
              </div>
              <div>
                <dt className="text-text-muted">Email</dt>
                <dd className="font-medium text-text-primary mt-1">{user?.email}</dd>
              </div>
              <div>
                <dt className="text-text-muted">Role</dt>
                <dd className="font-medium text-text-primary mt-1 capitalize">{user?.role?.replace('_', ' ')}</dd>
              </div>
              <div>
                <dt className="text-text-muted">Account ID</dt>
                <dd className="font-mono text-xs text-text-primary mt-1 break-all">{user?.id}</dd>
              </div>
            </dl>
          </div>

          {/* Notification preferences */}
          <NotificationPrefsCard />

          {/* Export data */}
          <div className="bg-card border border-border-light rounded-2xl p-6 mb-6">
            <div className="flex items-start space-x-4">
              <div className="bg-primary-light rounded-xl p-3">
                <Download className="h-6 w-6 text-primary" />
              </div>
              <div className="flex-1">
                <h2 className="font-heading text-xl font-semibold text-text-primary mb-2">
                  Download your data
                </h2>
                <p className="text-sm text-text-secondary mb-4">
                  Get a JSON file containing your profile, order history, reviews, favorites, loyalty points, subscriptions, and notification preferences. This satisfies the &quot;right of access&quot; under DPDP Act &amp; GDPR.
                </p>
                <button
                  onClick={handleExport}
                  disabled={exporting}
                  data-testid="export-data-btn"
                  className="bg-primary hover:bg-primary-hover text-white px-5 py-2.5 rounded-lg font-medium transition-all duration-200 flex items-center space-x-2 disabled:opacity-50"
                >
                  {exporting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Preparing your data...</span>
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4" />
                      <span>Download my data</span>
                    </>
                  )}
                </button>
                {exportMessage && (
                  <p className="mt-3 text-sm text-text-secondary" data-testid="export-message">{exportMessage}</p>
                )}
              </div>
            </div>
          </div>

          {/* Delete account */}
          <div className="bg-card border border-red-200 rounded-2xl p-6 mb-6">
            <div className="flex items-start space-x-4">
              <div className="bg-red-50 rounded-xl p-3">
                <Trash2 className="h-6 w-6 text-red-600" />
              </div>
              <div className="flex-1">
                <h2 className="font-heading text-xl font-semibold text-text-primary mb-2">
                  Delete my account
                </h2>
                <p className="text-sm text-text-secondary mb-4">
                  Permanently delete your account and personal data. Order records will be <strong>anonymised</strong> (your name, email, phone removed) but retained for 7 years as required by Indian GST &amp; Companies Act. This action cannot be undone.
                </p>

                {deleteStep === 'idle' && (
                  <button
                    onClick={() => setDeleteStep('confirm')}
                    data-testid="delete-account-btn"
                    className="bg-red-600 hover:bg-red-700 text-white px-5 py-2.5 rounded-lg font-medium transition-all duration-200 flex items-center space-x-2"
                  >
                    <Trash2 className="h-4 w-4" />
                    <span>Delete my account</span>
                  </button>
                )}

                {deleteStep === 'confirm' && (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-5 space-y-4" data-testid="delete-confirm-box">
                    <div className="flex items-start space-x-3">
                      <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                      <div className="text-sm text-text-primary">
                        <p className="font-semibold mb-2">This will permanently:</p>
                        <ul className="list-disc pl-5 space-y-1 text-text-secondary">
                          <li>Delete your profile, preferences, favorites, reviews, and notification settings</li>
                          <li>Anonymise your order history (kept for tax compliance only)</li>
                          <li>Cancel any active subscriptions</li>
                          <li>Forfeit any unredeemed loyalty points</li>
                          <li>Log you out of all devices</li>
                        </ul>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-text-primary mb-2">
                        Type <code className="px-1.5 py-0.5 bg-white border border-red-300 rounded text-red-600 font-mono">DELETE</code> to confirm:
                      </label>
                      <input
                        type="text"
                        value={confirmText}
                        onChange={(e) => setConfirmText(e.target.value)}
                        data-testid="delete-confirm-input"
                        placeholder="DELETE"
                        className="w-full px-4 py-2.5 border border-red-300 rounded-lg focus:ring-2 focus:ring-red-500/20 focus:border-red-500 bg-white font-mono"
                      />
                    </div>
                    {deleteError && (
                      <p className="text-sm text-red-600" data-testid="delete-error">{deleteError}</p>
                    )}
                    <div className="flex space-x-3">
                      <button
                        onClick={handleDelete}
                        disabled={confirmText !== 'DELETE'}
                        data-testid="confirm-delete-btn"
                        className="bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-lg font-medium transition-all duration-200"
                      >
                        Yes, delete my account permanently
                      </button>
                      <button
                        onClick={() => { setDeleteStep('idle'); setConfirmText(''); setDeleteError(''); }}
                        data-testid="cancel-delete-btn"
                        className="bg-white hover:bg-background border border-border-light text-text-primary px-5 py-2.5 rounded-lg font-medium transition-all duration-200"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {deleteStep === 'confirming' && (
                  <div className="flex items-center space-x-3 text-text-secondary">
                    <Loader2 className="h-5 w-5 animate-spin text-red-600" />
                    <span>Deleting your account...</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Contact for grievance */}
          <div className="bg-card border border-border-light rounded-2xl p-6">
            <div className="flex items-start space-x-4">
              <div className="bg-background rounded-xl p-3">
                <Mail className="h-6 w-6 text-text-secondary" />
              </div>
              <div className="flex-1">
                <h2 className="font-heading text-xl font-semibold text-text-primary mb-2">
                  Need help or have concerns?
                </h2>
                <p className="text-sm text-text-secondary mb-3">
                  Contact our Data Protection Officer or Grievance Officer. Response within 30 days as required by DPDP Act 2023.
                </p>
                <div className="flex flex-col sm:flex-row gap-3 text-sm">
                  <a
                    href="mailto:privacy@cravitoo.com"
                    data-testid="privacy-mail-link"
                    className="inline-flex items-center space-x-2 text-primary font-semibold hover:underline"
                  >
                    <Mail className="h-4 w-4" />
                    <span>privacy@cravitoo.com</span>
                  </a>
                  <a
                    href="mailto:grievance@cravitoo.com"
                    className="inline-flex items-center space-x-2 text-primary font-semibold hover:underline"
                  >
                    <Mail className="h-4 w-4" />
                    <span>grievance@cravitoo.com (Grievance Officer)</span>
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default DataSettings;
