import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import Navbar from '../../components/Navbar';
import { Store, Edit, Save, X, Settings, Mail, Trash2, Send, CheckCircle2, AlertCircle, Clock, Sparkles, Copy, Link2 } from 'lucide-react';
import logger from '../../lib/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const MasterVendors = () => {
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [pct, setPct] = useState('');
  const [saving, setSaving] = useState(false);
  const [profileEdit, setProfileEdit] = useState(null);
  const [pForm, setPForm] = useState({});
  const [resendVendor, setResendVendor] = useState(null);       // vendor row when modal is open
  const [resendEmail, setResendEmail] = useState('');
  const [resendBusy, setResendBusy] = useState(false);
  const [resendResult, setResendResult] = useState(null);       // {ok, message}
  const [resendLink, setResendLink] = useState('');             // the copyable magic link
  const [linkCopied, setLinkCopied] = useState(false);
  const [resendLog, setResendLog] = useState([]);
  const [sanitizing, setSanitizing] = useState(false);
  const [sanitizeResult, setSanitizeResult] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/vendors`, { withCredentials: true });
      setVendors(data);
    } catch (e) { logger.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async (vendorId) => {
    const v = parseFloat(pct);
    if (isNaN(v) || v < 0 || v > 50) {
      alert('Commission must be between 0 and 50');
      return;
    }
    setSaving(true);
    try {
      await axios.patch(`${API}/admin/vendors/${vendorId}/commission`,
        { commission_pct: v }, { withCredentials: true });
      setEditing(null);
      await load();
    } catch (e) {
      alert(e?.response?.data?.detail || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const openProfileEdit = (v) => {
    setProfileEdit(v);
    setPForm({
      name: v.name || '',
      description: v.description || '',
      cuisine_type: v.cuisine_type || '',
      phone: v.phone || '',
      email: v.email || '',
      address: v.address || '',
      status: v.status || 'active',
    });
  };

  const saveProfile = async () => {
    setSaving(true);
    try {
      await axios.patch(`${API}/admin/vendors/${profileEdit.id}`, pForm, { withCredentials: true });
      setProfileEdit(null);
      await load();
    } catch (e) {
      alert(e?.response?.data?.detail || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const deleteVendor = async (v) => {
    if (!window.confirm(
      `Permanently delete vendor "${v.name}"?\n\n` +
      `This will also remove ALL menu items, site mappings, orders, ` +
      `reservations and the vendor login user. This cannot be undone.`
    )) return;
    try {
      await axios.delete(`${API}/vendors/${v.id}`, { withCredentials: true });
      await load();
    } catch (e) {
      alert(e?.response?.data?.detail || 'Failed to delete vendor');
    }
  };

  const openResend = async (v) => {
    setResendVendor(v);
    setResendEmail(v.email || '');
    setResendResult(null);
    setResendLog([]);
    try {
      const { data } = await axios.get(`${API}/admin/vendors/${v.id}/email-log`, { withCredentials: true });
      setResendLog(data || []);
    } catch (_) { /* silent */ }
  };

  const sanitizeMappings = async () => {
    if (!window.confirm(
      'Clean up stale vendor-site mappings?\n\n' +
      'This scans every "active" mapping and deactivates any that points ' +
      'to a suspended, inactive, or deleted vendor. Safe to run — it does ' +
      'not delete data, only marks stale rows as inactive.'
    )) return;
    setSanitizing(true);
    setSanitizeResult(null);
    try {
      const { data } = await axios.post(
        `${API}/admin/vendor-site-mappings/sanitize`,
        {},
        { withCredentials: true },
      );
      setSanitizeResult({ ok: true, n: data.stale_mappings_deactivated || 0 });
    } catch (e) {
      setSanitizeResult({ ok: false, message: e?.response?.data?.detail || 'Sanitize failed' });
    } finally {
      setSanitizing(false);
    }
  };

  const doResend = async () => {
    if (!resendVendor) return;
    const email = (resendEmail || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      setResendResult({ ok: false, message: 'Please enter a valid email address.' });
      return;
    }
    setResendBusy(true);
    setResendResult(null);
    setResendLink('');
    setLinkCopied(false);
    try {
      const { data } = await axios.post(
        `${API}/admin/vendors/${resendVendor.id}/resend-onboarding`,
        { email },
        { withCredentials: true },
      );
      setResendResult({ ok: true, delivered: data.email_delivered !== false, message: data.message || `Sent to ${data.delivered_to}` });
      // Build the copy-link from THIS app's own origin using the token, so it
      // always opens on the same host the admin is using (robust to backend
      // ingress header stripping). Fall back to the server-provided magic_url.
      if (data.token) setResendLink(`${window.location.origin}/auth/magic/${data.token}`);
      else if (data.magic_url) setResendLink(data.magic_url);
      // refresh log
      const { data: log } = await axios.get(`${API}/admin/vendors/${resendVendor.id}/email-log`, { withCredentials: true });
      setResendLog(log || []);
      // reload the vendor list so email badge updates
      load();
    } catch (e) {
      setResendResult({ ok: false, message: e?.response?.data?.detail || 'Failed to send' });
    } finally {
      setResendBusy(false);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(resendLink);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2500);
    } catch {
      // Fallback for browsers without clipboard API
      const el = document.getElementById('resend-magic-link-field');
      if (el) { el.select(); document.execCommand('copy'); setLinkCopied(true); setTimeout(() => setLinkCopied(false), 2500); }
    }
  };

  if (loading) {
    return (
      <>
        <Navbar />
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </>
    );
  }

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-background">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex justify-between items-center mb-8 flex-wrap gap-4">
            <div>
              <h1 className="font-heading text-4xl sm:text-5xl tracking-tighter font-semibold text-text-primary">Vendors</h1>
              <p className="text-text-secondary mt-2">Manage platform vendors & commission rates</p>
            </div>
            <button
              data-testid="sanitize-mappings-btn"
              onClick={sanitizeMappings}
              disabled={sanitizing}
              title="Deactivate mappings pointing to suspended / deleted vendors so they stop appearing under site vendor lists"
              className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2.5 rounded-xl text-sm font-semibold shadow-lg disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4" />
              {sanitizing ? 'Cleaning…' : 'Clean up site mappings'}
            </button>
          </div>

          {sanitizeResult && (
            <div
              data-testid={sanitizeResult.ok ? 'sanitize-success' : 'sanitize-error'}
              className={`mb-6 flex items-start gap-2 rounded-xl p-3.5 text-sm ${
                sanitizeResult.ok
                  ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                  : 'bg-red-50 border border-red-200 text-red-800'
              }`}
            >
              {sanitizeResult.ok ? <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" /> : <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />}
              <div className="flex-1">
                {sanitizeResult.ok ? (
                  sanitizeResult.n === 0 ? (
                    <span>All vendor-site mappings are already clean. Nothing to fix.</span>
                  ) : (
                    <span>Cleaned up <strong>{sanitizeResult.n}</strong> stale mapping{sanitizeResult.n === 1 ? '' : 's'}. Those vendors will no longer appear on their sites&apos; vendor lists.</span>
                  )
                ) : (
                  <span>{sanitizeResult.message}</span>
                )}
              </div>
              <button
                onClick={() => setSanitizeResult(null)}
                className="text-current hover:opacity-70"
                aria-label="Dismiss"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          <div className="bg-card border border-border-light rounded-2xl overflow-hidden">
            <table className="w-full">
              <thead className="bg-background">
                <tr className="text-left text-xs text-text-muted uppercase">
                  <th className="px-4 py-3">Vendor</th>
                  <th className="px-4 py-3">Contact</th>
                  <th className="px-4 py-3">Cuisine</th>
                  <th className="px-4 py-3">Sites</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Login</th>
                  <th className="px-4 py-3">Rating</th>
                  <th className="px-4 py-3">Commission %</th>
                  <th className="px-4 py-3 w-12"></th>
                </tr>
              </thead>
              <tbody>
                {vendors.map((v) => (
                  <tr key={v.id} data-testid={`vendor-row-${v.id}`} className="border-t border-border-light/50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="bg-primary-light rounded-lg p-2">
                          <Store className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                          <p className="font-medium text-text-primary text-sm">{v.name}</p>
                          <p className="text-text-muted text-xs truncate max-w-xs">{v.description || ''}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <p data-testid={`vendor-email-${v.id}`} className="text-text-primary truncate max-w-[180px]" title={v.email}>{v.email || '—'}</p>
                      <p data-testid={`vendor-phone-${v.id}`} className="text-text-muted">{v.phone || '—'}</p>
                    </td>
                    <td className="px-4 py-3 text-sm text-text-secondary">{v.cuisine_type || '—'}</td>
                    <td className="px-4 py-3 text-sm">
                      <span data-testid={`vendor-sites-count-${v.id}`} className={`px-2 py-1 rounded-full font-medium text-xs ${
                        (v.mapped_sites_count ?? 0) > 0 ? 'bg-primary-light text-primary' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {v.mapped_sites_count ?? 0} {(v.mapped_sites_count ?? 0) === 1 ? 'site' : 'sites'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 text-xs rounded-full font-medium ${
                        v.status === 'active' ? 'bg-emerald-50 text-emerald-700' :
                        v.status === 'inactive' ? 'bg-gray-100 text-gray-600' :
                        'bg-amber-50 text-amber-700'
                      }`}>{v.status || 'active'}</span>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {v.has_login_user ? (
                        <span data-testid={`vendor-login-${v.id}`} className="px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 font-medium">Linked</span>
                      ) : (
                        <span data-testid={`vendor-login-${v.id}`} className="px-2 py-1 rounded-full bg-amber-50 text-amber-700 font-medium">No login</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-text-secondary">{v.rating ? `${v.rating.toFixed(1)} ⭐` : '—'}</td>
                    <td className="px-4 py-3">
                      {editing === v.id ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            value={pct}
                            onChange={(e) => setPct(e.target.value)}
                            className="w-20 px-2 py-1 border border-border-light rounded text-sm"
                            min="0"
                            max="50"
                            step="0.5"
                            data-testid={`commission-input-${v.id}`}
                          />
                          <button
                            onClick={() => save(v.id)}
                            disabled={saving}
                            data-testid={`save-commission-${v.id}`}
                            className="text-emerald-600 hover:bg-emerald-50 p-1.5 rounded"
                          >
                            <Save className="h-4 w-4" />
                          </button>
                          <button onClick={() => setEditing(null)} className="text-text-muted hover:bg-background p-1.5 rounded">
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-text-primary">{(v.commission_pct ?? 15).toFixed(1)}%</span>
                          <button
                            onClick={() => { setEditing(v.id); setPct(String(v.commission_pct ?? 15)); }}
                            data-testid={`edit-commission-${v.id}`}
                            className="text-primary hover:bg-primary-light p-1.5 rounded"
                          >
                            <Edit className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={async () => {
                            if (!window.confirm(`Re-send the invitation email to ${v.email || 'the vendor'}?`)) return;
                            try {
                              await axios.post(`${API}/vendors/${v.id}/resend-invite`, {}, { withCredentials: true });
                              alert(`✓ Invitation re-sent to ${v.email || 'vendor'}`);
                            } catch (e) {
                              alert(e?.response?.data?.detail || 'Could not send invite.');
                            }
                          }}
                          data-testid={`resend-vendor-invite-${v.id}`}
                          title="Re-send the partner-login invitation email"
                          className="text-primary hover:bg-primary-light p-1.5 rounded"
                        >
                          <Mail className="h-4 w-4" />
                        </button>
                        <button onClick={() => openProfileEdit(v)} data-testid={`edit-profile-${v.id}`} className="text-text-secondary hover:text-primary p-1.5 rounded hover:bg-background">
                          <Settings className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => openResend(v)}
                          data-testid={`resend-onboarding-${v.id}`}
                          title="Resend Vendor Panel onboarding link"
                          className="text-indigo-600 hover:text-white hover:bg-indigo-600 p-1.5 rounded transition-colors"
                        >
                          <Send className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => deleteVendor(v)}
                          data-testid={`delete-vendor-${v.id}`}
                          title="Permanently delete this vendor and all their data"
                          className="text-red-500 hover:text-white hover:bg-red-600 p-1.5 rounded transition-colors"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {vendors.length === 0 && (
              <div className="p-12 text-center">
                <Store className="h-10 w-10 text-text-muted mx-auto mb-3" />
                <p className="text-text-secondary">No vendors yet.</p>
              </div>
            )}
          </div>
        </div>
      </div>
      {profileEdit && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setProfileEdit(null)}>
          <div className="bg-card rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-border-light">
              <h2 className="font-heading text-xl font-medium">Edit Vendor Profile</h2>
              <button onClick={() => setProfileEdit(null)}><X className="h-5 w-5" /></button>
            </div>
            <div className="p-6 space-y-3">
              {[
                { k: 'name', label: 'Name', required: true },
                { k: 'description', label: 'Description', textarea: true },
                { k: 'cuisine_type', label: 'Cuisine Type' },
                { k: 'phone', label: 'Phone' },
                { k: 'email', label: 'Email', type: 'email' },
                { k: 'address', label: 'Address', textarea: true },
              ].map((f) => (
                <div key={f.k}>
                  <label className="text-sm font-medium text-text-primary">{f.label}{f.required && <span className="text-red-500"> *</span>}</label>
                  {f.textarea ? (
                    <textarea data-testid={`edit-vendor-${f.k}`} value={pForm[f.k] || ''} onChange={(e) => setPForm({ ...pForm, [f.k]: e.target.value })} rows={2} className="mt-1 w-full px-3 py-2 border border-border-light rounded-lg text-sm" />
                  ) : (
                    <input data-testid={`edit-vendor-${f.k}`} type={f.type || 'text'} value={pForm[f.k] || ''} onChange={(e) => setPForm({ ...pForm, [f.k]: e.target.value })} className="mt-1 w-full px-3 py-2 border border-border-light rounded-lg text-sm" />
                  )}
                </div>
              ))}
              <div>
                <label className="text-sm font-medium text-text-primary">Status</label>
                <select data-testid="edit-vendor-status" value={pForm.status || 'active'} onChange={(e) => setPForm({ ...pForm, status: e.target.value })} className="mt-1 w-full px-3 py-2 border border-border-light rounded-lg text-sm">
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="suspended">Suspended</option>
                </select>
              </div>
              <div className="flex gap-3 pt-3">
                <button onClick={() => setProfileEdit(null)} className="flex-1 px-4 py-2.5 border border-border-light rounded-xl font-medium">Cancel</button>
                <button data-testid="save-vendor-profile-btn" onClick={saveProfile} disabled={saving} className="flex-1 px-4 py-2.5 bg-primary text-white rounded-xl font-medium hover:bg-primary-hover disabled:opacity-50">{saving ? 'Saving...' : 'Save'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {resendVendor && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => !resendBusy && setResendVendor(null)}
          data-testid="resend-modal"
        >
          <div className="bg-card rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-border-light">
              <div>
                <h2 className="font-heading text-lg font-semibold text-text-primary flex items-center gap-2">
                  <Send className="h-4 w-4 text-indigo-600" />
                  Resend Vendor Panel access
                </h2>
                <p className="text-xs text-text-muted mt-0.5 truncate max-w-xs">for <strong>{resendVendor.name}</strong></p>
              </div>
              <button data-testid="resend-modal-close" onClick={() => setResendVendor(null)} className="text-text-muted hover:text-text-primary">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Send to</label>
                <input
                  data-testid="resend-email-input"
                  type="email"
                  autoFocus
                  value={resendEmail}
                  onChange={(e) => setResendEmail(e.target.value)}
                  disabled={resendBusy}
                  placeholder="vendor@company.com"
                  className="mt-1 w-full px-3 py-2.5 border border-border-light rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
                <p className="text-[11px] text-text-muted mt-1.5">
                  Works for corporate and approved non-corporate emails. Vendor gets a <strong>one-tap sign-in link</strong> that never expires until it's used once — they set their own password on first open.
                </p>
              </div>

              {resendResult && (
                <div
                  data-testid={resendResult.ok ? 'resend-success' : 'resend-error'}
                  className={`flex items-start gap-2 rounded-lg p-3 text-sm ${
                    resendResult.ok
                      ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                      : 'bg-red-50 border border-red-200 text-red-800'
                  }`}
                >
                  {resendResult.ok ? <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" /> : <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />}
                  <span>{resendResult.message}</span>
                </div>
              )}

              {resendLink && (
                <div data-testid="resend-magic-link-box" className="rounded-lg border border-indigo-200 bg-indigo-50/60 p-3">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Link2 className="h-3.5 w-3.5 text-indigo-600" />
                    <p className="text-[11px] font-semibold text-indigo-700 uppercase tracking-wider">Direct sign-in link</p>
                  </div>
                  <p className="text-[11px] text-text-muted mb-2">
                    Copy this and send it to the vendor on WhatsApp, SMS or chat if email doesn't arrive. It opens the "set your password" screen.
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      id="resend-magic-link-field"
                      data-testid="resend-magic-link-field"
                      readOnly
                      value={resendLink}
                      onFocus={(e) => e.target.select()}
                      className="flex-1 min-w-0 px-2.5 py-2 border border-border-light rounded-lg text-xs font-mono bg-white truncate"
                    />
                    <button
                      data-testid="resend-copy-link-btn"
                      onClick={copyLink}
                      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                        linkCopied ? 'bg-emerald-600 text-white' : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                      }`}
                    >
                      {linkCopied ? <><CheckCircle2 className="h-3.5 w-3.5" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy</>}
                    </button>
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <button
                  data-testid="resend-cancel-btn"
                  onClick={() => setResendVendor(null)}
                  disabled={resendBusy}
                  className="flex-1 bg-background hover:bg-background/80 border border-border-light text-text-primary px-4 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  Close
                </button>
                <button
                  data-testid="resend-send-btn"
                  onClick={doResend}
                  disabled={resendBusy || !resendEmail}
                  className="flex-1 flex items-center justify-center gap-2 bg-primary hover:bg-primary-hover text-white px-4 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50"
                >
                  {resendBusy ? 'Sending…' : <><Send className="h-4 w-4" /> Send link</>}
                </button>
              </div>

              {resendLog.length > 0 && (
                <div className="pt-3 border-t border-border-light">
                  <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-2">Recent attempts</p>
                  <ul className="space-y-1.5">
                    {resendLog.slice(0, 5).map((r, idx) => (
                      <li key={idx} data-testid={`resend-log-${idx}`} className="flex items-start gap-2 text-xs">
                        {r.status === 'sent' ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mt-0.5 flex-shrink-0" />
                        ) : r.status === 'no_email_on_file' ? (
                          <AlertCircle className="h-3.5 w-3.5 text-amber-500 mt-0.5 flex-shrink-0" />
                        ) : (
                          <AlertCircle className="h-3.5 w-3.5 text-red-500 mt-0.5 flex-shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-text-primary truncate">
                            <span className="font-medium">{r.email || '(no email)'}</span>
                            {r.error && <span className="text-red-600"> · {r.error.slice(0, 60)}</span>}
                          </p>
                          <p className="text-text-muted flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {new Date(r.created_at).toLocaleString()}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default MasterVendors;
