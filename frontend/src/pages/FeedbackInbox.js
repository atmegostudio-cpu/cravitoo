import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import Navbar from '../components/Navbar';
import { toast } from 'sonner';
import { MessageSquare, Star, AlertCircle, Loader2, CheckCircle2, AlertTriangle, TrendingUp, Inbox } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const ISSUE_LABELS = { service: 'Service', hygiene: 'Hygiene', delay: 'Delay', billing: 'Billing', other: 'Other' };

const StatCard = ({ label, value, sub, tone = 'default', testid, icon: Icon }) => {
  const tones = {
    default: 'bg-card border-border-light',
    danger: 'bg-red-50 border-red-200',
    star: 'bg-amber-50 border-amber-200',
  };
  return (
    <div data-testid={testid} className={`rounded-2xl border p-4 ${tones[tone]}`}>
      <div className="flex items-center gap-1.5 text-xs font-medium text-text-secondary mb-1">
        {Icon && <Icon className="h-3.5 w-3.5" />}{label}
      </div>
      <div className={`text-2xl font-bold ${tone === 'danger' ? 'text-red-600' : tone === 'star' ? 'text-amber-600' : 'text-text-primary'}`}>{value}</div>
      {sub && <div className="text-xs text-text-secondary mt-0.5">{sub}</div>}
    </div>
  );
};

const FeedbackInbox = () => {
  const [items, setItems] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // all | urgent | food | issue | open

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [inbox, stats] = await Promise.all([
        axios.get(`${API}/feedback`, { withCredentials: true }),
        axios.get(`${API}/feedback/analytics`, { withCredentials: true }),
      ]);
      setItems(inbox.data || []);
      setAnalytics(stats.data || null);
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Could not load feedback');
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { fetchAll(); }, [fetchAll]);

  const resolve = async (id) => {
    try {
      await axios.patch(`${API}/feedback/${id}/resolve`, {}, { withCredentials: true });
      setItems((prev) => prev.map((x) => (x.id === id ? { ...x, status: 'resolved' } : x)));
      setAnalytics((a) => (a ? { ...a, open: Math.max(0, a.open - 1) } : a));
      toast.success('Marked as resolved');
    } catch (e) { toast.error('Could not update'); }
  };

  const isUrgent = (f) => f.status === 'open' && f.priority === 'high';
  const shown = items.filter((i) => {
    if (filter === 'all') return true;
    if (filter === 'urgent') return isUrgent(i);
    if (filter === 'open') return i.status === 'open';
    return i.kind === filter;
  });
  const fmt = (s) => { try { return new Date(s).toLocaleString(); } catch { return s; } };

  const trend = analytics?.by_day || [];
  const maxDay = Math.max(1, ...trend.map((d) => d.count));
  const topIssues = analytics?.by_category || [];

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

          {/* Analytics summary */}
          {analytics && (
            <div data-testid="feedback-analytics" className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <StatCard testid="fb-stat-total" label="Total" value={analytics.total} icon={Inbox} />
              <StatCard testid="fb-stat-open" label="Open" value={analytics.open} sub={`${analytics.high_priority_open} urgent`} icon={MessageSquare} />
              <StatCard testid="fb-stat-avg" label="Avg rating" tone="star" icon={Star}
                value={analytics.avg_rating != null ? analytics.avg_rating : '—'}
                sub={analytics.rating_count ? `${analytics.rating_count} ratings` : 'no ratings yet'} />
              <StatCard testid="fb-stat-urgent" label="Urgent open" tone={analytics.high_priority_open ? 'danger' : 'default'}
                value={analytics.high_priority_open} sub="1–2★ & issues" icon={AlertTriangle} />
            </div>
          )}

          {/* Trend + top issues */}
          {analytics && (trend.length > 0 || topIssues.length > 0) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
              {trend.length > 0 && (
                <div data-testid="feedback-trend" className="bg-card border border-border-light rounded-2xl p-4">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-text-secondary mb-3">
                    <TrendingUp className="h-3.5 w-3.5" /> Last {trend.length} days
                  </div>
                  <div className="flex items-end gap-1 h-16">
                    {trend.map((d) => (
                      <div key={d.day} className="flex-1 h-full flex flex-col items-center justify-end group" title={`${d.day}: ${d.count}`}>
                        <div className="w-full rounded-t bg-primary/70 group-hover:bg-primary transition-colors"
                          style={{ height: `${Math.max(6, (d.count / maxDay) * 100)}%` }} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {topIssues.length > 0 && (
                <div data-testid="feedback-top-issues" className="bg-card border border-border-light rounded-2xl p-4">
                  <div className="text-xs font-medium text-text-secondary mb-3">Top issues</div>
                  <div className="space-y-2">
                    {topIssues.slice(0, 5).map((c) => (
                      <div key={c.category} className="flex items-center justify-between text-sm">
                        <span className="capitalize text-text-primary">{ISSUE_LABELS[c.category] || c.category}</span>
                        <span className="font-semibold text-text-secondary">{c.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex gap-2 mb-5 overflow-x-auto">
            {['all', 'urgent', 'open', 'food', 'issue'].map((f) => (
              <button key={f} data-testid={`feedback-filter-${f}`} onClick={() => setFilter(f)}
                className={`px-4 py-2 rounded-full text-sm font-medium capitalize whitespace-nowrap transition-all ${filter === f ? (f === 'urgent' ? 'bg-red-600 text-white' : 'bg-primary text-white') : 'bg-card border border-border-light text-text-secondary'}`}>
                {f === 'urgent' && <AlertTriangle className="h-3.5 w-3.5 inline mr-1 -mt-0.5" />}{f}
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
                  className={`bg-card border rounded-2xl p-4 ${isUrgent(f) ? 'border-red-300 ring-1 ring-red-200' : 'border-border-light'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      {f.kind === 'food' ? (
                        <span className="flex items-center gap-1 text-amber-500 font-bold">
                          <Star className="h-4 w-4 fill-amber-400 text-amber-400" /> {f.rating}/5
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-red-500 font-semibold capitalize">
                          <AlertCircle className="h-4 w-4" /> {ISSUE_LABELS[f.category] || f.category}
                        </span>
                      )}
                      {isUrgent(f) && (
                        <span data-testid={`feedback-urgent-${f.id}`} className="text-[10px] font-bold uppercase tracking-wide text-white bg-red-600 px-2 py-0.5 rounded-full flex items-center gap-1 animate-pulse">
                          <AlertTriangle className="h-3 w-3" /> Urgent
                        </span>
                      )}
                      {f.status === 'resolved' && (
                        <span className="text-xs font-medium text-green-600 flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> Resolved</span>
                      )}
                    </div>
                    <span className="text-xs text-text-secondary whitespace-nowrap">{fmt(f.created_at)}</span>
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
