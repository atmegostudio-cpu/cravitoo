import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import Navbar from '../../components/Navbar';
import { Building2, Plus, MapPin, Phone, Mail, ChevronRight, X, Trash2, Wrench, Link2, AlertTriangle } from 'lucide-react';
import logger from '../../lib/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const LIFECYCLE_STYLES = {
  draft: 'bg-slate-100 text-slate-700 border-slate-200',
  configured: 'bg-amber-100 text-amber-800 border-amber-200',
  live: 'bg-emerald-100 text-emerald-800 border-emerald-200',
};

const LifecycleBadge = ({ status }) => {
  const s = status || 'live';
  const cls = LIFECYCLE_STYLES[s] || LIFECYCLE_STYLES.live;
  const label = s === 'live' ? 'Live' : s === 'configured' ? 'Configured' : 'Draft';
  return (
    <span
      data-testid={`site-lifecycle-${s}`}
      className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full border ${cls}`}
    >
      {label}
    </span>
  );
};

const EMPTY_FORM = {
  name: '', company_id: '', city_id: '', address: '', city: '', contact_email: '', contact_phone: '',
  allow_pre_order: true, allow_cash_carry: true, allow_company_paid: false, allow_employee_paid: true,
};

const MasterSites = () => {
  const [sites, setSites] = useState([]);
  const [clients, setClients] = useState([]);
  const [cities, setCities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [repairing, setRepairing] = useState(false);
  // Assign client & city modal
  const [assignSite, setAssignSite] = useState(null); // the site being linked
  const [assignForm, setAssignForm] = useState({ company_id: '', city_id: '' });
  const [assignSaving, setAssignSaving] = useState(false);
  const [assignError, setAssignError] = useState('');

  const clientName = useCallback((id) => clients.find((c) => c.id === id)?.name || null, [clients]);
  const cityName = useCallback((id) => cities.find((c) => c.id === id)?.name || null, [cities]);

  const fetchAll = useCallback(async () => {
    try {
      const [s, c, ct] = await Promise.all([
        axios.get(`${API}/sites`, { withCredentials: true }),
        axios.get(`${API}/master/corporate-clients`, { withCredentials: true }),
        axios.get(`${API}/cities`, { withCredentials: true }),
      ]);
      setSites(s.data);
      setClients(c.data || []);
      setCities(ct.data || []);
    } catch (e) {
      logger.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const repairLinks = async () => {
    setRepairing(true);
    try {
      const { data } = await axios.post(`${API}/admin/integrity/backfill-sites`, {}, { withCredentials: true });
      await fetchAll();
      alert(`Repair complete. Scanned ${data.scanned}, linked company on ${data.fixed_company}, city on ${data.fixed_city}, still unresolved ${data.unresolved}.`);
    } catch (e) {
      alert(e?.response?.data?.detail || 'Repair failed');
    } finally {
      setRepairing(false);
    }
  };

  const deleteSite = async (site, e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm(
      `Permanently delete "${site.name}"?\n\n` +
      `This will also remove ALL menu items, vendor mappings, meal schedules, ` +
      `reservations and orders at this site. This cannot be undone.`
    )) return;
    try {
      await axios.delete(`${API}/sites/${site.id}`, { withCredentials: true });
      fetchAll();
    } catch (err) {
      alert(err?.response?.data?.detail || 'Failed to delete site');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const payload = { ...form, city: cityName(form.city_id) || form.city };
      await axios.post(`${API}/sites`, payload, { withCredentials: true });
      setShowForm(false);
      setForm(EMPTY_FORM);
      fetchAll();
    } catch (e) {
      setError(e?.response?.data?.detail || 'Failed to create site');
    } finally {
      setSubmitting(false);
    }
  };

  const openAssign = (site, e) => {
    e.preventDefault();
    e.stopPropagation();
    setAssignSite(site);
    setAssignForm({ company_id: site.company_id || '', city_id: site.city_id || '' });
    setAssignError('');
  };

  const saveAssign = async (e) => {
    e.preventDefault();
    if (!assignForm.company_id || !assignForm.city_id) {
      setAssignError('Pick both a client and a city');
      return;
    }
    setAssignSaving(true);
    setAssignError('');
    try {
      await axios.patch(`${API}/sites/${assignSite.id}`, {
        company_id: assignForm.company_id,
        city_id: assignForm.city_id,
        city: cityName(assignForm.city_id) || assignSite.city,
      }, { withCredentials: true });
      setAssignSite(null);
      fetchAll();
    } catch (err) {
      setAssignError(err?.response?.data?.detail || 'Failed to save');
    } finally {
      setAssignSaving(false);
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
            <h1 className="font-heading text-4xl sm:text-5xl tracking-tighter font-semibold text-text-primary">Sites</h1>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                data-testid="repair-site-links-btn"
                onClick={repairLinks}
                disabled={repairing}
                className="flex items-center gap-2 bg-card border border-border-light text-text-secondary px-4 py-2.5 rounded-xl font-medium hover:border-primary/40 disabled:opacity-50 transition-all"
                title="Relink any older sites missing their city or company"
              >
                <Wrench className="h-4 w-4" /> {repairing ? 'Repairing…' : 'Repair Links'}
              </button>
              <button
                data-testid="create-site-btn"
                onClick={() => { setForm(EMPTY_FORM); setError(''); setShowForm(true); }}
                className="flex items-center gap-2 bg-primary text-white px-5 py-2.5 rounded-xl font-medium hover:bg-primary-hover transition-all"
              >
                <Plus className="h-4 w-4" /> New Site
              </button>
            </div>
          </div>

          {sites.length === 0 && (
            <div className="bg-card border border-border-light rounded-2xl p-12 text-center">
              <Building2 className="h-12 w-12 text-text-muted mx-auto mb-4" />
              <p className="text-text-secondary mb-2">No sites yet.</p>
              <p className="text-text-muted text-sm">Create your first office location to start onboarding employees and vendors.</p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {sites.map((site) => {
              const linkedClient = clientName(site.company_id);
              const linkedCity = cityName(site.city_id);
              const unlinked = !site.company_id || !site.city_id;
              return (
              <div
                key={site.id}
                className="relative bg-card border border-border-light rounded-2xl p-6 hover:shadow-lg hover:border-primary/40 transition-all group"
              >
                <button
                  data-testid={`delete-site-${site.id}`}
                  onClick={(e) => deleteSite(site, e)}
                  title="Permanently delete this site"
                  className="absolute top-3 right-3 z-10 text-red-500 hover:text-white hover:bg-red-600 p-1.5 rounded-lg transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
                <Link
                  to={`/master/sites/${site.id}`}
                  data-testid={`site-card-${site.id}`}
                  className="block"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="bg-primary-light rounded-xl p-3">
                      <Building2 className="h-6 w-6 text-primary" />
                    </div>
                    <ChevronRight className="h-5 w-5 text-text-muted group-hover:text-primary transition-colors mr-8" />
                  </div>
                  <h3 className="font-heading text-lg font-medium text-text-primary mb-1">{site.name}</h3>
                  <p className="text-text-muted text-xs mb-3">{site.city}</p>
                  {site.lifecycle_status && (
                    <div className="mb-3">
                      <LifecycleBadge status={site.lifecycle_status} />
                    </div>
                  )}

                  {/* Client / City linkage */}
                  <div className="mb-3 flex flex-wrap items-center gap-1.5">
                    {linkedClient ? (
                      <span data-testid={`site-client-name-${site.id}`} className="inline-flex items-center gap-1 px-2 py-0.5 bg-primary-light text-primary text-xs rounded-full">
                        <Building2 className="h-3 w-3" /> {linkedClient}
                      </span>
                    ) : null}
                    {linkedCity ? (
                      <span data-testid={`site-city-name-${site.id}`} className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded-full">
                        <MapPin className="h-3 w-3" /> {linkedCity}
                      </span>
                    ) : null}
                    {unlinked && (
                      <span data-testid={`site-unlinked-badge-${site.id}`} className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-800 text-xs rounded-full">
                        <AlertTriangle className="h-3 w-3" /> Not linked to a client/city
                      </span>
                    )}
                  </div>

                  <div className="space-y-1.5 text-xs text-text-secondary">
                    <p className="flex items-start gap-1.5"><MapPin className="h-3 w-3 mt-0.5 flex-shrink-0" /> {site.address}</p>
                    <p className="flex items-center gap-1.5"><Mail className="h-3 w-3" /> {site.contact_email}</p>
                    <p className="flex items-center gap-1.5"><Phone className="h-3 w-3" /> {site.contact_phone}</p>
                  </div>
                  <div className="mt-4 flex gap-2 flex-wrap">
                    {site.allow_pre_order && <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 text-xs rounded-full">Pre-order</span>}
                    {site.allow_cash_carry && <span className="px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded-full">Cash & Carry</span>}
                    {site.allow_company_paid && <span className="px-2 py-0.5 bg-purple-50 text-purple-700 text-xs rounded-full">Company-paid</span>}
                    {site.allow_employee_paid && <span className="px-2 py-0.5 bg-amber-50 text-amber-700 text-xs rounded-full">Self-paid</span>}
                  </div>
                </Link>

                <button
                  data-testid={`assign-site-link-btn-${site.id}`}
                  onClick={(e) => openAssign(site, e)}
                  className={`mt-4 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all ${unlinked ? 'bg-amber-500 text-white hover:bg-amber-600' : 'bg-card border border-border-light text-text-secondary hover:border-primary/40'}`}
                >
                  <Link2 className="h-3.5 w-3.5" /> {unlinked ? 'Assign client & city' : 'Change client / city'}
                </button>
              </div>
            );})}
          </div>
        </div>
      </div>

      {/* Create site modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="bg-card rounded-2xl max-w-xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-border-light">
              <h2 className="font-heading text-2xl font-medium">New Site</h2>
              <button onClick={() => setShowForm(false)} className="text-text-muted hover:text-text-primary">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {error && <p className="text-red-600 text-sm bg-red-50 p-2 rounded">{error}</p>}
              <div>
                <label className="text-sm font-medium text-text-primary">Name</label>
                <input data-testid="site-name-input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 w-full px-3 py-2 border border-border-light rounded-lg focus:outline-none focus:border-primary" placeholder="Tech Corp - Mumbai HQ" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium text-text-primary">Client</label>
                  <select data-testid="site-client-select" required value={form.company_id} onChange={(e) => setForm({ ...form, company_id: e.target.value })} className="mt-1 w-full px-3 py-2 border border-border-light rounded-lg focus:outline-none focus:border-primary bg-white">
                    <option value="">Select client…</option>
                    {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-text-primary">City</label>
                  <select data-testid="site-city-select" required value={form.city_id} onChange={(e) => setForm({ ...form, city_id: e.target.value })} className="mt-1 w-full px-3 py-2 border border-border-light rounded-lg focus:outline-none focus:border-primary bg-white">
                    <option value="">Select city…</option>
                    {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>
              {clients.length === 0 && (
                <p className="text-xs text-amber-700 bg-amber-50 p-2 rounded">No clients yet — add one under <Link to="/master/clients" className="underline">Corporate Clients</Link> first.</p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium text-text-primary">Contact Phone</label>
                  <input required value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} className="mt-1 w-full px-3 py-2 border border-border-light rounded-lg focus:outline-none focus:border-primary" placeholder="+91-9876543210" />
                </div>
                <div>
                  <label className="text-sm font-medium text-text-primary">Contact Email</label>
                  <input type="email" required value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} className="mt-1 w-full px-3 py-2 border border-border-light rounded-lg focus:outline-none focus:border-primary" placeholder="admin@site.com" />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-text-primary">Address</label>
                <input required value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="mt-1 w-full px-3 py-2 border border-border-light rounded-lg focus:outline-none focus:border-primary" placeholder="123 Business Park" />
              </div>
              <div>
                <p className="text-sm font-medium text-text-primary mb-2">Ordering modes allowed</p>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {[
                    { key: 'allow_pre_order', label: 'Pre-order' },
                    { key: 'allow_cash_carry', label: 'Cash & Carry' },
                    { key: 'allow_company_paid', label: 'Company-paid' },
                    { key: 'allow_employee_paid', label: 'Employee-paid' },
                  ].map((opt) => (
                    <label key={opt.key} className="flex items-center gap-2 p-2 border border-border-light rounded-lg cursor-pointer hover:border-primary/40">
                      <input type="checkbox" checked={form[opt.key]} onChange={(e) => setForm({ ...form, [opt.key]: e.target.checked })} />
                      <span>{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="flex-1 px-4 py-2.5 border border-border-light rounded-xl font-medium text-text-secondary hover:bg-background">Cancel</button>
                <button data-testid="submit-site-btn" type="submit" disabled={submitting} className="flex-1 px-4 py-2.5 bg-primary text-white rounded-xl font-medium hover:bg-primary-hover disabled:opacity-50">
                  {submitting ? 'Creating...' : 'Create Site'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Assign client & city modal */}
      {assignSite && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setAssignSite(null)}>
          <div data-testid="assign-site-modal" className="bg-card rounded-2xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-border-light">
              <h2 className="font-heading text-xl font-medium flex items-center gap-2"><Link2 className="h-5 w-5 text-primary" /> Assign client & city</h2>
              <button data-testid="assign-cancel-btn" onClick={() => setAssignSite(null)} className="text-text-muted hover:text-text-primary">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={saveAssign} className="p-6 space-y-4">
              <p className="text-sm text-text-secondary">Linking <span className="font-medium text-text-primary">{assignSite.name}</span> so its orders roll up under the right client and city in the Sales Report.</p>
              {assignError && <p className="text-red-600 text-sm bg-red-50 p-2 rounded">{assignError}</p>}
              <div>
                <label className="text-sm font-medium text-text-primary">Client</label>
                <select data-testid="assign-client-select" value={assignForm.company_id} onChange={(e) => setAssignForm({ ...assignForm, company_id: e.target.value })} className="mt-1 w-full px-3 py-2 border border-border-light rounded-lg focus:outline-none focus:border-primary bg-white">
                  <option value="">Select client…</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-text-primary">City</label>
                <select data-testid="assign-city-select" value={assignForm.city_id} onChange={(e) => setAssignForm({ ...assignForm, city_id: e.target.value })} className="mt-1 w-full px-3 py-2 border border-border-light rounded-lg focus:outline-none focus:border-primary bg-white">
                  <option value="">Select city…</option>
                  {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setAssignSite(null)} className="flex-1 px-4 py-2.5 border border-border-light rounded-xl font-medium text-text-secondary hover:bg-background">Cancel</button>
                <button data-testid="assign-save-btn" type="submit" disabled={assignSaving} className="flex-1 px-4 py-2.5 bg-primary text-white rounded-xl font-medium hover:bg-primary-hover disabled:opacity-50">
                  {assignSaving ? 'Saving…' : 'Save link'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};

export default MasterSites;
