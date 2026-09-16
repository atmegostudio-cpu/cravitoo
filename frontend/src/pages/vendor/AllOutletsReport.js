import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import Navbar from '../../components/Navbar';
import { Download, IndianRupee, ShoppingBag, TrendingUp, Store, Layers, Loader2 } from 'lucide-react';
import logger from '../../lib/logger';
import { PageHeader } from '../../components/ui/page-header';
import { StatCard } from '../../components/ui/stat-card';
import { FilterBar, DateModeChips, DataTable, filterInputClass } from '../../components/ui/report-kit';

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
    { label: 'Total Sales', value: inr(summary.total_amount), icon: IndianRupee, tone: 'primary' },
    { label: 'Total Orders', value: summary.total_orders || 0, icon: ShoppingBag, tone: 'indigo' },
    { label: 'Paid', value: inr(summary.paid_amount), icon: TrendingUp, tone: 'green' },
    { label: 'Avg Order', value: inr(summary.avg_order_value), icon: Layers, tone: 'amber' },
  ];

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8" data-testid="all-outlets-report-page">
          <PageHeader
            title="Total Sales"
            subtitle="Combined sales across all your outlets — with vendor-wise and counter-wise breakdowns."
            icon={Store}
            actions={
              <button
                data-testid="download-xlsx-btn"
                onClick={download}
                disabled={downloading || loading}
                className="flex items-center justify-center gap-2 bg-primary text-white px-5 py-2.5 rounded-xl font-medium hover:bg-primary-hover disabled:opacity-50"
              >
                {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Excel
              </button>
            }
          />

          {/* Filters */}
          <FilterBar testid="report-filters">
            <DateModeChips
              mode={mode}
              onChange={setMode}
              testidPrefix="report-mode"
              modes={[
                { k: 'month', label: 'Month' },
                { k: 'range', label: 'Date range' },
                { k: 'single', label: 'Single date' },
              ]}
            />
            <div className="flex flex-wrap items-end gap-3 mt-4">
              {mode === 'month' && (
                <div>
                  <label className="text-xs font-medium text-text-muted block mb-1">Month</label>
                  <input data-testid="report-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={filterInputClass} />
                </div>
              )}
              {mode === 'single' && (
                <div>
                  <label className="text-xs font-medium text-text-muted block mb-1">Date</label>
                  <input data-testid="report-single" type="date" value={singleDate} onChange={(e) => setSingleDate(e.target.value)} className={filterInputClass} />
                </div>
              )}
              {mode === 'range' && (
                <>
                  <div>
                    <label className="text-xs font-medium text-text-muted block mb-1">From</label>
                    <input data-testid="report-from" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className={filterInputClass} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-text-muted block mb-1">To</label>
                    <input data-testid="report-to" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className={filterInputClass} />
                  </div>
                </>
              )}
            </div>
          </FilterBar>

          {error && <p className="text-red-600 text-sm bg-red-50 p-3 rounded-lg mb-4">{error}</p>}

          {loading ? (
            <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
          ) : (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8" data-testid="report-summary">
                {cards.map((c) => (
                  <StatCard key={c.label} label={c.label} value={c.value} icon={c.icon} tone={c.tone} />
                ))}
              </div>

              {/* Vendor-wise */}
              <div className="mb-8">
                <DataTable
                  title="By Outlet (Vendor-wise)"
                  testid="per-vendor-table"
                  rows={data?.per_vendor || []}
                  emptyText="No sales in this period."
                  minWidthClass="min-w-[520px]"
                  rowKey={(v) => v.vendor_id}
                  rowTestId={(v) => `per-vendor-row-${v.vendor_id}`}
                  cols={[
                    { key: 'outlet', label: 'Outlet', strong: true },
                    { key: 'orders', label: 'Orders', align: 'right' },
                    { key: 'total_amount', label: 'Total Sales', align: 'right', render: (r) => inr(r.total_amount) },
                    { key: 'paid_amount', label: 'Paid', align: 'right', render: (r) => <span className="text-emerald-700">{inr(r.paid_amount)}</span> },
                  ]}
                />
              </div>

              {/* Counter-wise */}
              <DataTable
                title="By Counter"
                testid="per-counter-table"
                rows={data?.per_counter || []}
                emptyText="No counter data in this period."
                minWidthClass="min-w-[520px]"
                rowKey={(c, i) => `${c.vendor_id}-${c.counter}-${i}`}
                rowTestId={(c, i) => `per-counter-row-${i}`}
                cols={[
                  { key: 'outlet', label: 'Outlet' },
                  { key: 'counter', label: 'Counter', strong: true },
                  { key: 'orders', label: 'Orders', align: 'right' },
                  { key: 'total_amount', label: 'Total Sales', align: 'right', render: (r) => inr(r.total_amount) },
                ]}
              />

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
                <DataTable
                  title="By Payment Method"
                  testid="per-payment-table"
                  rows={data?.per_payment_method || []}
                  emptyText="No payment data in this period."
                  rowKey={(p, i) => `${p.method}-${i}`}
                  rowTestId={(p, i) => `per-payment-row-${i}`}
                  cols={[
                    { key: 'method', label: 'Method', strong: true, render: (r) => cap(r.method) },
                    { key: 'orders', label: 'Orders', align: 'right' },
                    { key: 'total_amount', label: 'Total', align: 'right', render: (r) => inr(r.total_amount) },
                    { key: 'paid_amount', label: 'Paid', align: 'right', render: (r) => <span className="text-emerald-700">{inr(r.paid_amount)}</span> },
                  ]}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
};

export default AllOutletsReport;
