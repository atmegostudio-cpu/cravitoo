import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import Navbar from '../../components/Navbar';
import { toast } from 'sonner';
import { UtensilsCrossed, AlertCircle, Loader2, Send, CheckCircle2 } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const FACES = [
  { v: 1, e: '😖', label: 'Awful' },
  { v: 2, e: '😕', label: 'Meh' },
  { v: 3, e: '😐', label: 'Okay' },
  { v: 4, e: '🙂', label: 'Good' },
  { v: 5, e: '😍', label: 'Loved it' },
];
const ISSUES = [
  { v: 'service', label: 'Service' },
  { v: 'hygiene', label: 'Hygiene' },
  { v: 'delay', label: 'Delay' },
  { v: 'billing', label: 'Billing' },
  { v: 'other', label: 'Other' },
];

const EmployeeFeedback = () => {
  const [tab, setTab] = useState('food');
  const [orders, setOrders] = useState([]);
  const [orderId, setOrderId] = useState('');
  const [rating, setRating] = useState(0);
  const [category, setCategory] = useState('');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const fetchOrders = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/orders`, { withCredentials: true });
      setOrders((data || []).slice(0, 12));
    } catch (e) { /* ignore */ }
  }, []);
  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  const reset = () => { setRating(0); setCategory(''); setComment(''); setOrderId(''); setDone(false); };

  const submit = async () => {
    const payload = { kind: tab, comment };
    if (tab === 'food') {
      if (!rating) { toast.error('Tap a face to rate your meal'); return; }
      payload.rating = rating;
      const o = orders.find((x) => x.id === orderId);
      if (orderId) { payload.order_id = orderId; payload.item_name = (o?.items?.[0]?.name) || null; }
    } else {
      if (!category) { toast.error('Pick what went wrong'); return; }
      if (!comment.trim()) { toast.error('Add a short note'); return; }
      payload.category = category;
      if (orderId) payload.order_id = orderId;
    }
    setSubmitting(true);
    try {
      await axios.post(`${API}/feedback`, payload, { withCredentials: true });
      setDone(true);
      toast.success('Thanks! Your feedback was sent 🙌');
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Could not send feedback');
    } finally { setSubmitting(false); }
  };

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-background pb-24">
        <div className="max-w-lg mx-auto px-4 pt-6" data-testid="employee-feedback-page">
          <h1 className="font-heading text-3xl font-bold text-text-primary">Tell us how it went</h1>
          <p className="text-text-secondary text-sm mt-1">Takes a few seconds — it really helps 🙏</p>

          <div className="flex gap-2 mt-5 mb-6">
            <button data-testid="feedback-tab-food" onClick={() => { setTab('food'); reset(); }}
              className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl font-semibold transition-all ${tab === 'food' ? 'bg-primary text-white shadow-lg' : 'bg-card border border-border-light text-text-secondary'}`}>
              <UtensilsCrossed className="h-4 w-4" /> My meal
            </button>
            <button data-testid="feedback-tab-issue" onClick={() => { setTab('issue'); reset(); }}
              className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl font-semibold transition-all ${tab === 'issue' ? 'bg-primary text-white shadow-lg' : 'bg-card border border-border-light text-text-secondary'}`}>
              <AlertCircle className="h-4 w-4" /> Other issue
            </button>
          </div>

          {done ? (
            <div className="bg-card border border-border-light rounded-3xl p-10 text-center animate-in fade-in zoom-in duration-300" data-testid="feedback-success">
              <CheckCircle2 className="h-16 w-16 text-primary mx-auto mb-4" />
              <h2 className="font-heading text-xl font-bold text-text-primary">You're a star!</h2>
              <p className="text-text-secondary text-sm mt-1">Your feedback is on its way to the team.</p>
              <button data-testid="feedback-again-btn" onClick={reset} className="mt-6 px-6 py-3 rounded-xl bg-primary text-white font-semibold">Send another</button>
            </div>
          ) : (
            <div className="bg-card border border-border-light rounded-3xl p-6 space-y-6">
              {tab === 'food' ? (
                <>
                  <div>
                    <p className="font-heading text-lg font-semibold text-text-primary text-center mb-4">How was your meal today?</p>
                    <div className="flex justify-between" data-testid="feedback-faces">
                      {FACES.map((f) => (
                        <button key={f.v} data-testid={`feedback-face-${f.v}`} onClick={() => setRating(f.v)}
                          className={`flex flex-col items-center gap-1 transition-transform ${rating === f.v ? 'scale-125' : 'opacity-50 hover:opacity-100'}`}>
                          <span className="text-3xl">{f.e}</span>
                          <span className="text-[10px] font-medium text-text-secondary">{f.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  {orders.length > 0 && (
                    <div>
                      <label className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Which order? (optional)</label>
                      <div className="flex gap-2 overflow-x-auto pb-1 mt-2" data-testid="feedback-order-chips">
                        {orders.map((o) => (
                          <button key={o.id} data-testid={`feedback-order-${o.id}`} onClick={() => setOrderId(orderId === o.id ? '' : o.id)}
                            className={`whitespace-nowrap px-3 py-2 rounded-xl text-xs font-medium border transition-all ${orderId === o.id ? 'bg-primary text-white border-primary' : 'bg-background border-border-light text-text-secondary'}`}>
                            {(o.items?.[0]?.name) || o.collection_code || 'Order'}{o.items?.length > 1 ? ` +${o.items.length - 1}` : ''}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div>
                  <p className="font-heading text-lg font-semibold text-text-primary mb-3">What went wrong?</p>
                  <div className="grid grid-cols-3 gap-2" data-testid="feedback-issue-cats">
                    {ISSUES.map((c) => (
                      <button key={c.v} data-testid={`feedback-cat-${c.v}`} onClick={() => setCategory(c.v)}
                        className={`py-3 rounded-xl text-sm font-medium border transition-all ${category === c.v ? 'bg-primary text-white border-primary' : 'bg-background border-border-light text-text-secondary'}`}>
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <textarea data-testid="feedback-comment" value={comment} onChange={(e) => setComment(e.target.value)}
                placeholder={tab === 'food' ? 'Anything to add? (optional)' : 'Tell us a bit more…'}
                rows={3} className="w-full rounded-2xl border border-border-light bg-background p-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none" />

              <button data-testid="feedback-submit" onClick={submit} disabled={submitting}
                className="w-full flex items-center justify-center gap-2 bg-primary text-white py-3.5 rounded-2xl font-bold text-base shadow-lg disabled:opacity-50 hover:opacity-90 transition-all">
                {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                {submitting ? 'Sending…' : 'Send feedback'}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default EmployeeFeedback;
