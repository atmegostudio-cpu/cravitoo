import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import Navbar from '../../components/Navbar';
import { BarChart3, FileSpreadsheet, Loader2, Store, Building2, TrendingUp, ShoppingBag, MapPin, Briefcase, Users, ChevronDown, X, Check } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

const SummaryTable = ({ title, icon: Icon, rows, cols, emptyText, testid, headerExtra }) => (
  <div className="bg-card border border-border-light rounded-2xl overflow-hidden" data-testid={testid}>
    <div className="px-5 py-4 border-b border-border-light flex items-center gap-2">
      <Icon className="h-5 w-5 text-primary" />
      <h2 className="font-heading text-lg font-semibold text-text-primary">{title}</h2>
      {headerExtra ? <div className="ml-auto">{headerExtra}</div> : null}
    </div>
    {rows.length === 0 ? (
      <div className="p-8 text-center text-text-muted text-sm">{emptyText}</div>
    ) : (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-background text-xs text-text-muted uppercase tracking-wider">
            <tr>
              {cols.map((c) => (
                <th key={c.key} className={`px-5 py-3 ${c.align === 'right' ? 'text-right' : 'text-left'}`}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border-light">
            {rows.map((row, i) => (
              <tr key={i} data-testid={`${testid}-row-${i}`} className="hover:bg-background/50">
                {cols.map((c) => (
                  <td key={c.key} className={`px-5 py-3 ${c.align === 'right' ? 'text-right font-mono font-semibold' : 'text-text-primary'} ${c.strong ? 'font-medium' : 'text-text-secondary'}`}>
                    {c.render ? c.render(row) : row[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
);

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
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
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

  const anyFilter = clientIds.length || cityIds.length || siteIds.length || vendorIds.length || customerTypeIds.length;

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
              Drill down by <strong>Client → City → Site → Vendor</strong> (compare multiple at once), scoped to your role. Filter by a single day, a date range, or a month, then download the full breakdown as Excel.
            </p>
          </div>

          {/* Filters */}
          <div className="bg-card border border-border-light rounded-2xl p-5 mb-6" data-testid="sales-filter-panel">
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

              {/* City + Client row */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                <SummaryTable
                  title="Sales by City" icon={MapPin} testid="sales-by-city"
                  rows={data.city_summary || []} emptyText="No sales in this period."
                  cols={[
                    { key: 'city', label: 'City', strong: true },
                    { key: 'total', label: 'Total', align: 'right', render: (r) => inr(r.total) },
                  ]}
                />
                <SummaryTable
                  title="Sales by Client" icon={Briefcase} testid="sales-by-client"
                  rows={data.client_summary || []} emptyText="No sales in this period."
                  cols={[
                    { key: 'client', label: 'Client', strong: true },
                    { key: 'total', label: 'Total', align: 'right', render: (r) => inr(r.total) },
                  ]}
                />
                <SummaryTable
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
                <SummaryTable
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
                    <SummaryTable
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
            </>
          ) : null}
        </div>
      </div>
    </>
  );
};

export default SalesReport;
