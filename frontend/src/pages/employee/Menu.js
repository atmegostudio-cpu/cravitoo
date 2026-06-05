import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useSearchParams } from 'react-router-dom';
import Navbar from '../../components/Navbar';
import { ShoppingCart, Leaf, Plus, Minus, Store } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Razorpay checkout helper. Loads the script once, opens the popup, returns
// a promise that resolves with the payment response or rejects on user cancel.
const loadRazorpayScript = () =>
  new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });

const openRazorpayCheckout = ({ keyId, razorpayOrderId, amount, currency, name, email, contact, description }) =>
  new Promise((resolve, reject) => {
    const options = {
      key: keyId,
      amount,          // in paise
      currency,
      name: 'Cravitoo',
      description,
      order_id: razorpayOrderId,
      prefill: { name: name || '', email: email || '', contact: contact || '' },
      theme: { color: '#FF5A1F' },
      handler: (response) => resolve(response),
      modal: { ondismiss: () => reject(new Error('Payment cancelled')) },
    };
    const rzp = new window.Razorpay(options);
    rzp.on('payment.failed', (resp) => reject(new Error(resp.error?.description || 'Payment failed')));
    rzp.open();
  });

const EmployeeMenu = () => {
  const [searchParams] = useSearchParams();
  const vendorId = searchParams.get('vendor');
  const [vendors, setVendors] = useState([]);
  const [selectedVendor, setSelectedVendor] = useState(vendorId || '');
  const [menuItems, setMenuItems] = useState([]);
  // Cart now grouped by vendor: { vendorId: { vendorName, items: [...] } }
  const [cartByVendor, setCartByVendor] = useState(() => {
    try {
      const saved = localStorage.getItem('cravitoo_cart');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchVendors();
  }, []);

  useEffect(() => {
    if (selectedVendor) {
      fetchMenu();
    }
  }, [selectedVendor]);

  useEffect(() => {
    localStorage.setItem('cravitoo_cart', JSON.stringify(cartByVendor));
  }, [cartByVendor]);

  const fetchVendors = async () => {
    try {
      const { data } = await axios.get(`${API}/vendors`, { withCredentials: true });
      setVendors(data);
      if (!selectedVendor && data.length > 0) {
        setSelectedVendor(data[0].id);
      }
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchMenu = async () => {
    try {
      const { data } = await axios.get(`${API}/menu/${selectedVendor}`, { withCredentials: true });
      setMenuItems(data);
    } catch (error) {
      console.error('Error:', error);
    }
  };

  const getCurrentVendor = () => vendors.find(v => v.id === selectedVendor);

  const addToCart = (item) => {
    const vendor = getCurrentVendor();
    if (!vendor) return;
    
    setCartByVendor(prev => {
      const vendorCart = prev[selectedVendor] || { vendorName: vendor.name, items: [] };
      const existing = vendorCart.items.find(i => i.id === item.id);
      const newItems = existing
        ? vendorCart.items.map(i => i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i)
        : [...vendorCart.items, { ...item, quantity: 1 }];
      return { ...prev, [selectedVendor]: { ...vendorCart, items: newItems } };
    });
  };

  const updateQuantity = (vendorId, itemId, delta) => {
    setCartByVendor(prev => {
      const vendorCart = prev[vendorId];
      if (!vendorCart) return prev;
      
      const newItems = vendorCart.items
        .map(i => i.id === itemId ? { ...i, quantity: i.quantity + delta } : i)
        .filter(i => i.quantity > 0);
      
      if (newItems.length === 0) {
        const { [vendorId]: _, ...rest } = prev;
        return rest;
      }
      
      return { ...prev, [vendorId]: { ...vendorCart, items: newItems } };
    });
  };

  const placeOrdersForAllVendors = async () => {
    setSubmitting(true);
    try {
      const allVendorIds = Object.keys(cartByVendor);
      if (allVendorIds.length === 0) return;

      // Place orders for each vendor sequentially
      const orderIds = [];
      for (const vId of allVendorIds) {
        const vendorCart = cartByVendor[vId];
        const orderData = {
          vendor_id: vId,
          items: vendorCart.items.map(item => ({
            menu_item_id: item.id,
            quantity: item.quantity,
            price: item.price
          })),
          delivery_type: 'pickup'
        };
        const { data } = await axios.post(`${API}/orders`, orderData, { withCredentials: true });
        orderIds.push(data.id);
      }

      // Razorpay payment flow for the first order (multi-vendor combined cart
      // creates separate Cravitoo orders but pays in one popup — Phase-2 will
      // add multi-order pay; for now we pay the first order's amount).
      const scriptOk = await loadRazorpayScript();
      if (!scriptOk) {
        alert('Could not load the payment gateway. Please check your internet and try again.');
        return;
      }
      const { data: rzpOrder } = await axios.post(
        `${API}/payments/razorpay/create-order`,
        { order_id: orderIds[0] },
        { withCredentials: true }
      );

      // Clear cart now — even if user cancels payment, the Cravitoo order
      // already exists in pending state and they can retry from /orders.
      setCartByVendor({});
      localStorage.removeItem('cravitoo_cart');

      try {
        const payResp = await openRazorpayCheckout({
          keyId: rzpOrder.key_id,
          razorpayOrderId: rzpOrder.razorpay_order_id,
          amount: rzpOrder.amount,
          currency: rzpOrder.currency,
          description: `Cravitoo Order #${orderIds[0].slice(-8)}`,
        });
        // Verify signature server-side
        await axios.post(
          `${API}/payments/razorpay/verify`,
          {
            razorpay_order_id: payResp.razorpay_order_id,
            razorpay_payment_id: payResp.razorpay_payment_id,
            razorpay_signature: payResp.razorpay_signature,
          },
          { withCredentials: true }
        );
        window.location.href = '/employee/orders';
      } catch (payErr) {
        // User cancelled OR payment failed — order remains in 'pending'. They can retry.
        alert(payErr?.message === 'Payment cancelled'
          ? 'Payment cancelled. You can retry from your Orders page.'
          : `Payment failed: ${payErr?.message || 'please try again'}`);
        window.location.href = '/employee/orders';
      }
    } catch (error) {
      console.error('Error:', error);
      alert(error.response?.data?.detail || 'Failed to place order');
    } finally {
      setSubmitting(false);
    }
  };

  const totalItemsInCart = Object.values(cartByVendor).reduce(
    (sum, vc) => sum + vc.items.reduce((s, i) => s + i.quantity, 0), 0
  );
  
  const grandTotal = Object.values(cartByVendor).reduce(
    (sum, vc) => sum + vc.items.reduce((s, i) => s + (i.price * i.quantity), 0), 0
  );

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
          <div className="mb-8">
            <h1 className="font-heading text-4xl sm:text-5xl tracking-tighter font-semibold text-text-primary mb-4">
              Browse Menu
            </h1>
            
            <div className="flex flex-wrap gap-3">
              {vendors.map((vendor) => (
                <button
                  key={vendor.id}
                  data-testid={`vendor-tab-${vendor.id}`}
                  onClick={() => setSelectedVendor(vendor.id)}
                  className={`px-6 py-3 rounded-lg font-medium transition-all duration-200 ${
                    selectedVendor === vendor.id
                      ? 'bg-primary text-white'
                      : 'bg-card border border-border-light text-text-secondary hover:text-text-primary hover:border-primary'
                  }`}
                >
                  {vendor.name}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {menuItems.map((item) => (
                  <div key={item.id} data-testid={`menu-item-${item.id}`} className="bg-card border border-border-light rounded-xl overflow-hidden hover:shadow-md transition-all duration-200">
                    {item.image_url && (
                      <img src={item.image_url} alt={item.name} className="w-full h-48 object-cover" />
                    )}
                    <div className="p-6">
                      <div className="flex justify-between items-start mb-2">
                        <h3 className="font-heading text-lg font-medium text-text-primary">{item.name}</h3>
                        {item.is_vegetarian && (
                          <Leaf className="h-5 w-5 text-green-600" data-testid="vegetarian-icon" />
                        )}
                      </div>
                      <p className="text-text-secondary text-sm mb-3">{item.description}</p>
                      <div className="flex justify-between items-center">
                        <p className="text-text-primary font-semibold text-lg">₹{item.price.toFixed(2)}</p>
                        <button
                          onClick={() => addToCart(item)}
                          data-testid={`add-to-cart-${item.id}`}
                          className="bg-primary hover:bg-primary-hover text-white px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 flex items-center space-x-2"
                        >
                          <Plus className="h-4 w-4" />
                          <span>Add</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="sticky top-24">
                <div data-testid="cart-section" className="bg-card border border-border-light rounded-xl p-6">
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center space-x-2">
                      <ShoppingCart className="h-6 w-6 text-primary" />
                      <h3 className="font-heading text-xl font-medium text-text-primary">Your Cart</h3>
                    </div>
                    {totalItemsInCart > 0 && (
                      <span data-testid="cart-count" className="bg-primary text-white text-xs font-medium px-2 py-1 rounded-full">
                        {totalItemsInCart}
                      </span>
                    )}
                  </div>

                  {Object.keys(cartByVendor).length === 0 ? (
                    <p data-testid="empty-cart-message" className="text-text-secondary text-center py-8">Your cart is empty</p>
                  ) : (
                    <>
                      {Object.entries(cartByVendor).map(([vId, vCart]) => (
                        <div key={vId} className="mb-4 pb-4 border-b border-border-light last:border-b-0">
                          <div className="flex items-center space-x-2 mb-3">
                            <Store className="h-4 w-4 text-primary" />
                            <p data-testid={`cart-vendor-${vId}`} className="font-medium text-text-primary text-sm">{vCart.vendorName}</p>
                          </div>
                          {vCart.items.map((item) => (
                            <div key={item.id} data-testid={`cart-item-${item.id}`} className="flex justify-between items-start mb-3">
                              <div className="flex-1">
                                <p className="text-text-primary text-sm mb-1">{item.name}</p>
                                <p className="text-text-secondary text-xs">₹{item.price.toFixed(2)}</p>
                              </div>
                              <div className="flex items-center space-x-3">
                                <button
                                  onClick={() => updateQuantity(vId, item.id, -1)}
                                  data-testid={`decrease-qty-${item.id}`}
                                  className="bg-background hover:bg-gray-200 rounded-full p-1 transition-all duration-200"
                                >
                                  <Minus className="h-4 w-4 text-text-primary" />
                                </button>
                                <span data-testid={`cart-qty-${item.id}`} className="font-medium text-text-primary text-sm">{item.quantity}</span>
                                <button
                                  onClick={() => updateQuantity(vId, item.id, 1)}
                                  data-testid={`increase-qty-${item.id}`}
                                  className="bg-background hover:bg-gray-200 rounded-full p-1 transition-all duration-200"
                                >
                                  <Plus className="h-4 w-4 text-text-primary" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ))}

                      <div className="border-t-2 border-border-light pt-4 mb-6">
                        <div className="flex justify-between items-center">
                          <span className="font-heading text-lg font-medium text-text-primary">Total</span>
                          <span data-testid="cart-total" className="font-heading text-2xl font-semibold text-primary">₹{grandTotal.toFixed(2)}</span>
                        </div>
                        {Object.keys(cartByVendor).length > 1 && (
                          <p className="text-xs text-text-muted mt-2">{Object.keys(cartByVendor).length} separate orders will be created</p>
                        )}
                      </div>

                      <button
                        onClick={placeOrdersForAllVendors}
                        disabled={submitting}
                        data-testid="place-order-btn"
                        className="w-full bg-primary hover:bg-primary-hover text-white py-3 rounded-lg font-medium transition-all duration-200 disabled:opacity-50"
                      >
                        {submitting ? 'Processing...' : 'Proceed to Checkout'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default EmployeeMenu;
