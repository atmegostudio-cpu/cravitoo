import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useSearchParams } from 'react-router-dom';
import Navbar from '../../components/Navbar';
import { ShoppingCart, Leaf, Plus, Minus } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const EmployeeMenu = () => {
  const [searchParams] = useSearchParams();
  const vendorId = searchParams.get('vendor');
  const [vendors, setVendors] = useState([]);
  const [selectedVendor, setSelectedVendor] = useState(vendorId || '');
  const [menuItems, setMenuItems] = useState([]);
  const [cart, setCart] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchVendors();
  }, []);

  useEffect(() => {
    if (selectedVendor) {
      fetchMenu();
    }
  }, [selectedVendor]);

  const fetchVendors = async () => {
    try {
      const { data } = await axios.get(`${API}/vendors`, { withCredentials: true });
      setVendors(data);
      if (!selectedVendor && data.length > 0) {
        setSelectedVendor(data[0].id);
      }
    } catch (error) {
      console.error('Error fetching vendors:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchMenu = async () => {
    try {
      const { data } = await axios.get(`${API}/menu/${selectedVendor}`, { withCredentials: true });
      setMenuItems(data);
    } catch (error) {
      console.error('Error fetching menu:', error);
    }
  };

  const addToCart = (item) => {
    const existing = cart.find(c => c.id === item.id);
    if (existing) {
      setCart(cart.map(c => c.id === item.id ? { ...c, quantity: c.quantity + 1 } : c));
    } else {
      setCart([...cart, { ...item, quantity: 1 }]);
    }
  };

  const updateQuantity = (itemId, delta) => {
    setCart(cart.map(c => {
      if (c.id === itemId) {
        const newQuantity = c.quantity + delta;
        return newQuantity > 0 ? { ...c, quantity: newQuantity } : null;
      }
      return c;
    }).filter(Boolean));
  };

  const placeOrder = async () => {
    try {
      const orderData = {
        vendor_id: selectedVendor,
        items: cart.map(item => ({
          menu_item_id: item.id,
          quantity: item.quantity,
          price: item.price
        })),
        delivery_type: 'pickup'
      };

      const { data } = await axios.post(`${API}/orders`, orderData, { withCredentials: true });
      
      const origin_url = window.location.origin;
      const checkoutData = { order_id: data.id, origin_url };
      const checkoutRes = await axios.post(`${API}/payments/checkout`, checkoutData, { withCredentials: true });
      
      window.location.href = checkoutRes.data.url;
    } catch (error) {
      console.error('Error placing order:', error);
      alert('Failed to place order');
    }
  };

  const cartTotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

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
                  <div className="flex items-center space-x-2 mb-6">
                    <ShoppingCart className="h-6 w-6 text-primary" />
                    <h3 className="font-heading text-xl font-medium text-text-primary">Your Cart</h3>
                  </div>

                  {cart.length === 0 ? (
                    <p data-testid="empty-cart-message" className="text-text-secondary text-center py-8">Your cart is empty</p>
                  ) : (
                    <>
                      <div className="space-y-4 mb-6">
                        {cart.map((item) => (
                          <div key={item.id} data-testid={`cart-item-${item.id}`} className="flex justify-between items-start pb-4 border-b border-border-light">
                            <div className="flex-1">
                              <p className="font-medium text-text-primary text-sm mb-1">{item.name}</p>
                              <p className="text-text-secondary text-xs">₹{item.price.toFixed(2)}</p>
                            </div>
                            <div className="flex items-center space-x-3">
                              <button
                                onClick={() => updateQuantity(item.id, -1)}
                                data-testid={`decrease-qty-${item.id}`}
                                className="bg-background hover:bg-gray-200 rounded-full p-1 transition-all duration-200"
                              >
                                <Minus className="h-4 w-4 text-text-primary" />
                              </button>
                              <span data-testid={`cart-qty-${item.id}`} className="font-medium text-text-primary">{item.quantity}</span>
                              <button
                                onClick={() => updateQuantity(item.id, 1)}
                                data-testid={`increase-qty-${item.id}`}
                                className="bg-background hover:bg-gray-200 rounded-full p-1 transition-all duration-200"
                              >
                                <Plus className="h-4 w-4 text-text-primary" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="border-t border-border-light pt-4 mb-6">
                        <div className="flex justify-between items-center">
                          <span className="font-heading text-lg font-medium text-text-primary">Total</span>
                          <span data-testid="cart-total" className="font-heading text-2xl font-semibold text-primary">₹{cartTotal.toFixed(2)}</span>
                        </div>
                      </div>

                      <button
                        onClick={placeOrder}
                        data-testid="place-order-btn"
                        className="w-full bg-primary hover:bg-primary-hover text-white py-3 rounded-lg font-medium transition-all duration-200"
                      >
                        Proceed to Checkout
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