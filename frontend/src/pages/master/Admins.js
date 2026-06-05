import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Navbar from '../../components/Navbar';
import { ShieldCheck, Crown, MapPin, Plus, X, Trash2, UserCog, Mail } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const ROLE_META = {
  master_admin: { label: 'Master Admin', icon: Crown, color: 'text-red-600', bg: 'bg-red-50' },
  super_admin: { label: 'Super Admin', icon: ShieldCheck, color: 'text-purple-600', bg: 'bg-purple-50' },
  site_admin: { label: 'Site Admin', icon: MapPin, color: 'text-blue-600', bg: 'bg-blue-50' },
};

const MasterAdmins = () => {
  const [admins, setAdmins] = useState([]);
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [role, setRole] = useState('site_admin');
  const [form, setForm] = useState({ email: '', password: '', name: '', site_id: '', assigned_sites: [] });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    try {
      const [a, s] = await Promise.all([
        axios.get(`${API}/admin/admins`, { withCredentials: true }),
        axios.get(`${API}/sites`, { withCredentials: true }),
      ]);
      setAdmins(a.data);
      setSites(s.data);
    } catch (e) { console.error(e); }
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
      }
      setShowForm(false);
      setForm({ email: '', password: '', name: '', site_id: '', assigned_sites: [] });
      await load();
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || 'Failed');
    } finally {
      setSubmitting(false);
    }
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
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="bg-card rounded-2xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-border-light">
              <h2 className="font-heading text-2xl font-medium">New Admin</h2>
              <button onClick={() => setShowForm(false)}><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={submit} className="p-6 space-y-4">
              {error && <p className="text-red-600 text-sm bg-red-50 p-2 rounded">{error}</p>}
              <div>
                <label className="text-sm font-medium text-text-primary">Role</label>
                <select data-testid="new-admin-role" value={role} onChange={(e) => setRole(e.target.value)} className="mt-1 w-full px-3 py-2 border border-border-light rounded-lg">
                  <option value="site_admin">Site Admin</option>
                  <option value="super_admin">Super Admin</option>
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
                <input data-testid="new-admin-password" type="password" required minLength={6} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="mt-1 w-full px-3 py-2 border border-border-light rounded-lg" />
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
              <div className="flex gap-3 pt-2">
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
