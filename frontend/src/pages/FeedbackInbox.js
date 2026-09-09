import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import Navbar from '../components/Navbar';
import { toast } from 'sonner';
import { MessageSquare, Star, AlertCircle, Loader2, CheckCircle2 } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const FeedbackInbox = () => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // all | food | issue | open

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API}/feedback`, { withCredentials: true });
      setItems(data || []);
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Could not load feedback');
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { fetchAll(); }, [fetchAll]);

  const resolve = async (id) => {
    try {
      await axios.patch(`${API}/feedback/${id}/resolve`, {}, { withCredentials: true });
      setItems((prev) => prev.map((x) => (x.id === id ? { ...x, status: 'resolved' } : x)));
      toast.success('Marked as resolved');
    } catch (e) { toast.error('Could not update'); }
  };

  const shown = items.filter((i) => filter === 'all' || (filter === 'open' ? i.status === 'open' : i.kind === filter));
  const fmt = (s) => { try { return new Date(s).toLocaleString(); } catch { return s; } };

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-background pb-24">
        <div className="max-w-3xl mx-auto px-4 pt-6" data-testid="feedback-inbox-page">
          <div className="flex items-center gap-2 mb-1">
            <MessageSquare className="h-6 w-6 text-primary" />
            <h1 className="font-heading text-3xl font-bold text-text-primary">Feedback</h1>
          </div>
          <p className="text-text-secondary text-sm mb-5">What your customers are saying — follow up on the open ones.</p>

          <div className="flex gap-2 mb-5 overflow-x-auto">
            {['all', 'open', 'food', 'issue'].map((f) => (
              <button key={f} data-testid={`feedback-filter-${f}`} onClick={() => setFilter(f)}
                className={`px-4 py-2 rounded-full text-sm font-medium capitalize whitespace-nowrap transition-all ${filter === f ? 'bg-primary text-white' : 'bg-card border border-border-light text-text-secondary'}`}>
                {f}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
          ) : shown.length === 0 ? (
            <div className="text-center py-16 text-text-secondary" data-testid="feedback-empty">No feedback yet.</div>
          ) : (
            <div className="space-y-3">
              {shown.map((f) => (
                <div key={f.id} data-testid={`feedback-item-${f.id}`}
                  className="bg-card border border-border-light rounded-2xl p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      {f.kind === 'food' ? (
                        <span className="flex items-center gap-1 text-amber-500 font-bold">
                          <Star className="h-4 w-4 fill-amber-400 text-amber-400" /> {f.rating}/5
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-red-500 font-semibold capitalize">
                          <AlertCircle className="h-4 w-4" /> {f.category}
                        </span>
                      )}
                      {f.status === 'resolved' && (
                        <span className="text-xs font-medium text-green-600 flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> Resolved</span>
                      )}
                    </div>
                    <span className="text-xs text-text-secondary">{fmt(f.created_at)}</span>
                  </div>
                  {f.item_name && <p className="text-sm font-medium text-text-primary mt-2">{f.item_name}</p>}
                  {f.comment && <p className="text-sm text-text-secondary mt-1">“{f.comment}”</p>}
                  <div className="flex items-center justify-between mt-3">
                    <p className="text-xs text-text-secondary">
                      {f.employee_name || 'Employee'}{f.order_code ? ` · #${f.order_code}` : ''}
                    </p>
                    {f.status !== 'resolved' && (
                      <button data-testid={`feedback-resolve-${f.id}`} onClick={() => resolve(f.id)}
                        className="text-xs font-semibold text-primary hover:underline">Mark resolved</button>
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

export default FeedbackInbox;
