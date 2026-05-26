import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import Navbar from '../../components/Navbar';
import { Building2, ShoppingBag, IndianRupee, Users, Store, ArrowRight } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const SiteAdminDashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [site, setSite] = useState(null);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const siteId = user?.site_id;
    if (!siteId) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const [s, r] = await Promise.all([
          axios.get(`${API}/sites/${siteId}`, { withCredentials: true }),
          axios.get(`${API}/reports/site/${siteId}`, { withCredentials: true }),
        ]);
        setSite(s.data);
        setReport(r.data);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    })();
  }, [user]);

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

  if (!user?.site_id || !site) {
    return (
      <>
        <Navbar />
        <div className="min-h-screen bg-background flex items-center justify-center">
          <p className="text-text-secondary">No site assigned to your account.</p>
        </div>
      </>
    );
  }

  const stats = [
    { label: 'Total Orders', value: report?.total_orders || 0, icon: ShoppingBag, color: 'text-emerald-600', bg: 'bg-emerald-50' },
    { label: 'Paid Orders', value: report?.paid_orders || 0, icon: ShoppingBag, color: 'text-blue-600', bg: 'bg-blue-50' },
    { label: 'Revenue', value: `₹${(report?.total_revenue || 0).toLocaleString('en-IN')}`, icon: IndianRupee, color: 'text-primary', bg: 'bg-primary-light' },
    { label: 'Employees', value: report?.employees || 0, icon: Users, color: 'text-purple-600', bg: 'bg-purple-50' },
  ];

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-background">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex items-start gap-4 mb-8 flex-wrap">
            <div className="bg-primary-light rounded-2xl p-4">
              <Building2 className="h-8 w-8 text-primary" />
            </div>
            <div className="flex-1">
              <h1 className="font-heading text-3xl sm:text-4xl tracking-tighter font-semibold text-text-primary">{site.name}</h1>
              <p className="text-text-secondary mt-1">{site.address}, {site.city}</p>
            </div>
            <button
              data-testid="manage-site-btn"
              onClick={() => navigate(`/site-admin/site/${site.id}`)}
              className="flex items-center gap-2 bg-primary text-white px-5 py-2.5 rounded-xl font-medium hover:bg-primary-hover"
            >
              Manage Site <ArrowRight className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {stats.map((s) => {
              const Icon = s.icon;
              return (
                <div key={s.label} data-testid={`siteadmin-stat-${s.label.toLowerCase().replace(' ', '-')}`} className="bg-card border border-border-light rounded-2xl p-5">
                  <div className={`${s.bg} rounded-xl p-2.5 w-fit mb-3`}>
                    <Icon className={`h-5 w-5 ${s.color}`} />
                  </div>
                  <p className="text-2xl font-heading font-semibold text-text-primary">{s.value}</p>
                  <p className="text-text-secondary text-xs mt-1">{s.label}</p>
                </div>
              );
            })}
          </div>

          <div className="bg-card border border-border-light rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-heading text-xl font-medium flex items-center gap-2"><Store className="h-5 w-5 text-primary" /> Vendor Performance</h2>
            </div>
            {(report?.vendors || []).length === 0 && (
              <p className="text-text-muted text-sm">No paid orders from any vendor at this site yet.</p>
            )}
            <div className="space-y-2">
              {(report?.vendors || []).map((v) => (
                <div key={v.vendor_id} data-testid={`vendor-perf-${v.vendor_id}`} className="flex items-center justify-between p-3 bg-background rounded-lg">
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
    </>
  );
};

export default SiteAdminDashboard;
