import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import Navbar from '../../components/Navbar';
import { Sparkles, Play, Trash2, CheckCircle2, AlertCircle, Loader2, Copy, ChevronRight } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const DemoControl = () => {
  const [enabled, setEnabled] = useState(null); // null=loading, false=production, true=demo allowed
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const flag = await axios.get(`${API}/admin/demo/enabled`, { withCredentials: true });
      const isEnabled = !!flag.data?.demo_enabled;
      setEnabled(isEnabled);
      if (!isEnabled) {
        setLoading(false);
        return;
      }
      const { data } = await axios.get(`${API}/admin/demo/status`, { withCredentials: true });
      setStatus(data);
    } catch (e) {
      setError(e?.response?.data?.detail || 'Could not load status');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const setup = async () => {
    if (!window.confirm('Create the Cravitoo Pune demo (City, Site, Vendor, Corp Admin, Employee, Vendor user)?')) return;
    setBusy('setup'); setMessage(''); setError('');
    try {
      const { data } = await axios.post(`${API}/admin/demo/setup`, {}, { withCredentials: true });
      const created = Object.keys(data.created || {}).length;
      const existed = Object.keys(data.existed || {}).length;
      setMessage(`Demo ready · ${created} created · ${existed} already existed. Scroll down for the demo flow.`);
      await loadStatus();
    } catch (e) {
      setError(e?.response?.data?.detail || 'Setup failed');
    } finally { setBusy(null); }
  };

  const teardown = async () => {
    if (!window.confirm('Delete ALL demo data (city, site, vendor, demo users, and their reservations / orders)?\n\nThis cannot be undone.')) return;
    setBusy('teardown'); setMessage(''); setError('');
    try {
      const { data } = await axios.post(`${API}/admin/demo/teardown`, {}, { withCredentials: true });
      const total = Object.values(data.removed || {}).reduce((a, b) => a + b, 0);
      setMessage(`Demo cleaned up · ${total} records removed.`);
      await loadStatus();
    } catch (e) {
      setError(e?.response?.data?.detail || 'Teardown failed');
    } finally { setBusy(null); }
  };

  const copy = (text) => {
    navigator.clipboard.writeText(text);
    setMessage(`Copied: ${text}`);
    setTimeout(() => setMessage(''), 2000);
  };

  const active = status?.demo_active;
  const creds = status?.credentials || {};

  if (loading) {
    return (<><Navbar /><div className="min-h-screen bg-background flex items-center justify-center"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" /></div></>);
  }

  if (enabled === false) {
    return (
      <>
        <Navbar />
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div data-testid="demo-disabled-banner" className="max-w-lg bg-card border border-border-light rounded-2xl p-8 text-center">
            <AlertCircle className="h-10 w-10 text-amber-500 mx-auto mb-4" />
            <h1 className="font-heading text-2xl font-semibold mb-2">Demo Control disabled</h1>
            <p className="text-text-secondary text-sm">
              This environment is running in <strong>production</strong> mode. Demo
              setup and teardown endpoints are unavailable here to protect real
              customer data. Use a preview or staging environment for demos.
            </p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-background">
        <div className="max-w-4xl mx-auto px-6 py-8">
          <div className="flex items-center gap-3 mb-2">
            <Sparkles className="h-6 w-6 text-primary" />
            <h1 className="font-heading text-4xl sm:text-5xl tracking-tighter font-semibold text-text-primary">Demo Control</h1>
          </div>
          <p className="text-text-secondary mb-6 max-w-2xl">
            One-click setup &amp; teardown for the <strong>Cravitoo Pune Demo</strong>. Creates a complete sandbox
            (Company, Site, Vendor, Corp Admin, Employee) you can use to walk through every feature.
          </p>

          {message && <div data-testid="demo-success" className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm flex items-center gap-2"><CheckCircle2 className="h-4 w-4" /> {message}</div>}
          {error && <div data-testid="demo-error" className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2"><AlertCircle className="h-4 w-4" /> {error}</div>}

          {/* Status + Buttons */}
          <div className="bg-card border border-border-light rounded-2xl p-6 mb-6" data-testid="demo-status-panel">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <span className={`inline-block px-3 py-1 text-xs font-medium rounded-full border ${
                  active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-700 border-slate-200'
                }`}>
                  {active ? 'Demo active' : 'No demo set up'}
                </span>
                {active && status?.counts && (
                  <span className="text-xs text-text-muted">
                    {status.counts.cities} city · {status.counts.companies} company · {status.counts.sites} site · {status.counts.vendors} vendor · {status.counts.users} users
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  data-testid="demo-setup-btn"
                  onClick={setup}
                  disabled={busy !== null}
                  className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-xl font-medium hover:bg-primary-hover disabled:opacity-50"
                >
                  {busy === 'setup' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  {active ? 'Re-run setup' : 'Set up demo'}
                </button>
                {active && (
                  <button
                    data-testid="demo-teardown-btn"
                    onClick={teardown}
                    disabled={busy !== null}
                    className="flex items-center gap-2 px-5 py-2.5 border border-red-300 text-red-700 rounded-xl font-medium hover:bg-red-50 disabled:opacity-50"
                  >
                    {busy === 'teardown' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    Clean up demo
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Credentials */}
          <div className="bg-card border border-border-light rounded-2xl p-6 mb-6">
            <h2 className="font-heading text-xl font-medium mb-4">Demo Credentials</h2>
            <p className="text-text-secondary text-sm mb-4">Password for all 3 accounts: <code className="px-1.5 py-0.5 bg-background border rounded text-primary font-mono text-xs">Demo@123</code></p>
            <div className="space-y-2">
              {Object.entries(creds).map(([role, c]) => (
                <div key={role} data-testid={`cred-row-${role}`} className="flex items-center justify-between p-3 bg-background rounded-lg">
                  <div>
                    <p className="text-xs text-text-muted uppercase tracking-wide">{role.replace('_', ' ')}</p>
                    <p className="font-mono text-sm text-text-primary">{c.email}</p>
                  </div>
                  <button onClick={() => copy(c.email)} className="text-text-muted hover:text-primary p-2" title="Copy email">
                    <Copy className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Flow walkthrough */}
          <div className="bg-card border border-border-light rounded-2xl p-6">
            <h2 className="font-heading text-xl font-medium mb-4">Demo Flow — show every feature in 5 minutes</h2>
            <ol className="space-y-4">
              {[
                {
                  who: 'Master Admin',
                  email: 'admin@cravitoo.com / admin123',
                  steps: [
                    'Stay on this screen → click "Set up demo" above (already done if you see the green status).',
                    'Show Sites → Cravitoo - Pune Office (lifecycle: Live, ATMEGO mapped, Lunch+Dinner enabled).',
                    'Show Domains → cravitoo.com auto-listed.',
                    'Show Clients → Cravitoo with billing contact.',
                  ],
                },
                {
                  who: 'Employee',
                  email: 'info@cravitoo.com / Demo@123',
                  steps: [
                    'Logout and log back in as the employee.',
                    'Open Reservations → pick a meal type (Veg Meal / Non-Veg Meal / Veg Salad / Non-Veg Salad) for Lunch → Reserve.',
                    'Repeat for Dinner with a different meal type.',
                    'Note: Reservations close at 8 PM IST. Run the demo before 8 PM.',
                  ],
                },
                {
                  who: 'Corporate Admin (Finance)',
                  email: 'finance@cravitoo.com / Demo@123',
                  steps: [
                    'Logout and log back in as the Corp Admin.',
                    'Dashboard shows employee usage stats + Excel/CSV/PDF Export buttons.',
                    'Bulk Pre-Order page (active between 8:00–8:45 PM IST): place 5 Veg + 10 Non-Veg anonymously for the team.',
                  ],
                },
                {
                  who: 'Vendor (ATMEGO)',
                  email: 'vendor@atmego.com / Demo@123',
                  steps: [
                    'Logout and log back in as the vendor.',
                    'Reservations page shows tomorrow\'s kitchen counts broken down by meal type.',
                    'Export Kitchen List → CSV download.',
                  ],
                },
                {
                  who: 'Master Admin again',
                  email: 'admin@cravitoo.com / admin123',
                  steps: [
                    'Reports section → use the Excel / CSV / PDF Export buttons on Reservations, Orders, Vendor Sales.',
                    'Billing → pick this month → Generate invoices → download the Excel / PDF.',
                    'When done → come back to this page and click "Clean up demo".',
                  ],
                },
              ].map((step, idx) => (
                <li key={idx} className="border-l-2 border-primary/30 pl-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-mono text-xs text-primary bg-primary-light rounded-full px-2 py-0.5">Step {idx + 1}</span>
                    <strong className="text-text-primary">{step.who}</strong>
                    <span className="text-text-muted text-xs font-mono">· {step.email}</span>
                  </div>
                  <ul className="space-y-1">
                    {step.steps.map((s, i) => (
                      <li key={i} className="text-sm text-text-secondary flex items-start gap-1.5">
                        <ChevronRight className="h-3.5 w-3.5 text-text-muted mt-0.5 flex-shrink-0" />
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </>
  );
};

export default DemoControl;
