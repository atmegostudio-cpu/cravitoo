import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import Navbar from '../../components/Navbar';
import { Building2, Plus, Mail, ArrowRight, Trash2, X, CheckCircle2, Edit3 } from 'lucide-react';
import logger from '../../lib/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const STAGES = [
  { key: 'draft', label: 'Draft', color: 'bg-slate-100 text-slate-700 border-slate-200' },
  { key: 'review', label: 'In Review', color: 'bg-blue-100 text-blue-800 border-blue-200' },
  { key: 'approved', label: 'Approved', color: 'bg-amber-100 text-amber-800 border-amber-200' },
  { key: 'active', label: 'Active', color: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
];
const NEXT_STAGE = {
  draft: { to: 'review', label: 'Move to Review' },
  review: { to: 'approved', label: 'Approve' },
  approved: { to: 'active', label: 'Activate' },
};

const StageBadge = ({ stage }) => {
  const s = STAGES.find(x => x.key === stage) || STAGES[3];
  return (
    <span data-testid={`stage-${stage}`} className={`inline-block px-2.5 py-1 text-xs font-medium rounded-full border ${s.color}`}>
      {s.label}
    </span>
  );
};

const CorporateClients = () => {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', address: '', contact_email: '', contact_phone: '', billing_contact_name: '', billing_contact_email: '', notes: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API}/master/corporate-clients`, { withCredentials: true });
      setClients(data || []);
    } catch (e) {
      logger.error(e);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', address: '', contact_email: '', contact_phone: '', billing_contact_name: '', billing_contact_email: '', notes: '' });
    setError('');
    setShowForm(true);
  };
  const openEdit = (c) => {
    setEditing(c);
    setForm({
      name: c.name || '', address: c.address || '', contact_email: c.contact_email || '',
      contact_phone: c.contact_phone || '', billing_contact_name: c.billing_contact_name || '',
      billing_contact_email: c.billing_contact_email || '', notes: c.notes || '',
    });
    setError('');
    setShowForm(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true); setError('');
    try {
      if (editing) {
        await axios.patch(`${API}/master/corporate-clients/${editing.id}`, form, { withCredentials: true });
      } else {
        await axios.post(`${API}/master/corporate-clients`, form, { withCredentials: true });
      }
      setShowForm(false);
      await load();
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : (Array.isArray(detail) ? detail.map(d => d.msg).join(', ') : 'Save failed'));
    } finally { setSubmitting(false); }
  };

  const [invite, setInvite] = useState(null);

  const advance = async (client, target) => {
    if (!window.confirm(`Advance "${client.name}" to "${target}"?` + (target === 'approved' ? '\n\nThe Corporate Admin account will be created and a set-password link emailed to the billing contact.' : ''))) return;
    try {
      const { data } = await axios.post(`${API}/master/corporate-clients/${client.id}/lifecycle`, { to: target }, { withCredentials: true });
      if (target === 'approved') {
        if (data?.magic_url) {
          setInvite({ clientName: client.name, email: data.admin_email, magic_url: data.magic_url, delivered: !!data.email_delivered });
        } else {
          alert('Approved. ' + (data?.provision_skipped_reason ? `Admin account not created: ${data.provision_skipped_reason}` : ''));
        }
      }
      await load();
    } catch (e) {
      alert(e?.response?.data?.detail || 'Lifecycle change failed');
    }
  };

  const resendInvite = async (client) => {
    try {
      const { data } = await axios.post(`${API}/master/corporate-clients/${client.id}/resend-admin-invite`, {}, { withCredentials: true });
      setInvite({ clientName: client.name, email: data.admin_email, magic_url: data.magic_url, delivered: !!data.email_delivered });
    } catch (e) {
      alert(e?.response?.data?.detail || 'Could not resend admin invite');
    }
  };

  const remove = async (client) => {
    if (!window.confirm(`Delete "${client.name}"?\n\nIf there are linked employees/sites, you will be asked whether to cascade.`)) return;
    try {
      await axios.delete(`${API}/master/corporate-clients/${client.id}`, { withCredentials: true });
      await load();
    } catch (e) {
      const detail = e?.response?.data?.detail || '';
      // Backend returns a "Re-issue with ?cascade=true" hint when employees are linked.
      if (typeof detail === 'string' && detail.includes('cascade=true')) {
        if (!window.confirm(
          `${detail}\n\n` +
          `⚠ Cascading will PERMANENTLY delete every employee, site, order, invoice ` +
          `and domain linked to "${client.name}". This cannot be undone.\n\n` +
          `Continue?`
        )) return;
        try {
          await axios.delete(
            `${API}/master/corporate-clients/${client.id}?cascade=true`,
            { withCredentials: true }
          );
          await load();
        } catch (e2) {
          alert(e2?.response?.data?.detail || 'Cascade delete failed');
        }
        return;
      }
      alert(detail || 'Delete failed');
    }
  };

  if (loading) {
    return (<><Navbar /><div className="min-h-screen bg-background flex items-center justify-center"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" /></div></>);
  }

  return (
    <>
      <Navbar />
      {invite && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" data-testid="corp-invite-modal">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <h3 className="font-heading text-lg font-semibold text-text-primary mb-1">Corporate Admin access ready</h3>
            <p className="text-sm text-text-secondary mb-4">
              {invite.delivered
                ? `We emailed a one-time set-password link to ${invite.email}.`
                : `Couldn't email ${invite.email}. Copy the link below and send it directly — it works the same way.`}
            </p>
            <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Set-password link · {invite.clientName}</label>
            <div className="flex gap-2 mt-1 mb-4">
              <input data-testid="corp-invite-link" readOnly value={invite.magic_url || ''} className="flex-1 px-3 py-2 border border-border-light rounded-lg text-xs font-mono bg-background" />
              <button
                data-testid="corp-invite-copy"
                onClick={() => { try { navigator.clipboard.writeText(invite.magic_url); } catch { /* noop */ } }}
                className="px-3 py-2 bg-primary text-white rounded-lg text-xs font-medium hover:bg-primary-hover whitespace-nowrap"
              >Copy link</button>
            </div>
            <button data-testid="corp-invite-close" onClick={() => setInvite(null)} className="w-full px-4 py-2.5 border border-border-light rounded-xl text-sm font-medium text-text-secondary hover:bg-background">Done</button>
          </div>
        </div>
      )}
      <div className="min-h-screen bg-background">
        <div className="max-w-6xl mx-auto px-6 py-8">
          <div className="flex justify-between items-start mb-8 flex-wrap gap-4">
            <div>
              <h1 className="font-heading text-4xl sm:text-5xl tracking-tighter font-semibold text-text-primary">Corporate Clients</h1>
              <p className="text-text-secondary mt-2 max-w-2xl">
                Manage your enterprise clients through the lifecycle: <strong>Draft → Review → Approved → Active</strong>.
                Approval triggers a welcome email with login link to the billing contact.
              </p>
            </div>
            <button
              data-testid="add-client-btn"
              onClick={openCreate}
              className="flex items-center gap-2 bg-primary text-white px-5 py-2.5 rounded-xl font-medium hover:bg-primary-hover transition-all"
            >
              <Plus className="h-4 w-4" /> Add Client
            </button>
          </div>

          {clients.length === 0 ? (
            <div className="bg-card border border-border-light rounded-2xl p-12 text-center" data-testid="empty-clients">
              <Building2 className="h-12 w-12 text-text-muted mx-auto mb-4" />
              <p className="text-text-secondary mb-2">No corporate clients yet.</p>
              <p className="text-text-muted text-sm">Add your first client to start onboarding.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {clients.map((c) => (
                <div key={c.id} data-testid={`client-card-${c.id}`} className="bg-card border border-border-light rounded-2xl p-5 hover:shadow-md transition-shadow">
                  <div className="flex justify-between items-start gap-2 mb-3">
                    <div className="flex-1">
                      <h3 className="font-heading text-lg font-semibold text-text-primary">{c.name}</h3>
                      <p className="text-xs text-text-muted mt-1">{c.address}</p>
                    </div>
                    <StageBadge stage={c.lifecycle_status} />
                  </div>
                  <div className="space-y-1 text-sm text-text-secondary mb-4">
                    <div className="flex items-center gap-2"><Mail className="h-3.5 w-3.5 text-text-muted" /> {c.contact_email}</div>
                    {c.billing_contact_email && (
                      <div className="flex items-center gap-2 text-xs text-text-muted">
                        💼 Billing: {c.billing_contact_name || '—'} &lt;{c.billing_contact_email}&gt;
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap pt-3 border-t border-border-light">
                    {NEXT_STAGE[c.lifecycle_status] && (
                      <button
                        data-testid={`advance-${c.id}`}
                        onClick={() => advance(c, NEXT_STAGE[c.lifecycle_status].to)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-medium hover:bg-primary-hover"
                      >
                        {NEXT_STAGE[c.lifecycle_status].label} <ArrowRight className="h-3 w-3" />
                      </button>
                    )}
                    {(c.lifecycle_status === 'approved' || c.lifecycle_status === 'active') && (
                      <button
                        data-testid={`resend-invite-${c.id}`}
                        onClick={() => resendInvite(c)}
                        className="flex items-center gap-1 px-3 py-1.5 border border-border-light rounded-lg text-xs font-medium text-text-secondary hover:bg-background"
                      >
                        <Mail className="h-3 w-3" /> Resend admin invite
                      </button>
                    )}
                    {c.lifecycle_status === 'active' && (
                      <span className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-700">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Onboarded
                      </span>
                    )}
                    <button
                      data-testid={`edit-${c.id}`}
                      onClick={() => openEdit(c)}
                      className="flex items-center gap-1 px-3 py-1.5 border border-border-light rounded-lg text-xs font-medium text-text-secondary hover:bg-background"
                    >
                      <Edit3 className="h-3 w-3" /> Edit
                    </button>
                    <button
                      data-testid={`delete-${c.id}`}
                      onClick={() => remove(c)}
                      className="flex items-center gap-1 px-3 py-1.5 text-red-600 hover:bg-red-50 rounded-lg text-xs font-medium"
                    >
                      <Trash2 className="h-3 w-3" /> Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="bg-card rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-border-light">
              <h2 className="font-heading text-2xl font-medium">{editing ? 'Edit Corporate Client' : 'Add Corporate Client'}</h2>
              <button onClick={() => setShowForm(false)} className="text-text-muted hover:text-text-primary"><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={submit} className="p-6 space-y-4">
              {error && <p className="text-red-600 text-sm bg-red-50 p-3 rounded-lg" data-testid="client-form-error">{error}</p>}
              {[
                ['name', 'Company name *', 'TechCorp Pvt. Ltd.', true],
                ['address', 'Address *', '123 Business Park, Bangalore', true],
                ['contact_email', 'Contact email *', 'admin@techcorp.com', true],
                ['contact_phone', 'Contact phone *', '+91-9876543210', true],
                ['billing_contact_name', 'Billing contact name', 'Priya Sharma'],
                ['billing_contact_email', 'Billing contact email', 'finance@techcorp.com'],
                ['notes', 'Notes', 'Optional internal notes'],
              ].map(([k, label, ph, req]) => (
                <div key={k}>
                  <label className="text-sm font-medium text-text-primary">{label}</label>
                  <input
                    data-testid={`client-${k}-input`}
                    required={!!req}
                    value={form[k]}
                    onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                    placeholder={ph}
                    className="mt-1 w-full px-3 py-2 border border-border-light rounded-lg focus:outline-none focus:border-primary"
                  />
                </div>
              ))}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="flex-1 px-4 py-2.5 border border-border-light rounded-xl font-medium text-text-secondary hover:bg-background">Cancel</button>
                <button data-testid="submit-client-btn" type="submit" disabled={submitting} className="flex-1 px-4 py-2.5 bg-primary text-white rounded-xl font-medium hover:bg-primary-hover disabled:opacity-50">
                  {submitting ? 'Saving…' : (editing ? 'Save Changes' : 'Create Client')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};

export default CorporateClients;
