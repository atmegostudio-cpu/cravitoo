import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import Navbar from '../../components/Navbar';
import { Building2, ShoppingBag, IndianRupee, Users, Store, ArrowRight } from 'lucide-react';
import logger from '../../lib/logger';
import { PageHeader } from '../../components/ui/page-header';
import { StatCard } from '../../components/ui/stat-card';

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
      } catch (e) { logger.error(e); }
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
    { label: 'Total Orders', value: report?.total_orders || 0, icon: ShoppingBag, tone: 'green' },
    { label: 'Paid Orders', value: report?.paid_orders || 0, icon: ShoppingBag, tone: 'blue' },
    { label: 'Revenue', value: `₹${(report?.total_revenue || 0).toLocaleString('en-IN')}`, icon: IndianRupee, tone: 'primary' },
    { label: 'Employees', value: report?.employees || 0, icon: Users, tone: 'purple' },
  ];

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-background">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <PageHeader
            title={site.name}
            subtitle={`${site.address}, ${site.city}`}
            icon={Building2}
            actions={
              <button
                data-testid="manage-site-btn"
                onClick={() => navigate(`/site-admin/site/${site.id}`)}
                className="flex items-center gap-2 bg-primary text-white px-5 py-2.5 rounded-xl font-medium hover:bg-primary-hover transition-all duration-200"
              >
                Manage Site <ArrowRight className="h-4 w-4" />
              </button>
            }
          />

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {stats.map((s) => (
              <StatCard
                key={s.label}
                testid={`siteadmin-stat-${s.label.toLowerCase().replace(' ', '-')}`}
                label={s.label}
                value={s.value}
                icon={s.icon}
                tone={s.tone}
              />
            ))}
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
