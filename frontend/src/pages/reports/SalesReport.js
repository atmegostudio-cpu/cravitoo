import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import Navbar from '../../components/Navbar';
import { BarChart3, FileSpreadsheet, Loader2, Store, Building2, TrendingUp, ShoppingBag } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const todayISO = () => new Date().toISOString().slice(0, 10);
const currentMonth = () => new Date().toISOString().slice(0, 7);

const SalesReport = () => {
  const [mode, setMode] = useState('range'); // 'range' | 'date' | 'month'
  const [date, setDate] = useState(todayISO());
  const [start, setStart] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [end, setEnd] = useState(todayISO());
  const [month, setMonth] = useState(currentMonth());

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');

  const buildParams = useCallback(() => {
    const p = new URLSearchParams();
    if (mode === 'date') p.set('date', date);
    else if (mode === 'month') p.set('month', month);
    else { p.set('start', start); p.set('end', end); }
    return p;
  }, [mode, date, month, start, end]);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params = buildParams();
      const { data } = await axios.get(`${API}/admin/sales-report?${params.toString()}`, { withCredentials: true });
      setData(data);
    } catch (e) {
      setError(e?.response?.data?.detail || 'Failed to load sales report');
      setData(null);
    } finally { setLoading(false); }
  }, [buildParams]);

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const downloadExcel = async () => {
    setDownloading(true);
    try {
      const params = buildParams();
      params.set('format', 'xlsx');
      const resp = await axios.get(`${API}/admin/sales-report?${params.toString()}`, { responseType: 'blob', withCredentials: true });
      const blob = new Blob([resp.data], { type: resp.headers['content-type'] || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cravitoo-sales-${todayISO()}.xlsx`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch (e) {
      setError(e?.response?.data?.detail || 'Download failed');
    } finally { setDownloading(false); }
  };

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-background">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <div className="mb-8">
            <h1 className="font-heading text-4xl sm:text-5xl tracking-tighter font-semibold text-text-primary flex items-center gap-3">
              <BarChart3 className="h-9 w-9 text-primary" /> Sales Report
            </h1>
            <p className="text-text-secondary mt-2 max-w-3xl">
              Total sales split by <strong>Site</strong> and <strong>Vendor</strong>, scoped to your role. Filter by a single day, a date range, or a month, then download the full breakdown as Excel.
            </p>
          </div>

          {/* Filters */}
          <div className="bg-card border border-border-light rounded-2xl p-5 mb-6" data-testid="sales-filter-panel">
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              {[
                { k: 'range', label: 'Date range' },
                { k: 'date', label: 'Single day' },
                { k: 'month', label: 'Month' },
              ].map((t) => (
                <button
                  key={t.k}
                  data-testid={`sales-mode-${t.k}`}
                  onClick={() => setMode(t.k)}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                    mode === t.k ? 'bg-primary text-white' : 'bg-background text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="flex items-end gap-3 flex-wrap">
              {mode === 'date' && (
                <div className="flex-1 min-w-[180px]">
                  <label className="text-xs text-text-muted mb-1 block">Date</label>
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="sales-date-input"
                    className="w-full px-3 py-2 border border-border-light rounded-lg bg-background text-sm focus:outline-none focus:border-primary" />
                </div>
              )}
              {mode === 'range' && (
                <>
                  <div className="flex-1 min-w-[160px]">
                    <label className="text-xs text-text-muted mb-1 block">From</label>
                    <input type="date" value={start} onChange={(e) => setStart(e.target.value)} data-testid="sales-start-input"
                      className="w-full px-3 py-2 border border-border-light rounded-lg bg-background text-sm focus:outline-none focus:border-primary" />
                  </div>
                  <div className="flex-1 min-w-[160px]">
                    <label className="text-xs text-text-muted mb-1 block">To</label>
                    <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} data-testid="sales-end-input"
                      className="w-full px-3 py-2 border border-border-light rounded-lg bg-background text-sm focus:outline-none focus:border-primary" />
                  </div>
                </>
              )}
              {mode === 'month' && (
                <div className="flex-1 min-w-[180px]">
                  <label className="text-xs text-text-muted mb-1 block">Month</label>
                  <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} data-testid="sales-month-input"
                    className="w-full px-3 py-2 border border-border-light rounded-lg bg-background text-sm focus:outline-none focus:border-primary" />
                </div>
              )}
              <button onClick={load} disabled={loading} data-testid="sales-apply-btn"
                className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-xl font-medium hover:bg-primary-hover disabled:opacity-50">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <TrendingUp className="h-4 w-4" />}
                {loading ? 'Loading…' : 'Apply'}
              </button>
              <button onClick={downloadExcel} disabled={downloading || !data} data-testid="sales-download-xlsx-btn"
                className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 disabled:opacity-50">
                {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
                Download Excel
              </button>
            </div>
          </div>

          {error && <div data-testid="sales-error" className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}

          {loading && !data ? (
            <div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" /></div>
          ) : data ? (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                <div className="bg-card border border-border-light rounded-2xl p-5" data-testid="sales-grand-total">
                  <div className="flex items-center gap-2 text-text-muted text-sm mb-1"><TrendingUp className="h-4 w-4" /> Total Sales</div>
                  <div className="text-3xl font-semibold text-text-primary">{inr(data.grand_total)}</div>
                </div>
                <div className="bg-card border border-border-light rounded-2xl p-5" data-testid="sales-order-count">
                  <div className="flex items-center gap-2 text-text-muted text-sm mb-1"><ShoppingBag className="h-4 w-4" /> Orders</div>
                  <div className="text-3xl font-semibold text-text-primary">{data.order_count}</div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* By Site */}
                <div className="bg-card border border-border-light rounded-2xl overflow-hidden" data-testid="sales-by-site">
                  <div className="px-5 py-4 border-b border-border-light flex items-center gap-2">
                    <Building2 className="h-5 w-5 text-primary" />
                    <h2 className="font-heading text-lg font-semibold text-text-primary">Sales by Site</h2>
                  </div>
                  {data.site_summary.length === 0 ? (
                    <div className="p-8 text-center text-text-muted text-sm">No sales in this period.</div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="bg-background text-xs text-text-muted uppercase tracking-wider">
                        <tr><th className="text-left px-5 py-3">Site</th><th className="text-right px-5 py-3">Total</th></tr>
                      </thead>
                      <tbody className="divide-y divide-border-light">
                        {data.site_summary.map((s, i) => (
                          <tr key={i} data-testid={`sales-site-row-${i}`} className="hover:bg-background/50">
                            <td className="px-5 py-3 font-medium text-text-primary">{s.site}</td>
                            <td className="px-5 py-3 text-right font-mono font-semibold">{inr(s.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* By Vendor */}
                <div className="bg-card border border-border-light rounded-2xl overflow-hidden" data-testid="sales-by-vendor">
                  <div className="px-5 py-4 border-b border-border-light flex items-center gap-2">
                    <Store className="h-5 w-5 text-primary" />
                    <h2 className="font-heading text-lg font-semibold text-text-primary">Sales by Vendor</h2>
                  </div>
                  {data.vendor_summary.length === 0 ? (
                    <div className="p-8 text-center text-text-muted text-sm">No sales in this period.</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm min-w-[420px]">
                        <thead className="bg-background text-xs text-text-muted uppercase tracking-wider">
                          <tr><th className="text-left px-5 py-3">Vendor</th><th className="text-left px-5 py-3">Site</th><th className="text-right px-5 py-3">Total</th></tr>
                        </thead>
                        <tbody className="divide-y divide-border-light">
                          {data.vendor_summary.map((v, i) => (
                            <tr key={i} data-testid={`sales-vendor-row-${i}`} className="hover:bg-background/50">
                              <td className="px-5 py-3 font-medium text-text-primary">{v.vendor}</td>
                              <td className="px-5 py-3 text-text-secondary">{v.site}</td>
                              <td className="px-5 py-3 text-right font-mono font-semibold">{inr(v.total)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </>
  );
};

export default SalesReport;
