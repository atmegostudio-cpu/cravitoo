import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Navbar from '../../components/Navbar';
import { TrendingUp, ShoppingBag, DollarSign, IndianRupee, Trophy, Clock } from 'lucide-react';
import logger from '../../lib/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const VendorDashboard = () => {
  const [analytics, setAnalytics] = useState(null);
  const [today, setToday] = useState(null);
  const [recentOrders, setRecentOrders] = useState([]);
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [analyticsRes, todayRes, ordersRes] = await Promise.all([
        axios.get(`${API}/analytics/vendor`, { withCredentials: true }),
        axios.get(`${API}/analytics/vendor/today`, { withCredentials: true }),
        axios.get(`${API}/orders`, { withCredentials: true })
      ]);
      setAnalytics(analyticsRes.data);
      setToday(todayRes.data);
      setRecentOrders(ordersRes.data.slice(0, 5));
      axios.get(`${API}/vendor/outlets-overview`, { withCredentials: true }).then((r) => setOverview(r.data)).catch(() => {});
    } catch (error) {
      logger.error('Error fetching data:', error);
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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <h1 className="font-heading text-3xl sm:text-4xl lg:text-5xl tracking-tight sm:tracking-tighter font-semibold text-text-primary mb-6 sm:mb-8">
            Vendor Dashboard
          </h1>

          {overview && overview.outlets && overview.outlets.length > 1 && (
            <div data-testid="outlets-overview" className="mb-8 bg-card border border-border-light rounded-2xl p-5 sm:p-6">
              <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
                <h2 className="font-heading text-lg font-semibold text-text-primary">All outlets · today</h2>
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-text-secondary">Orders <b data-testid="overview-total-orders" className="text-text-primary">{overview.total_orders}</b></span>
                  <span className="text-text-secondary">Revenue <b data-testid="overview-total-revenue" className="text-text-primary">₹{Number(overview.total_revenue).toFixed(0)}</b></span>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {overview.outlets.map((o) => (
                  <div key={o.vendor_id} data-testid={`overview-outlet-${o.vendor_id}`}
                    className={`rounded-xl border p-4 ${o.active ? 'border-primary bg-primary/5' : 'border-border-light bg-background/60'}`}>
                    <div className="flex items-center justify-between mb-2">
                      <p className="font-medium text-text-primary text-sm truncate">{o.name}</p>
                      {o.active && <span className="text-[10px] font-semibold text-primary uppercase tracking-wider">Active</span>}
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-1 text-text-secondary"><ShoppingBag className="h-3.5 w-3.5" /> {o.orders}</span>
                      <span className="flex items-center gap-1 text-text-secondary"><IndianRupee className="h-3.5 w-3.5" /> {Number(o.revenue).toFixed(0)}</span>
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-text-muted">Use the outlet switcher in the top bar to manage a specific outlet.</p>
            </div>
          )}

          <div data-testid="today-command-center" className="mb-6 sm:mb-8">
            <h2 className="font-heading text-lg sm:text-xl font-medium text-text-primary mb-3 sm:mb-4">Today at a Glance</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
              <div data-testid="today-sales-card" className="bg-card border border-border-light rounded-2xl p-5 sm:p-6">
                <div className="flex items-center gap-3 mb-3">
                  <div className="bg-primary-light rounded-xl p-2.5">
                    <IndianRupee className="h-5 w-5 text-primary" />
                  </div>
                  <p className="text-text-secondary text-sm font-medium">Today's Sales</p>
                </div>
                <p data-testid="today-sales-amount" className="text-3xl font-heading font-semibold text-text-primary mb-1">
                  ₹{(today?.today_revenue ?? 0).toFixed(2)}
                </p>
                <p className="text-text-secondary text-xs">
                  {today?.today_paid_orders ?? 0} paid · {today?.today_orders ?? 0} orders today
                </p>
              </div>

              <div data-testid="today-top-item-card" className="bg-card border border-border-light rounded-2xl p-5 sm:p-6">
                <div className="flex items-center gap-3 mb-3">
                  <div className="bg-accent-light rounded-xl p-2.5">
                    <Trophy className="h-5 w-5 text-accent-hover" />
                  </div>
                  <p className="text-text-secondary text-sm font-medium">Top Item Today</p>
                </div>
                {today?.top_item ? (
                  <>
                    <p data-testid="today-top-item-name" className="text-xl font-heading font-semibold text-text-primary mb-1 truncate">
                      {today.top_item.name}
                    </p>
                    <p className="text-text-secondary text-xs">{today.top_item.quantity} sold</p>
                  </>
                ) : (
                  <p data-testid="today-top-item-empty" className="text-text-secondary text-sm mt-2">No orders yet today</p>
                )}
              </div>

              <div data-testid="pending-payments-card" className="bg-card border border-border-light rounded-2xl p-5 sm:p-6">
                <div className="flex items-center gap-3 mb-3">
                  <div className="bg-yellow-100 rounded-xl p-2.5">
                    <Clock className="h-5 w-5 text-yellow-600" />
                  </div>
                  <p className="text-text-secondary text-sm font-medium">Pending Payments</p>
                </div>
                <p data-testid="pending-payments-amount" className="text-3xl font-heading font-semibold text-text-primary mb-1">
                  ₹{(today?.pending_amount ?? 0).toFixed(2)}
                </p>
                <p className="text-text-secondary text-xs">{today?.pending_count ?? 0} order(s) to collect</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-6 mb-6 sm:mb-8">
            <div data-testid="total-orders-card" className="bg-card border border-border-light rounded-2xl p-5 sm:p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="bg-primary-light rounded-xl p-3">
                  <ShoppingBag className="h-6 w-6 text-primary" />
                </div>
                <TrendingUp className="h-5 w-5 text-green-500" />
              </div>
              <p className="text-3xl font-heading font-semibold text-text-primary mb-1">{analytics?.total_orders || 0}</p>
              <p className="text-text-secondary text-sm">Total Orders</p>
            </div>

            <div data-testid="total-revenue-card" className="bg-card border border-border-light rounded-2xl p-5 sm:p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="bg-green-100 rounded-xl p-3">
                  <DollarSign className="h-6 w-6 text-green-600" />
                </div>
              </div>
              <p className="text-3xl font-heading font-semibold text-text-primary mb-1">₹{analytics?.total_revenue?.toFixed(2) || 0}</p>
              <p className="text-text-secondary text-sm">Total Revenue</p>
            </div>

            <div data-testid="avg-order-card" className="bg-card border border-border-light rounded-2xl p-5 sm:p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="bg-accent-light rounded-xl p-3">
                  <TrendingUp className="h-6 w-6 text-accent-hover" />
                </div>
              </div>
              <p className="text-3xl font-heading font-semibold text-text-primary mb-1">₹{analytics?.average_order_value?.toFixed(2) || 0}</p>
              <p className="text-text-secondary text-sm">Avg Order Value</p>
            </div>
          </div>

          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <h2 className="font-heading text-xl sm:text-2xl font-medium text-text-primary">Recent Orders</h2>
              <a
                href="/vendor/reports"
                data-testid="vendor-reports-link"
                className="text-sm text-primary hover:text-primary-hover font-medium underline underline-offset-2"
              >
                View Sales Report →
              </a>
            </div>
            <div className="space-y-3 sm:space-y-4">
              {recentOrders.map((order) => (
                <div key={order.id} data-testid={`vendor-order-${order.id}`} className="bg-card border border-border-light rounded-xl p-4 sm:p-6">
                  <div className="flex flex-wrap justify-between items-start gap-2">
                    <div>
                      <p className="font-medium text-text-primary mb-1">Order #{order.id.slice(-8)}</p>
                      <p className="text-text-secondary text-xs sm:text-sm">{new Date(order.created_at).toLocaleString()}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-text-primary mb-2">₹{order.total_amount.toFixed(2)}</p>
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                        order.status === 'confirmed' ? 'bg-green-100 text-green-700' :
                        'bg-yellow-100 text-yellow-700'
                      }`}>
                        {order.status}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default VendorDashboard;