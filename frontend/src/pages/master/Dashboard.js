import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Navbar from '../../components/Navbar';
import { Building2, Store, Users, ShoppingBag, IndianRupee, TrendingUp, Activity } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const MasterDashboard = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await axios.get(`${API}/reports/master-dashboard`, { withCredentials: true });
        setData(data);
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

export default MasterDashboard;
