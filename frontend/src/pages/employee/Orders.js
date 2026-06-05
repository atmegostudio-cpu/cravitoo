import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Navbar from '../../components/Navbar';
import { Package, Clock, CheckCircle, QrCode, Star, XCircle } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const EmployeeOrders = () => {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showQRFor, setShowQRFor] = useState(null);
  const [reviewFor, setReviewFor] = useState(null);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [reviewMessage, setReviewMessage] = useState('');

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

  const submitReview = async (order) => {
    try {
      await axios.post(
        `${API}/reviews`,
        {
          vendor_id: order.vendor_id,
          order_id: order.id,
          rating: rating,
          comment: comment
        },
        { withCredentials: true }
      );
      setReviewMessage('Review submitted!');
      setReviewFor(null);
      setComment('');
      setRating(5);
      setTimeout(() => setReviewMessage(''), 3000);
    } catch (error) {
      setReviewMessage(error.response?.data?.detail || 'Failed to submit review');
    }
  };

  const cancelOrder = async (order) => {
    const msg = order.payment_status === 'paid'
      ? `Cancel order #${order.id.slice(-8)}? You'll receive a refund of ₹${order.total_amount.toFixed(2)} within 5–7 business days.`
      : `Cancel order #${order.id.slice(-8)}?`;
    if (!window.confirm(msg)) return;
    try {
      const { data } = await axios.post(`${API}/orders/${order.id}/cancel`, {}, { withCredentials: true });
      setReviewMessage(data.refund_status ? `Cancelled. Refund: ${data.refund_status}` : 'Order cancelled.');
      setTimeout(() => setReviewMessage(''), 4000);
      fetchOrders();
    } catch (e) {
      alert(e?.response?.data?.detail || 'Could not cancel order');
    }
  };

  const isCancellable = (order) => {
    if (order.status !== 'pending') return false;
    const elapsed = Date.now() - new Date(order.created_at).getTime();
    return elapsed < 5 * 60 * 1000;
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

          {reviewMessage && (
            <div data-testid="review-message" className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700">
              {reviewMessage}
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
                        <div key={item.menu_item_id || `${order.id}-${index}`} className="flex justify-between text-sm">
                          <span className="text-text-secondary">{item.quantity}x {item.name || 'Item'}</span>
                          <span className="text-text-primary">₹{(item.price * item.quantity).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mt-4 pt-4 border-t border-border-light">
                    <div className="flex items-center justify-between flex-wrap gap-3">
                      <span className={`px-4 py-2 rounded-lg text-sm font-medium ${
                        order.status === 'confirmed' ? 'bg-green-100 text-green-700' :
                        order.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                        order.status === 'ready' ? 'bg-primary-light text-primary' :
                        order.status === 'completed' ? 'bg-gray-100 text-gray-700' :
                        'bg-blue-100 text-blue-700'
                      }`}>
                        {order.status === 'confirmed' ? 'Order Confirmed' :
                         order.status === 'pending' ? 'Order Pending' :
                         order.status === 'ready' ? 'Ready for Pickup' :
                         order.status === 'completed' ? 'Completed' :
                         order.status === 'preparing' ? 'Preparing' :
                         'Processing'}
                      </span>
                      
                      <div className="flex gap-2">
                        {(order.status === 'ready' || order.status === 'confirmed') && order.pickup_qr && (
                          <button
                            onClick={() => setShowQRFor(showQRFor === order.id ? null : order.id)}
                            data-testid={`qr-btn-${order.id}`}
                            className="flex items-center space-x-2 bg-primary hover:bg-primary-hover text-white px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200"
                          >
                            <QrCode className="h-4 w-4" />
                            <span>Pickup QR</span>
                          </button>
                        )}
                        {(order.status === 'completed' || order.status === 'ready') && (
                          <button
                            onClick={() => setReviewFor(reviewFor === order.id ? null : order.id)}
                            data-testid={`review-btn-${order.id}`}
                            className="flex items-center space-x-2 bg-accent-hover hover:bg-accent text-white px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200"
                          >
                            <Star className="h-4 w-4" />
                            <span>Review</span>
                          </button>
                        )}
                        {isCancellable(order) && (
                          <button
                            onClick={() => cancelOrder(order)}
                            data-testid={`cancel-btn-${order.id}`}
                            className="flex items-center space-x-2 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200"
                          >
                            <XCircle className="h-4 w-4" />
                            <span>Cancel</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {showQRFor === order.id && order.pickup_qr && (
                    <div data-testid={`qr-display-${order.id}`} className="mt-4 p-6 bg-gradient-to-br from-primary-light to-accent-light rounded-xl text-center">
                      <p className="text-sm text-text-secondary mb-2">Show this QR code at pickup:</p>
                      <div className="bg-white p-4 rounded-lg inline-block mb-2">
                        <img
                          src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(order.pickup_qr)}`}
                          alt="Pickup QR Code"
                          className="w-48 h-48"
                        />
                      </div>
                      <p className="text-xs text-text-muted font-mono mt-2 break-all">{order.pickup_qr}</p>
                    </div>
                  )}

                  {reviewFor === order.id && (
                    <div data-testid={`review-form-${order.id}`} className="mt-4 p-6 bg-background rounded-xl">
                      <h4 className="font-heading text-lg font-medium text-text-primary mb-3">Write a Review</h4>
                      
                      <div className="mb-4">
                        <label className="text-sm font-medium text-text-primary block mb-2">Rating</label>
                        <div className="flex space-x-2">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <button
                              key={star}
                              data-testid={`rating-${star}`}
                              onClick={() => setRating(star)}
                              className="transition-all duration-200 hover:scale-110"
                            >
                              <Star
                                className={`h-8 w-8 ${
                                  star <= rating ? 'fill-accent text-accent-hover' : 'text-text-muted'
                                }`}
                              />
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="mb-4">
                        <label className="text-sm font-medium text-text-primary block mb-2">Comment (optional)</label>
                        <textarea
                          data-testid="review-comment"
                          value={comment}
                          onChange={(e) => setComment(e.target.value)}
                          className="w-full px-4 py-3 border border-border-light rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary bg-card"
                          rows="3"
                          placeholder="Share your experience..."
                        />
                      </div>

                      <div className="flex space-x-2">
                        <button
                          onClick={() => submitReview(order)}
                          data-testid={`submit-review-${order.id}`}
                          className="bg-primary hover:bg-primary-hover text-white px-6 py-2 rounded-lg font-medium transition-all duration-200"
                        >
                          Submit Review
                        </button>
                        <button
                          onClick={() => setReviewFor(null)}
                          className="bg-background border border-border-light text-text-secondary hover:text-text-primary px-6 py-2 rounded-lg font-medium transition-all duration-200"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
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
