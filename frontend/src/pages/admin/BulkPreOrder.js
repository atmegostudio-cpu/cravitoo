import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import Navbar from '../../components/Navbar';
import { ClipboardList, AlertCircle, CheckCircle2, Clock, Store, Send } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const MEAL_PERIODS = [
  { key: 'breakfast', label: 'Breakfast', emoji: '🌅' },
  { key: 'lunch', label: 'Lunch', emoji: '🍽️' },
  { key: 'snacks', label: 'Evening Snacks', emoji: '☕' },
  { key: 'dinner', label: 'Dinner', emoji: '🌙' },
];

const MEAL_TYPES = [
  { key: 'veg_meal', label: 'Veg Meal', emoji: '🟢' },
  { key: 'non_veg_meal', label: 'Non-Veg Meal', emoji: '🔴' },
  { key: 'veg_salad', label: 'Veg Salad', emoji: '🥗' },
  { key: 'non_veg_salad', label: 'Non-Veg Salad', emoji: '🥗' },
];

const CountdownPill = ({ to, label }) => {
  const [text, setText] = useState('');
  useEffect(() => {
    const tick = () => {
      const ms = new Date(to).getTime() - Date.now();
      if (ms <= 0) { setText(''); return; }
      const m = Math.floor(ms / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      setText(`${m}m ${s.toString().padStart(2, '0')}s`);
    };
    tick();
    const i = setInterval(tick, 1000);
    return () => clearInterval(i);
  }, [to]);
  if (!text) return null;
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-50 text-amber-800 rounded-full text-xs font-medium border border-amber-200">
      <Clock className="h-3 w-3" /> {label}: {text}
    </span>
  );
};

const CorporateBulkPreOrder = () => {
  const [windowStatus, setWindowStatus] = useState(null);
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [siteId, setSiteId] = useState('');
  const [vendors, setVendors] = useState([]);
  const [vendorId, setVendorId] = useState('');
  const [mealPeriod, setMealPeriod] = useState('lunch');
  const [counts, setCounts] = useState({ veg_meal: 0, non_veg_meal: 0, veg_salad: 0, non_veg_salad: 0 });
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadWindow = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/reservations/bulk-window`, { withCredentials: true });
      setWindowStatus(data);
    } catch (e) {
      setError(e?.response?.data?.detail || 'Could not load window status');
    }
  }, []);

  const loadSites = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/sites`, { withCredentials: true });
      setSites(data || []);
      if (data?.length) setSiteId((cur) => cur || data[0].id);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadWindow(); loadSites(); }, [loadWindow, loadSites]);
  useEffect(() => {
    const t = setInterval(loadWindow, 30000); // refresh window status every 30s
    return () => clearInterval(t);
  }, [loadWindow]);

  useEffect(() => {
    if (!siteId) { setVendors([]); setVendorId(''); return; }
    (async () => {
      try {
        const { data } = await axios.get(`${API}/sites/${siteId}/vendors`, { withCredentials: true });
        setVendors(data || []);
        if (data?.length) setVendorId(data[0].id || data[0].vendor_id);
      } catch (e) {
        setVendors([]);
      }
    })();
  }, [siteId]);

  const total = Object.values(counts).reduce((a, b) => a + (parseInt(b, 10) || 0), 0);

  const submit = async () => {
    setError(''); setMessage('');
    if (!siteId || !vendorId) { setError('Pick site & vendor'); return; }
    if (total === 0) { setError('Add at least one meal count'); return; }
    setSubmitting(true);
    try {
      const cleanCounts = {};
      Object.entries(counts).forEach(([k, v]) => {
        const n = parseInt(v, 10) || 0;
        if (n > 0) cleanCounts[k] = n;
      });
      const { data } = await axios.post(
        `${API}/reservations/bulk`,
        {
          site_id: siteId,
          vendor_id: vendorId,
          meal_period: mealPeriod,
          counts: cleanCounts,
          note: note.trim() || null,
        },
        { withCredentials: true },
      );
      setMessage(`✅ Reserved ${data.total_reservations_created} meals for ${data.delivery_date} with ${data.vendor_name}`);
      setCounts({ veg_meal: 0, non_veg_meal: 0, veg_salad: 0, non_veg_salad: 0 });
      setNote('');
    } catch (e) {
      setError(e?.response?.data?.detail || 'Bulk pre-order failed');
    } finally {
      setSubmitting(false);
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

  const isOpen = !!windowStatus?.is_open;

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-background">
        <div className="max-w-3xl mx-auto px-6 py-8">
          <div className="mb-6">
            <h1 className="font-heading text-4xl sm:text-5xl tracking-tighter font-semibold text-text-primary">Bulk Pre-Order</h1>
            <p className="text-text-secondary mt-2">
              Place last-minute anonymous pre-orders for your team. Window: <strong>8:00 PM – 8:45 PM IST</strong>.
            </p>
          </div>

          <div className={`rounded-2xl p-5 mb-6 border ${isOpen ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200'}`} data-testid="bulk-window-status">
            <div className="flex items-center gap-3 flex-wrap">
              {isOpen ? (
                <>
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  <strong className="text-emerald-900">Window is OPEN</strong>
                  <CountdownPill to={windowStatus?.window_end_ist} label="closes in" />
                </>
              ) : (
                <>
                  <AlertCircle className="h-5 w-5 text-slate-500" />
                  <strong className="text-slate-700">Window is CLOSED</strong>
                  <span className="text-xs text-slate-600">Opens at 8:00 PM IST every day</span>
                </>
              )}
            </div>
          </div>

          {message && (
            <div data-testid="bulk-success" className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">{message}</div>
          )}
          {error && (
            <div data-testid="bulk-error" className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
          )}

          <div className="bg-card border border-border-light rounded-2xl p-6 space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-text-muted mb-1 block">Site</label>
                <select
                  data-testid="bulk-site-select"
                  value={siteId}
                  onChange={(e) => setSiteId(e.target.value)}
                  className="w-full px-3 py-2 border border-border-light rounded-lg bg-background text-sm focus:outline-none focus:border-primary"
                  disabled={!isOpen}
                >
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-text-muted mb-1 block">Vendor</label>
                <select
                  data-testid="bulk-vendor-select"
                  value={vendorId}
                  onChange={(e) => setVendorId(e.target.value)}
                  className="w-full px-3 py-2 border border-border-light rounded-lg bg-background text-sm focus:outline-none focus:border-primary"
                  disabled={!isOpen || vendors.length === 0}
                >
                  {vendors.length === 0 && <option value="">No vendors mapped</option>}
                  {vendors.map((v) => (
                    <option key={v.id || v.vendor_id} value={v.id || v.vendor_id}>{v.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs text-text-muted mb-2 block">Meal period</label>
              <div className="flex flex-wrap gap-2">
                {MEAL_PERIODS.map((mp) => {
                  const active = mealPeriod === mp.key;
                  return (
                    <button
                      key={mp.key}
                      type="button"
                      disabled={!isOpen}
                      onClick={() => setMealPeriod(mp.key)}
                      data-testid={`bulk-period-${mp.key}`}
                      className={`px-4 py-2 rounded-full text-sm font-medium border transition-colors ${
                        active ? 'bg-primary text-white border-primary' : 'bg-background text-text-secondary border-border-light hover:border-primary'
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      {mp.emoji} {mp.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="text-xs text-text-muted mb-2 block">Quantities per meal type</label>
              <div className="grid grid-cols-2 gap-3">
                {MEAL_TYPES.map((mt) => (
                  <div key={mt.key} className="flex items-center justify-between bg-background border border-border-light rounded-xl p-3">
                    <span className="text-sm text-text-primary font-medium">{mt.emoji} {mt.label}</span>
                    <input
                      type="number"
                      min="0"
                      max="500"
                      value={counts[mt.key]}
                      data-testid={`bulk-count-${mt.key}`}
                      disabled={!isOpen}
                      onChange={(e) => setCounts({ ...counts, [mt.key]: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                      className="w-20 px-2 py-1 border border-border-light rounded-lg text-right font-mono focus:outline-none focus:border-primary disabled:bg-slate-100"
                    />
                  </div>
                ))}
              </div>
              <div className="mt-3 flex justify-between items-center text-sm">
                <span className="text-text-muted">Total meals</span>
                <span data-testid="bulk-total-count" className="font-mono text-text-primary font-semibold">{total}</span>
              </div>
            </div>

            <div>
              <label className="text-xs text-text-muted mb-1 block">Internal note (optional)</label>
              <input
                data-testid="bulk-note-input"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Town hall - Aug 15"
                disabled={!isOpen}
                className="w-full px-3 py-2 border border-border-light rounded-lg bg-background text-sm focus:outline-none focus:border-primary disabled:bg-slate-100"
              />
            </div>

            <button
              data-testid="bulk-submit-btn"
              type="button"
              onClick={submit}
              disabled={!isOpen || submitting || total === 0 || !siteId || !vendorId}
              className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-primary text-white rounded-xl font-medium hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Send className="h-4 w-4" />
              {submitting ? 'Placing…' : `Place ${total} meal${total !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default CorporateBulkPreOrder;
