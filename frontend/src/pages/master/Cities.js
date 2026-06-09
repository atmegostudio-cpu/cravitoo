import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import Navbar from '../../components/Navbar';
import { MapPin, Plus, X, Trash2, UserCog, Archive, RotateCcw, Edit3, Eye, EyeOff } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const REGIONS = ['North', 'South', 'East', 'West', 'Central', 'Northeast'];

const MasterCities = () => {
  const [cities, setCities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [showAdminForm, setShowAdminForm] = useState(null);
  const [form, setForm] = useState({ name: '', state: '', region: '', country: 'India' });
  const [adminForm, setAdminForm] = useState({ email: '', password: '', name: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API}/cities?include_archived=${includeArchived}`, { withCredentials: true });
      setCities(data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [includeArchived]);

  useEffect(() => { load(); }, [load]);

  const resetForm = () => {
    setForm({ name: '', state: '', region: '', country: 'India' });
    setEditing(null);
    setError('');
  };

  const openCreate = () => { resetForm(); setShowForm(true); };
  const openEdit = (c) => {
    setEditing(c);
    setForm({ name: c.name || '', state: c.state || '', region: c.region || '', country: c.country || 'India' });
    setError('');
    setShowForm(true);
  };

  const saveCity = async (e) => {
    e.preventDefault();
    setSubmitting(true); setError('');
    try {
      if (editing) {
        await axios.patch(`${API}/cities/${editing.id}`, form, { withCredentials: true });
      } else {
        await axios.post(`${API}/cities`, form, { withCredentials: true });
      }
      setShowForm(false);
      resetForm();
      await load();
    } catch (e) {
      setError(e?.response?.data?.detail || 'Failed');
    } finally { setSubmitting(false); }
  };

  const archiveCity = async (c) => {
    if (!window.confirm(`Archive "${c.name}"?\n\nThis hides it from sign-up flows but keeps history. You can restore it later.`)) return;
    try {
      await axios.post(`${API}/cities/${c.id}/archive`, {}, { withCredentials: true });
      await load();
    } catch (e) {
      alert(e?.response?.data?.detail || 'Archive failed');
    }
  };

  const restoreCity = async (c) => {
    try {
      await axios.post(`${API}/cities/${c.id}/restore`, {}, { withCredentials: true });
      await load();
    } catch (e) {
      alert(e?.response?.data?.detail || 'Restore failed');
    }
  };

  const deleteCity = async (c) => {
    if (!window.confirm(`Permanently delete "${c.name}"?\n\nThis cannot be undone. Cities with linked Sites or Admins cannot be deleted — archive them instead.`)) return;
    try {
      await axios.delete(`${API}/cities/${c.id}`, { withCredentials: true });
      await load();
    } catch (e) {
      alert(e?.response?.data?.detail || 'Delete failed');
    }
  };

  const createCityAdmin = async (e) => {
    e.preventDefault();
    setSubmitting(true); setError('');
    try {
      await axios.post(`${API}/admin/city-admins`,
        { ...adminForm, city_id: showAdminForm.id },
        { withCredentials: true });
      setShowAdminForm(null);
      setAdminForm({ email: '', password: '', name: '' });
      alert('City admin created. Share the credentials with them.');
    } catch (e) {
      setError(e?.response?.data?.detail || 'Failed');
    } finally { setSubmitting(false); }
  };

  if (loading) {
    return (<><Navbar /><div className="min-h-screen bg-background flex items-center justify-center"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div></div></>);
  }

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-background">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex justify-between items-center mb-6 flex-wrap gap-4">
            <div>
              <h1 className="font-heading text-4xl sm:text-5xl tracking-tighter font-semibold text-text-primary">Cities</h1>
              <p className="text-text-secondary mt-2">Manage cities & their admins across India</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                data-testid="toggle-archived-btn"
                onClick={() => setIncludeArchived(!includeArchived)}
                className="flex items-center gap-2 px-4 py-2.5 border border-border-light rounded-xl text-sm font-medium text-text-secondary hover:bg-card"
                title={includeArchived ? 'Hide archived cities' : 'Show archived cities'}
              >
                {includeArchived ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                {includeArchived ? 'Hide archived' : 'Show archived'}
              </button>
              <button data-testid="create-city-btn" onClick={openCreate} className="flex items-center gap-2 bg-primary text-white px-5 py-2.5 rounded-xl font-medium hover:bg-primary-hover">
                <Plus className="h-4 w-4" /> New City
              </button>
            </div>
          </div>

          {cities.length === 0 && (
            <div className="bg-card border border-border-light rounded-2xl p-12 text-center" data-testid="empty-cities">
              <MapPin className="h-12 w-12 text-text-muted mx-auto mb-4" />
              <p className="text-text-secondary mb-2">No cities yet.</p>
              <p className="text-text-muted text-sm">Add cities to organize your sites and vendors by region.</p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {cities.map((c) => {
              const isArchived = c.status === 'archived';
              return (
                <div key={c.id} data-testid={`city-card-${c.id}`} className={`bg-card border rounded-2xl p-6 hover:shadow-md transition-all ${isArchived ? 'opacity-70 border-slate-200' : 'border-border-light'}`}>
                  <div className="flex items-start justify-between mb-4">
                    <div className={`${isArchived ? 'bg-slate-100' : 'bg-blue-50'} rounded-xl p-3`}>
                      <MapPin className={`h-6 w-6 ${isArchived ? 'text-slate-500' : 'text-blue-600'}`} />
                    </div>
                    {isArchived ? (
                      <span data-testid={`archived-badge-${c.id}`} className="inline-block px-2.5 py-1 text-xs font-medium rounded-full bg-slate-100 text-slate-700 border border-slate-200">Archived</span>
                    ) : (
                      <button onClick={() => setShowAdminForm(c)} data-testid={`add-city-admin-${c.id}`} title="Add City Admin" className="text-primary hover:bg-primary-light p-1.5 rounded-lg">
                        <UserCog className="h-5 w-5" />
                      </button>
                    )}
                  </div>
                  <h3 className="font-heading text-lg font-medium text-text-primary mb-1">{c.name}</h3>
                  <p className="text-text-muted text-sm">
                    {c.state}, {c.country}
                    {c.region && <span className="ml-1.5 inline-block px-2 py-0.5 text-xs rounded-full bg-amber-50 text-amber-700">{c.region}</span>}
                  </p>
                  <div className="flex gap-2 mt-4">
                    <div className="bg-background rounded-lg px-3 py-2 flex-1">
                      <p className="text-xs text-text-muted">Sites</p>
                      <p className="font-heading text-lg font-semibold text-text-primary">{c.site_count}</p>
                    </div>
                    <div className="bg-background rounded-lg px-3 py-2 flex-1">
                      <p className="text-xs text-text-muted">Active vendors</p>
                      <p className="font-heading text-lg font-semibold text-primary">{c.vendor_count}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 mt-4 pt-3 border-t border-border-light flex-wrap">
                    {!isArchived && (
                      <>
                        <button
                          data-testid={`edit-city-${c.id}`}
                          onClick={() => openEdit(c)}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-text-secondary hover:bg-background rounded-lg"
                        >
                          <Edit3 className="h-3 w-3" /> Edit
                        </button>
                        <button
                          data-testid={`archive-city-${c.id}`}
                          onClick={() => archiveCity(c)}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 rounded-lg"
                        >
                          <Archive className="h-3 w-3" /> Archive
                        </button>
                      </>
                    )}
                    {isArchived && (
                      <button
                        data-testid={`restore-city-${c.id}`}
                        onClick={() => restoreCity(c)}
                        className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 rounded-lg"
                      >
                        <RotateCcw className="h-3 w-3" /> Restore
                      </button>
                    )}
                    <button
                      data-testid={`delete-city-${c.id}`}
                      onClick={() => deleteCity(c)}
                      className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg ml-auto"
                      title="Delete (blocked if sites are linked)"
                    >
                      <Trash2 className="h-3 w-3" /> Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {showForm && (
        <Modal onClose={() => { setShowForm(false); resetForm(); }} title={editing ? `Edit City · ${editing.name}` : 'New City'}>
          <form onSubmit={saveCity} className="p-6 space-y-4">
            {error && <p className="text-red-600 text-sm bg-red-50 p-2 rounded" data-testid="city-form-error">{error}</p>}
            <div>
              <label className="text-sm font-medium">City Name *</label>
              <input data-testid="city-name-input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 w-full px-3 py-2 border border-border-light rounded-lg" placeholder="Bangalore" />
            </div>
            <div>
              <label className="text-sm font-medium">State *</label>
              <input data-testid="city-state-input" required value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} className="mt-1 w-full px-3 py-2 border border-border-light rounded-lg" placeholder="Karnataka" />
            </div>
            <div>
              <label className="text-sm font-medium">Region</label>
              <select
                data-testid="city-region-select"
                value={form.region}
                onChange={(e) => setForm({ ...form, region: e.target.value })}
                className="mt-1 w-full px-3 py-2 border border-border-light rounded-lg bg-card"
              >
                <option value="">— Select region —</option>
                {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <p className="text-xs text-text-muted mt-1">Used for regional reporting & vendor allocation.</p>
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => { setShowForm(false); resetForm(); }} className="flex-1 px-4 py-2.5 border border-border-light rounded-xl font-medium">Cancel</button>
              <button data-testid="submit-city-btn" type="submit" disabled={submitting} className="flex-1 px-4 py-2.5 bg-primary text-white rounded-xl font-medium hover:bg-primary-hover disabled:opacity-50">
                {submitting ? 'Saving…' : (editing ? 'Save Changes' : 'Create City')}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {showAdminForm && (
        <Modal onClose={() => setShowAdminForm(null)} title={`Add City Admin · ${showAdminForm.name}`}>
          <form onSubmit={createCityAdmin} className="p-6 space-y-4">
            {error && <p className="text-red-600 text-sm bg-red-50 p-2 rounded">{error}</p>}
            <div>
              <label className="text-sm font-medium">Name</label>
              <input data-testid="city-admin-name" required value={adminForm.name} onChange={(e) => setAdminForm({ ...adminForm, name: e.target.value })} className="mt-1 w-full px-3 py-2 border border-border-light rounded-lg" />
            </div>
            <div>
              <label className="text-sm font-medium">Email</label>
              <input type="email" data-testid="city-admin-email" required value={adminForm.email} onChange={(e) => setAdminForm({ ...adminForm, email: e.target.value })} className="mt-1 w-full px-3 py-2 border border-border-light rounded-lg" />
            </div>
            <div>
              <label className="text-sm font-medium">Password</label>
              <input type="password" data-testid="city-admin-password" required minLength={6} value={adminForm.password} onChange={(e) => setAdminForm({ ...adminForm, password: e.target.value })} className="mt-1 w-full px-3 py-2 border border-border-light rounded-lg" />
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setShowAdminForm(null)} className="flex-1 px-4 py-2.5 border border-border-light rounded-xl font-medium">Cancel</button>
              <button data-testid="submit-city-admin-btn" type="submit" disabled={submitting} className="flex-1 px-4 py-2.5 bg-primary text-white rounded-xl font-medium hover:bg-primary-hover disabled:opacity-50">{submitting ? 'Creating...' : 'Create Admin'}</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
};

const Modal = ({ children, title, onClose }) => (
  <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
    <div className="bg-card rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between p-6 border-b border-border-light">
        <h2 className="font-heading text-2xl font-medium">{title}</h2>
        <button onClick={onClose}><X className="h-5 w-5" /></button>
      </div>
      {children}
    </div>
  </div>
);

export default MasterCities;
