import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import Navbar from '../../components/Navbar';
import { Download, IndianRupee, ShoppingBag, TrendingUp, Store, Layers, Loader2 } from 'lucide-react';
import logger from '../../lib/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const inr = (n) => `₹${(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const cap = (s) => (s ? String(s).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '—');
const STATUS_CHIP = {
  paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  failed: 'bg-red-50 text-red-700 border-red-200',
  cancelled: 'bg-gray-50 text-gray-600 border-gray-200',
};
const currentMonth = () => new Date().toISOString().slice(0, 7);
const todayISO = () => new Date().toISOString().slice(0, 10);

const AllOutletsReport = () => {
  const [mode, setMode] = useState('month'); // 'month' | 'range' | 'single'
  const [month, setMonth] = useState(currentMonth());
  const [singleDate, setSingleDate] = useState(todayISO());
  const [fromDate, setFromDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); });
  const [toDate, setToDate] = useState(todayISO());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');

  const query = useCallback(() => {
    const q = new URLSearchParams();
    if (mode === 'month') q.set('month', month);
    else if (mode === 'single') { q.set('from', new Date(singleDate + 'T00:00:00').toISOString()); q.set('to', new Date(singleDate + 'T23:59:59').toISOString()); }
    else { q.set('from', new Date(fromDate + 'T00:00:00').toISOString()); q.set('to', new Date(toDate + 'T23:59:59').toISOString()); }
    return q;
  }, [mode, month, fromDate, toDate, singleDate]);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await axios.get(`${API}/vendor/all-outlets-report?${query().toString()}`, { withCredentials: true });
      setData(res.data);
    } catch (e) {
      logger.error(e);
      setError(e?.response?.data?.detail || 'Failed to load report');
    } finally { setLoading(false); }
  }, [query]);

  useEffect(() => { load(); }, [load]);

  const download = async () => {
    setDownloading(true);
    try {
      const res = await axios.get(`${API}/vendor/all-outlets-report/export?${query().toString()}`, { withCredentials: true, responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `cravitoo_all_outlets_sales_${mode === 'month' ? month : mode === 'single' ? singleDate : `${fromDate}_${toDate}`}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      alert(e?.response?.data?.detail || 'Download failed');
    } finally { setDownloading(false); }
  };

  const summary = data?.summary || {};
  const cards = [
    { label: 'Total Sales', value: inr(summary.total_amount), icon: IndianRupee, color: 'text-primary bg-primary-light' },
    { label: 'Total Orders', value: summary.total_orders || 0, icon: ShoppingBag, color: 'text-indigo-700 bg-indigo-50' },
    { label: 'Paid', value: inr(summary.paid_amount), icon: TrendingUp, color: 'text-emerald-700 bg-emerald-50' },
    { label: 'Avg Order', value: inr(summary.avg_order_value), icon: Layers, color: 'text-amber-700 bg-amber-50' },
  ];

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8" data-testid="all-outlets-report-page">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div>
              <h1 className="font-heading text-3xl sm:text-4xl tracking-tight font-semibold text-text-primary flex items-center gap-2">
                <Store className="h-7 w-7 text-primary" /> Total Sales
              </h1>
              <p className="text-xs sm:text-sm text-text-muted mt-1">Combined sales across all your outlets — with vendor-wise and counter-wise breakdowns.</p>
            </div>
            <button
              data-testid="download-xlsx-btn"
              onClick={download}
              disabled={downloading || loading}
              className="flex items-center justify-center gap-2 bg-primary text-white px-5 py-2.5 rounded-xl font-medium hover:bg-primary-hover disabled:opacity-50"
            >
              {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Excel
            </button>
          </div>

          {/* Filters */}
          <div className="bg-card border border-border-light rounded-2xl p-4 mb-6 flex flex-wrap items-end gap-3" data-testid="report-filters">
            <div>
              <label className="text-xs font-medium text-text-muted block mb-1">Filter by</label>
              <select data-testid="report-mode" value={mode} onChange={(e) => setMode(e.target.value)} className="px-3 py-2 border border-border-light rounded-lg bg-white text-sm">
                <option value="month">Month</option>
                <option value="range">Date range</option>
                <option value="single">Single date</option>
              </select>
            </div>
            {mode === 'month' && (
              <div>
                <label className="text-xs font-medium text-text-muted block mb-1">Month</label>
                <input data-testid="report-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="px-3 py-2 border border-border-light rounded-lg text-sm" />
              </div>
            )}
            {mode === 'single' && (
              <div>
                <label className="text-xs font-medium text-text-muted block mb-1">Date</label>
                <input data-testid="report-single" type="date" value={singleDate} onChange={(e) => setSingleDate(e.target.value)} className="px-3 py-2 border border-border-light rounded-lg text-sm" />
              </div>
            )}
            {mode === 'range' && (
              <>
                <div>
                  <label className="text-xs font-medium text-text-muted block mb-1">From</label>
                  <input data-testid="report-from" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="px-3 py-2 border border-border-light rounded-lg text-sm" />
                </div>
                <div>
                  <label className="text-xs font-medium text-text-muted block mb-1">To</label>
                  <input data-testid="report-to" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="px-3 py-2 border border-border-light rounded-lg text-sm" />
                </div>
              </>
            )}
          </div>

          {error && <p className="text-red-600 text-sm bg-red-50 p-3 rounded-lg mb-4">{error}</p>}

          {loading ? (
            <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
          ) : (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8" data-testid="report-summary">
                {cards.map((c) => (
                  <div key={c.label} className="bg-card border border-border-light rounded-2xl p-4">
                    <div className={`inline-flex p-2 rounded-lg mb-3 ${c.color}`}><c.icon className="h-5 w-5" /></div>
                    <p className="text-2xl font-semibold text-text-primary">{c.value}</p>
                    <p className="text-xs text-text-muted mt-1">{c.label}</p>
                  </div>
                ))}
              </div>

              {/* Vendor-wise */}
              <div className="bg-card border border-border-light rounded-2xl overflow-hidden mb-8">
                <div className="px-5 py-3 border-b border-border-light"><h2 className="font-heading text-lg font-semibold text-text-primary">By Outlet (Vendor-wise)</h2></div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid="per-vendor-table">
                    <thead className="bg-background text-text-muted text-xs uppercase">
                      <tr><th className="text-left px-5 py-2.5">Outlet</th><th className="text-right px-5 py-2.5">Orders</th><th className="text-right px-5 py-2.5">Total Sales</th><th className="text-right px-5 py-2.5">Paid</th></tr>
                    </thead>
                    <tbody className="divide-y divide-border-light/60">
                      {(data?.per_vendor || []).map((v) => (
                        <tr key={v.vendor_id} data-testid={`per-vendor-row-${v.vendor_id}`}>
                          <td className="px-5 py-2.5 font-medium text-text-primary">{v.outlet}</td>
                          <td className="px-5 py-2.5 text-right">{v.orders}</td>
                          <td className="px-5 py-2.5 text-right font-semibold">{inr(v.total_amount)}</td>
                          <td className="px-5 py-2.5 text-right text-emerald-700">{inr(v.paid_amount)}</td>
                        </tr>
                      ))}
                      {(data?.per_vendor || []).length === 0 && <tr><td colSpan={4} className="px-5 py-8 text-center text-text-muted">No sales in this period.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Counter-wise */}
              <div className="bg-card border border-border-light rounded-2xl overflow-hidden">
                <div className="px-5 py-3 border-b border-border-light"><h2 className="font-heading text-lg font-semibold text-text-primary">By Counter</h2></div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid="per-counter-table">
                    <thead className="bg-background text-text-muted text-xs uppercase">
                      <tr><th className="text-left px-5 py-2.5">Outlet</th><th className="text-left px-5 py-2.5">Counter</th><th className="text-right px-5 py-2.5">Orders</th><th className="text-right px-5 py-2.5">Total Sales</th></tr>
                    </thead>
                    <tbody className="divide-y divide-border-light/60">
                      {(data?.per_counter || []).map((c, i) => (
                        <tr key={`${c.vendor_id}-${c.counter}-${i}`} data-testid={`per-counter-row-${i}`}>
                          <td className="px-5 py-2.5 text-text-secondary">{c.outlet}</td>
                          <td className="px-5 py-2.5 font-medium text-text-primary">{c.counter}</td>
                          <td className="px-5 py-2.5 text-right">{c.orders}</td>
                          <td className="px-5 py-2.5 text-right font-semibold">{inr(c.total_amount)}</td>
                        </tr>
                      ))}
                      {(data?.per_counter || []).length === 0 && <tr><td colSpan={4} className="px-5 py-8 text-center text-text-muted">No counter data in this period.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Payment breakdown */}
              <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6" data-testid="payment-breakdown">
                <div className="bg-card border border-border-light rounded-2xl p-5">
                  <h2 className="font-heading text-lg font-semibold text-text-primary mb-3">Paid vs Pending</h2>
                  <div className="flex flex-wrap gap-2">
                    {(data?.per_payment_status || []).map((p) => (
                      <div key={p.status} data-testid={`pay-status-${p.status}`} className={`flex-1 min-w-[130px] rounded-xl border px-4 py-3 ${STATUS_CHIP[p.status] || 'bg-gray-50 text-gray-600 border-gray-200'}`}>
                        <p className="text-xs font-medium uppercase tracking-wide">{cap(p.status)}</p>
                        <p className="text-xl font-semibold mt-1">{inr(p.total_amount)}</p>
                        <p className="text-[11px] opacity-80">{p.orders} order{p.orders === 1 ? '' : 's'}</p>
                      </div>
                    ))}
                    {(data?.per_payment_status || []).length === 0 && <p className="text-text-muted text-sm">No data.</p>}
                  </div>
                </div>
                <div className="bg-card border border-border-light rounded-2xl overflow-hidden">
                  <div className="px-5 py-3 border-b border-border-light"><h2 className="font-heading text-lg font-semibold text-text-primary">By Payment Method</h2></div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm" data-testid="per-payment-table">
                      <thead className="bg-background text-text-muted text-xs uppercase">
                        <tr><th className="text-left px-5 py-2.5">Method</th><th className="text-right px-5 py-2.5">Orders</th><th className="text-right px-5 py-2.5">Total</th><th className="text-right px-5 py-2.5">Paid</th></tr>
                      </thead>
                      <tbody className="divide-y divide-border-light/60">
                        {(data?.per_payment_method || []).map((p, i) => (
                          <tr key={`${p.method}-${i}`} data-testid={`per-payment-row-${i}`}>
                            <td className="px-5 py-2.5 font-medium text-text-primary">{cap(p.method)}</td>
                            <td className="px-5 py-2.5 text-right">{p.orders}</td>
                            <td className="px-5 py-2.5 text-right font-semibold">{inr(p.total_amount)}</td>
                            <td className="px-5 py-2.5 text-right text-emerald-700">{inr(p.paid_amount)}</td>
                          </tr>
                        ))}
                        {(data?.per_payment_method || []).length === 0 && <tr><td colSpan={4} className="px-5 py-8 text-center text-text-muted">No payment data in this period.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
};

export default AllOutletsReport;
