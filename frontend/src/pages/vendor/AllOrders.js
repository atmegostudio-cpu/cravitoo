import React, { useState, useEffect, useCallback } from 'react';
import Navbar from '../../components/Navbar';
import axios from 'axios';
import { Store, RefreshCw, User, Package } from 'lucide-react';
import logger from '../../lib/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const STATUS_STYLE = {
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  preparing: 'bg-blue-50 text-blue-700 border-blue-200',
  ready: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  completed: 'bg-gray-50 text-gray-600 border-gray-200',
  collected: 'bg-gray-50 text-gray-600 border-gray-200',
  cancelled: 'bg-red-50 text-red-700 border-red-200',
};

const OUTLET_COLORS = ['bg-primary/10 text-primary border-primary/20', 'bg-purple-50 text-purple-700 border-purple-200', 'bg-teal-50 text-teal-700 border-teal-200', 'bg-orange-50 text-orange-700 border-orange-200', 'bg-pink-50 text-pink-700 border-pink-200'];

const VendorAllOrders = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (silent) => {
    if (silent) setRefreshing(true);
    try {
      const { data: d } = await axios.get(`${API}/vendor/all-outlets-orders`, { withCredentials: true });
      setData(d);
    } catch (error) {
      logger.error('Error fetching all-outlet orders:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => load(true), 15000);
    return () => clearInterval(t);
  }, [load]);

  const outletColor = (vid) => {
    const idx = (data?.outlets || []).findIndex((o) => o.id === vid);
    return OUTLET_COLORS[idx >= 0 ? idx % OUTLET_COLORS.length : 0];
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

  const orders = (data?.orders || []).filter((o) => !filter || o.vendor_id === filter);

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
            <h1 className="font-heading text-3xl sm:text-4xl lg:text-5xl tracking-tight font-semibold text-text-primary flex items-center gap-3">
              <Store className="h-8 w-8 text-primary" /> All Outlets · Live Orders
            </h1>
            <button
              data-testid="all-orders-refresh"
              onClick={() => load(true)}
              className="flex items-center gap-2 text-sm text-text-secondary hover:text-primary border border-border-light rounded-lg px-3 py-2"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>

          <div className="flex flex-wrap gap-2 mb-6" data-testid="all-orders-filters">
            <button
              data-testid="all-orders-filter-all"
              onClick={() => setFilter('')}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border ${filter === '' ? 'bg-primary text-white border-primary' : 'bg-card text-text-secondary border-border-light hover:bg-background'}`}
            >
              All outlets ({data?.orders?.length || 0})
            </button>
            {(data?.outlets || []).map((o) => {
              const count = (data?.orders || []).filter((x) => x.vendor_id === o.id).length;
              return (
                <button
                  key={o.id}
                  data-testid={`all-orders-filter-${o.id}`}
                  onClick={() => setFilter(o.id)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium border ${filter === o.id ? 'bg-primary text-white border-primary' : 'bg-card text-text-secondary border-border-light hover:bg-background'}`}
                >
                  {o.name} ({count})
                </button>
              );
            })}
          </div>

          {orders.length === 0 ? (
            <div className="bg-card border border-border-light rounded-2xl p-12 text-center" data-testid="all-orders-empty">
              <Package className="h-10 w-10 text-text-muted mx-auto mb-3" />
              <p className="text-text-secondary">No orders to show yet.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="all-orders-list">
              {orders.map((o) => (
                <div key={o.id} data-testid={`all-order-${o.id}`} className="bg-card border border-border-light rounded-2xl p-4">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${outletColor(o.vendor_id)}`}>{o.outlet}</span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full border capitalize ${STATUS_STYLE[o.status] || 'bg-gray-50 text-gray-600 border-gray-200'}`}>{o.status || '—'}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-mono font-semibold text-text-primary text-sm">{o.collection_code || '—'}</p>
                    <p className="font-semibold text-text-primary">₹{Number(o.total_amount || 0).toFixed(0)}</p>
                  </div>
                  <p className="text-xs text-text-secondary flex items-center gap-1 mt-1"><User className="h-3 w-3" /> {o.employee_name || 'Guest'}{o.counter ? ` · ${o.counter}` : ''}</p>
                  <p className="text-xs text-text-muted mt-2 line-clamp-2">
                    {(o.items || []).map((it) => `${it.quantity || 1}× ${it.name}`).join(', ') || '—'}
                  </p>
                  {o.created_at && <p className="text-[11px] text-text-muted mt-2">{new Date(o.created_at).toLocaleString()}</p>}
                </div>
              ))}
            </div>
          )}
          <p className="mt-4 text-xs text-text-muted">Auto-refreshes every 15 seconds · showing latest 200 orders across your outlets.</p>
        </div>
      </div>
    </>
  );
};

export default VendorAllOrders;
