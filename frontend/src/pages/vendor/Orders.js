import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Navbar from '../../components/Navbar';
import { Package } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const VendorOrders = () => {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchOrders();
  }, []);

  const fetchOrders = async () => {
    try {
      const { data } = await axios.get(`${API}/orders`, { withCredentials: true });
      setOrders(data);
    } catch (error) {
      console.error('Error fetching orders:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateStatus = async (orderId, newStatus) => {
    try {
      await axios.patch(`${API}/orders/${orderId}?status=${newStatus}`, {}, { withCredentials: true });
      fetchOrders();
    } catch (error) {
      console.error('Error updating order:', error);
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
        <div className="max-w-5xl mx-auto px-6 py-8">
          <h1 className="font-heading text-4xl sm:text-5xl tracking-tighter font-semibold text-text-primary mb-8">
            Order Management
          </h1>

          {orders.length === 0 ? (
            <div data-testid="no-vendor-orders" className="bg-card border border-border-light rounded-xl p-12 text-center">
              <Package className="h-16 w-16 text-text-muted mx-auto mb-4" />
              <p className="text-text-secondary">No orders yet</p>
            </div>
          ) : (
            <div className="space-y-4">
              {orders.map((order) => (
                <div key={order.id} data-testid={`vendor-order-detail-${order.id}`} className="bg-card border border-border-light rounded-xl p-6">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="font-heading text-lg font-medium text-text-primary mb-2">Order #{order.id.slice(-8)}</h3>
                      <p className="text-text-secondary text-sm">{new Date(order.created_at).toLocaleString()}</p>
                    </div>
                    <p className="font-heading text-xl font-semibold text-primary">₹{order.total_amount.toFixed(2)}</p>
                  </div>

                  <div className="mb-4">
                    <p className="text-sm font-medium text-text-primary mb-2">Items: {order.items.length}</p>
                  </div>

                  <div className="flex space-x-3">
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