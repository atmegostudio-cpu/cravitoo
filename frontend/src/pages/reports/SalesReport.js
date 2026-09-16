import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import Navbar from '../../components/Navbar';
import { BarChart3, FileSpreadsheet, Loader2, Store, Building2, TrendingUp, ShoppingBag, MapPin, Briefcase, Users, ChevronDown, X, Check, Wallet, Landmark, RotateCcw } from 'lucide-react';
import { PageHeader } from '../../components/ui/page-header';
import { StatCard } from '../../components/ui/stat-card';
import { FilterBar, DateModeChips, DataTable, filterInputClass } from '../../components/ui/report-kit';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const cap = (s) => (s ? String(s).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '—');
const PAY_CHIP = {
  paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  failed: 'bg-red-50 text-red-700 border-red-200',
  unpaid: 'bg-red-50 text-red-700 border-red-200',
  refunded: 'bg-slate-50 text-slate-600 border-slate-200',
};
const todayISO = () => new Date().toISOString().slice(0, 10);
const currentMonth = () => new Date().toISOString().slice(0, 7);

/* Lightweight checkbox multi-select dropdown */
const MultiSelect = ({ label, icon: Icon, options = [], selected = [], onChange, testid, disabled }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const toggle = (id) => {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

  const summary = selected.length === 0
    ? `All ${label.toLowerCase()}`
    : selected.length === 1
      ? (options.find((o) => o.id === selected[0])?.name || '1 selected')
      : `${selected.length} selected`;

  return (
    <div className="relative min-w-[190px] flex-1" ref={ref} data-testid={`${testid}-wrap`}>
      <label className="text-xs text-text-muted mb-1 block">{label}</label>
      <button
        type="button"
        disabled={disabled}
        data-testid={`${testid}-trigger`}
        onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2 border rounded-lg bg-background text-sm text-left transition-colors ${
          selected.length ? 'border-primary text-text-primary' : 'border-border-light text-text-secondary'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-primary'}`}
      >
        <span className="flex items-center gap-2 truncate">
          {Icon && <Icon className="h-4 w-4 shrink-0 text-primary" />}
          <span className="truncate">{summary}</span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && !disabled && (
        <div className="absolute z-30 mt-1 w-full max-h-64 overflow-auto bg-card border border-border-light rounded-xl shadow-lg py-1" data-testid={`${testid}-panel`}>
          {options.length === 0 ? (
            <div className="px-3 py-3 text-xs text-text-muted">No options</div>
          ) : (
            <>
              {selected.length > 0 && (
                <button
                  type="button"
                  data-testid={`${testid}-clear`}
                  onClick={() => onChange([])}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-muted hover:bg-background"
                >
                  <X className="h-3 w-3" /> Clear selection
                </button>
              )}
              {options.map((o) => {
                const on = selected.includes(o.id);
                return (
                  <button
                    type="button"
                    key={o.id}
                    data-testid={`${testid}-opt-${o.id}`}
                    onClick={() => toggle(o.id)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-background"
                  >
                    <span className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 ${on ? 'bg-primary border-primary' : 'border-border-light'}`}>
                      {on && <Check className="h-3 w-3 text-white" />}
                    </span>
                    <span className="truncate text-text-primary">{o.name}</span>
                  </button>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
};

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
  const [vendorGroup, setVendorGroup] = useState('site'); // 'site' | 'vendor'

  // filter option catalog + selections
  const [catalog, setCatalog] = useState({ clients: [], cities: [], sites: [], vendors: [], customer_types: [] });
  const [clientIds, setClientIds] = useState([]);
  const [cityIds, setCityIds] = useState([]);
  const [siteIds, setSiteIds] = useState([]);
  const [vendorIds, setVendorIds] = useState([]);
  const [customerTypeIds, setCustomerTypeIds] = useState([]);

  const [data, setData] = useState(null);
  const [settlement, setSettlement] = useState(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [settleDownloading, setSettleDownloading] = useState(false);
  const [error, setError] = useState('');

  // load filter catalog once
  useEffect(() => {
    (async () => {
      try {
        const { data } = await axios.get(`${API}/admin/sales-report/filters`, { withCredentials: true });
        setCatalog({ clients: data.clients || [], cities: data.cities || [], sites: data.sites || [], vendors: data.vendors || [], customer_types: data.customer_types || [] });
      } catch (_) { /* filters optional */ }
    })();
  }, []);

  /* ---- cascade: narrow child options by parent selections ---- */
  const visibleCities = catalog.cities.filter((ci) =>
    clientIds.length === 0 ||
    catalog.sites.some((s) => s.city_id === ci.id && clientIds.includes(s.company_id))
  );
  const visibleSites = catalog.sites.filter((s) =>
    (clientIds.length === 0 || clientIds.includes(s.company_id)) &&
    (cityIds.length === 0 || cityIds.includes(s.city_id))
  );
  const visibleSiteIdSet = new Set(visibleSites.map((s) => s.id));
  const visibleVendors = catalog.vendors.filter((v) =>
    (v.site_ids || []).some((sid) =>
      (siteIds.length === 0 ? visibleSiteIdSet.has(sid) : siteIds.includes(sid))
    )
  );

  // prune selections that fall outside the newly-visible options
  useEffect(() => {
    setCityIds((prev) => prev.filter((id) => visibleCities.some((c) => c.id === id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientIds]);
  useEffect(() => {
    setSiteIds((prev) => prev.filter((id) => visibleSites.some((s) => s.id === id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientIds, cityIds]);
  useEffect(() => {
    setVendorIds((prev) => prev.filter((id) => visibleVendors.some((v) => v.id === id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientIds, cityIds, siteIds]);

  const buildParams = useCallback(() => {
    const p = new URLSearchParams();
    if (mode === 'date') p.set('date', date);
    else if (mode === 'month') p.set('month', month);
    else { p.set('start', start); p.set('end', end); }
    if (clientIds.length) p.set('client_ids', clientIds.join(','));
    if (cityIds.length) p.set('city_ids', cityIds.join(','));
    if (siteIds.length) p.set('site_ids', siteIds.join(','));
    if (vendorIds.length) p.set('vendor_ids', vendorIds.join(','));
    if (customerTypeIds.length) p.set('customer_types', customerTypeIds.join(','));
    return p;
  }, [mode, date, month, start, end, clientIds, cityIds, siteIds, vendorIds, customerTypeIds]);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params = buildParams();
      const [salesRes, settleRes] = await Promise.all([
        axios.get(`${API}/admin/sales-report?${params.toString()}`, { withCredentials: true }),
        axios.get(`${API}/admin/settlement-report?${params.toString()}`, { withCredentials: true }).catch(() => null),
      ]);
      setData(salesRes.data);
      setSettlement(settleRes ? settleRes.data : null);
    } catch (e) {
      setError(e?.response?.data?.detail || 'Failed to load sales report');
      setData(null); setSettlement(null);
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
      const period = mode === 'date' ? date : mode === 'month' ? month : `${start}_${end}`;
      a.download = `cravitoo-sales-${period}.xlsx`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch (e) {
      setError(e?.response?.data?.detail || 'Download failed');
    } finally { setDownloading(false); }
  };

  const downloadSettlement = async () => {
    setSettleDownloading(true);
    try {
      const params = buildParams();
      params.set('format', 'xlsx');
      const resp = await axios.get(`${API}/admin/settlement-report?${params.toString()}`, { responseType: 'blob', withCredentials: true });
      const blob = new Blob([resp.data], { type: resp.headers['content-type'] || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const period = mode === 'date' ? date : mode === 'month' ? month : `${start}_${end}`;
      a.download = `cravitoo-settlement-${period}.xlsx`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch (e) {
      setError(e?.response?.data?.detail || 'Settlement download failed');
    } finally { setSettleDownloading(false); }
  };

  const anyFilter = clientIds.length || cityIds.length || siteIds.length || vendorIds.length || customerTypeIds.length;

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-background">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <PageHeader
            title="Sales Report"
            subtitle="Drill down by Client → City → Site → Vendor (compare multiple at once), scoped to your role. Filter by day, range, or month, then export the full breakdown."
            icon={BarChart3}
          />

          {/* Filters */}
          <FilterBar testid="sales-filter-panel">
            {/* Cascading multi-selects */}
            <div className="flex items-start gap-3 flex-wrap mb-4">
              <MultiSelect label="Client" icon={Briefcase} testid="sales-filter-client"
                options={catalog.clients} selected={clientIds} onChange={setClientIds} />
              <MultiSelect label="City" icon={MapPin} testid="sales-filter-city"
                options={visibleCities} selected={cityIds} onChange={setCityIds} />
              <MultiSelect label="Site" icon={Building2} testid="sales-filter-site"
                options={visibleSites} selected={siteIds} onChange={setSiteIds} />
              <MultiSelect label="Vendor" icon={Store} testid="sales-filter-vendor"
                options={visibleVendors} selected={vendorIds} onChange={setVendorIds} />
              <MultiSelect label="Customer Type" icon={Users} testid="sales-filter-customer-type"
                options={catalog.customer_types} selected={customerTypeIds} onChange={setCustomerTypeIds} />
            </div>

            {/* Date mode chips */}
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              <DateModeChips
                mode={mode}
                onChange={setMode}
                testidPrefix="sales-mode"
                modes={[
                  { k: 'range', label: 'Date range' },
                  { k: 'date', label: 'Single day' },
                  { k: 'month', label: 'Month' },
                ]}
              />
              {anyFilter ? (
                <button
                  data-testid="sales-clear-filters"
                  onClick={() => { setClientIds([]); setCityIds([]); setSiteIds([]); setVendorIds([]); setCustomerTypeIds([]); }}
                  className="px-4 py-2 rounded-full text-sm font-medium text-text-muted hover:text-text-primary flex items-center gap-1"
                >
                  <X className="h-3.5 w-3.5" /> Clear filters
                </button>
              ) : null}
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
          </FilterBar>

          {error && <div data-testid="sales-error" className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}

          {loading && !data ? (
            <div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" /></div>
          ) : data ? (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                <StatCard testid="sales-grand-total" label="Total Sales" value={inr(data.grand_total)} icon={TrendingUp} tone="primary" />
                <StatCard testid="sales-order-count" label="Orders" value={data.order_count} icon={ShoppingBag} tone="indigo" />
              </div>

              {/* City + Client row */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                <DataTable
                  title="Sales by City" icon={MapPin} testid="sales-by-city"
                  rows={data.city_summary || []} emptyText="No sales in this period."
                  cols={[
                    { key: 'city', label: 'City', strong: true },
                    { key: 'total', label: 'Total', align: 'right', render: (r) => inr(r.total) },
                  ]}
                />
                <DataTable
                  title="Sales by Client" icon={Briefcase} testid="sales-by-client"
                  rows={data.client_summary || []} emptyText="No sales in this period."
                  cols={[
                    { key: 'client', label: 'Client', strong: true },
                    { key: 'total', label: 'Total', align: 'right', render: (r) => inr(r.total) },
                  ]}
                />
                <DataTable
                  title="Sales by Customer Type" icon={Users} testid="sales-by-customer-type"
                  rows={data.customer_type_summary || []} emptyText="No sales in this period."
                  cols={[
                    { key: 'customer_type', label: 'Customer Type', strong: true },
                    { key: 'total', label: 'Total', align: 'right', render: (r) => inr(r.total) },
                  ]}
                />
              </div>

              {/* Site + Vendor row */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <DataTable
                  title="Sales by Site" icon={Building2} testid="sales-by-site"
                  rows={data.site_summary || []} emptyText="No sales in this period."
                  cols={[
                    { key: 'site', label: 'Site', strong: true },
                    { key: 'city', label: 'City' },
                    { key: 'total', label: 'Total', align: 'right', render: (r) => inr(r.total) },
                  ]}
                />
                {(() => {
                  const vendorRows = vendorGroup === 'vendor'
                    ? Object.values((data.vendor_summary || []).reduce((acc, r) => {
                        const k = r.vendor || '—';
                        acc[k] = acc[k] || { vendor: k, total: 0 };
                        acc[k].total += Number(r.total || 0);
                        return acc;
                      }, {})).sort((a, b) => b.total - a.total)
                    : (data.vendor_summary || []);
                  const vendorToggle = (
                    <div className="flex rounded-lg border border-border-light overflow-hidden text-xs">
                      <button data-testid="vendor-group-site" onClick={() => setVendorGroup('site')}
                        className={`px-2.5 py-1 transition-colors ${vendorGroup === 'site' ? 'bg-primary text-white' : 'bg-card text-text-secondary hover:bg-background'}`}>By site</button>
                      <button data-testid="vendor-group-vendor" onClick={() => setVendorGroup('vendor')}
                        className={`px-2.5 py-1 transition-colors ${vendorGroup === 'vendor' ? 'bg-primary text-white' : 'bg-card text-text-secondary hover:bg-background'}`}>By vendor</button>
                    </div>
                  );
                  return (
                    <DataTable
                      title="Sales by Vendor" icon={Store} testid="sales-by-vendor"
                      headerExtra={vendorToggle}
                      rows={vendorRows} emptyText="No sales in this period."
                      cols={vendorGroup === 'vendor'
                        ? [
                            { key: 'vendor', label: 'Vendor', strong: true },
                            { key: 'total', label: 'Total', align: 'right', render: (r) => inr(r.total) },
                          ]
                        : [
                            { key: 'vendor', label: 'Vendor', strong: true },
                            { key: 'site', label: 'Site' },
                            { key: 'total', label: 'Total', align: 'right', render: (r) => inr(r.total) },
                          ]}
                    />
                  );
                })()}
              </div>

              {/* Payment reconciliation */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6" data-testid="sales-payment-breakdown">
                <div className="bg-card border border-border-light rounded-2xl p-5">
                  <h2 className="font-heading text-lg font-semibold text-text-primary mb-3">Paid vs Pending</h2>
                  <div className="flex flex-wrap gap-2">
                    {(data.per_payment_status || []).map((p) => (
                      <div key={p.status} data-testid={`sales-pay-status-${p.status}`} className={`flex-1 min-w-[130px] rounded-xl border px-4 py-3 ${PAY_CHIP[p.status] || 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                        <p className="text-xs font-medium uppercase tracking-wide">{cap(p.status)}</p>
                        <p className="text-xl font-semibold mt-1">{inr(p.total_amount)}</p>
                        <p className="text-[11px] opacity-80">{p.orders} order{p.orders === 1 ? '' : 's'}</p>
                      </div>
                    ))}
                    {(data.per_payment_status || []).length === 0 && <p className="text-text-muted text-sm">No payment data in this period.</p>}
                  </div>
                </div>
                <DataTable
                  title="By Payment Method" icon={Wallet} testid="sales-per-payment-table"
                  rows={data.per_payment_method || []} emptyText="No payment data in this period."
                  rowKey={(p, i) => `${p.method}-${i}`}
                  rowTestId={(p, i) => `sales-per-payment-row-${i}`}
                  cols={[
                    { key: 'method', label: 'Method', strong: true, render: (r) => cap(r.method) },
                    { key: 'orders', label: 'Orders', align: 'right' },
                    { key: 'total_amount', label: 'Total', align: 'right', render: (r) => inr(r.total_amount) },
                    { key: 'paid_amount', label: 'Paid', align: 'right', render: (r) => <span className="text-emerald-700">{inr(r.paid_amount)}</span> },
                  ]}
                />
              </div>

              {/* Settlement & reconciliation */}
              {settlement && (
                <div className="mt-8" data-testid="sales-settlement">
                  <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                    <h2 className="font-heading text-xl font-semibold text-text-primary flex items-center gap-2">
                      <Landmark className="h-5 w-5 text-primary" /> Settlement &amp; Reconciliation
                    </h2>
                    <button data-testid="sales-download-settlement-btn" onClick={downloadSettlement} disabled={settleDownloading}
                      className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-50">
                      {settleDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />} Settlement Excel
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                    <StatCard testid="settle-gross" label="Gross Collected" value={inr(settlement.gross_amount)} icon={Wallet} tone="primary" />
                    <StatCard testid="settle-refunded" label="Refunded" value={inr(settlement.refunded_amount)} icon={RotateCcw} tone="red" />
                    <StatCard testid="settle-net" label="Net Settled" value={inr(settlement.net_amount)} icon={TrendingUp} tone="green" />
                  </div>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <DataTable
                      title="By Gateway" icon={Landmark} testid="settle-per-gateway"
                      rows={settlement.per_gateway || []} emptyText="No settlement data in this period."
                      rowKey={(g) => g.gateway} rowTestId={(g) => `settle-gateway-${g.gateway}`}
                      cols={[
                        { key: 'label', label: 'Gateway', strong: true },
                        { key: 'orders', label: 'Paid', align: 'right' },
                        { key: 'gross_amount', label: 'Gross', align: 'right', render: (r) => inr(r.gross_amount) },
                        { key: 'refunded_amount', label: 'Refunded', align: 'right', render: (r) => <span className="text-red-600">{inr(r.refunded_amount)}</span> },
                        { key: 'net_amount', label: 'Net', align: 'right', render: (r) => <span className="text-emerald-700">{inr(r.net_amount)}</span> },
                      ]}
                    />
                    <div className="bg-card border border-border-light rounded-2xl p-5" data-testid="settle-refunds-cancellations">
                      <h3 className="font-heading text-lg font-semibold text-text-primary mb-3">Refunds &amp; Cancellations</h3>
                      <div className="space-y-2 text-sm">
                        {[
                          { k: 'refunded', label: 'Refunded', c: 'text-red-600' },
                          { k: 'refund_pending', label: 'Refund pending', c: 'text-amber-600' },
                          { k: 'refund_failed', label: 'Refund failed', c: 'text-red-700' },
                        ].map((row) => (
                          <div key={row.k} data-testid={`settle-refund-${row.k}`} className="flex items-center justify-between border-b border-border-light/60 pb-2">
                            <span className="text-text-secondary">{row.label}</span>
                            <span className="font-mono"><span className="text-text-muted mr-3">{settlement.refunds[row.k].count}</span><span className={row.c}>{inr(settlement.refunds[row.k].amount)}</span></span>
                          </div>
                        ))}
                        <div data-testid="settle-cancel-total" className="flex items-center justify-between border-b border-border-light/60 pb-2">
                          <span className="text-text-secondary">Cancelled orders</span>
                          <span className="font-mono"><span className="text-text-muted mr-3">{settlement.cancellations.total.count}</span><span className="text-text-primary">{inr(settlement.cancellations.total.amount)}</span></span>
                        </div>
                        <p className="text-xs text-text-muted">Paid→cancelled {settlement.cancellations.paid_cancelled.count} · Before payment {settlement.cancellations.unpaid_cancelled.count}</p>
                        {(settlement.cancellations.by_actor || []).length > 0 && (
                          <div className="flex flex-wrap gap-2 pt-1">
                            {settlement.cancellations.by_actor.map((a) => (
                              <span key={a.by} className="text-xs px-2 py-1 rounded-full bg-background border border-border-light text-text-secondary">{cap(a.by)}: {a.count}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </>
  );
};

export default SalesReport;
