import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { UserRound, Plus, Minus, ClipboardList, CheckCircle2, Loader2, ShoppingCart, Search } from 'lucide-react';
import Navbar from '../../components/Navbar';
import { useAuth } from '../../context/AuthContext';
import logger from '../../lib/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function VendorManualOrder() {
  const { user } = useAuth();
  const [types, setTypes] = useState([]);
  const [menu, setMenu] = useState([]);
  const [selectedType, setSelectedType] = useState('');
  const [cart, setCart] = useState({});          // { itemId: qty }
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState(null);   // success payload

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [t, m] = await Promise.all([
        axios.get(`${API}/customer-types`, { withCredentials: true }),
        axios.get(`${API}/menu/${user?.vendor_id}`, { withCredentials: true }),
      ]);
      setTypes(t.data || []);
      setMenu((m.data || []).filter((i) => i.is_available !== false));
    } catch (err) {
      logger.error('Manual order load failed', err);
      setError(err?.response?.data?.detail || 'Could not load menu / customer types');
    } finally {
      setLoading(false);
    }
  }, [user?.vendor_id]);

  useEffect(() => { if (user?.vendor_id) fetchAll(); }, [fetchAll, user?.vendor_id]);

  const menuById = useMemo(() => Object.fromEntries(menu.map((i) => [i.id, i])), [menu]);
  const filteredMenu = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? menu.filter((i) => (i.name || '').toLowerCase().includes(q)) : menu;
  }, [menu, query]);

  const setQty = (id, delta) => setCart((c) => {
    const next = { ...c };
    const q = (next[id] || 0) + delta;
    if (q <= 0) delete next[id]; else next[id] = q;
    return next;
  });

  const cartItems = Object.entries(cart).map(([id, qty]) => ({ item: menuById[id], qty })).filter((x) => x.item);
  const total = cartItems.reduce((s, { item, qty }) => s + Number(item.price || 0) * qty, 0);
  const canSubmit = selectedType && cartItems.length > 0 && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');
    try {
      const { data } = await axios.post(`${API}/vendor/manual-order`, {
        customer_type: selectedType,
        items: cartItems.map(({ item, qty }) => ({ menu_item_id: item.id, quantity: qty, price: Number(item.price || 0) })),
        mark_paid: true,
        payment_method: 'physical_qr',
      }, { withCredentials: true });
      setReceipt(data);
      setCart({});
      setQuery('');
    } catch (err) {
      setError(err?.response?.data?.detail || 'Could not punch the order');
    } finally {
      setSubmitting(false);
    }
  };

  const newOrder = () => { setReceipt(null); setSelectedType(''); setError(''); };

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-background" data-testid="manual-order-page">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
          <div className="flex items-center gap-3 mb-1">
            <div className="rounded-xl bg-primary/10 p-2"><ClipboardList className="h-6 w-6 text-primary" /></div>
            <h1 className="font-heading text-3xl sm:text-4xl font-bold text-text-primary">Manual Order</h1>
          </div>
          <p className="text-text-secondary text-sm mb-8">Punch a counter order for a walk-in customer with no corporate email. Payment is collected on your counter UPI / QR.</p>

          {error && <div data-testid="manual-order-error" className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}

          {receipt ? (
            <div data-testid="manual-order-receipt" className="bg-card border border-border-light rounded-2xl p-8 text-center max-w-md mx-auto">
              <div className="w-20 h-20 mx-auto rounded-full bg-emerald-100 flex items-center justify-center mb-5">
                <CheckCircle2 className="h-11 w-11 text-emerald-600" />
              </div>
              <h2 className="font-heading text-2xl font-bold text-text-primary mb-1">Order Punched</h2>
              <p className="text-text-secondary text-sm mb-4">{receipt.customer_type} · marked paid</p>
              <div className="rounded-xl bg-background py-4 mb-2">
                <p className="text-xs uppercase tracking-widest text-text-muted mb-1">Collection Code</p>
                <p data-testid="manual-order-code" className="font-mono text-3xl font-bold text-primary">{receipt.collection_code}</p>
              </div>
              <p className="font-mono text-lg font-semibold text-text-primary mb-6">{inr(receipt.total_amount)}</p>
              <button data-testid="manual-order-new-btn" onClick={newOrder}
                className="w-full bg-primary hover:bg-primary-hover text-white px-6 py-3 rounded-xl font-semibold transition-colors">
                New Manual Order
              </button>
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center py-20 text-text-muted"><Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading…</div>
          ) : (
            <div className="grid lg:grid-cols-3 gap-6">
              {/* Left: type + menu */}
              <div className="lg:col-span-2 space-y-6">
                <div className="bg-card border border-border-light rounded-2xl p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <UserRound className="h-5 w-5 text-primary" />
                    <h2 className="font-heading text-lg font-semibold text-text-primary">Customer type</h2>
                  </div>
                  <div className="flex flex-wrap gap-2" data-testid="manual-order-types">
                    {types.map((t) => (
                      <button key={t.id} data-testid={`manual-type-${t.id}`} onClick={() => setSelectedType(t.name)}
                        className={`px-4 py-2 rounded-full text-sm font-medium border transition-colors ${selectedType === t.name ? 'bg-primary text-white border-primary' : 'bg-card text-text-secondary border-border-light hover:border-primary/40'}`}>
                        {t.name}
                      </button>
                    ))}
                    {types.length === 0 && <span className="text-text-muted text-sm">No customer types configured.</span>}
                  </div>
                </div>

                <div className="bg-card border border-border-light rounded-2xl overflow-hidden">
                  <div className="p-4 border-b border-border-light flex items-center gap-2">
                    <Search className="h-4 w-4 text-text-muted" />
                    <input data-testid="manual-order-search" value={query} onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search your menu…"
                      className="w-full bg-transparent text-sm focus:outline-none text-text-primary" />
                  </div>
                  <div className="divide-y divide-border-light max-h-[420px] overflow-y-auto">
                    {filteredMenu.map((i) => (
                      <div key={i.id} data-testid={`manual-menu-item-${i.id}`} className="flex items-center justify-between px-4 py-3 gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-text-primary truncate">{i.name}</p>
                          <p className="text-xs text-text-muted">{inr(i.price)}{i.counter ? ` · ${i.counter}` : ''}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button data-testid={`manual-minus-${i.id}`} onClick={() => setQty(i.id, -1)} disabled={!cart[i.id]}
                            className="h-8 w-8 rounded-full border border-border-light flex items-center justify-center text-text-secondary disabled:opacity-30 hover:border-primary/40">
                            <Minus className="h-4 w-4" />
                          </button>
                          <span data-testid={`manual-qty-${i.id}`} className="w-6 text-center text-sm font-semibold text-text-primary">{cart[i.id] || 0}</span>
                          <button data-testid={`manual-plus-${i.id}`} onClick={() => setQty(i.id, 1)}
                            className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center hover:bg-primary/20">
                            <Plus className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                    {filteredMenu.length === 0 && <div className="p-8 text-center text-text-muted text-sm">No menu items found.</div>}
                  </div>
                </div>
              </div>

              {/* Right: cart summary */}
              <div className="lg:col-span-1">
                <div className="bg-card border border-border-light rounded-2xl p-5 lg:sticky lg:top-24" data-testid="manual-order-summary">
                  <div className="flex items-center gap-2 mb-4">
                    <ShoppingCart className="h-5 w-5 text-primary" />
                    <h2 className="font-heading text-lg font-semibold text-text-primary">Order</h2>
                  </div>
                  {cartItems.length === 0 ? (
                    <p className="text-text-muted text-sm py-6 text-center">Add items from the menu.</p>
                  ) : (
                    <div className="space-y-2 mb-4">
                      {cartItems.map(({ item, qty }) => (
                        <div key={item.id} className="flex justify-between text-sm">
                          <span className="text-text-secondary">{qty}× {item.name}</span>
                          <span className="font-mono text-text-primary">{inr(item.price * qty)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex justify-between items-center border-t border-border-light pt-4 mb-1">
                    <span className="text-sm font-semibold text-text-primary">Total</span>
                    <span data-testid="manual-order-total" className="font-mono text-xl font-bold text-primary">{inr(total)}</span>
                  </div>
                  <p className="text-xs text-text-muted mb-4">{selectedType ? `For: ${selectedType}` : 'Select a customer type above'}</p>
                  <button data-testid="manual-order-submit" onClick={submit} disabled={!canSubmit}
                    className="w-full bg-primary hover:bg-primary-hover disabled:opacity-40 text-white px-6 py-3 rounded-xl font-semibold flex items-center justify-center gap-2 transition-colors">
                    {submitting ? <><Loader2 className="h-5 w-5 animate-spin" /> Punching…</> : <><CheckCircle2 className="h-5 w-5" /> Complete Order</>}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
