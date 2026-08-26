import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import Navbar from '../../components/Navbar';
import { Download, FileText, Filter, IndianRupee, ShoppingBag, TrendingUp, Clock, CheckCircle2, XCircle } from 'lucide-react';
import logger from '../../lib/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const fmt = (n) => `₹${(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const dtLocal = (iso) => iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

const rangePresets = [
  { label: 'Today',       days: 0 },
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days',days: 30 },
  { label: 'Last 90 days',days: 90 },
];

const isoStart = (d) => { const x=new Date(d); x.setHours(0,0,0,0); return x.toISOString(); };
const isoEnd   = (d) => { const x=new Date(d); x.setHours(23,59,59,999); return x.toISOString(); };

export default function VendorReports() {
  const today = new Date();
  const [fromDate, setFromDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0,10); });
  const [toDate, setToDate]     = useState(() => today.toISOString().slice(0,10));
  const [counter, setCounter]   = useState('');
  const [paymentStatus, setPaymentStatus] = useState('all');
  const [counters, setCounters] = useState([]);
  const [summary, setSummary]   = useState(null);
  const [perCounter, setPerCounter] = useState([]);
  const [orders, setOrders]     = useState([]);
  const [total, setTotal]       = useState(0);
  const [page, setPage]         = useState(1);
  const [size]                  = useState(50);
  const [loading, setLoading]   = useState(false);
  const [downloading, setDownloading] = useState('');

  const params = useCallback(() => {
    const q = new URLSearchParams();
    q.set('from', isoStart(fromDate));
    q.set('to',   isoEnd(toDate));
    if (counter)       q.set('counter', counter);
    if (paymentStatus && paymentStatus !== 'all') q.set('payment_status', paymentStatus);
    return q;
  }, [fromDate, toDate, counter, paymentStatus]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [c, s, o] = await Promise.all([
        axios.get(`${API}/vendor/counters`, { withCredentials: true }),
        axios.get(`${API}/vendor/reports/sales-summary?${params().toString()}`, { withCredentials: true }),
        axios.get(`${API}/vendor/reports/sales-orders?${params().toString()}&page=${page}&size=${size}`, { withCredentials: true }),
      ]);
      setCounters(c.data || []);
      setSummary(s.data.summary);
      setPerCounter(s.data.per_counter || []);
      setOrders(o.data.rows || []);
      setTotal(o.data.total || 0);
    } catch (e) {
      logger.warn('reports fetch failed', e);
    } finally {
      setLoading(false);
    }
  }, [params, page, size]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const applyPreset = (days) => {
    const to = new Date(); const from = new Date();
    if (days > 0) from.setDate(from.getDate() - days + 1);
    setFromDate(from.toISOString().slice(0, 10));
    setToDate(to.toISOString().slice(0, 10));
    setPage(1);
  };

  const download = async (format, forCounter = null) => {
    const key = `${format}-${forCounter || 'all'}`;
    setDownloading(key);
    try {
      const q = params();
      if (forCounter) q.set('counter', forCounter);
      q.set('format', format);
      const res = await axios.get(`${API}/vendor/reports/sales-export?${q.toString()}`, {
        withCredentials: true, responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      const ext = format === 'pdf' ? 'pdf' : 'csv';
      a.href = url;
      a.download = `cravitoo_sales_${fromDate}_${toDate}${forCounter ? '_' + forCounter.replace(/ /g,'_') : ''}.${ext}`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(e?.response?.data?.detail || 'Download failed');
    } finally {
      setDownloading('');
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / size));

  const cards = summary ? [
    { label: 'Total Orders',   value: summary.total_orders, icon: ShoppingBag,  color: 'text-indigo-700 bg-indigo-50 ring-indigo-200' },
    { label: 'Total Sales',    value: fmt(summary.total_amount),   icon: IndianRupee, color: 'text-primary bg-primary-light ring-primary/30' },
    { label: 'Paid',           value: fmt(summary.paid_amount),    icon: CheckCircle2, color: 'text-emerald-700 bg-emerald-50 ring-emerald-200' },
    { label: 'Pending',        value: fmt(summary.pending_amount), icon: Clock,        color: 'text-amber-700 bg-amber-50 ring-amber-200' },
    { label: 'Cancelled',      value: fmt(summary.cancelled_amount), icon: XCircle,    color: 'text-red-700 bg-red-50 ring-red-200' },
    { label: 'Avg order',      value: fmt(summary.avg_order_value),  icon: TrendingUp, color: 'text-slate-700 bg-slate-50 ring-slate-200' },
  ] : [];

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8" data-testid="vendor-reports-page">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="font-heading text-4xl font-semibold text-text-primary flex items-center gap-2">
              <FileText className="h-8 w-8 text-primary" /> Sales Report
            </h1>
            <p className="text-sm text-text-muted mt-1">Track sales across all your counters — download combined or per-counter reports.</p>
          </div>
          <div className="flex gap-2">
            <button
              data-testid="download-csv-all"
              onClick={() => download('csv')}
              disabled={!!downloading}
              className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              <Download className="h-4 w-4" /> {downloading === 'csv-all' ? 'Downloading…' : 'Download CSV'}
            </button>
            <button
              data-testid="download-pdf-all"
              onClick={() => download('pdf')}
              disabled={!!downloading}
              className="flex items-center gap-2 bg-primary hover:bg-primary-hover text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              <Download className="h-4 w-4" /> {downloading === 'pdf-all' ? 'Downloading…' : 'Download PDF'}
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-card border border-border-light rounded-2xl p-4 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Filter className="h-4 w-4 text-text-muted" />
            <span className="text-xs uppercase tracking-wider font-semibold text-text-muted">Filters</span>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-[11px] font-medium text-text-secondary mb-1">From</label>
              <input data-testid="filter-from" type="date" value={fromDate} onChange={(e) => { setFromDate(e.target.value); setPage(1); }}
                className="px-3 py-2 border border-border-light rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-text-secondary mb-1">To</label>
              <input data-testid="filter-to" type="date" value={toDate} onChange={(e) => { setToDate(e.target.value); setPage(1); }}
                className="px-3 py-2 border border-border-light rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
            </div>
            <div className="flex gap-1">
              {rangePresets.map(p => (
                <button key={p.label} data-testid={`preset-${p.days}`} onClick={() => applyPreset(p.days)}
                  className="text-xs px-2.5 py-1.5 bg-background border border-border-light rounded-lg hover:bg-primary-light hover:border-primary transition-colors">
                  {p.label}
                </button>
              ))}
            </div>
            {counters.length > 0 && (
              <div>
                <label className="block text-[11px] font-medium text-text-secondary mb-1">Counter</label>
                <select data-testid="filter-counter" value={counter} onChange={(e) => { setCounter(e.target.value); setPage(1); }}
                  className="px-3 py-2 border border-border-light rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 bg-white">
                  <option value="">All counters</option>
                  {counters.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="block text-[11px] font-medium text-text-secondary mb-1">Payment</label>
              <select data-testid="filter-payment" value={paymentStatus} onChange={(e) => { setPaymentStatus(e.target.value); setPage(1); }}
                className="px-3 py-2 border border-border-light rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 bg-white">
                <option value="all">All</option>
                <option value="paid">Paid</option>
                <option value="pending">Pending</option>
                <option value="failed">Failed</option>
              </select>
            </div>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
          {cards.map(c => (
            <div key={c.label} data-testid={`kpi-${c.label.toLowerCase().replace(/ /g, '-')}`}
              className={`rounded-xl p-4 ring-1 ${c.color.split(' ').filter(x => x.includes('ring')).join(' ')} bg-card`}>
              <div className="flex items-center gap-2 mb-2">
                <div className={`p-1.5 rounded-lg ${c.color.split(' ').filter(x => x.includes('bg')).join(' ')}`}>
                  <c.icon className={`h-4 w-4 ${c.color.split(' ').filter(x => x.startsWith('text')).join(' ')}`} />
                </div>
                <p className="text-[10px] uppercase font-semibold tracking-wider text-text-muted">{c.label}</p>
              </div>
              <p className="font-heading text-xl font-semibold text-text-primary">{c.value}</p>
            </div>
          ))}
        </div>

        {/* Per-counter breakdown */}
        {perCounter.length > 1 && (
          <div className="bg-card border border-border-light rounded-2xl p-5 mb-6" data-testid="per-counter-card">
            <h2 className="font-heading text-lg font-semibold text-text-primary mb-3">Per-counter breakdown</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wider text-text-muted border-b border-border-light">
                    <th className="text-left py-2">Counter</th>
                    <th className="text-right">Orders</th>
                    <th className="text-right">Total</th>
                    <th className="text-right">Paid</th>
                    <th className="text-right">Pending</th>
                    <th className="text-right">Download</th>
                  </tr>
                </thead>
                <tbody>
                  {perCounter.map(pc => (
                    <tr key={pc.counter} data-testid={`counter-row-${pc.counter}`} className="border-b border-border-light/50">
                      <td className="py-3 font-medium text-text-primary">{pc.counter}</td>
                      <td className="text-right">{pc.orders}</td>
                      <td className="text-right font-semibold">{fmt(pc.total_amount)}</td>
                      <td className="text-right text-emerald-700">{fmt(pc.paid_amount)}</td>
                      <td className="text-right text-amber-700">{fmt(pc.pending_amount)}</td>
                      <td className="text-right">
                        <div className="inline-flex gap-1">
                          {pc.counter !== '—' && (
                            <>
                              <button onClick={() => download('csv', pc.counter)} disabled={!!downloading}
                                data-testid={`download-csv-${pc.counter}`}
                                className="text-xs px-2 py-1 bg-background hover:bg-primary-light border border-border-light rounded">CSV</button>
                              <button onClick={() => download('pdf', pc.counter)} disabled={!!downloading}
                                data-testid={`download-pdf-${pc.counter}`}
                                className="text-xs px-2 py-1 bg-background hover:bg-primary-light border border-border-light rounded">PDF</button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Orders table */}
        <div className="bg-card border border-border-light rounded-2xl overflow-hidden">
          <div className="p-5 border-b border-border-light flex items-center justify-between">
            <h2 className="font-heading text-lg font-semibold text-text-primary">Order details</h2>
            <span className="text-xs text-text-muted">{total} order{total === 1 ? '' : 's'} in this range</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-background">
                <tr className="text-[11px] uppercase tracking-wider text-text-muted">
                  <th className="text-left px-4 py-2.5">Date / Time</th>
                  <th className="text-left">Order ID</th>
                  <th className="text-left">Counter</th>
                  <th className="text-left">Items</th>
                  <th className="text-right">Qty</th>
                  <th className="text-right">Amount</th>
                  <th className="text-left">Payment</th>
                  <th className="text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={8} className="text-center py-8 text-text-muted">Loading…</td></tr>}
                {!loading && orders.length === 0 && <tr><td colSpan={8} className="text-center py-8 text-text-muted">No orders in this range.</td></tr>}
                {!loading && orders.map(o => (
                  <tr key={o.id} data-testid={`order-row-${o.collection_code || o.id}`} className="border-t border-border-light/50 hover:bg-background/40">
                    <td className="px-4 py-2.5 text-text-secondary">{dtLocal(o.created_at)}</td>
                    <td className="font-mono text-xs">{o.collection_code || o.id.slice(-8)}</td>
                    <td className="text-text-secondary">{o.counter}</td>
                    <td className="text-text-secondary max-w-xs truncate">{(o.items || []).map(i => `${i.name} ×${i.quantity}`).join(', ')}</td>
                    <td className="text-right">{o.quantity}</td>
                    <td className="text-right font-semibold">{fmt(o.amount)}</td>
                    <td>
                      <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-medium ${
                        o.payment_status === 'paid' ? 'bg-emerald-100 text-emerald-800' :
                        o.payment_status === 'pending' ? 'bg-amber-100 text-amber-800' :
                        'bg-red-100 text-red-800'
                      }`}>{o.payment_status || '—'}</span>
                    </td>
                    <td className="text-xs text-text-secondary">{o.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-border-light text-xs text-text-muted">
              <span>Page {page} of {totalPages}</span>
              <div className="flex gap-1">
                <button data-testid="page-prev" disabled={page <= 1} onClick={() => setPage(page - 1)}
                  className="px-2.5 py-1 rounded border border-border-light hover:bg-background disabled:opacity-40">Prev</button>
                <button data-testid="page-next" disabled={page >= totalPages} onClick={() => setPage(page + 1)}
                  className="px-2.5 py-1 rounded border border-border-light hover:bg-background disabled:opacity-40">Next</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
