import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import Navbar from '../../components/Navbar';
import { Download, FileText, IndianRupee, ShoppingBag, TrendingUp, Clock, CheckCircle2, XCircle } from 'lucide-react';
import logger from '../../lib/logger';
import { PageHeader } from '../../components/ui/page-header';
import { StatCard } from '../../components/ui/stat-card';
import { FilterBar, DateModeChips, DataTable, FilterField, filterInputClass } from '../../components/ui/report-kit';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const fmt = (n) => `₹${(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const dtLocal = (iso, tz) => iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: tz || 'Asia/Kolkata' }) : '—';

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
  const [mode, setMode]         = useState('range'); // 'single' | 'range' | 'month'
  const [singleDate, setSingleDate] = useState(() => today.toISOString().slice(0,10));
  const [month, setMonth]       = useState(() => today.toISOString().slice(0,7));
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
    if (mode === 'single') { q.set('from', isoStart(singleDate)); q.set('to', isoEnd(singleDate)); }
    else if (mode === 'month') { const [y, m] = month.split('-').map(Number); q.set('from', isoStart(new Date(y, m - 1, 1))); q.set('to', isoEnd(new Date(y, m, 0))); }
    else { q.set('from', isoStart(fromDate)); q.set('to', isoEnd(toDate)); }
    if (counter)       q.set('counter', counter);
    if (paymentStatus && paymentStatus !== 'all') q.set('payment_status', paymentStatus);
    return q;
  }, [mode, singleDate, month, fromDate, toDate, counter, paymentStatus]);

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
      const period = mode === 'single' ? singleDate : mode === 'month' ? month : `${fromDate}_${toDate}`;
      a.href = url;
      a.download = `cravitoo_sales_${period}${forCounter ? '_' + forCounter.replace(/ /g,'_') : ''}.${ext}`;
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
    { label: 'Total Orders',   value: summary.total_orders, icon: ShoppingBag,  tone: 'indigo' },
    { label: 'Total Sales',    value: fmt(summary.total_amount),   icon: IndianRupee, tone: 'primary' },
    { label: 'Paid',           value: fmt(summary.paid_amount),    icon: CheckCircle2, tone: 'green' },
    { label: 'Pending',        value: fmt(summary.pending_amount), icon: Clock,        tone: 'amber' },
    { label: 'Cancelled',      value: fmt(summary.cancelled_amount), icon: XCircle,    tone: 'red' },
    { label: 'Avg order',      value: fmt(summary.avg_order_value),  icon: TrendingUp, tone: 'slate' },
  ] : [];

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8" data-testid="vendor-reports-page">
        <PageHeader
          title="Sales Report"
          subtitle="Track sales across all your counters — download combined or per-counter reports."
          icon={FileText}
          actions={
            <div className="flex gap-2">
              <button
                data-testid="download-csv-all"
                onClick={() => download('csv')}
                disabled={!!downloading}
                className="flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2.5 rounded-xl text-sm font-medium disabled:opacity-50"
              >
                <Download className="h-4 w-4" /> {downloading === 'csv-all' ? 'Downloading…' : 'CSV'}
              </button>
              <button
                data-testid="download-pdf-all"
                onClick={() => download('pdf')}
                disabled={!!downloading}
                className="flex items-center justify-center gap-2 bg-primary hover:bg-primary-hover text-white px-4 py-2.5 rounded-xl text-sm font-medium disabled:opacity-50"
              >
                <Download className="h-4 w-4" /> {downloading === 'pdf-all' ? 'Downloading…' : 'PDF'}
              </button>
            </div>
          }
        />

        {/* Filters */}
        <FilterBar>
          <DateModeChips
            mode={mode}
            onChange={(k) => { setMode(k); setPage(1); }}
            testidPrefix="filter-mode"
            modes={[
              { k: 'single', label: 'Single date' },
              { k: 'range', label: 'Date range' },
              { k: 'month', label: 'Month' },
            ]}
          />
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap sm:items-end gap-3 mt-4">
            {mode === 'single' && (
              <FilterField label="Date">
                <input data-testid="filter-single" type="date" value={singleDate} onChange={(e) => { setSingleDate(e.target.value); setPage(1); }} className={filterInputClass} />
              </FilterField>
            )}
            {mode === 'month' && (
              <FilterField label="Month">
                <input data-testid="filter-month" type="month" value={month} onChange={(e) => { setMonth(e.target.value); setPage(1); }} className={filterInputClass} />
              </FilterField>
            )}
            {mode === 'range' && (
              <>
                <FilterField label="From">
                  <input data-testid="filter-from" type="date" value={fromDate} onChange={(e) => { setFromDate(e.target.value); setPage(1); }} className={filterInputClass} />
                </FilterField>
                <FilterField label="To">
                  <input data-testid="filter-to" type="date" value={toDate} onChange={(e) => { setToDate(e.target.value); setPage(1); }} className={filterInputClass} />
                </FilterField>
                <div className="col-span-2 flex flex-wrap gap-1 items-end">
                  {rangePresets.map(p => (
                    <button key={p.label} data-testid={`preset-${p.days}`} onClick={() => applyPreset(p.days)}
                      className="text-xs px-2.5 py-2 bg-background border border-border-light rounded-lg hover:bg-primary-light hover:border-primary transition-colors">
                      {p.label}
                    </button>
                  ))}
                </div>
              </>
            )}
            {counters.length > 0 && (
              <FilterField label="Counter">
                <select data-testid="filter-counter" value={counter} onChange={(e) => { setCounter(e.target.value); setPage(1); }} className={filterInputClass}>
                  <option value="">All counters</option>
                  {counters.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </FilterField>
            )}
            <FilterField label="Payment">
              <select data-testid="filter-payment" value={paymentStatus} onChange={(e) => { setPaymentStatus(e.target.value); setPage(1); }} className={filterInputClass}>
                <option value="all">All</option>
                <option value="paid">Paid</option>
                <option value="pending">Pending</option>
                <option value="failed">Failed</option>
              </select>
            </FilterField>
          </div>
        </FilterBar>

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-5 sm:mb-6">
          {cards.map(c => (
            <StatCard key={c.label} testid={`kpi-${c.label.toLowerCase().replace(/ /g, '-')}`} label={c.label} value={c.value} icon={c.icon} tone={c.tone} />
          ))}
        </div>

        {/* Per-counter breakdown */}
        {perCounter.length > 1 && (
          <div className="mb-5 sm:mb-6">
            <DataTable
              title="Per-counter breakdown"
              testid="per-counter-card"
              rows={perCounter}
              minWidthClass="min-w-[560px]"
              rowKey={(pc) => pc.counter}
              rowTestId={(pc) => `counter-row-${pc.counter}`}
              cols={[
                { key: 'counter', label: 'Counter', strong: true },
                { key: 'orders', label: 'Orders', align: 'right' },
                { key: 'total_amount', label: 'Total', align: 'right', render: (pc) => fmt(pc.total_amount) },
                { key: 'paid', label: 'Paid', align: 'right', render: (pc) => <span className="text-emerald-700">{fmt(pc.paid_amount)}</span> },
                { key: 'pending', label: 'Pending', align: 'right', render: (pc) => <span className="text-amber-700">{fmt(pc.pending_amount)}</span> },
                {
                  key: 'download', label: 'Download', render: (pc) => pc.counter !== '—' ? (
                    <div className="inline-flex gap-1">
                      <button onClick={() => download('csv', pc.counter)} disabled={!!downloading} data-testid={`download-csv-${pc.counter}`}
                        className="text-xs px-2 py-1 bg-background hover:bg-primary-light border border-border-light rounded">CSV</button>
                      <button onClick={() => download('pdf', pc.counter)} disabled={!!downloading} data-testid={`download-pdf-${pc.counter}`}
                        className="text-xs px-2 py-1 bg-background hover:bg-primary-light border border-border-light rounded">PDF</button>
                    </div>
                  ) : null,
                },
              ]}
            />
          </div>
        )}

        {/* Orders table */}
        <div className="bg-card border border-border-light rounded-2xl overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-border-light flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-heading text-base sm:text-lg font-semibold text-text-primary">Order details</h2>
            <span className="text-xs text-text-muted">{total} order{total === 1 ? '' : 's'} in this range</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
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
                    <td className="px-4 py-2.5 text-text-secondary">{dtLocal(o.created_at, o.site_timezone)}</td>
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
