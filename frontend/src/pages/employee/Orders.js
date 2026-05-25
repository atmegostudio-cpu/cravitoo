import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useSearchParams } from 'react-router-dom';
import Navbar from '../../components/Navbar';
import { Package, Clock, CheckCircle } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const EmployeeOrders = () => {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('session_id');
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [checkingPayment, setCheckingPayment] = useState(!!sessionId);

  useEffect(() => {
    if (sessionId) {
      checkPaymentStatus(sessionId);
    }
    fetchOrders();
  }, []);

  const checkPaymentStatus = async (sessionId) => {
    let attempts = 0;
    const maxAttempts = 5;
    
    const poll = async () => {
      try {
        const { data } = await axios.get(`${API}/payments/status/${sessionId}`, { withCredentials: true });
        
        if (data.payment_status === 'paid') {
          setCheckingPayment(false);
          fetchOrders();
          return;
        }
        
        attempts++;
        if (attempts < maxAttempts) {
          setTimeout(poll, 2000);
        } else {
          setCheckingPayment(false);
        }
      } catch (error) {
        console.error('Error checking payment:', error);
        setCheckingPayment(false);
      }
    };
    
    poll();
  };

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

  const getStatusIcon = (status) => {
    switch (status) {
      case 'confirmed':
        return <CheckCircle className="h-5 w-5 text-green-600" />;
      case 'pending':
        return <Clock className="h-5 w-5 text-yellow-600" />;
      default:
        return <Package className="h-5 w-5 text-blue-600" />;
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
            My Orders
          </h1>

          {checkingPayment && (
            <div data-testid="payment-checking-banner" className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6 flex items-center space-x-3">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
              <p className="text-blue-800 font-medium">Verifying your payment...</p>
            </div>
          )}

          {orders.length === 0 ? (
            <div data-testid="no-orders-state" className="bg-card border border-border-light rounded-xl p-12 text-center">
              <Package className="h-16 w-16 text-text-muted mx-auto mb-4" />
              <h3 className="font-heading text-xl font-medium text-text-primary mb-2">No orders yet</h3>
              <p className="text-text-secondary mb-6">Start exploring our menu to place your first order!</p>
              <a
                href="/employee/menu"
                data-testid="browse-menu-link"
                className="inline-block bg-primary hover:bg-primary-hover text-white px-6 py-3 rounded-lg font-medium transition-all duration-200"
              >
                Browse Menu
              </a>
            </div>
          ) : (
            <div className="space-y-4">
              {orders.map((order) => (
                <div key={order.id} data-testid={`order-${order.id}`} className="bg-card border border-border-light rounded-xl p-6 hover:shadow-md transition-all duration-200">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <div className="flex items-center space-x-3 mb-2">
                        <h3 className="font-heading text-lg font-medium text-text-primary">Order #{order.id.slice(-8)}</h3>
                        {getStatusIcon(order.status)}
                      </div>
                      <p className="text-text-secondary text-sm">
                        {new Date(order.created_at).toLocaleDateString('en-IN', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-heading text-2xl font-semibold text-primary mb-1">₹{order.total_amount.toFixed(2)}</p>
                      <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${
                        order.payment_status === 'paid' ? 'bg-green-100 text-green-700' :
                        'bg-yellow-100 text-yellow-700'
                      }`}>
                        {order.payment_status === 'paid' ? 'Paid' : 'Pending Payment'}
                      </span>
                    </div>
                  </div>

                  <div className="border-t border-border-light pt-4">
                    <p className="text-sm font-medium text-text-primary mb-2">Items:</p>
                    <div className="space-y-2">
                      {order.items.map((item, index) => (
                        <div key={index} className="flex justify-between text-sm">
                          <span className="text-text-secondary">{item.quantity}x Item</span>
                          <span className="text-text-primary">₹{(item.price * item.quantity).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mt-4 pt-4 border-t border-border-light">
                    <div className="flex items-center justify-between">
                      <span className={`px-4 py-2 rounded-lg text-sm font-medium ${
                        order.status === 'confirmed' ? 'bg-green-100 text-green-700' :
                        order.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-blue-100 text-blue-700'
                      }`}>
                        {order.status === 'confirmed' ? 'Order Confirmed' :
                         order.status === 'pending' ? 'Order Pending' :
                         'Processing'}
                      </span>
                      <span className="text-xs text-text-muted capitalize">{order.delivery_type}</span>
                    </div>
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

export default EmployeeOrders;