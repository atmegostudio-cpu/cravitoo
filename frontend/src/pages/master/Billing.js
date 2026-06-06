import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import Navbar from '../../components/Navbar';
import { Receipt, Play, FileSpreadsheet, FileText, RotateCcw, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const currentYearMonth = () => {
  const now = new Date();
  // We want to bill the PREVIOUS month by default
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const yyyy = prev.getFullYear();
  const mm = String(prev.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
};

const Billing = () => {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(currentYearMonth());
  const [running, setRunning] = useState(false);
  const [filter, setFilter] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API}/billing/invoices`, { withCredentials: true });
      setInvoices(data || []);
    } catch (e) {
      setError(e?.response?.data?.detail || 'Failed to load invoices');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const runBilling = async () => {
    if (!/^\d{4}-\d{2}$/.test(month)) { alert('Month must be YYYY-MM'); return; }
    if (!window.confirm(`Generate invoices for ${month}? This will email each corporate client's billing contact.`)) return;
    setRunning(true); setMessage(''); setError('');
    try {
      const { data } = await axios.post(`${API}/billing/run`, { month }, { withCredentials: true });
      setMessage(`✅ Generated ${data.invoices_generated.length} invoice(s) for ${data.period}. Skipped: ${data.skipped_clients}.`);
      await load();
    } catch (e) {
      setError(e?.response?.data?.detail || 'Billing run failed');
    } finally { setRunning(false); }
  };

  const download = async (inv, format) => {
    try {
      const resp = await axios.get(`${API}/billing/invoices/${inv.id}/download?format=${format}`, { responseType: 'blob', withCredentials: true });
      const blob = new Blob([resp.data], { type: resp.headers['content-type'] || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cravitoo-invoice-${inv.client_name?.replace(/\s+/g, '-')}-${inv.period}.${format}`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch (e) {
      alert(e?.response?.data?.detail || 'Download failed');
    }
  };

  const resend = async (inv) => {
    if (!window.confirm(`Resend invoice for ${inv.client_name} (${inv.period}) to ${inv.billing_email}?`)) return;
    try {
      const { data } = await axios.post(`${API}/billing/invoices/${inv.id}/resend`, {}, { withCredentials: true });
      alert(data.ok ? 'Resent.' : `Failed: ${data.error}`);
      await load();
    } catch (e) {
      alert(e?.response?.data?.detail || 'Resend failed');
    }
  };

  const filtered = filter ? invoices.filter(i =>
    (i.client_name || '').toLowerCase().includes(filter.toLowerCase()) || i.period.includes(filter)
  ) : invoices;

  if (loading) {
    return (<><Navbar /><div className="min-h-screen bg-background flex items-center justify-center"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" /></div></>);
  }

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-background">
        <div className="max-w-6xl mx-auto px-6 py-8">
          <div className="mb-8">
            <h1 className="font-heading text-4xl sm:text-5xl tracking-tighter font-semibold text-text-primary">Billing & Invoices</h1>
            <p className="text-text-secondary mt-2 max-w-3xl">
              Auto-generated monthly invoices for active corporate clients. The cron runs at <strong>6 AM IST on the 1st of every month</strong>;
              use the form below to run a specific month manually.
            </p>
          </div>

          <div className="bg-card border border-border-light rounded-2xl p-5 mb-6 flex items-end gap-3 flex-wrap" data-testid="billing-run-panel">
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs text-text-muted mb-1 block">Run for month</label>
              <input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                data-testid="billing-month-input"
                className="w-full px-3 py-2 border border-border-light rounded-lg bg-background text-sm focus:outline-none focus:border-primary"
              />
            </div>
            <button
              data-testid="run-billing-btn"
              onClick={runBilling}
              disabled={running}
              className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-xl font-medium hover:bg-primary-hover disabled:opacity-50"
            >
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {running ? 'Generating…' : 'Generate invoices'}
            </button>
          </div>

          {message && <div data-testid="billing-success" className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">{message}</div>}
          {error && <div data-testid="billing-error" className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}

          <div className="mb-4">
            <input
              data-testid="invoice-filter-input"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by client name or period (YYYY-MM)…"
              className="w-full md:w-96 px-3 py-2 border border-border-light rounded-lg bg-background text-sm focus:outline-none focus:border-primary"
            />
          </div>

          {filtered.length === 0 ? (
            <div className="bg-card border border-border-light rounded-2xl p-12 text-center" data-testid="no-invoices">
              <Receipt className="h-12 w-12 text-text-muted mx-auto mb-4" />
              <p className="text-text-secondary mb-2">No invoices yet.</p>
              <p className="text-text-muted text-sm">Run billing for a past month to generate.</p>
            </div>
          ) : (
            <div className="bg-card border border-border-light rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-background text-xs text-text-muted uppercase tracking-wider">
                  <tr>
                    <th className="text-left px-5 py-3">Client</th>
                    <th className="text-left px-5 py-3">Period</th>
                    <th className="text-right px-5 py-3">Meals</th>
                    <th className="text-right px-5 py-3">Grand Total</th>
                    <th className="text-left px-5 py-3">Email</th>
                    <th className="text-right px-5 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-light">
                  {filtered.map((inv) => (
                    <tr key={inv.id} data-testid={`invoice-row-${inv.id}`} className="hover:bg-background/50">
                      <td className="px-5 py-3 font-medium text-text-primary">{inv.client_name}</td>
                      <td className="px-5 py-3 font-mono text-text-secondary">{inv.period}</td>
                      <td className="px-5 py-3 text-right font-mono">{inv.line_item_count}</td>
                      <td className="px-5 py-3 text-right font-mono font-semibold">₹ {inv.grand_total?.toFixed(2)}</td>
                      <td className="px-5 py-3 text-xs">
                        {inv.email_sent ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-3 w-3" /> Sent to {inv.billing_email}</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-amber-700"><AlertCircle className="h-3 w-3" /> {inv.email_error || 'Not sent'}</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button data-testid={`invoice-download-xlsx-${inv.id}`} aria-label={`Download ${inv.client_name} ${inv.period} Excel`} onClick={() => download(inv, 'xlsx')} title="Download Excel" className="p-1.5 rounded-lg hover:bg-background text-text-secondary hover:text-primary"><FileSpreadsheet className="h-4 w-4" /></button>
                          <button data-testid={`invoice-download-pdf-${inv.id}`} aria-label={`Download ${inv.client_name} ${inv.period} PDF`} onClick={() => download(inv, 'pdf')} title="Download PDF" className="p-1.5 rounded-lg hover:bg-background text-text-secondary hover:text-primary"><FileText className="h-4 w-4" /></button>
                          <button data-testid={`invoice-resend-email-${inv.id}`} aria-label={`Resend ${inv.client_name} ${inv.period} email`} onClick={() => resend(inv)} title="Resend email" className="p-1.5 rounded-lg hover:bg-background text-text-secondary hover:text-primary"><RotateCcw className="h-4 w-4" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default Billing;
