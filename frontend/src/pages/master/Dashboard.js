import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Navbar from '../../components/Navbar';
import { Building2, Store, Users, ShoppingBag, IndianRupee, TrendingUp, Activity } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const MasterDashboard = () => {
  const [data, setData] = useState(null);
  const [charts, setCharts] = useState(null);
  const [leaderboard, setLeaderboard] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [d, c, lb] = await Promise.all([
          axios.get(`${API}/reports/master-dashboard`, { withCredentials: true }),
          axios.get(`${API}/reports/charts?days=14`, { withCredentials: true }),
          axios.get(`${API}/reports/city-leaderboard?days=30`, { withCredentials: true }),
        ]);
        setData(d.data);
        setCharts(c.data);
        setLeaderboard(lb.data);
      } catch (e) {
        console.error(e);
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

// ============== CHART COMPONENTS ==============

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
          return <circle key={i} cx={x} cy={y} r="0.8" fill="#FF6B35" />;
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
