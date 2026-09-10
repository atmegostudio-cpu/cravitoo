import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import Navbar from '../../components/Navbar';
import { Mail, Plus, Trash2, X, ShieldAlert, CheckCircle2, Link2, Search } from 'lucide-react';
import logger from '../../lib/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const AllowedDomains = () => {
  const [domains, setDomains] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ domain: '', company_id: '', site_id: '', notes: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [testEmail, setTestEmail] = useState('');
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);
  const [rejections, setRejections] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, c, s, rej] = await Promise.all([
        axios.get(`${API}/admin/allowed-domains`, { withCredentials: true }),
        axios.get(`${API}/companies`, { withCredentials: true }).catch(() => ({ data: [] })),
        axios.get(`${API}/sites`, { withCredentials: true }).catch(() => ({ data: [] })),
        axios.get(`${API}/admin/signup-rejections`, { withCredentials: true }).catch(() => ({ data: { summary: [], recent: [] } })),
      ]);
      setDomains(d.data);
      setCompanies(c.data || []);
      setSites(s.data || []);
      setRejections(rej.data);
    } catch (e) {
      logger.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const body = {
        domain: form.domain.trim().replace(/^@/, '').toLowerCase(),
        company_id: form.company_id || null,
        site_id: form.site_id || null,
        notes: form.notes.trim(),
      };
      await axios.post(`${API}/admin/allowed-domains`, body, { withCredentials: true });
      setShowForm(false);
      setForm({ domain: '', company_id: '', site_id: '', notes: '' });
      await load();
    } catch (err) {
      setError(err?.response?.data?.detail || 'Failed to add domain');
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (id, domain) => {
    if (!window.confirm(`Remove '${domain}' from the allowlist?`)) return;
    try {
      await axios.delete(`${API}/admin/allowed-domains/${id}`, { withCredentials: true });
      await load();
    } catch (err) {
      alert(err?.response?.data?.detail || 'Failed to delete');
    }
  };

  const backfill = async (d) => {
    try {
      await axios.post(`${API}/admin/allowed-domains/${d.id}/backfill-company`, {}, { withCredentials: true });
      await load();
    } catch (err) {
      alert(err?.response?.data?.detail || 'Could not link company');
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const { data } = await axios.get(`${API}/admin/allowed-domains/test`, { params: { email: testEmail }, withCredentials: true });
      setTestResult(data);
    } catch (err) {
      setTestResult({ allowed: false, message: err?.response?.data?.detail || 'Test failed' });
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <>
        <Navbar />
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
        </div>
      </>
    );
  }

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-background">
        <div className="max-w-6xl mx-auto px-6 py-8">
          <div className="flex justify-between items-start mb-6 flex-wrap gap-4">
            <div>
              <h1 className="font-heading text-4xl sm:text-5xl tracking-tighter font-semibold text-text-primary">Allowed Domains</h1>
              <p className="text-text-secondary mt-2 max-w-2xl">
                Restrict employee sign-ups to corporate emails. Personal email providers (Gmail, Yahoo, Outlook) are
                blocked automatically. Add the email domains of your corporate clients here so their employees can register.
              </p>
            </div>
            <button
              data-testid="add-domain-btn"
              onClick={() => setShowForm(true)}
              className="flex items-center gap-2 bg-primary text-white px-5 py-2.5 rounded-xl font-medium hover:bg-primary-hover transition-all"
            >
              <Plus className="h-4 w-4" /> Add Domain
            </button>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-6 flex items-start gap-3">
            <ShieldAlert className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-amber-900">
              <strong>Auto-blocked:</strong> gmail.com, yahoo.com, outlook.com, hotmail.com, live.com, icloud.com, aol.com,
              protonmail.com, rediffmail.com — and other free email providers. You only need to add legitimate corporate domains.
            </div>
          </div>

          <div className="bg-card border border-border-light rounded-2xl p-4 mb-6" data-testid="domain-test-panel">
            <div className="flex items-center gap-2 mb-1">
              <Search className="h-4 w-4 text-primary" />
              <p className="font-medium text-text-primary text-sm">Test a domain</p>
            </div>
            <p className="text-xs text-text-muted mb-3">See which company &amp; site a new employee on this email/domain would be mapped to.</p>
            <div className="flex gap-2 flex-wrap">
              <input
                data-testid="domain-test-input"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') runTest(); }}
                placeholder="someone@company.com or company.com"
                className="flex-1 min-w-[220px] px-3 py-2 border border-border-light rounded-lg text-sm font-mono focus:outline-none focus:border-primary"
              />
              <button data-testid="domain-test-btn" onClick={runTest} disabled={testing || !testEmail} className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-hover disabled:opacity-50">{testing ? 'Testing…' : 'Test'}</button>
            </div>
            {testResult && (
              <div data-testid="domain-test-result" className={`mt-3 text-sm px-3 py-2 rounded-lg border ${testResult.allowed ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-700'}`}>
                {testResult.allowed ? '✓ ' : '✗ '}{testResult.message}
              </div>
            )}
          </div>

          {domains.length === 0 ? (
            <div className="bg-card border border-border-light rounded-2xl p-12 text-center" data-testid="empty-domains">
              <Mail className="h-12 w-12 text-text-muted mx-auto mb-4" />
              <p className="text-text-secondary mb-2">No allowed domains yet.</p>
              <p className="text-text-muted text-sm">Add your first corporate domain to enable employee sign-ups.</p>
            </div>
          ) : (
            <div className="bg-card border border-border-light rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-background">
                  <tr className="text-left text-text-muted text-xs uppercase tracking-wider">
                    <th className="px-5 py-3">Domain</th>
                    <th className="px-5 py-3">Company</th>
                    <th className="px-5 py-3">Default Site</th>
                    <th className="px-5 py-3">Notes</th>
                    <th className="px-5 py-3">Added by</th>
                    <th className="px-5 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-light">
                  {domains.map((d) => (
                    <tr key={d.id} data-testid={`domain-row-${d.domain}`} className="hover:bg-background/50">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                          <span className="font-mono text-text-primary">@{d.domain}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-text-secondary">
                        {d.company_name ? (
                          <span className="inline-flex items-center gap-1">
                            {d.company_name}
                            {d.company_via_site && <span className="text-[10px] text-text-muted">(via site)</span>}
                          </span>
                        ) : '—'}
                        {d.can_backfill && (
                          <button
                            data-testid={`backfill-domain-${d.domain}`}
                            onClick={() => backfill(d)}
                            title="Link this domain directly to its site's company"
                            className="ml-2 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                          >
                            <Link2 className="h-3 w-3" /> Link company
                          </button>
                        )}
                      </td>
                      <td className="px-5 py-3 text-text-secondary">
                        {d.site_name ? (
                          <span className="inline-flex items-center gap-2">
                            {d.site_name}
                            {d.site_status && d.site_status !== 'live' && (
                              <span data-testid={`site-notlive-${d.domain}`} className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200" title="Employees can't sign up until this site is Live">Not live</span>
                            )}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-5 py-3 text-text-muted text-xs">{d.notes || '—'}</td>
                      <td className="px-5 py-3 text-text-muted text-xs">{d.created_by || '—'}</td>
                      <td className="px-5 py-3 text-right">
                        <button
                          data-testid={`delete-domain-${d.domain}`}
                          onClick={() => remove(d.id, d.domain)}
                          className="text-red-600 hover:text-red-700 inline-flex items-center gap-1 text-xs font-medium"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {rejections && rejections.recent.length > 0 && (
            <div className="mt-10" data-testid="signup-rejections">
              <h2 className="font-heading text-2xl font-semibold text-text-primary mb-1">Rejected sign-ups</h2>
              <p className="text-sm text-text-muted mb-4">Recent attempts blocked because the domain isn't allowed (or its site isn't live). Tap a red chip to add that domain.</p>
              <div className="flex flex-wrap gap-2 mb-4">
                {rejections.summary.filter((s) => !s.in_allowlist && s.domain !== '(none)').map((s) => (
                  <button key={s.domain} data-testid={`reject-domain-${s.domain}`}
                    onClick={() => { setForm({ domain: s.domain, company_id: '', site_id: '', notes: '' }); setShowForm(true); }}
                    className="inline-flex items-center gap-1.5 text-xs bg-red-50 border border-red-200 text-red-700 rounded-full px-3 py-1.5 hover:bg-red-100">
                    <span className="font-mono">@{s.domain}</span> · {s.count} <Plus className="h-3 w-3" /> Add
                  </button>
                ))}
              </div>
              <div className="bg-card border border-border-light rounded-2xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-background"><tr className="text-left text-text-muted text-xs uppercase tracking-wider">
                    <th className="px-5 py-3">Email</th><th className="px-5 py-3">Domain</th><th className="px-5 py-3">Reason</th><th className="px-5 py-3">When</th>
                  </tr></thead>
                  <tbody className="divide-y divide-border-light">
                    {rejections.recent.map((r, i) => (
                      <tr key={i} data-testid={`rejection-row-${i}`}>
                        <td className="px-5 py-2.5 text-text-secondary">{r.email}</td>
                        <td className="px-5 py-2.5 font-mono text-text-primary">@{r.domain}</td>
                        <td className="px-5 py-2.5 text-xs text-text-muted">{r.reason === 'not_in_allowlist' ? 'Domain not allowed' : r.reason === 'free_provider' ? 'Free email blocked' : r.reason === 'site_not_live' ? 'Site not live' : r.reason}</td>
                        <td className="px-5 py-2.5 text-text-muted text-xs">{r.created_at ? new Date(r.created_at).toLocaleString() : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="bg-card rounded-2xl max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-border-light">
              <h2 className="font-heading text-2xl font-medium">Add corporate domain</h2>
              <button onClick={() => setShowForm(false)} className="text-text-muted hover:text-text-primary">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={submit} className="p-6 space-y-4">
              {error && <p className="text-red-600 text-sm bg-red-50 p-3 rounded-lg" data-testid="domain-form-error">{error}</p>}
              <div>
                <label className="text-sm font-medium text-text-primary">Domain*</label>
                <input
                  data-testid="domain-input"
                  required
                  value={form.domain}
                  onChange={(e) => setForm({ ...form, domain: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border border-border-light rounded-lg focus:outline-none focus:border-primary font-mono"
                  placeholder="company.com"
                />
                <p className="text-xs text-text-muted mt-1">e.g. <span className="font-mono">infosys.com</span> — no @ symbol needed</p>
              </div>
              <div>
                <label className="text-sm font-medium text-text-primary">Company (optional)</label>
                <select
                  data-testid="domain-company-select"
                  value={form.company_id}
                  onChange={(e) => setForm({ ...form, company_id: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border border-border-light rounded-lg focus:outline-none focus:border-primary"
                >
                  <option value="">— None —</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <p className="text-xs text-text-muted mt-1">New sign-ups from this domain will auto-link to this company</p>
              </div>
              <div>
                <label className="text-sm font-medium text-text-primary">Default site (optional)</label>
                <select
                  data-testid="domain-site-select"
                  value={form.site_id}
                  onChange={(e) => setForm({ ...form, site_id: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border border-border-light rounded-lg focus:outline-none focus:border-primary"
                >
                  <option value="">— None —</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} {s.lifecycle_status && s.lifecycle_status !== 'live' ? `(${s.lifecycle_status})` : ''}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-text-muted mt-1">If set, employees must wait until the site is <strong>Live</strong> to sign up</p>
              </div>
              <div>
                <label className="text-sm font-medium text-text-primary">Notes</label>
                <input
                  data-testid="domain-notes-input"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border border-border-light rounded-lg focus:outline-none focus:border-primary"
                  placeholder="e.g. Tech Corp employees - Bangalore HQ"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="flex-1 px-4 py-2.5 border border-border-light rounded-xl font-medium text-text-secondary hover:bg-background">Cancel</button>
                <button
                  data-testid="submit-domain-btn"
                  type="submit"
                  disabled={submitting || !form.domain}
                  className="flex-1 px-4 py-2.5 bg-primary text-white rounded-xl font-medium hover:bg-primary-hover disabled:opacity-50"
                >
                  {submitting ? 'Adding…' : 'Add Domain'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};

export default AllowedDomains;
