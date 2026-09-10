import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import Navbar from '../../components/Navbar';
import { Package, ScanLine, Maximize2, User, Volume2, VolumeX } from 'lucide-react';
import logger from '../../lib/logger';
import CollectionScanner from '../../components/CollectionScanner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const VendorOrders = () => {
  const [orders, setOrders] = useState([]);
  const [counters, setCounters] = useState([]);
  const [counterFilter, setCounterFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [soundOn, setSoundOn] = useState(() => localStorage.getItem('cravitoo_order_sound') !== 'off');

  useEffect(() => {
    fetchOrders();
    fetchCounters();
  }, []);

  const fetchOrders = async () => {
    try {
      const { data } = await axios.get(`${API}/orders`, { withCredentials: true });
      setOrders(data);
    } catch (error) {
      logger.error('Error fetching orders:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchCounters = async () => {
    try {
      const { data } = await axios.get(`${API}/vendor/counters`, { withCredentials: true });
      setCounters(data || []);
    } catch (error) {
      logger.error('Error fetching counters:', error);
    }
  };

  const visibleOrders = counterFilter
    ? orders.filter((o) => (o.counter || '') === counterFilter)
    : orders;

  const errMsg = (error, fallback) => {
    const d = error?.response?.data?.detail;
    if (typeof d === 'string') return d;
    if (Array.isArray(d)) return d.map((x) => x?.msg || JSON.stringify(x)).join(', ');
    return d?.msg || error?.message || fallback;
  };

  const updateStatus = async (orderId, newStatus) => {
    try {
      await axios.patch(`${API}/orders/${orderId}?status=${newStatus}`, {}, { withCredentials: true });
      fetchOrders();
    } catch (error) {
      logger.error('Error updating order:', error);
      alert(errMsg(error, 'Could not update the order. Please reload and try again.'));
    }
  };

  const markPaid = async (orderId) => {
    if (!window.confirm('Confirm payment received via Physical QR?')) return;
    try {
      await axios.post(`${API}/orders/${orderId}/mark-paid`, { method: 'physical_qr' }, { withCredentials: true });
      fetchOrders();
    } catch (error) {
      alert(errMsg(error, 'Could not mark paid'));
    }
  };

  const markCollected = async (orderId) => {
    if (!window.confirm('Mark this order as collected by the customer?')) return;
    try {
      await axios.patch(`${API}/orders/${orderId}?status=collected`, {}, { withCredentials: true });
      fetchOrders();
    } catch (error) {
      alert(errMsg(error, 'Could not mark collected'));
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
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <div className="flex items-start justify-between flex-wrap gap-3 mb-6 sm:mb-8">
            <h1 className="font-heading text-3xl sm:text-4xl lg:text-5xl tracking-tight sm:tracking-tighter font-semibold text-text-primary">
              Order Management
            </h1>
            <div className="flex flex-wrap gap-2 w-full sm:w-auto">
              <button
                data-testid="toggle-order-sound-btn"
                onClick={() => { const n = !soundOn; setSoundOn(n); localStorage.setItem('cravitoo_order_sound', n ? 'on' : 'off'); }}
                title={soundOn ? 'New-order chime is ON — tap to mute (quiet hours)' : 'New-order chime is OFF — tap to unmute'}
                className={`flex items-center justify-center gap-2 px-4 py-3 rounded-2xl text-sm sm:text-base font-semibold transition-all ${soundOn ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100' : 'bg-slate-100 text-slate-500 border border-slate-200 hover:bg-slate-200'}`}
              >
                {soundOn ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
                <span className="hidden sm:inline">{soundOn ? 'Sound On' : 'Muted'}</span>
              </button>
              <Link
                to="/vendor/kiosk"
                data-testid="enter-kiosk-btn"
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-4 sm:px-5 py-3 rounded-2xl text-sm sm:text-base font-semibold shadow-lg transition-all"
                title="Full-screen counter mode — locks to Scan & Collect"
              >
                <Maximize2 className="h-5 w-5" /> Kiosk Mode
              </Link>
              <button
                data-testid="open-scanner-btn"
                onClick={() => setScannerOpen(true)}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-primary hover:bg-primary-hover text-white px-4 sm:px-5 py-3 rounded-2xl text-sm sm:text-base font-semibold shadow-lg shadow-primary/30 transition-all"
              >
                <ScanLine className="h-5 w-5" /> Scan &amp; Collect
              </button>
            </div>
          </div>

          <CollectionScanner
            open={scannerOpen}
            onClose={() => setScannerOpen(false)}
            onSuccess={() => fetchOrders()}
          />

          {counters.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 mb-5" data-testid="counter-filter-row">
              <span className="text-sm font-medium text-text-secondary mr-1">Counter:</span>
              <button
                data-testid="counter-filter-all"
                onClick={() => setCounterFilter('')}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${counterFilter === '' ? 'bg-primary text-white' : 'bg-card border border-border-light text-text-secondary hover:border-primary/40'}`}
              >
                All counters
              </button>
              {counters.map((c) => (
                <button
                  key={c}
                  data-testid={`counter-filter-${c}`}
                  onClick={() => setCounterFilter(c)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${counterFilter === c ? 'bg-primary text-white' : 'bg-card border border-border-light text-text-secondary hover:border-primary/40'}`}
                >
                  {c}
                </button>
              ))}
            </div>
          )}

          {visibleOrders.length === 0 ? (
            <div data-testid="no-vendor-orders" className="bg-card border border-border-light rounded-xl p-8 sm:p-12 text-center">
              <Package className="h-16 w-16 text-text-muted mx-auto mb-4" />
              <p className="text-text-secondary">{counterFilter ? `No orders for ${counterFilter}` : 'No orders yet'}</p>
            </div>
          ) : (
            <div className="space-y-3 sm:space-y-4">
              {visibleOrders.map((order) => (
                <div key={order.id} data-testid={`vendor-order-detail-${order.id}`} className="bg-card border border-border-light rounded-xl p-4 sm:p-6">
                  <div className="flex flex-wrap justify-between items-start gap-2 mb-4">
                    <div className="min-w-0">
                      <h3 className="font-heading text-base sm:text-lg font-medium text-text-primary mb-1">Order #{order.id.slice(-8)}</h3>
                      {order.collection_code && (
                        <p className="text-xs font-mono font-bold text-primary mb-1" data-testid={`vendor-collection-code-${order.id}`}>
                          {order.collection_code}
                        </p>
                      )}
                      <p className="text-text-secondary text-xs sm:text-sm">{new Date(order.created_at).toLocaleString()}</p>
                      {order.counter && (
                        <span data-testid={`vendor-order-counter-${order.id}`} className="inline-block mt-1 px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-medium">
                          {order.counter}
                        </span>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="font-heading text-lg sm:text-xl font-semibold text-primary">₹{order.total_amount.toFixed(2)}</p>
                      <span className={`inline-block mt-1 px-2 py-0.5 rounded text-[10px] font-medium ${
                        order.payment_status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                      }`}>
                        {order.payment_status === 'paid'
                          ? `Paid · ${order.payment_method === 'physical_qr' ? 'QR' : order.payment_method === 'cash' ? 'Cash' : ''}`
                          : 'Payment Pending'}
                      </span>
                    </div>
                  </div>

                  <div className="mb-4">
                    <div className="flex items-center gap-2 mb-2" data-testid={`vendor-order-employee-${order.id}`}>
                      <User className="h-4 w-4 text-text-muted" />
                      <span className="text-sm font-medium text-text-primary">{order.employee_name || 'Walk-in / Kiosk'}</span>
                      {order.customer_type && (
                        <span data-testid={`vendor-order-customertype-${order.id}`} className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-semibold">
                          Manual · {order.customer_type}
                        </span>
                      )}
                    </div>
                    <ul className="space-y-1" data-testid={`vendor-order-items-${order.id}`}>
                      {order.items.map((item, i) => (
                        <li key={i} className="flex justify-between text-sm">
                          <span className="text-text-primary"><span className="font-semibold">{item.quantity}×</span> {item.name || 'Item'}</span>
                          <span className="text-text-secondary">₹{((item.price || 0) * item.quantity).toFixed(2)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {order.status === 'pending' && (
                      <button
                        onClick={() => updateStatus(order.id, 'confirmed')}
                        data-testid={`confirm-order-${order.id}`}
                        className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200"
                      >
                        Confirm Order
                      </button>
                    )}
                    {order.status === 'confirmed' && (
                      <button
                        onClick={() => updateStatus(order.id, 'preparing')}
                        data-testid={`preparing-order-${order.id}`}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200"
                      >
                        Mark Preparing
                      </button>
                    )}
                    {order.status === 'preparing' && (
                      <button
                        onClick={() => updateStatus(order.id, 'ready')}
                        data-testid={`ready-order-${order.id}`}
                        className="bg-primary hover:bg-primary-hover text-white px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200"
                      >
                        Mark Ready
                      </button>
                    )}
                    {order.status === 'ready' && (
                      <button
                        onClick={() => markCollected(order.id)}
                        data-testid={`collect-order-${order.id}`}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200"
                      >
                        Mark Collected
                      </button>
                    )}
                    {order.payment_status !== 'paid' && order.status !== 'cancelled' && (
                      <button
                        onClick={() => markPaid(order.id)}
                        data-testid={`mark-paid-qr-${order.id}`}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200"
                      >
                        Mark Paid (QR)
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default VendorOrders;