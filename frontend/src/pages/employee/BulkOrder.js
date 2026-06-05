import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Navbar from '../../components/Navbar';
import { Users, Plus, Trash2, Send, Sparkles } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const BulkOrder = () => {
  const [vendors, setVendors] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [selectedVendor, setSelectedVendor] = useState('');
  // Stable unique IDs so React can correctly track persons across add/remove.
  // Index-as-key would cause state to mis-attach when a middle person is removed.
  const newPersonUid = () => `p_${Math.random().toString(36).slice(2)}_${Date.now()}`;
  const [orders, setOrders] = useState([{ _uid: newPersonUid(), user_email: '', items: [] }]);
  const [sponsored, setSponsored] = useState(false);
  const [occasion, setOccasion] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchVendors();
  }, []);

  useEffect(() => {
    if (selectedVendor) fetchMenu();
  }, [selectedVendor]);

  const fetchVendors = async () => {
    try {
      const { data } = await axios.get(`${API}/vendors`, { withCredentials: true });
      setVendors(data);
      if (data.length > 0) setSelectedVendor(data[0].id);
    } catch (error) {
      console.error('Error:', error);
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

  const addPerson = () => {
    setOrders([...orders, { _uid: newPersonUid(), user_email: '', items: [] }]);
  };

  const removePerson = (idx) => {
    setOrders(orders.filter((_, i) => i !== idx));
  };

  const updatePersonEmail = (idx, email) => {
    const newOrders = [...orders];
    newOrders[idx].user_email = email;
    setOrders(newOrders);
  };

  const toggleItemForPerson = (orderIdx, itemId) => {
    const newOrders = [...orders];
    const existingIdx = newOrders[orderIdx].items.findIndex(i => i.menu_item_id === itemId);
    if (existingIdx >= 0) {
      newOrders[orderIdx].items.splice(existingIdx, 1);
    } else {
      const menuItem = menuItems.find(m => m.id === itemId);
      newOrders[orderIdx].items.push({
        menu_item_id: itemId,
        quantity: 1,
        price: menuItem.price
      });
    }
    setOrders(newOrders);
  };

  const updateItemQuantity = (orderIdx, itemId, delta) => {
    const newOrders = [...orders];
    const item = newOrders[orderIdx].items.find(i => i.menu_item_id === itemId);
    if (item) {
      item.quantity = Math.max(1, item.quantity + delta);
    }
    setOrders(newOrders);
  };

  const submitBulkOrder = async () => {
    setSubmitting(true);
    try {
      const validOrders = orders.filter(o => o.user_email && o.items.length > 0);
      if (validOrders.length === 0) {
        setMessage('Add at least one valid order');
        setSubmitting(false);
        return;
      }
      const { data } = await axios.post(
        `${API}/orders/bulk`,
        {
          vendor_id: selectedVendor,
          orders: validOrders,
          delivery_type: 'pickup',
          sponsored: sponsored,
          occasion: occasion || null
        },
        { withCredentials: true }
      );
      setMessage(`Bulk order created! ${data.orders.length} orders, total ₹${data.total_amount.toFixed(2)}`);
      setOrders([{ _uid: newPersonUid(), user_email: '', items: [] }]);
      setOccasion('');
      setTimeout(() => setMessage(''), 5000);
    } catch (error) {
      setMessage(error.response?.data?.detail || 'Failed to create bulk order');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-background">
        <div className="max-w-6xl mx-auto px-6 py-8">
          <div className="flex items-center space-x-3 mb-2">
            <Users className="h-8 w-8 text-primary" />
            <h1 className="font-heading text-4xl sm:text-5xl tracking-tighter font-semibold text-text-primary">
              Bulk Team Order
            </h1>
          </div>
          <p className="text-text-secondary text-lg mb-8">
            Order meals for the whole team in one go
          </p>

          {message && (
            <div data-testid="bulk-message" className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700">
              {message}
            </div>
          )}

          <div className="bg-card border border-border-light rounded-2xl p-6 mb-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">Vendor</label>
                <select
                  data-testid="bulk-vendor-select"
                  value={selectedVendor}
                  onChange={(e) => setSelectedVendor(e.target.value)}
                  className="w-full px-4 py-3 border border-border-light rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary bg-background"
                >
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">Occasion (optional)</label>
                <input
                  type="text"
                  data-testid="bulk-occasion-input"
                  value={occasion}
                  onChange={(e) => setOccasion(e.target.value)}
                  placeholder="e.g., Friday Team Lunch, Project Celebration"
                  className="w-full px-4 py-3 border border-border-light rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary bg-background"
                />
              </div>
            </div>
            <label className="flex items-center space-x-2 cursor-pointer">
              <input
                type="checkbox"
                data-testid="bulk-sponsored-checkbox"
                checked={sponsored}
                onChange={(e) => setSponsored(e.target.checked)}
                className="w-4 h-4 text-primary rounded focus:ring-primary"
              />
              <span className="text-text-primary flex items-center space-x-2">
                <Sparkles className="h-4 w-4 text-accent-hover" />
                <span>Company-sponsored (auto-confirm & paid)</span>
              </span>
            </label>
          </div>

          <div className="space-y-4 mb-6">
            {orders.map((order, idx) => (
              <div key={order._uid || idx} data-testid={`bulk-person-${idx}`} className="bg-card border border-border-light rounded-2xl p-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-heading text-lg font-medium text-text-primary">Person {idx + 1}</h3>
                  {orders.length > 1 && (
                    <button onClick={() => removePerson(idx)} data-testid={`remove-person-${idx}`} className="text-text-secondary hover:text-red-600">
                      <Trash2 className="h-5 w-5" />
                    </button>
                  )}
                </div>

                <div className="mb-4">
                  <label className="block text-sm font-medium text-text-primary mb-2">Employee Email</label>
                  <input
                    type="email"
                    data-testid={`person-email-${idx}`}
                    value={order.user_email}
                    onChange={(e) => updatePersonEmail(idx, e.target.value)}
                    placeholder="employee@company.com"
                    className="w-full px-4 py-3 border border-border-light rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary bg-background"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                  {menuItems.map((item) => {
                    const selected = order.items.find(i => i.menu_item_id === item.id);
                    return (
                      <div
                        key={item.id}
                        className={`border-2 rounded-lg p-3 transition-all duration-200 ${
                          selected ? 'border-primary bg-primary-light/50' : 'border-border-light bg-background hover:border-primary/50'
                        }`}
                      >
                        <button
                          onClick={() => toggleItemForPerson(idx, item.id)}
                          data-testid={`person-${idx}-item-${item.id}`}
                          className="w-full text-left"
                        >
                          <p className="font-medium text-text-primary text-sm">{item.name}</p>
                          <p className="text-xs text-primary">₹{item.price.toFixed(2)}</p>
                        </button>
                        {selected && (
                          <div className="flex items-center justify-between mt-2 pt-2 border-t border-border-light">
                            <button onClick={() => updateItemQuantity(idx, item.id, -1)} className="text-text-secondary hover:text-primary text-sm">-</button>
                            <span className="text-text-primary text-sm font-medium">{selected.quantity}</span>
                            <button onClick={() => updateItemQuantity(idx, item.id, 1)} className="text-text-secondary hover:text-primary text-sm">+</button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="flex space-x-3">
            <button onClick={addPerson} data-testid="add-person-btn" className="bg-background border border-primary text-primary hover:bg-primary-light px-6 py-3 rounded-lg font-medium transition-all duration-200 flex items-center space-x-2">
              <Plus className="h-5 w-5" />
              <span>Add Person</span>
            </button>
            <button
              onClick={submitBulkOrder}
              disabled={submitting}
              data-testid="submit-bulk-btn"
              className="flex-1 bg-primary hover:bg-primary-hover text-white py-3 rounded-lg font-medium transition-all duration-200 flex items-center justify-center space-x-2 disabled:opacity-50"
            >
              <Send className="h-5 w-5" />
              <span>{submitting ? 'Submitting...' : 'Submit Bulk Order'}</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default BulkOrder;
