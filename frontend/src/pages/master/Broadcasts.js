import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import Navbar from '../../components/Navbar';
import { Megaphone, Send, Loader2, Users, ChevronRight, Mail, Smartphone, AlertTriangle } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const AUDIENCE_OPTIONS = [
  { value: 'all', label: 'Everyone on Cravitoo', hint: 'Reaches employees, vendors and admins' },
  { value: 'role', label: 'A specific role', hint: 'e.g. only employees, only vendors' },
  { value: 'site', label: 'A specific site', hint: 'Only members of one office' },
  { value: 'city', label: 'A specific city', hint: 'Everyone in one city' },
];

const ROLE_OPTIONS = [
  { value: 'employee', label: 'Employees' },
  { value: 'vendor', label: 'Vendors' },
  { value: 'site_admin', label: 'Site Admins' },
  { value: 'corporate_admin', label: 'Corporate Admins' },
  { value: 'city_admin', label: 'City Admins' },
  { value: 'super_admin', label: 'Super Admins' },
];

const Broadcasts = () => {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [audience, setAudience] = useState('all');
  const [targetRole, setTargetRole] = useState('employee');
  const [targetSiteId, setTargetSiteId] = useState('');
  const [targetCityId, setTargetCityId] = useState('');
  const [sendPush, setSendPush] = useState(true);
  const [sendEmail, setSendEmail] = useState(false);
  const [sites, setSites] = useState([]);
  const [cities, setCities] = useState([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null); // delivery stats
  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const { data } = await axios.get(`${API}/admin/broadcasts?limit=30`, { withCredentials: true });
      setHistory(data || []);
    } catch {
      setHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
    // Lazy-load sites + cities for the audience selectors
    axios.get(`${API}/sites`, { withCredentials: true }).then((r) => setSites(r.data || [])).catch(() => {});
    axios.get(`${API}/cities`, { withCredentials: true }).then((r) => setCities(r.data || [])).catch(() => {});
  }, [loadHistory]);

  const handleSend = async (e) => {
    e.preventDefault();
    setError(''); setSuccess(null); setSending(true);
    try {
      const body = { title: title.trim(), message: message.trim(), audience, send_push: sendPush, send_email: sendEmail };
      if (audience === 'role') body.target_role = targetRole;
      if (audience === 'site') body.target_site_id = targetSiteId;
      if (audience === 'city') body.target_city_id = targetCityId;
      const { data } = await axios.post(`${API}/admin/broadcasts`, body, { withCredentials: true });
      setSuccess(data);
      setTitle(''); setMessage('');
      loadHistory();
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  const audienceDisabled = !title.trim() || message.trim().length < 3 || (audience === 'site' && !targetSiteId) || (audience === 'city' && !targetCityId);

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-background">
        <div className="max-w-5xl mx-auto px-6 py-8">
          {/* Header */}
          <div className="flex items-start justify-between mb-8">
            <div>
              <h1 className="font-heading text-4xl sm:text-5xl tracking-tighter font-semibold text-text-primary">
                Announcements
              </h1>
              <p className="text-text-secondary mt-2">
                Send a single message to many users at once via push notifications and (optionally) email.
              </p>
            </div>
            <button
              data-testid="back-to-dashboard"
              onClick={() => navigate('/master/dashboard')}
              className="px-4 py-2 text-sm text-text-secondary border border-border-light rounded-lg hover:bg-card"
            >
              Back to dashboard
            </button>
          </div>

          {/* Compose form */}
          <form onSubmit={handleSend} className="bg-card border border-border-light rounded-2xl p-6 mb-8" data-testid="broadcast-form">
            <div className="flex items-start gap-4 mb-6">
              <div className="bg-primary-light rounded-xl p-3 flex-shrink-0">
                <Megaphone className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h2 className="font-heading text-xl font-semibold text-text-primary">New announcement</h2>
                <p className="text-text-muted text-sm mt-1">
                  Push notifications are <span className="text-primary font-medium">free and unlimited</span>. Email reaches only users who opted in.
                </p>
              </div>
            </div>

            {/* Title */}
            <div className="mb-4">
              <label className="text-xs font-medium text-text-secondary uppercase">Title</label>
              <input
                data-testid="broadcast-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Cafeteria closed on June 15"
                maxLength={120}
                className="mt-1 w-full px-3 py-2 border border-border-light rounded-lg text-sm"
                required
              />
              <p className="text-text-muted text-xs mt-1">{title.length}/120</p>
            </div>

            {/* Message */}
            <div className="mb-4">
              <label className="text-xs font-medium text-text-secondary uppercase">Message</label>
              <textarea
                data-testid="broadcast-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Write the full announcement here…"
                rows={4}
                maxLength={4000}
                className="mt-1 w-full px-3 py-2 border border-border-light rounded-lg text-sm"
                required
              />
              <p className="text-text-muted text-xs mt-1">{message.length}/4000</p>
            </div>

            {/* Audience */}
            <div className="mb-4">
              <label className="text-xs font-medium text-text-secondary uppercase">Send to</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                {AUDIENCE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    data-testid={`audience-${opt.value}`}
                    onClick={() => setAudience(opt.value)}
                    className={`text-left p-3 rounded-lg border-2 transition-colors ${audience === opt.value ? 'border-primary bg-primary-light' : 'border-border-light hover:border-text-muted'}`}
                  >
                    <p className="text-sm font-medium text-text-primary">{opt.label}</p>
                    <p className="text-xs text-text-muted mt-0.5">{opt.hint}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Sub-target selector */}
            {audience === 'role' && (
              <div className="mb-4">
                <label className="text-xs font-medium text-text-secondary uppercase">Role</label>
                <select
                  data-testid="target-role"
                  value={targetRole}
                  onChange={(e) => setTargetRole(e.target.value)}
                  className="mt-1 w-full px-3 py-2 border border-border-light rounded-lg text-sm"
                >
                  {ROLE_OPTIONS.map((r) => (<option key={r.value} value={r.value}>{r.label}</option>))}
                </select>
              </div>
            )}
            {audience === 'site' && (
              <div className="mb-4">
                <label className="text-xs font-medium text-text-secondary uppercase">Site</label>
                <select
                  data-testid="target-site"
                  value={targetSiteId}
                  onChange={(e) => setTargetSiteId(e.target.value)}
                  className="mt-1 w-full px-3 py-2 border border-border-light rounded-lg text-sm"
                >
                  <option value="">-- Pick a site --</option>
                  {sites.map((s) => (<option key={s.id} value={s.id}>{s.name} {s.city_name ? `(${s.city_name})` : ''}</option>))}
                </select>
              </div>
            )}
            {audience === 'city' && (
              <div className="mb-4">
                <label className="text-xs font-medium text-text-secondary uppercase">City</label>
                <select
                  data-testid="target-city"
                  value={targetCityId}
                  onChange={(e) => setTargetCityId(e.target.value)}
                  className="mt-1 w-full px-3 py-2 border border-border-light rounded-lg text-sm"
                >
                  <option value="">-- Pick a city --</option>
                  {cities.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                </select>
              </div>
            )}

            {/* Channels */}
            <div className="mb-5">
              <label className="text-xs font-medium text-text-secondary uppercase">Delivery channels</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                <label className={`flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer ${sendPush ? 'border-primary bg-primary-light' : 'border-border-light'}`}>
                  <input
                    type="checkbox"
                    data-testid="channel-push"
                    checked={sendPush}
                    onChange={(e) => setSendPush(e.target.checked)}
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-text-primary flex items-center gap-2"><Smartphone className="h-4 w-4" /> Push notification</p>
                    <p className="text-xs text-text-muted mt-0.5">Free & unlimited. Recipients with the mobile app installed receive it instantly.</p>
                  </div>
                </label>
                <label className={`flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer ${sendEmail ? 'border-primary bg-primary-light' : 'border-border-light'}`}>
                  <input
                    type="checkbox"
                    data-testid="channel-email"
                    checked={sendEmail}
                    onChange={(e) => setSendEmail(e.target.checked)}
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-text-primary flex items-center gap-2"><Mail className="h-4 w-4" /> Email</p>
                    <p className="text-xs text-text-muted mt-0.5">Only sent to users who opted-in. Counts against Resend quota — use sparingly.</p>
                  </div>
                </label>
              </div>
            </div>

            {error && (
              <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            {success && (
              <div className="mb-4 p-4 rounded-lg bg-emerald-50 border border-emerald-200" data-testid="broadcast-success">
                <p className="text-sm text-emerald-800 font-medium">✅ Announcement sent</p>
                <p className="text-xs text-emerald-700 mt-1">
                  Reached <strong>{success.delivery_stats.recipients}</strong> recipient(s).
                  {success.delivery_stats.in_app > 0 && ` ${success.delivery_stats.in_app} in-app/push delivered.`}
                  {success.delivery_stats.email_sent > 0 && ` ${success.delivery_stats.email_sent} email(s) sent.`}
                  {success.delivery_stats.email_skipped > 0 && ` ${success.delivery_stats.email_skipped} email(s) skipped (user opted out).`}
                </p>
              </div>
            )}

            <button
              type="submit"
              data-testid="broadcast-send"
              disabled={audienceDisabled || sending || (!sendPush && !sendEmail)}
              className="w-full sm:w-auto px-6 py-2.5 bg-primary text-white rounded-lg font-medium hover:bg-primary-hover disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {sending ? 'Sending…' : 'Send announcement'}
            </button>
          </form>

          {/* History */}
          <div className="bg-card border border-border-light rounded-2xl p-6" data-testid="broadcast-history">
            <h2 className="font-heading text-xl font-semibold text-text-primary mb-4 flex items-center gap-2">
              <Users className="h-5 w-5 text-text-secondary" /> Recent announcements
            </h2>
            {loadingHistory ? (
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            ) : history.length === 0 ? (
              <p className="text-text-muted text-sm">No announcements yet. Compose your first one above.</p>
            ) : (
              <ul className="divide-y divide-border-light">
                {history.map((b) => (
                  <li key={b.id} data-testid={`history-item-${b.id}`} className="py-3 flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-text-primary text-sm">{b.title}</p>
                      <p className="text-xs text-text-muted mt-1 line-clamp-2">{b.message}</p>
                      <p className="text-xs text-text-muted mt-1">
                        <span className="capitalize">{b.audience}</span>
                        {b.target_role && ` • ${b.target_role}`}
                        {' • '}
                        {b.created_at ? new Date(b.created_at).toLocaleString('en-IN', { hour12: false }) : '—'}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-xs text-text-muted">Reached</p>
                      <p className="text-base font-semibold text-primary">{b.delivery_stats?.recipients || 0}</p>
                      <p className="text-xs text-text-muted">
                        {(b.delivery_stats?.in_app || 0)}📱 {(b.delivery_stats?.email_sent || 0)}✉️
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-text-muted flex-shrink-0 mt-2" />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default Broadcasts;
