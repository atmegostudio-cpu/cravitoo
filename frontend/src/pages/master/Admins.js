import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Navbar from '../../components/Navbar';
import { ShieldCheck, Crown, MapPin, Plus, X, Trash2, UserCog, Mail, Store, SlidersHorizontal, ListChecks, Layers } from 'lucide-react';
import logger from '../../lib/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const ROLE_META = {
  master_admin: { label: 'Master Admin', icon: Crown, color: 'text-red-600', bg: 'bg-red-50' },
  super_admin: { label: 'Super Admin', icon: ShieldCheck, color: 'text-purple-600', bg: 'bg-purple-50' },
  site_admin: { label: 'Site Admin', icon: MapPin, color: 'text-blue-600', bg: 'bg-blue-50' },
  vendor_operator: { label: 'Vendor Operator', icon: Store, color: 'text-primary', bg: 'bg-primary/10' },
  sub_admin: { label: 'Sub-Admin', icon: SlidersHorizontal, color: 'text-emerald-700', bg: 'bg-emerald-50' },
};

const MasterAdmins = () => {
  const [admins, setAdmins] = useState([]);
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [role, setRole] = useState('site_admin');
  const [form, setForm] = useState({ email: '', password: '', name: '', site_id: '', assigned_sites: [], vendor_ids: [], permissions: [], scope: { client_ids: [], city_ids: [], site_ids: [], vendor_ids: [] } });
  const [operators, setOperators] = useState([]);
  const [allVendors, setAllVendors] = useState([]);
  const [operatorInvite, setOperatorInvite] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [subAdmins, setSubAdmins] = useState([]);
  const [clients, setClients] = useState([]);
  const [cities, setCities] = useState([]);
  const [activity, setActivity] = useState([]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    try {
      const [a, s, ops, vs, cat, subs, cl, ci, act] = await Promise.all([
        axios.get(`${API}/admin/admins`, { withCredentials: true }),
        axios.get(`${API}/sites`, { withCredentials: true }),
        axios.get(`${API}/admin/vendor-operators`, { withCredentials: true }),
        axios.get(`${API}/admin/all-vendors`, { withCredentials: true }),
        axios.get(`${API}/admin/permission-catalog`, { withCredentials: true }),
        axios.get(`${API}/admin/sub-admins`, { withCredentials: true }),
        axios.get(`${API}/master/corporate-clients`, { withCredentials: true }),
        axios.get(`${API}/cities`, { withCredentials: true }),
        axios.get(`${API}/admin/sub-admin-activity?limit=50`, { withCredentials: true }),
      ]);
      setAdmins(a.data);
      setSites(s.data);
      setOperators(ops.data);
      setAllVendors(vs.data);
      setCatalog(cat.data.permissions || []);
      setSubAdmins(subs.data);
      setClients(cl.data || []);
      setCities(ci.data || []);
      setActivity(act.data || []);
    } catch (e) { logger.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (role === 'site_admin') {
        if (!form.site_id) throw new Error('Select a site');
        await axios.post(`${API}/admin/site-admins`, { email: form.email, password: form.password, name: form.name, site_id: form.site_id }, { withCredentials: true });
      } else if (role === 'super_admin') {
        await axios.post(`${API}/admin/super-admins`, { email: form.email, password: form.password, name: form.name, assigned_sites: form.assigned_sites }, { withCredentials: true });
      } else if (role === 'master_admin') {
        if (!form.email.endsWith('@cravitoo.com')) throw new Error('Master admin email must end with @cravitoo.com');
        await axios.post(`${API}/admin/master-admins`, { email: form.email, password: form.password, name: form.name }, { withCredentials: true });
      } else if (role === 'vendor_operator') {
        if (!form.vendor_ids.length) throw new Error('Select at least one outlet');
        const { data } = await axios.post(`${API}/admin/vendor-operators`, { email: form.email, name: form.name, vendor_ids: form.vendor_ids }, { withCredentials: true });
        setOperatorInvite({ email: data.email, magic_url: data.magic_url, delivered: !!data.email_delivered });
      } else if (role === 'sub_admin') {
        if (!form.permissions.length) throw new Error('Select at least one permission');
        const { data } = await axios.post(`${API}/admin/sub-admins`, { email: form.email, name: form.name, permissions: form.permissions, scope: form.scope }, { withCredentials: true });
        setOperatorInvite({ email: data.email, magic_url: data.magic_url, delivered: !!data.email_delivered });
      }
      setShowForm(false);
      setForm({ email: '', password: '', name: '', site_id: '', assigned_sites: [], vendor_ids: [], permissions: [], scope: { client_ids: [], city_ids: [], site_ids: [], vendor_ids: [] } });
      await load();
    } catch (e) {
      const detail = e?.response?.data?.detail;
      const msg = typeof detail === 'string' ? detail
        : Array.isArray(detail) ? detail.map((d) => d?.msg || JSON.stringify(d)).join(', ')
        : (detail?.msg || e.message || 'Failed');
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const deleteOperator = async (op) => {
    if (!window.confirm(`Delete operator ${op.email}?`)) return;
    try { await axios.delete(`${API}/admin/vendor-operators/${op.id}`, { withCredentials: true }); await load(); }
    catch (e) { alert(e?.response?.data?.detail || 'Failed'); }
  };

  const resendOperator = async (op) => {
    try {
      const { data } = await axios.post(`${API}/admin/vendor-operators/${op.id}/resend`, {}, { withCredentials: true });
      setOperatorInvite({ email: op.email, magic_url: data.magic_url, delivered: !!data.email_delivered });
    } catch (e) { alert(e?.response?.data?.detail || 'Failed'); }
  };

  const deleteSubAdmin = async (sa) => {
    if (!window.confirm(`Delete sub-admin ${sa.email}?`)) return;
    try { await axios.delete(`${API}/admin/sub-admins/${sa.id}`, { withCredentials: true }); await load(); }
    catch (e) { alert(e?.response?.data?.detail || 'Failed'); }
  };

  const resendSubAdmin = async (sa) => {
    try {
      const { data } = await axios.post(`${API}/admin/sub-admins/${sa.id}/resend`, {}, { withCredentials: true });
      setOperatorInvite({ email: sa.email, magic_url: data.magic_url, delivered: !!data.email_delivered });
    } catch (e) { alert(e?.response?.data?.detail || 'Failed'); }
  };


  const deleteAdmin = async (admin) => {
    if (!window.confirm(`Delete ${admin.email}?`)) return;
    try {
      await axios.delete(`${API}/admin/admins/${admin.id}`, { withCredentials: true });
      await load();
    } catch (e) { alert(e?.response?.data?.detail || 'Failed'); }
  };

  const resendInvite = async (admin) => {
    if (!window.confirm(`Re-send the invitation email to ${admin.email}?\n\nThey'll receive a fresh "How to log in" message with the Email Code flow instructions.`)) return;
    try {
      await axios.post(`${API}/admin/users/${admin.id}/resend-invite`, {}, { withCredentials: true });
      alert(`✓ Invitation re-sent to ${admin.email}`);
    } catch (e) {
      alert(e?.response?.data?.detail || 'Could not send invite — check Resend config.');
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

  const siteName = (id) => sites.find((s) => s.id === id)?.name || id;

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-background">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex justify-between items-center mb-8 flex-wrap gap-4">
            <h1 className="font-heading text-4xl sm:text-5xl tracking-tighter font-semibold text-text-primary">Admins</h1>
            <button data-testid="create-admin-btn" onClick={() => setShowForm(true)} className="flex items-center gap-2 bg-primary text-white px-5 py-2.5 rounded-xl font-medium hover:bg-primary-hover transition-all">
              <Plus className="h-4 w-4" /> New Admin
            </button>
          </div>

          <div className="bg-card border border-border-light rounded-2xl overflow-hidden">
            <table className="w-full">
              <thead className="bg-background">
                <tr className="text-left text-xs text-text-muted uppercase">
                  <th className="px-4 py-3">Admin</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Scope</th>
                  <th className="px-4 py-3 w-12"></th>
                </tr>
              </thead>
              <tbody>
                {admins.map((a) => {
                  const meta = ROLE_META[a.role] || ROLE_META.site_admin;
                  const Icon = meta.icon;
                  return (
                    <tr key={a.id} data-testid={`admin-row-${a.id}`} className="border-t border-border-light/50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className={`${meta.bg} rounded-lg p-2`}>
                            <Icon className={`h-4 w-4 ${meta.color}`} />
                          </div>
                          <div>
                            <p className="font-medium text-text-primary text-sm">{a.name || '—'}</p>
                            <p className="text-text-muted text-xs">{a.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 ${meta.bg} ${meta.color} text-xs rounded-full font-medium`}>{meta.label}</span>
                      </td>
                      <td className="px-4 py-3 text-sm text-text-secondary">
                        {a.role === 'site_admin' && (a.site_id ? siteName(a.site_id) : '—')}
                        {a.role === 'super_admin' && ((a.assigned_sites || []).length === 0 ? 'All sites' : `${a.assigned_sites.length} sites`)}
                        {a.role === 'master_admin' && 'All sites · platform-wide'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button
                            data-testid={`resend-invite-${a.id}`}
                            onClick={() => resendInvite(a)}
                            title="Re-send the invitation email"
                            className="text-primary hover:bg-primary-light p-2 rounded-lg"
                          >
                            <Mail className="h-4 w-4" />
                          </button>
                          <button data-testid={`delete-admin-${a.id}`} onClick={() => deleteAdmin(a)} className="text-red-600 hover:bg-red-50 p-2 rounded-lg">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {admins.length === 0 && (
              <div className="p-12 text-center">
                <UserCog className="h-10 w-10 text-text-muted mx-auto mb-3" />
                <p className="text-text-secondary">No admins yet.</p>
              </div>
            )}
          </div>

          {operators.length > 0 && (
            <div className="mt-10">
              <h2 className="font-heading text-2xl font-semibold text-text-primary mb-4 flex items-center gap-2"><Store className="h-5 w-5 text-primary" /> Vendor Operators <span className="text-sm font-normal text-text-muted">· one login, multiple outlets</span></h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {operators.map((op) => (
                  <div key={op.id} data-testid={`operator-card-${op.id}`} className="bg-card border border-border-light rounded-2xl p-5">
                    <div className="flex justify-between items-start gap-2">
                      <div>
                        <p className="font-medium text-text-primary">{op.name}</p>
                        <p className="text-xs text-text-muted">{op.email}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button data-testid={`operator-resend-${op.id}`} onClick={() => resendOperator(op)} title="Resend set-password link" className="text-primary hover:bg-primary/10 p-2 rounded-lg"><Mail className="h-4 w-4" /></button>
                        <button data-testid={`operator-delete-${op.id}`} onClick={() => deleteOperator(op)} className="text-red-600 hover:bg-red-50 p-2 rounded-lg"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {op.outlets.map((n, i) => <span key={i} className="text-xs bg-background border border-border-light rounded-full px-2 py-0.5 text-text-secondary">{n}</span>)}
                    </div>
                    <p className="mt-3 text-[11px] text-text-muted">
                      {op.last_login_at ? `Last signed in ${new Date(op.last_login_at).toLocaleString()}` : (op.activated ? 'Password set · not signed in yet' : '⚠ Invited · has not set password yet')}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {subAdmins.length > 0 && (
            <div className="mt-10" data-testid="sub-admins-section">
              <h2 className="font-heading text-2xl font-semibold text-text-primary mb-4 flex items-center gap-2"><SlidersHorizontal className="h-5 w-5 text-emerald-700" /> Sub-Admins <span className="text-sm font-normal text-text-muted">· custom permissions + scope</span></h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {subAdmins.map((sa) => (
                  <div key={sa.id} data-testid={`sub-admin-card-${sa.id}`} className="bg-card border border-border-light rounded-2xl p-5">
                    <div className="flex justify-between items-start gap-2">
                      <div>
                        <p className="font-medium text-text-primary">{sa.name}</p>
                        <p className="text-xs text-text-muted">{sa.email}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button data-testid={`sub-admin-resend-${sa.id}`} onClick={() => resendSubAdmin(sa)} title="Resend set-password link" className="text-primary hover:bg-primary/10 p-2 rounded-lg"><Mail className="h-4 w-4" /></button>
                        <button data-testid={`sub-admin-delete-${sa.id}`} onClick={() => deleteSubAdmin(sa)} className="text-red-600 hover:bg-red-50 p-2 rounded-lg"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {(sa.permissions || []).map((p) => {
                        const meta = catalog.find((c) => c.key === p);
                        return <span key={p} className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-full px-2 py-0.5">{meta?.label || p}</span>;
                      })}
                      {(sa.permissions || []).length === 0 && <span className="text-xs text-text-muted">No permissions</span>}
                    </div>
                    <p className="mt-3 text-[11px] text-text-muted flex items-center gap-1.5">
                      <Layers className="h-3.5 w-3.5" />
                      {(() => {
                        const sc = sa.scope || {};
                        const parts = [];
                        if (sc.client_ids?.length) parts.push(`${sc.client_ids.length} client(s)`);
                        if (sc.city_ids?.length) parts.push(`${sc.city_ids.length} city(ies)`);
                        if (sc.site_ids?.length) parts.push(`${sc.site_ids.length} site(s)`);
                        if (sc.vendor_ids?.length) parts.push(`${sc.vendor_ids.length} vendor(s)`);
                        return parts.length ? parts.join(' · ') : 'No scope assigned';
                      })()}
                    </p>
                    <p className="mt-1 text-[11px] text-text-muted">
                      {sa.last_login_at ? `Last signed in ${new Date(sa.last_login_at).toLocaleString()}` : (sa.activated ? 'Password set · not signed in yet' : '⚠ Invited · has not set password yet')}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {activity.length > 0 && (
            <div className="mt-10" data-testid="sub-admin-activity-section">
              <h2 className="font-heading text-2xl font-semibold text-text-primary mb-4 flex items-center gap-2"><ListChecks className="h-5 w-5 text-emerald-700" /> Sub-Admin Activity <span className="text-sm font-normal text-text-muted">· who did what & when</span></h2>
              <div className="bg-card border border-border-light rounded-2xl divide-y divide-border-light/60 overflow-hidden">
                {activity.map((ev) => (
                  <div key={ev.id} data-testid={`activity-row-${ev.id}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="text-text-primary truncate">
                        <span className="font-medium">{ev.user_email}</span>{' '}
                        <span className="text-text-secondary">{(ev.action || '').replace(/_/g, ' ')}</span>{' '}
                        <span className="text-text-muted">· {ev.entity_type}</span>
                      </p>
                      {ev.details && Object.keys(ev.details).length > 0 && (
                        <p className="text-xs text-text-muted truncate">{JSON.stringify(ev.details)}</p>
                      )}
                    </div>
                    <span className="text-xs text-text-muted whitespace-nowrap">{ev.created_at ? new Date(ev.created_at).toLocaleString() : ''}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {operatorInvite && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" data-testid="operator-invite-modal">
          <div className="bg-card rounded-2xl max-w-md w-full p-6">
            <h3 className="font-heading text-lg font-semibold text-text-primary mb-1">Operator access ready</h3>
            <p className="text-sm text-text-secondary mb-4">{operatorInvite.delivered ? `Set-password link emailed to ${operatorInvite.email}.` : `Couldn't email ${operatorInvite.email}. Copy the link below and send it directly.`}</p>
            <div className="flex gap-2 mb-4">
              <input data-testid="operator-invite-link" readOnly value={operatorInvite.magic_url || ''} className="flex-1 px-3 py-2 border border-border-light rounded-lg text-xs font-mono bg-background" />
              <button data-testid="operator-invite-copy" onClick={() => { try { navigator.clipboard.writeText(operatorInvite.magic_url); } catch { /* noop */ } }} className="px-3 py-2 bg-primary text-white rounded-lg text-xs font-medium hover:bg-primary-hover whitespace-nowrap">Copy link</button>
            </div>
            <button data-testid="operator-invite-close" onClick={() => setOperatorInvite(null)} className="w-full px-4 py-2.5 border border-border-light rounded-xl text-sm font-medium text-text-secondary hover:bg-background">Done</button>
          </div>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="bg-card rounded-2xl max-w-md w-full max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-border-light">
              <h2 className="font-heading text-2xl font-medium">New Admin</h2>
              <button onClick={() => setShowForm(false)}><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={submit} className="p-6 space-y-4 overflow-y-auto">
              {error && <p className="text-red-600 text-sm bg-red-50 p-2 rounded">{error}</p>}
              <div>
                <label className="text-sm font-medium text-text-primary">Role</label>
                <select data-testid="new-admin-role" value={role} onChange={(e) => setRole(e.target.value)} className="mt-1 w-full px-3 py-2 border border-border-light rounded-lg">
                  <option value="site_admin">Site Admin</option>
                  <option value="super_admin">Super Admin</option>
                  <option value="vendor_operator">Vendor Operator (multi-outlet)</option>
                  <option value="sub_admin">Sub-Admin (custom permissions)</option>
                  <option value="master_admin">Master Admin (must be @cravitoo.com)</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-text-primary">Name</label>
                <input data-testid="new-admin-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 w-full px-3 py-2 border border-border-light rounded-lg" />
              </div>
              <div>
                <label className="text-sm font-medium text-text-primary">Email</label>
                <input data-testid="new-admin-email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="mt-1 w-full px-3 py-2 border border-border-light rounded-lg" />
              </div>
              <div>
                <label className="text-sm font-medium text-text-primary">Password</label>
                <input data-testid="new-admin-password" type="password" required={!['vendor_operator', 'sub_admin'].includes(role)} disabled={['vendor_operator', 'sub_admin'].includes(role)} minLength={6} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder={['vendor_operator', 'sub_admin'].includes(role) ? 'Set via email magic-link' : ''} className="mt-1 w-full px-3 py-2 border border-border-light rounded-lg disabled:bg-background disabled:text-text-muted" />
              </div>
              {role === 'site_admin' && (
                <div>
                  <label className="text-sm font-medium text-text-primary">Assigned Site</label>
                  <select data-testid="new-admin-site" required value={form.site_id} onChange={(e) => setForm({ ...form, site_id: e.target.value })} className="mt-1 w-full px-3 py-2 border border-border-light rounded-lg">
                    <option value="">-- choose site --</option>
                    {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              )}
              {role === 'super_admin' && (
                <div>
                  <label className="text-sm font-medium text-text-primary">Assigned Sites (empty = all)</label>
                  <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                    {sites.map((s) => (
                      <label key={s.id} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={form.assigned_sites.includes(s.id)} onChange={(e) => {
                          const next = e.target.checked ? [...form.assigned_sites, s.id] : form.assigned_sites.filter((x) => x !== s.id);
                          setForm({ ...form, assigned_sites: next });
                        }} />
                        {s.name}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {role === 'vendor_operator' && (
                <div>
                  <label className="text-sm font-medium text-text-primary">Outlets this operator manages</label>
                  <div className="mt-2 space-y-1 max-h-40 overflow-y-auto border border-border-light rounded-lg p-2">
                    {allVendors.map((v) => (
                      <label key={v.id} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" data-testid={`op-vendor-${v.id}`} checked={form.vendor_ids.includes(v.id)} onChange={(e) => {
                          const next = e.target.checked ? [...form.vendor_ids, v.id] : form.vendor_ids.filter((x) => x !== v.id);
                          setForm({ ...form, vendor_ids: next });
                        }} />
                        {v.name}
                      </label>
                    ))}
                    {allVendors.length === 0 && <p className="text-xs text-text-muted">No active vendors yet.</p>}
                  </div>
                  <p className="mt-1 text-xs text-text-muted">They set their password via an emailed magic link (like other invites).</p>
                </div>
              )}
              {role === 'sub_admin' && (
                <>
                  <div>
                    <label className="text-sm font-medium text-text-primary flex items-center gap-1.5"><ListChecks className="h-4 w-4 text-emerald-700" /> Permissions</label>
                    <div className="mt-2 space-y-1 border border-border-light rounded-lg p-2">
                      {catalog.map((p) => (
                        <label key={p.key} className="flex items-center gap-2 text-sm">
                          <input type="checkbox" data-testid={`sub-perm-${p.key.replace(':', '-')}`} checked={form.permissions.includes(p.key)} onChange={(e) => {
                            const next = e.target.checked ? [...form.permissions, p.key] : form.permissions.filter((x) => x !== p.key);
                            setForm({ ...form, permissions: next });
                          }} />
                          <span><span className="font-medium">{p.label}</span> <span className="text-text-muted text-xs">· {p.module}</span></span>
                        </label>
                      ))}
                      {catalog.length === 0 && <p className="text-xs text-text-muted">No permissions available.</p>}
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-text-primary flex items-center gap-1.5"><SlidersHorizontal className="h-4 w-4 text-emerald-700" /> Scope <span className="text-xs font-normal text-text-muted">· defines exactly what they can touch</span></label>
                    {[
                      { key: 'client_ids', label: 'Clients', items: clients },
                      { key: 'city_ids', label: 'Cities', items: cities },
                      { key: 'site_ids', label: 'Sites', items: sites },
                      { key: 'vendor_ids', label: 'Vendors', items: allVendors },
                    ].map((grp) => (
                      <div key={grp.key} className="mt-2">
                        <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-1">{grp.label}</p>
                        <div className="space-y-1 max-h-28 overflow-y-auto border border-border-light rounded-lg p-2">
                          {grp.items.map((it) => (
                            <label key={it.id} className="flex items-center gap-2 text-sm">
                              <input type="checkbox" data-testid={`sub-scope-${grp.key}-${it.id}`} checked={form.scope[grp.key].includes(it.id)} onChange={(e) => {
                                const cur = form.scope[grp.key];
                                const next = e.target.checked ? [...cur, it.id] : cur.filter((x) => x !== it.id);
                                setForm({ ...form, scope: { ...form.scope, [grp.key]: next } });
                              }} />
                              {it.name}
                            </label>
                          ))}
                          {grp.items.length === 0 && <p className="text-xs text-text-muted">None available.</p>}
                        </div>
                      </div>
                    ))}
                    <p className="mt-1 text-xs text-text-muted">Sales & onboarding access is limited to the sites resolved from this scope. They set their password via an emailed magic link.</p>
                  </div>
                </>
              )}
              <div className="flex gap-3 pt-3 sticky bottom-0 bg-card -mx-6 px-6 pb-1 border-t border-border-light mt-2">
                <button type="button" onClick={() => setShowForm(false)} className="flex-1 px-4 py-2.5 border border-border-light rounded-xl font-medium">Cancel</button>
                <button data-testid="submit-admin-btn" type="submit" disabled={submitting} className="flex-1 px-4 py-2.5 bg-primary text-white rounded-xl font-medium hover:bg-primary-hover disabled:opacity-50">{submitting ? 'Creating...' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};

export default MasterAdmins;
