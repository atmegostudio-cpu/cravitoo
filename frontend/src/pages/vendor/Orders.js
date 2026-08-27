import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import Navbar from '../../components/Navbar';
import { Package, ScanLine, Maximize2 } from 'lucide-react';
import logger from '../../lib/logger';
import CollectionScanner from '../../components/CollectionScanner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const VendorOrders = () => {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scannerOpen, setScannerOpen] = useState(false);

  useEffect(() => {
    fetchOrders();
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

  const updateStatus = async (orderId, newStatus) => {
    try {
      await axios.patch(`${API}/orders/${orderId}?status=${newStatus}`, {}, { withCredentials: true });
      fetchOrders();
    } catch (error) {
      logger.error('Error updating order:', error);
    }
  };

  const markPaid = async (orderId) => {
    if (!window.confirm('Confirm payment received via Physical QR?')) return;
    try {
      await axios.post(`${API}/orders/${orderId}/mark-paid`, { method: 'physical_qr' }, { withCredentials: true });
      fetchOrders();
    } catch (error) {
      alert(error.response?.data?.detail || 'Could not mark paid');
    }
  };

  const markCollected = async (orderId) => {
    if (!window.confirm('Mark this order as collected by the customer?')) return;
    try {
      await axios.patch(`${API}/orders/${orderId}?status=collected`, {}, { withCredentials: true });
      fetchOrders();
    } catch (error) {
      alert(error.response?.data?.detail || 'Could not mark collected');
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

          {orders.length === 0 ? (
            <div data-testid="no-vendor-orders" className="bg-card border border-border-light rounded-xl p-8 sm:p-12 text-center">
              <Package className="h-16 w-16 text-text-muted mx-auto mb-4" />
              <p className="text-text-secondary">No orders yet</p>
            </div>
          ) : (
            <div className="space-y-3 sm:space-y-4">
              {orders.map((order) => (
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
                    <p className="text-sm font-medium text-text-primary mb-2">Items: {order.items.length}</p>
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