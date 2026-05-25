import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Navbar from '../../components/Navbar';
import { TrendingUp, ShoppingBag, DollarSign } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const VendorDashboard = () => {
  const [analytics, setAnalytics] = useState(null);
  const [recentOrders, setRecentOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [analyticsRes, ordersRes] = await Promise.all([
        axios.get(`${API}/analytics/vendor`, { withCredentials: true }),
        axios.get(`${API}/orders`, { withCredentials: true })
      ]);
      setAnalytics(analyticsRes.data);
      setRecentOrders(ordersRes.data.slice(0, 5));
    } catch (error) {
      console.error('Error fetching data:', error);
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
          <h1 className="font-heading text-4xl sm:text-5xl tracking-tighter font-semibold text-text-primary mb-8">
            Vendor Dashboard
          </h1>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div data-testid="total-orders-card" className="bg-card border border-border-light rounded-2xl p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="bg-primary-light rounded-xl p-3">
                  <ShoppingBag className="h-6 w-6 text-primary" />
                </div>
                <TrendingUp className="h-5 w-5 text-green-500" />
              </div>
              <p className="text-3xl font-heading font-semibold text-text-primary mb-1">{analytics?.total_orders || 0}</p>
              <p className="text-text-secondary text-sm">Total Orders</p>
            </div>

            <div data-testid="total-revenue-card" className="bg-card border border-border-light rounded-2xl p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="bg-green-100 rounded-xl p-3">
                  <DollarSign className="h-6 w-6 text-green-600" />
                </div>
              </div>
              <p className="text-3xl font-heading font-semibold text-text-primary mb-1">₹{analytics?.total_revenue?.toFixed(2) || 0}</p>
              <p className="text-text-secondary text-sm">Total Revenue</p>
            </div>

            <div data-testid="avg-order-card" className="bg-card border border-border-light rounded-2xl p-6">
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
            <h2 className="font-heading text-2xl font-medium text-text-primary mb-4">Recent Orders</h2>
            <div className="space-y-4">
              {recentOrders.map((order) => (
                <div key={order.id} data-testid={`vendor-order-${order.id}`} className="bg-card border border-border-light rounded-xl p-6">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-medium text-text-primary mb-1">Order #{order.id.slice(-8)}</p>
                      <p className="text-text-secondary text-sm">{new Date(order.created_at).toLocaleString()}</p>
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