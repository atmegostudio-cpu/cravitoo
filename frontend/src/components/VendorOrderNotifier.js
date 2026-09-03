import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Bell, BellRing } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const POLL_MS = 15000;

const notifSupported = () => typeof window !== 'undefined' && 'Notification' in window;

// Vendor-only: polls for new orders, shows a toast + chime + unread bell badge,
// AND a system browser notification (fires even when the tab is unfocused/background).
const VendorOrderNotifier = () => {
  const navigate = useNavigate();
  const [unread, setUnread] = useState(0);
  const [toasts, setToasts] = useState([]);
  const [perm, setPerm] = useState(notifSupported() ? Notification.permission : 'unsupported');
  const seenIds = useRef(null); // Set of order ids already known
  const bootstrapped = useRef(false);

  const requestPerm = useCallback(async () => {
    if (!notifSupported()) return;
    try {
      const p = await Notification.requestPermission();
      setPerm(p);
    } catch (e) { /* ignore */ }
  }, []);

  const showBrowserNotification = useCallback((order) => {
    if (!notifSupported() || Notification.permission !== 'granted') return;
    const first = order.items?.[0];
    const label = first ? `${first.quantity}× ${first.name || 'item'}${order.items.length > 1 ? ` +${order.items.length - 1} more` : ''}` : 'New order';
    try {
      const n = new Notification('🔔 New order received', {
        body: `${label}\nfrom ${order.employee_name || 'Walk-in / Kiosk'}`,
        tag: `order-${order.id}`, // dedupes repeats for the same order
        renotify: true,
      });
      n.onclick = () => { window.focus(); navigate('/vendor/orders'); n.close(); };
    } catch (e) { /* some browsers require a service worker for persistent notifications */ }
  }, [navigate]);

  const beep = useCallback(() => {
    if (localStorage.getItem('cravitoo_order_sound') === 'off') return; // vendor muted the chime
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'sine'; osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
      osc.start(); osc.stop(ctx.currentTime + 0.4);
    } catch (e) { /* audio not available */ }
  }, []);

  const pushToast = useCallback((order) => {
    const first = order.items?.[0];
    const label = first ? `${first.quantity}× ${first.name || 'item'}${order.items.length > 1 ? ` +${order.items.length - 1} more` : ''}` : 'New order';
    const t = { id: order.id, code: order.collection_code || `#${order.id.slice(-6)}`, label, who: order.employee_name || 'Walk-in / Kiosk' };
    setToasts((prev) => [t, ...prev].slice(0, 4));
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== t.id)), 8000);
  }, []);

  const poll = useCallback(async () => {
    // Keep polling even when the tab is hidden so background browser
    // notifications still fire when the vendor isn't looking at the tab.
    try {
      const { data } = await axios.get(`${API}/orders`, { withCredentials: true });
      const ids = new Set(data.map((o) => o.id));
      if (!bootstrapped.current) {
        seenIds.current = ids; // first load: mark all as seen, no toast
        bootstrapped.current = true;
        return;
      }
      const fresh = data.filter((o) => !seenIds.current.has(o.id));
      if (fresh.length > 0) {
        fresh.slice(0, 4).forEach((o) => { pushToast(o); showBrowserNotification(o); });
        setUnread((u) => u + fresh.length);
        beep();
      }
      seenIds.current = ids;
    } catch (e) { /* ignore transient errors */ }
  }, [beep, pushToast, showBrowserNotification]);

  useEffect(() => {
    // Ask once for permission so background alerts can be shown.
    if (notifSupported() && Notification.permission === 'default') requestPerm();
    poll();
    const iv = setInterval(poll, POLL_MS);
    return () => clearInterval(iv);
  }, [poll, requestPerm]);

  const openOrders = () => { setUnread(0); navigate('/vendor/orders'); };

  return (
    <>
      {perm !== 'granted' && perm !== 'unsupported' && (
        <button
          onClick={requestPerm}
          data-testid="enable-browser-alerts-btn"
          title="Enable desktop alerts for new orders (works even when this tab is in the background)"
          className="hidden sm:flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 hover:bg-amber-100 px-2.5 py-1.5 rounded-lg transition-all"
        >
          <BellRing className="h-3.5 w-3.5" /> Enable alerts
        </button>
      )}
      <button
        onClick={openOrders}
        data-testid="vendor-notification-bell"
        aria-label="New orders"
        title="New orders"
        className="relative flex items-center justify-center h-9 w-9 rounded-lg text-text-secondary hover:text-primary hover:bg-primary/5 transition-all"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span data-testid="vendor-notification-count" className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      <div className="fixed top-20 right-4 z-[9999] space-y-2 w-[300px] max-w-[90vw]">
        {toasts.map((t) => (
          <button
            key={t.id}
            onClick={openOrders}
            data-testid={`new-order-toast-${t.id}`}
            className="w-full text-left bg-white border border-primary/30 shadow-xl rounded-xl p-3 animate-in slide-in-from-right"
          >
            <p className="text-xs font-bold text-primary mb-0.5 flex items-center gap-1"><Bell className="h-3.5 w-3.5" /> New order · {t.code}</p>
            <p className="text-sm font-medium text-text-primary">{t.label}</p>
            <p className="text-xs text-text-muted">from {t.who}</p>
          </button>
        ))}
      </div>
    </>
  );
};

export default VendorOrderNotifier;
