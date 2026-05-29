import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { useAuth } from '../context/AuthContext';
import { Store, Save, ArrowLeft } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const OnboardingNew = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [sites, setSites] = useState([]);
  const [form, setForm] = useState({
    vendor_name: '',
    company_name: '',
    contact_person: '',
    mobile_number: '',
    email: '',
    business_address: '',
    cuisine_type: 'Multi-cuisine',
    site_id: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const { data } = await axios.get(`${API}/sites`, { withCredentials: true });
        setSites(data);
        if (user?.role === 'site_admin' && user.site_id) {
          setForm((f) => ({ ...f, site_id: user.site_id }));
        } else if (data.length === 1) {
          setForm((f) => ({ ...f, site_id: data[0].id }));
        }
      } catch (e) { console.error(e); }
    })();
  }, [user]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const { data } = await axios.post(`${API}/onboarding/vendors`, form, { withCredentials: true });
      navigate(`/onboarding/${data.id}`);
    } catch (e) {
      setError(e?.response?.data?.detail || 'Failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-background">
        <div className="max-w-3xl mx-auto px-6 py-8">
          <button onClick={() => navigate('/onboarding')} className="flex items-center gap-2 text-text-secondary hover:text-text-primary mb-4 text-sm">
            <ArrowLeft className="h-4 w-4" /> Back to list
          </button>
          <div className="flex items-center gap-3 mb-8">
            <div className="bg-primary-light rounded-xl p-3">
              <Store className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="font-heading text-3xl sm:text-4xl tracking-tighter font-semibold text-text-primary">New Vendor Onboarding</h1>
              <p className="text-text-secondary text-sm mt-1">Step 1 of 3 — Enter basic vendor information. Documents & checklist come next.</p>
            </div>
          </div>

          <form onSubmit={submit} className="bg-card border border-border-light rounded-2xl p-6 space-y-5">
            {error && <p className="text-red-600 text-sm bg-red-50 p-3 rounded-lg">{error}</p>}

            <h2 className="font-heading text-lg font-medium text-text-primary border-b border-border-light pb-2">Basic Information</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Vendor Name *" value={form.vendor_name} onChange={(v) => setForm({ ...form, vendor_name: v })} required testID="vendor-name" placeholder="e.g. Spice Kitchen" />
              <Field label="Company Name *" value={form.company_name} onChange={(v) => setForm({ ...form, company_name: v })} required testID="company-name" placeholder="e.g. Spice Kitchen Pvt Ltd" />
              <Field label="Contact Person *" value={form.contact_person} onChange={(v) => setForm({ ...form, contact_person: v })} required testID="contact-person" placeholder="Full name" />
              <Field label="Mobile Number *" value={form.mobile_number} onChange={(v) => setForm({ ...form, mobile_number: v })} required testID="mobile-number" placeholder="+91-9876543210" />
              <Field label="Email *" value={form.email} onChange={(v) => setForm({ ...form, email: v })} type="email" required testID="email" placeholder="contact@vendor.com" />
              <Field label="Cuisine Type" value={form.cuisine_type} onChange={(v) => setForm({ ...form, cuisine_type: v })} testID="cuisine" placeholder="e.g. North Indian" />
            </div>

            <Field label="Business Address *" value={form.business_address} onChange={(v) => setForm({ ...form, business_address: v })} required testID="address" placeholder="Full business address" multiline />

            <div>
              <label className="text-sm font-medium text-text-primary">Site *</label>
              <select
                data-testid="site-select"
                value={form.site_id}
                onChange={(e) => setForm({ ...form, site_id: e.target.value })}
                required
                disabled={user?.role === 'site_admin'}
                className="mt-1 w-full px-3 py-2 border border-border-light rounded-lg disabled:bg-background"
              >
                <option value="">-- choose site --</option>
                {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <p className="text-xs text-text-muted mt-1">The site this vendor will serve.</p>
            </div>

            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => navigate('/onboarding')} className="px-5 py-2.5 border border-border-light rounded-xl font-medium">Cancel</button>
              <button data-testid="submit-onboarding-btn" type="submit" disabled={submitting} className="flex-1 flex items-center justify-center gap-2 bg-primary text-white px-5 py-2.5 rounded-xl font-medium hover:bg-primary-hover disabled:opacity-50">
                <Save className="h-4 w-4" /> {submitting ? 'Creating...' : 'Save & Continue to Documents'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
};

const Field = ({ label, value, onChange, type = 'text', required, testID, placeholder, multiline }) => (
  <div>
    <label className="text-sm font-medium text-text-primary">{label}</label>
    {multiline ? (
      <textarea data-testid={testID} value={value} onChange={(e) => onChange(e.target.value)} required={required} placeholder={placeholder} rows={2} className="mt-1 w-full px-3 py-2 border border-border-light rounded-lg" />
    ) : (
      <input data-testid={testID} type={type} value={value} onChange={(e) => onChange(e.target.value)} required={required} placeholder={placeholder} className="mt-1 w-full px-3 py-2 border border-border-light rounded-lg" />
    )}
  </div>
);

export default OnboardingNew;
