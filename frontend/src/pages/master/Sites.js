import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import Navbar from '../../components/Navbar';
import { Building2, Plus, MapPin, Phone, Mail, ChevronRight, X } from 'lucide-react';

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

const MasterSites = () => {
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: '',
    address: '',
    city: '',
    contact_email: '',
    contact_phone: '',
    allow_pre_order: true,
    allow_cash_carry: true,
    allow_company_paid: false,
    allow_employee_paid: true,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const fetchSites = async () => {
    try {
      const { data } = await axios.get(`${API}/sites`, { withCredentials: true });
      setSites(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchSites(); }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await axios.post(`${API}/sites`, form, { withCredentials: true });
      setShowForm(false);
      setForm({
        name: '', address: '', city: '', contact_email: '', contact_phone: '',
        allow_pre_order: true, allow_cash_carry: true, allow_company_paid: false, allow_employee_paid: true,
      });
      fetchSites();
    } catch (e) {
      setError(e?.response?.data?.detail || 'Failed to create site');
    } finally {
      setSubmitting(false);
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
            <button
              data-testid="create-site-btn"
              onClick={() => setShowForm(true)}
              className="flex items-center gap-2 bg-primary text-white px-5 py-2.5 rounded-xl font-medium hover:bg-primary-hover transition-all"
            >
              <Plus className="h-4 w-4" /> New Site
            </button>
          </div>

          {sites.length === 0 && (
            <div className="bg-card border border-border-light rounded-2xl p-12 text-center">
              <Building2 className="h-12 w-12 text-text-muted mx-auto mb-4" />
              <p className="text-text-secondary mb-2">No sites yet.</p>
              <p className="text-text-muted text-sm">Create your first office location to start onboarding employees and vendors.</p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {sites.map((site) => (
              <Link
                key={site.id}
                to={`/master/sites/${site.id}`}
                data-testid={`site-card-${site.id}`}
                className="bg-card border border-border-light rounded-2xl p-6 hover:shadow-lg hover:border-primary/40 transition-all group"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="bg-primary-light rounded-xl p-3">
                    <Building2 className="h-6 w-6 text-primary" />
                  </div>
                  <ChevronRight className="h-5 w-5 text-text-muted group-hover:text-primary transition-colors" />
                </div>
                <h3 className="font-heading text-lg font-medium text-text-primary mb-1">{site.name}</h3>
                <p className="text-text-muted text-xs mb-3">{site.city}</p>
                {site.lifecycle_status && (
                  <div className="mb-3">
                    <LifecycleBadge status={site.lifecycle_status} />
                  </div>
                )}
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
            ))}
          </div>
        </div>
      </div>

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
                  <label className="text-sm font-medium text-text-primary">City</label>
                  <input required value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className="mt-1 w-full px-3 py-2 border border-border-light rounded-lg focus:outline-none focus:border-primary" placeholder="Mumbai" />
                </div>
                <div>
                  <label className="text-sm font-medium text-text-primary">Contact Phone</label>
                  <input required value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} className="mt-1 w-full px-3 py-2 border border-border-light rounded-lg focus:outline-none focus:border-primary" placeholder="+91-9876543210" />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-text-primary">Address</label>
                <input required value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="mt-1 w-full px-3 py-2 border border-border-light rounded-lg focus:outline-none focus:border-primary" placeholder="123 Business Park" />
              </div>
              <div>
                <label className="text-sm font-medium text-text-primary">Contact Email</label>
                <input type="email" required value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} className="mt-1 w-full px-3 py-2 border border-border-light rounded-lg focus:outline-none focus:border-primary" placeholder="admin@site.com" />
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
    </>
  );
};

export default MasterSites;
