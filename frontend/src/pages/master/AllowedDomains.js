import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import Navbar from '../../components/Navbar';
import { Mail, Plus, Trash2, X, ShieldAlert, CheckCircle2 } from 'lucide-react';

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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, c, s] = await Promise.all([
        axios.get(`${API}/admin/allowed-domains`, { withCredentials: true }),
        axios.get(`${API}/companies`, { withCredentials: true }).catch(() => ({ data: [] })),
        axios.get(`${API}/sites`, { withCredentials: true }).catch(() => ({ data: [] })),
      ]);
      setDomains(d.data);
      setCompanies(c.data || []);
      setSites(s.data || []);
    } catch (e) {
      console.error(e);
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
                      <td className="px-5 py-3 text-text-secondary">{d.company_name || '—'}</td>
                      <td className="px-5 py-3 text-text-secondary">{d.site_name || '—'}</td>
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
