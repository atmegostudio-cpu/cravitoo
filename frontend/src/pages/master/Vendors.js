import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Navbar from '../../components/Navbar';
import { Store, Edit, Save, X, Settings, Mail } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const MasterVendors = () => {
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [pct, setPct] = useState('');
  const [saving, setSaving] = useState(false);
  const [profileEdit, setProfileEdit] = useState(null);
  const [pForm, setPForm] = useState({});

  const load = async () => {
    try {
      const { data } = await axios.get(`${API}/vendors`, { withCredentials: true });
      setVendors(data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

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
          </div>

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
    </>
  );
};

export default MasterVendors;
