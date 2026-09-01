import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Navbar from '../../components/Navbar';
import ExportButtons from '../../components/ExportButtons';
import { TrendingUp, Users, DollarSign } from 'lucide-react';
import logger from '../../lib/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const CorporateAdminDashboard = () => {
  const [analytics, setAnalytics] = useState(null);
  const [today, setToday] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const fetchAnalytics = async () => {
    try {
      const [aRes, tRes] = await Promise.all([
        axios.get(`${API}/analytics/corporate`, { withCredentials: true }),
        axios.get(`${API}/analytics/corporate/today`, { withCredentials: true }),
      ]);
      setAnalytics(aRes.data);
      setToday(tRes.data);
    } catch (error) {
      logger.error('Error fetching analytics:', error);
    } finally {
      setLoading(false);
    }
  };

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

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-background">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex flex-wrap justify-between items-start gap-4 mb-8">
            <h1 className="font-heading text-4xl sm:text-5xl tracking-tighter font-semibold text-text-primary">
              Corporate Dashboard
            </h1>
            <div className="bg-card border border-border-light rounded-2xl p-3 space-y-2">
              <p className="text-xs text-text-muted">Reservations (last 30 days)</p>
              <ExportButtons endpoint="/exports/reservations" filename="cravitoo-reservations" testidPrefix="corp-reservations" />
              <p className="text-xs text-text-muted pt-2 border-t border-border-light">Orders (last 30 days)</p>
              <ExportButtons endpoint="/exports/orders" filename="cravitoo-orders" testidPrefix="corp-orders" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div data-testid="corporate-total-orders" className="bg-card border border-border-light rounded-2xl p-8">
              <div className="flex items-center justify-between mb-4">
                <div className="bg-primary-light rounded-xl p-3">
                  <Users className="h-8 w-8 text-primary" />
                </div>
                <TrendingUp className="h-6 w-6 text-green-500" />
              </div>
              <p className="text-4xl font-heading font-semibold text-text-primary mb-2">{analytics?.total_orders || 0}</p>
              <p className="text-text-secondary">Total Employee Orders</p>
            </div>

            <div data-testid="corporate-total-spend" className="bg-card border border-border-light rounded-2xl p-8">
              <div className="flex items-center justify-between mb-4">
                <div className="bg-green-100 rounded-xl p-3">
                  <DollarSign className="h-8 w-8 text-green-600" />
                </div>
              </div>
              <p className="text-4xl font-heading font-semibold text-text-primary mb-2">₹{analytics?.total_spend?.toFixed(2) || 0}</p>
              <p className="text-text-secondary">Total Spending</p>
            </div>
          </div>

          <div className="mt-8" data-testid="corporate-today-section">
            <h2 className="font-heading text-xl sm:text-2xl font-medium text-text-primary mb-4">Today across your sites</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 mb-6">
              <div data-testid="corp-today-orders" className="bg-card border border-border-light rounded-2xl p-5 sm:p-6">
                <p className="text-text-secondary text-sm mb-1">Orders Today</p>
                <p className="text-3xl font-heading font-semibold text-text-primary">{today?.today_orders ?? 0}</p>
                <p className="text-text-muted text-xs mt-1">{today?.today_paid_orders ?? 0} paid</p>
              </div>
              <div data-testid="corp-today-spend" className="bg-card border border-border-light rounded-2xl p-5 sm:p-6">
                <p className="text-text-secondary text-sm mb-1">Spend Today (paid)</p>
                <p className="text-3xl font-heading font-semibold text-text-primary">₹{(today?.today_spend ?? 0).toFixed(2)}</p>
              </div>
              <div data-testid="corp-today-sites" className="bg-card border border-border-light rounded-2xl p-5 sm:p-6">
                <p className="text-text-secondary text-sm mb-1">Active Sites Today</p>
                <p className="text-3xl font-heading font-semibold text-text-primary">{today?.per_site?.length ?? 0}</p>
              </div>
            </div>
            <div className="bg-card border border-border-light rounded-2xl p-4 sm:p-6" data-testid="corp-per-site-table">
              <h3 className="font-heading text-base sm:text-lg font-medium text-text-primary mb-3">Per-site breakdown</h3>
              {(!today?.per_site || today.per_site.length === 0) ? (
                <p data-testid="corp-per-site-empty" className="text-text-secondary text-sm">No orders yet today.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[420px] text-sm">
                    <thead>
                      <tr className="text-left text-text-muted border-b border-border-light">
                        <th className="py-2 pr-4 font-medium">Site</th>
                        <th className="py-2 pr-4 font-medium text-right">Orders</th>
                        <th className="py-2 font-medium text-right">Spend (paid)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {today.per_site.map((row) => (
                        <tr key={row.site_id || 'none'} data-testid={`corp-site-row-${row.site_id || 'none'}`} className="border-b border-border-light/60 last:border-0">
                          <td className="py-2 pr-4 text-text-primary">{row.site_name}</td>
                          <td className="py-2 pr-4 text-right text-text-secondary">{row.orders}</td>
                          <td className="py-2 text-right font-medium text-text-primary">₹{row.spend.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default CorporateAdminDashboard;