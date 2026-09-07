import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import Navbar from '../../components/Navbar';
import { Building2, Store, Users, ShoppingBag, IndianRupee, TrendingUp, Activity, Mail, Loader2, AlertTriangle, Trash2, Sparkles, Wallet, ScanLine, Clock, CheckCircle2, XCircle, PackageCheck } from 'lucide-react';
import logger from '../../lib/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const MasterDashboard = () => {
  const [data, setData] = useState(null);
  const [charts, setCharts] = useState(null);
  const [leaderboard, setLeaderboard] = useState(null);
  const [aiSpend, setAiSpend] = useState(null);
  const [reconciliation, setReconciliation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sendingReport, setSendingReport] = useState(false);
  const [reportMessage, setReportMessage] = useState('');

  const handleSendWeeklyReport = async () => {
    setSendingReport(true);
    setReportMessage('');
    try {
      const { data: result } = await axios.post(`${API}/admin/reports/weekly/send?target_role=all`, {}, { withCredentials: true });
      setReportMessage(`✓ Report sent to ${result.sent}/${result.recipients_total} admins (period: ${result.period}).`);
    } catch (e) {
      setReportMessage(`✗ ${e.response?.data?.detail || 'Failed to send report'}`);
    } finally {
      setSendingReport(false);
      setTimeout(() => setReportMessage(''), 8000);
    }
  };

  const [reclassifying, setReclassifying] = useState(false);
  const [reclassifyMessage, setReclassifyMessage] = useState('');
  const handleReclassifyVeg = async () => {
    const proceed = window.confirm(
      'Re-run classifiers over EVERY live menu item?\n\n' +
      'OK  → SAFE mode (only fills items that have no veg / allergen tag yet — vendor overrides preserved)\n' +
      'Cancel → do nothing'
    );
    if (!proceed) return;
    const overwrite = window.confirm(
      'ALSO overwrite items that already have manual tags?\n\n' +
      'OK  → OVERWRITE mode (fixes mis-tagged items — vendor manual overrides WILL be replaced)\n' +
      'Cancel → keep manual overrides (safer)'
    );
    setReclassifying(true);
    setReclassifyMessage('');
    try {
      const q = overwrite ? '?overwrite=true' : '';
      const [veg, allergen] = await Promise.all([
        axios.post(`${API}/admin/menu-items/reclassify-veg${q}`, {}, { withCredentials: true }),
        axios.post(`${API}/admin/menu-items/reclassify-allergens${q}`, {}, { withCredentials: true }),
      ]);
      setReclassifyMessage(
        `✓ ${overwrite ? 'OVERWRITE' : 'SAFE'} — Veg: ${veg.data.changed}/${veg.data.total} · Allergens: ${allergen.data.changed}/${allergen.data.total}`,
      );
    } catch (e) {
      setReclassifyMessage(`✗ ${e.response?.data?.detail || 'Reclassify failed'}`);
    } finally {
      setReclassifying(false);
      setTimeout(() => setReclassifyMessage(''), 12000);
    }
  };

  const [testEmailSending, setTestEmailSending] = useState(false);
  const [testEmailMsg, setTestEmailMsg] = useState('');

  const sendTestEmail = async () => {
    const to = window.prompt(
      'Send a Cravitoo email health-check to which address?\n\n' +
      'Tip: use your personal Gmail first (arrives in inbox = OK), ' +
      'then repeat with a corporate address to prove that mailbox allowlisted us.'
    );
    if (!to || !to.includes('@')) return;
    setTestEmailSending(true);
    setTestEmailMsg('');
    try {
      const { data } = await axios.post(
        `${API}/admin/email/send-test`,
        { to: to.trim() },
        { withCredentials: true, timeout: 30000 },
      );
      setTestEmailMsg(`✓ Sent from ${data.from} → ${data.to}. Check inbox in ~30s (not spam). If it's in spam, the recipient's IT needs to allowlist us.`);
    } catch (e) {
      const detail = e.response?.data?.detail || e.message;
      setTestEmailMsg(`✗ ${detail}`);
    } finally {
      setTestEmailSending(false);
      setTimeout(() => setTestEmailMsg(''), 20000);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const [d, c, lb, ai, rc] = await Promise.all([
          axios.get(`${API}/reports/master-dashboard`, { withCredentials: true }),
          axios.get(`${API}/reports/charts?days=14`, { withCredentials: true }),
          axios.get(`${API}/reports/city-leaderboard?days=30`, { withCredentials: true }),
          axios.get(`${API}/admin/ai-photos/spend`, { withCredentials: true }).catch(() => null),
          axios.get(`${API}/admin/orders/reconciliation`, { withCredentials: true }).catch(() => null),
        ]);
        setData(d.data);
        setCharts(c.data);
        setLeaderboard(lb.data);
        if (ai) setAiSpend(ai.data);
        if (rc) setReconciliation(rc.data);
      } catch (e) {
        logger.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <>
        <Navbar />
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </>
    );
  }

  const stats = [
    { label: 'Total Sites', value: data?.total_sites || 0, icon: Building2, bg: 'bg-blue-100', color: 'text-blue-600' },
    { label: 'Active Vendors', value: data?.total_vendors || 0, icon: Store, bg: 'bg-primary-light', color: 'text-primary' },
    { label: 'Total Users', value: data?.total_users || 0, icon: Users, bg: 'bg-purple-100', color: 'text-purple-600' },
    { label: 'Employees', value: data?.total_employees || 0, icon: Users, bg: 'bg-indigo-100', color: 'text-indigo-600' },
    { label: 'Total Orders', value: data?.total_orders || 0, icon: ShoppingBag, bg: 'bg-emerald-100', color: 'text-emerald-600' },
    { label: 'Paid Orders', value: data?.paid_orders || 0, icon: Activity, bg: 'bg-teal-100', color: 'text-teal-600' },
  ];

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-background">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex justify-between items-start mb-8 flex-wrap gap-4">
            <div>
              <h1 className="font-heading text-4xl sm:text-5xl tracking-tighter font-semibold text-text-primary">
                Master Dashboard
              </h1>
              <p className="text-text-secondary mt-2">Platform-wide control of Cravitoo</p>
            </div>
            <div className="bg-gradient-to-r from-primary to-orange-600 text-white rounded-2xl px-6 py-4 flex items-center gap-3" data-testid="total-revenue-card">
              <IndianRupee className="h-8 w-8" />
              <div>
                <p className="text-xs opacity-90">Total Revenue</p>
                <p className="font-heading text-2xl font-semibold">₹{(data?.total_revenue || 0).toLocaleString('en-IN')}</p>
              </div>
            </div>
          </div>

          {/* One-click data-hygiene toolbar */}
          <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3" data-testid="data-hygiene-toolbar">
            <div>
              <h3 className="font-heading font-semibold text-amber-900 flex items-center gap-2">
                <Sparkles className="h-4 w-4" /> Menu Data Hygiene
              </h3>
              <p className="text-sm text-amber-800 mt-0.5">
                Re-run the Veg / Non-Veg + Allergen classifiers over every live menu item. Fixes mis-tagged rows and fills in missing allergens.
              </p>
              {reclassifyMessage && (
                <p className="text-xs mt-2 font-medium" data-testid="reclassify-live-message">{reclassifyMessage}</p>
              )}
            </div>
            <button
              onClick={handleReclassifyVeg}
              disabled={reclassifying}
              data-testid="reclassify-live-menu-btn"
              className="flex items-center gap-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap"
            >
              {reclassifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {reclassifying ? 'Reclassifying...' : 'Fix All Live Menus'}
            </button>
          </div>

          {/* Bulk photo fill toolbar REMOVED per Feb-2026 simplification.
              Photos are now managed per-item via Upload / Generate / Remove
              on Master → Sites → {site} → Menu tab and on the Vendor Panel. */}

          {/* Fix Employee Menus — diagnostic + repair for blank/empty employee menus */}
          <FixEmployeeMenus />

          {/* Email deliverability probe */}
          <div className="mb-6 rounded-2xl border border-sky-200 bg-sky-50 p-5 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3" data-testid="email-health-toolbar">
            <div className="flex-1 min-w-0">
              <h3 className="font-heading font-semibold text-sky-900 flex items-center gap-2">
                <Sparkles className="h-4 w-4" /> Email deliverability
              </h3>
              <p className="text-sm text-sky-800 mt-0.5">
                Send a real OTP-style test email to prove Resend + DKIM + SPF + the recipient's corporate allowlist all work together. Do this <strong>before</strong> onboarding each new corporate client.
              </p>
              {testEmailMsg && (
                <p className="text-xs mt-2 font-medium text-sky-900" data-testid="test-email-message">
                  {testEmailSending && <Loader2 className="inline h-3.5 w-3.5 animate-spin mr-1" />}
                  {testEmailMsg}
                </p>
              )}
            </div>
            <button
              onClick={sendTestEmail}
              disabled={testEmailSending}
              data-testid="send-test-email-btn"
              className="flex items-center gap-2 bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap"
            >
              {testEmailSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Send Test Email
            </button>
          </div>

          {/* Quick actions row */}
          {(() => {
            const hasOrphans =
              data && (data.total_sites || 0) === 0 && (data.total_vendors || 0) === 0 &&
              ((data.total_users || 0) > 1 || (data.total_orders || 0) > 0 ||
               (data.total_employees || 0) > 0 || (data.total_revenue || 0) > 0);
            return hasOrphans ? (
              <div
                data-testid="orphan-warning-card"
                className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
              >
                <div className="flex items-start gap-3">
                  <div className="bg-red-100 rounded-xl p-2.5">
                    <AlertTriangle className="h-5 w-5 text-red-600" />
                  </div>
                  <div>
                    <h3 className="font-heading font-semibold text-red-800">Orphan data detected</h3>
                    <p className="text-sm text-red-700 mt-0.5">
                      You have 0 sites and 0 active vendors but{' '}
                      <strong>{data.total_users || 0} users</strong>,{' '}
                      <strong>{data.total_orders || 0} orders</strong> and{' '}
                      <strong>₹{(data.total_revenue || 0).toLocaleString('en-IN')}</strong>{' '}
                      revenue still exist. Reset the app to clear everything.
                    </p>
                  </div>
                </div>
                <Link
                  to="/master/reset"
                  data-testid="go-to-reset-btn"
                  className="whitespace-nowrap flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white px-5 py-2.5 rounded-lg font-medium"
                >
                  <Trash2 className="h-4 w-4" /> Reset App to Blank
                </Link>
              </div>
            ) : null;
          })()}

          {/* AI photo spend tracker — only shown once at least one AI image has been generated */}
          {aiSpend && (aiSpend.all_time?.images || 0) > 0 && (
            <div
              data-testid="ai-spend-card"
              className="mb-6 rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
            >
              <div className="flex items-start gap-3">
                <div className="bg-violet-100 rounded-xl p-2.5">
                  <Sparkles className="h-5 w-5 text-violet-600" />
                </div>
                <div>
                  <h3 className="font-heading font-semibold text-text-primary">AI photo spend</h3>
                  <p className="text-xs text-text-muted mt-0.5">
                    gpt-image-1 · ~₹{aiSpend.price_per_image_inr}/image · runaway usage = LLM key balance drop
                  </p>
                </div>
              </div>
              <div className="flex gap-6 text-right">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-text-muted">Month to date</p>
                  <p className="font-heading text-xl font-semibold text-violet-700" data-testid="ai-spend-mtd">
                    ₹{aiSpend.month_to_date.spend_inr.toLocaleString('en-IN')}
                  </p>
                  <p className="text-[11px] text-text-muted">{aiSpend.month_to_date.images} images</p>
                </div>
                <div className="hidden sm:block border-l border-violet-200" />
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-text-muted">Last 30 days</p>
                  <p className="font-heading text-xl font-semibold text-violet-700" data-testid="ai-spend-30d">
                    ₹{aiSpend.last_30_days.spend_inr.toLocaleString('en-IN')}
                  </p>
                  <p className="text-[11px] text-text-muted">{aiSpend.last_30_days.images} images</p>
                </div>
              </div>
            </div>
          )}

          {/* Quick actions row */}
          <div className="bg-card border border-border-light rounded-2xl p-5 mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="bg-primary-light rounded-xl p-2.5">
                <Mail className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="font-heading font-semibold text-text-primary">Weekly admin email report</h3>
                <p className="text-sm text-text-secondary mt-0.5">Send a 7-day performance summary to all master &amp; site admins</p>
                {reportMessage && (
                  <p data-testid="report-message" className={`text-xs mt-2 ${reportMessage.startsWith('✓') ? 'text-green-600' : 'text-red-600'}`}>{reportMessage}</p>
                )}
              </div>
            </div>
            <button
              onClick={handleSendWeeklyReport}
              disabled={sendingReport}
              data-testid="send-weekly-report-btn"
              className="bg-primary hover:bg-primary-hover text-white px-5 py-2.5 rounded-lg font-medium transition-all duration-200 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {sendingReport ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Sending...</span>
                </>
              ) : (
                <>
                  <Mail className="h-4 w-4" />
                  <span>Send weekly report now</span>
                </>
              )}
            </button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
            {stats.map((s) => {
              const Icon = s.icon;
              return (
                <div key={s.label} data-testid={`stat-${s.label.toLowerCase().replace(/ /g, '-')}`} className="bg-card border border-border-light rounded-2xl p-5">
                  <div className={`${s.bg} rounded-xl p-2.5 w-fit mb-3`}>
                    <Icon className={`h-5 w-5 ${s.color}`} />
                  </div>
                  <p className="text-2xl font-heading font-semibold text-text-primary">{s.value}</p>
                  <p className="text-text-secondary text-xs mt-1">{s.label}</p>
                </div>
              );
            })}
          </div>

          {reconciliation && (
            <OrderReconciliation data={reconciliation} />
          )}

          {charts && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              <RevenueChart data={charts.daily_revenue} />
              <TopDishesChart data={charts.top_dishes} />
            </div>
          )}

          {leaderboard && leaderboard.cities.length > 0 && (
            <CityLeaderboard data={leaderboard} />
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-card border border-border-light rounded-2xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-heading text-xl font-medium text-text-primary">Top Sites</h2>
                <TrendingUp className="h-5 w-5 text-green-500" />
              </div>
              {(data?.top_sites || []).length === 0 && (
                <p className="text-text-muted text-sm">No paid orders yet from any site.</p>
              )}
              <div className="space-y-3">
                {(data?.top_sites || []).map((s) => (
                  <div key={s.site_id} className="flex items-center justify-between p-3 bg-background rounded-lg" data-testid={`top-site-${s.site_id}`}>
                    <div>
                      <p className="font-medium text-text-primary text-sm">{s.name}</p>
                      <p className="text-text-muted text-xs">{s.orders} orders</p>
                    </div>
                    <p className="font-heading font-semibold text-primary">₹{s.revenue.toLocaleString('en-IN')}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-card border border-border-light rounded-2xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-heading text-xl font-medium text-text-primary">Top Vendors</h2>
                <TrendingUp className="h-5 w-5 text-green-500" />
              </div>
              {(data?.top_vendors || []).length === 0 && (
                <p className="text-text-muted text-sm">No vendor orders yet.</p>
              )}
              <div className="space-y-3">
                {(data?.top_vendors || []).map((v) => (
                  <div key={v.vendor_id} className="flex items-center justify-between p-3 bg-background rounded-lg" data-testid={`top-vendor-${v.vendor_id}`}>
                    <div>
                      <p className="font-medium text-text-primary text-sm">{v.name}</p>
                      <p className="text-text-muted text-xs">{v.orders} orders</p>
                    </div>
                    <p className="font-heading font-semibold text-primary">₹{v.revenue.toLocaleString('en-IN')}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

// ============== FIX EMPLOYEE MENUS ==============

const FixEmployeeMenus = () => {
  const [email, setEmail] = useState('');
  const [trace, setTrace] = useState(null);
  const [checking, setChecking] = useState(false);
  const [report, setReport] = useState(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [msg, setMsg] = useState('');
  const [lookupResults, setLookupResults] = useState(null);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [sitesList, setSitesList] = useState([]);
  const [assignChoice, setAssignChoice] = useState({});
  const [assigningEmail, setAssigningEmail] = useState('');

  const runLookup = async (preserveMsg = false) => {
    const q = email.trim();
    if (!q) { setMsg('Enter an email or a domain like @cravitoo.com'); return; }
    setLookupBusy(true); if (!preserveMsg) setMsg(''); setLookupResults(null);
    try {
      const [empRes, siteRes] = await Promise.all([
        axios.get(`${API}/admin/employees/lookup?q=${encodeURIComponent(q)}`, { withCredentials: true }),
        sitesList.length ? Promise.resolve({ data: sitesList }) : axios.get(`${API}/sites`, { withCredentials: true }),
      ]);
      setLookupResults(empRes.data);
      if (!sitesList.length) setSitesList(siteRes.data || []);
      if (empRes.data.length === 0) setMsg(`No employees match "${q}"`);
    } catch (e) {
      setMsg(`✗ ${e.response?.data?.detail || 'Lookup failed'}`);
    } finally { setLookupBusy(false); }
  };

  const assignEmp = async (empEmail) => {
    const siteId = assignChoice[empEmail];
    if (!siteId) { setMsg('Pick a site first'); return; }
    setAssigningEmail(empEmail);
    try {
      const { data } = await axios.post(`${API}/admin/employees/assign-site`, { email: empEmail, site_id: siteId }, { withCredentials: true });
      await runLookup(true);
      setMsg(`✓ ${data.email} assigned to ${data.site_name}. Their menu will show that site's vendors now.`);
    } catch (e) {
      setMsg(`✗ ${e.response?.data?.detail || 'Assign failed'}`);
    } finally { setAssigningEmail(''); }
  };

  const runCheck = async () => {
    if (!email.includes('@')) { setMsg('Enter a valid employee email'); return; }
    setChecking(true); setTrace(null); setMsg('');
    try {
      const { data } = await axios.get(`${API}/admin/integrity/employee-visibility?email=${encodeURIComponent(email.trim())}`, { withCredentials: true });
      setTrace(data);
    } catch (e) {
      setMsg(`✗ ${e.response?.data?.detail || 'Lookup failed'}`);
    } finally { setChecking(false); }
  };

  const runReport = async () => {
    setLoadingReport(true); setMsg('');
    try {
      const { data } = await axios.get(`${API}/admin/integrity/employee-menu-report`, { withCredentials: true });
      setReport(data);
    } catch (e) {
      setMsg(`✗ ${e.response?.data?.detail || 'Report failed'}`);
    } finally { setLoadingReport(false); }
  };

  const runBackfill = async () => {
    if (!window.confirm('Auto-assign the correct site to employees who are missing one? Safe and re-runnable.')) return;
    setBackfilling(true); setMsg('');
    try {
      const { data } = await axios.post(`${API}/admin/integrity/backfill-employee-sites`, {}, { withCredentials: true });
      await runReport();
      setMsg(`✓ Fixed ${data.fixed} employee(s). ${data.unresolved.length} still need manual site assignment${data.unresolved.length ? ': ' + data.unresolved.map((u) => u.email).join(', ') : '.'}`);
    } catch (e) {
      setMsg(`✗ ${e.response?.data?.detail || 'Backfill failed'}`);
    } finally { setBackfilling(false); }
  };

  const verdictOk = trace && trace.verdict?.startsWith('OK');

  return (
    <div className="mb-6 rounded-2xl border border-teal-200 bg-teal-50 p-5" data-testid="fix-employee-menus-panel">
      <h3 className="font-heading font-semibold text-teal-900 flex items-center gap-2">
        <Users className="h-4 w-4" /> Fix Employee Menus
      </h3>
      <p className="text-sm text-teal-800 mt-0.5 mb-3">
        Diagnose why an employee sees a blank menu, then repair it. Check one employee by email, or scan everyone and auto-assign missing sites.
      </p>

      <div className="flex flex-col sm:flex-row gap-2 mb-3">
        <input
          data-testid="fem-email-input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && runCheck()}
          placeholder="employee@company.com"
          className="flex-1 px-3 py-2 border border-teal-200 rounded-lg text-sm"
        />
        <button data-testid="fem-check-btn" onClick={runCheck} disabled={checking} className="bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap flex items-center gap-2">
          {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Check employee
        </button>
        <button data-testid="fem-report-btn" onClick={runReport} disabled={loadingReport} className="bg-white border border-teal-300 text-teal-800 hover:bg-teal-100 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap">
          {loadingReport ? 'Scanning…' : 'Scan everyone'}
        </button>
        <button data-testid="fem-lookup-btn" onClick={runLookup} disabled={lookupBusy} className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap flex items-center gap-2">
          {lookupBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Search &amp; assign
        </button>
        <button data-testid="fem-backfill-btn" onClick={runBackfill} disabled={backfilling} className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap flex items-center gap-2">
          {backfilling ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Auto-fix sites
        </button>
      </div>

      {msg && <p data-testid="fem-message" className={`text-xs font-medium mb-2 ${msg.startsWith('✓') ? 'text-emerald-700' : 'text-red-600'}`}>{msg}</p>}

      {trace && (
        <div data-testid="fem-trace" className={`rounded-xl p-4 mb-3 text-sm ${verdictOk ? 'bg-emerald-100 border border-emerald-200' : 'bg-amber-100 border border-amber-200'}`}>
          <p className="font-medium text-text-primary">{trace.email}</p>
          <p className="text-xs text-text-secondary mb-2">
            site: {trace.site_name || trace.effective_site_id || '—'}
            {trace.resolved_via_single_site_fallback ? ' (auto-resolved)' : ''} · active vendors on site: {trace.active_mappings_on_site ?? 0}
          </p>
          <p data-testid="fem-verdict" className={`font-semibold ${verdictOk ? 'text-emerald-800' : 'text-amber-900'}`}>{trace.verdict}</p>
          {Array.isArray(trace.vendors) && trace.vendors.length > 0 && (
            <ul className="mt-2 text-xs text-text-secondary list-disc pl-5">
              {trace.vendors.map((v) => (
                <li key={v.vendor_id}>{v.name} — status {v.vendor_status}, {v.menu_items_available}/{v.menu_items_total} items available</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {lookupResults && lookupResults.length > 0 && (
        <div data-testid="fem-assign-panel" className="rounded-xl p-4 mb-3 bg-white border border-indigo-200">
          <p className="font-medium text-text-primary mb-2 text-sm">Assign employee → City / Site / Cafeteria / Vendor</p>
          <div className="space-y-2">
            {lookupResults.map((e) => (
              <div key={e.id} data-testid={`fem-emp-row-${e.email}`} className="flex flex-col sm:flex-row sm:items-center gap-2 p-2 rounded-lg bg-slate-50">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{e.email}</p>
                  <p className="text-xs text-text-muted">Current site: {e.site_name || <span className="text-red-600 font-medium">none — menu is blank</span>}</p>
                </div>
                <select
                  data-testid={`fem-site-select-${e.email}`}
                  value={assignChoice[e.email] || e.site_id || ''}
                  onChange={(ev) => setAssignChoice({ ...assignChoice, [e.email]: ev.target.value })}
                  className="px-2 py-1.5 border border-border-light rounded-lg text-xs bg-white"
                >
                  <option value="">— Select site —</option>
                  {sitesList.map((s) => (
                    <option key={s.id} value={s.id}>{s.city ? `${s.city} · ` : ''}{s.name}</option>
                  ))}
                </select>
                <button
                  data-testid={`fem-assign-btn-${e.email}`}
                  onClick={() => assignEmp(e.email)}
                  disabled={assigningEmail === e.email}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap"
                >
                  {assigningEmail === e.email ? 'Saving…' : 'Assign'}
                </button>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-text-muted mt-2">Vendors/cafeterias shown to the employee come from the site you assign here. Assign the site whose vendors they should see.</p>
        </div>
      )}

      {report && (
        <div data-testid="fem-report" className="rounded-xl p-4 bg-white border border-teal-200 text-sm">
          <p className="font-medium text-text-primary mb-2">Scan summary</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
            <span data-testid="fem-sum-nosite" className="px-2 py-1 rounded bg-red-50 text-red-700">No site: <strong>{report.summary.no_site}</strong></span>
            <span className="px-2 py-1 rounded bg-red-50 text-red-700">Deleted site: <strong>{report.summary.site_deleted}</strong></span>
            <span className="px-2 py-1 rounded bg-amber-50 text-amber-700">Zero vendors: <strong>{report.summary.zero_vendors}</strong></span>
            <span className="px-2 py-1 rounded bg-amber-50 text-amber-700">Domains w/o site: <strong>{report.summary.domains_missing_site_id}</strong></span>
            <span className="px-2 py-1 rounded bg-amber-50 text-amber-700">Vendors all-unavailable: <strong>{report.summary.vendors_all_unavailable}</strong></span>
          </div>
          {report.employees_no_site.length > 0 && (
            <p className="text-xs text-text-secondary mt-2">No-site employees: {report.employees_no_site.map((e) => e.email).join(', ')}</p>
          )}
        </div>
      )}
    </div>
  );
};

// ============== CHART COMPONENTS ==============

const OrderReconciliation = ({ data }) => {
  const b = data?.buckets || {};
  const mode = data?.payment_mode || 'OFFLINE';
  const fmt = (n) => `₹${(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

  const paymentBuckets = [
    { key: 'total',       label: 'Total Orders',    bucket: b.total,       icon: ShoppingBag,   accent: 'text-slate-700',   ring: 'ring-slate-200',   bg: 'bg-slate-50' },
    { key: 'pending',     label: 'Pending Payment', bucket: b.pending,     icon: Clock,         accent: 'text-amber-700',   ring: 'ring-amber-200',   bg: 'bg-amber-50' },
    { key: 'paid',        label: 'Paid',            bucket: b.paid,        icon: CheckCircle2,  accent: 'text-emerald-700', ring: 'ring-emerald-200', bg: 'bg-emerald-50' },
    { key: 'unpaid',      label: 'Unpaid',          bucket: b.unpaid,      icon: XCircle,       accent: 'text-red-700',     ring: 'ring-red-200',     bg: 'bg-red-50' },
    { key: 'physical_qr', label: 'Physical QR',     bucket: b.physical_qr, icon: ScanLine,      accent: 'text-indigo-700',  ring: 'ring-indigo-200',  bg: 'bg-indigo-50' },
  ];

  const statusBuckets = [
    { key: 'ready_for_collection', label: 'Ready',     bucket: b.ready_for_collection, icon: PackageCheck, tone: 'bg-primary-light text-primary' },
    { key: 'collected',            label: 'Collected', bucket: b.collected,            icon: CheckCircle2, tone: 'bg-emerald-100 text-emerald-700' },
    { key: 'cancelled',            label: 'Cancelled', bucket: b.cancelled,            icon: XCircle,      tone: 'bg-red-100 text-red-700' },
  ];

  return (
    <div className="bg-card border border-border-light rounded-2xl p-6 mb-6" data-testid="order-reconciliation-card">
      <div className="flex items-start justify-between mb-5 flex-wrap gap-2">
        <div>
          <h2 className="font-heading text-xl font-medium text-text-primary flex items-center gap-2">
            <Wallet className="h-5 w-5 text-primary" /> Order Reconciliation
          </h2>
          <p className="text-xs text-text-muted mt-0.5">
            Bucketed view of every order — cross-check counter cash and QR takings at end of day.
          </p>
        </div>
        <span
          data-testid="payment-mode-badge"
          className={`text-[11px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full ${mode === 'OFFLINE' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}
        >
          Mode · {mode}
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {paymentBuckets.map(({ key, label, bucket, icon: Icon, accent, ring, bg }) => (
          <div
            key={key}
            data-testid={`recon-bucket-${key}`}
            className={`rounded-xl p-4 ring-1 ${ring} ${bg}`}
          >
            <div className="flex items-center gap-2 mb-2">
              <Icon className={`h-4 w-4 ${accent}`} />
              <span className={`text-[11px] font-semibold uppercase tracking-wider ${accent}`}>{label}</span>
            </div>
            <p className="font-heading text-2xl font-semibold text-text-primary leading-none">{bucket?.count || 0}</p>
            <p className={`text-xs ${accent} mt-1 font-medium`}>{fmt(bucket?.amount)}</p>
          </div>
        ))}
      </div>

      <div className="mt-5 pt-4 border-t border-border-light">
        <p className="text-xs uppercase tracking-wider text-text-muted mb-2 font-semibold">Fulfilment status</p>
        <div className="flex flex-wrap gap-2">
          {statusBuckets.map(({ key, label, bucket, icon: Icon, tone }) => (
            <div
              key={key}
              data-testid={`recon-status-${key}`}
              className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm ${tone}`}
            >
              <Icon className="h-4 w-4" />
              <span className="font-medium">{label}</span>
              <span className="font-heading font-semibold">{bucket?.count || 0}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const RevenueChart = ({ data }) => {
  if (!data || data.length === 0) {
    return (
      <div className="bg-card border border-border-light rounded-2xl p-6">
        <h3 className="font-heading text-lg font-medium text-text-primary mb-2">Daily Revenue (14d)</h3>
        <p className="text-text-muted text-sm">No revenue data yet.</p>
      </div>
    );
  }
  const max = Math.max(...data.map((d) => d.revenue), 1);
  const W = 100, H = 60, padX = 4;
  const stepX = (W - padX * 2) / Math.max(data.length - 1, 1);
  const points = data.map((d, i) => {
    const x = padX + i * stepX;
    const y = H - 6 - (d.revenue / max) * (H - 12);
    return `${x},${y}`;
  }).join(' ');
  const areaPoints = `${padX},${H - 4} ${points} ${padX + (data.length - 1) * stepX},${H - 4}`;
  const total = data.reduce((s, d) => s + d.revenue, 0);
  return (
    <div className="bg-card border border-border-light rounded-2xl p-6" data-testid="revenue-chart">
      <div className="flex items-baseline justify-between mb-1">
        <h3 className="font-heading text-lg font-medium text-text-primary">Daily Revenue</h3>
        <span className="text-xs text-text-muted">last {data.length} days</span>
      </div>
      <p className="text-3xl font-heading font-bold text-primary mb-3">₹{total.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</p>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-32" style={{ display: 'block' }}>
        <polygon points={areaPoints} fill="rgba(255, 107, 53, 0.15)" />
        <polyline points={points} fill="none" stroke="#FF6B35" strokeWidth="0.8" strokeLinecap="round" strokeLinejoin="round" />
        {data.map((d, i) => {
          const x = padX + i * stepX;
          const y = H - 6 - (d.revenue / max) * (H - 12);
          return <circle key={d.date || `dot-${i}`} cx={x} cy={y} r="0.8" fill="#FF6B35" />;
        })}
      </svg>
      <div className="flex justify-between mt-2 text-xs text-text-muted">
        <span>{data[0]?.date.slice(5) || ''}</span>
        <span>{data[data.length - 1]?.date.slice(5) || ''}</span>
      </div>
    </div>
  );
};

const TopDishesChart = ({ data }) => {  if (!data || data.length === 0) {
    return (
      <div className="bg-card border border-border-light rounded-2xl p-6">
        <h3 className="font-heading text-lg font-medium text-text-primary mb-2">Top Dishes</h3>
        <p className="text-text-muted text-sm">No paid orders yet.</p>
      </div>
    );
  }
  const max = Math.max(...data.map((d) => d.qty), 1);
  return (
    <div className="bg-card border border-border-light rounded-2xl p-6" data-testid="top-dishes-chart">
      <h3 className="font-heading text-lg font-medium text-text-primary mb-4">Top Dishes (by qty)</h3>
      <div className="space-y-3">
        {data.map((d, i) => (
          <div key={d.menu_item_id || i} className="flex items-center gap-3">
            <span className="text-xs font-mono text-text-muted w-5">#{i + 1}</span>
            <div className="flex-1">
              <div className="flex items-baseline justify-between mb-1">
                <p className="text-sm font-medium text-text-primary truncate">{d.name}</p>
                <p className="text-xs text-text-muted ml-2">{d.qty} sold · ₹{d.revenue.toFixed(0)}</p>
              </div>
              <div className="h-2 bg-background rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full" style={{ width: `${(d.qty / max) * 100}%` }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const CityLeaderboard = ({ data }) => {
  const maxRev = Math.max(...data.cities.map((c) => c.revenue), 1);
  const totalCities = data.cities.length;
  const medals = ['🥇', '🥈', '🥉'];
  return (
    <div className="bg-card border border-border-light rounded-2xl p-6 mb-6" data-testid="city-leaderboard">
      <div className="flex items-baseline justify-between mb-4 flex-wrap gap-2">
        <h2 className="font-heading text-xl font-medium text-text-primary">City Performance · last {data.days} days</h2>
        <p className="text-sm text-text-secondary">
          {totalCities} {totalCities === 1 ? 'city' : 'cities'} · Total ₹{data.total_revenue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-left text-xs text-text-muted uppercase border-b border-border-light">
              <th className="pb-2 pl-2 w-12">Rank</th>
              <th className="pb-2">City</th>
              <th className="pb-2 text-right">Revenue</th>
              <th className="pb-2 text-right w-20">Orders</th>
              <th className="pb-2 text-right w-20">Sites</th>
              <th className="pb-2 text-right w-20">Vendors</th>
              <th className="pb-2 text-right w-24">Pending</th>
              <th className="pb-2 text-right w-32">Avg Checklist</th>
            </tr>
          </thead>
          <tbody>
            {data.cities.map((c, idx) => (
              <tr key={c.city_id} data-testid={`leaderboard-row-${c.city_id}`} className="border-b border-border-light/50">
                <td className="py-3 pl-2">
                  <span className="text-lg" title={`#${idx + 1}`}>{medals[idx] || `#${idx + 1}`}</span>
                </td>
                <td className="py-3">
                  <p className="font-medium text-text-primary text-sm">{c.name}</p>
                  <p className="text-text-muted text-xs">{c.state}</p>
                </td>
                <td className="py-3 text-right">
                  <p className="font-heading font-semibold text-primary">₹{c.revenue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</p>
                  <div className="h-1.5 bg-background rounded-full overflow-hidden mt-1 ml-auto" style={{ maxWidth: '120px' }}>
                    <div className="h-full bg-primary rounded-full" style={{ width: `${(c.revenue / maxRev) * 100}%` }} />
                  </div>
                </td>
                <td className="py-3 text-right text-sm text-text-secondary">{c.orders}</td>
                <td className="py-3 text-right text-sm text-text-secondary">{c.site_count}</td>
                <td className="py-3 text-right text-sm text-text-secondary">{c.vendor_count}</td>
                <td className="py-3 text-right">
                  {c.pending_onboardings > 0 ? (
                    <span className="px-2 py-0.5 bg-amber-50 text-amber-700 text-xs rounded-full font-medium">{c.pending_onboardings}</span>
                  ) : (
                    <span className="text-text-muted text-xs">—</span>
                  )}
                </td>
                <td className="py-3 text-right">
                  {c.avg_checklist_pct > 0 ? (
                    <div className="flex items-center gap-2 justify-end">
                      <div className="h-1.5 bg-background rounded-full overflow-hidden flex-1" style={{ maxWidth: '60px' }}>
                        <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${c.avg_checklist_pct}%` }} />
                      </div>
                      <span className="text-xs text-text-secondary font-medium w-10">{c.avg_checklist_pct}%</span>
                    </div>
                  ) : (
                    <span className="text-text-muted text-xs">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default MasterDashboard;
