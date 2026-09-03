import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Bell } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const POLL_MS = 15000;

// Vendor-only: polls for new orders, shows a toast + chime + unread bell badge.
const VendorOrderNotifier = () => {
  const navigate = useNavigate();
  const [unread, setUnread] = useState(0);
  const [toasts, setToasts] = useState([]);
  const seenIds = useRef(null); // Set of order ids already known
  const bootstrapped = useRef(false);

  const beep = useCallback(() => {
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
    if (document.hidden) return; // skip polling while the tab is in the background
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
        fresh.slice(0, 4).forEach(pushToast);
        setUnread((u) => u + fresh.length);
        beep();
      }
      seenIds.current = ids;
    } catch (e) { /* ignore transient errors */ }
  }, [beep, pushToast]);

  useEffect(() => {
    poll();
    const iv = setInterval(poll, POLL_MS);
    return () => clearInterval(iv);
  }, [poll]);

  const openOrders = () => { setUnread(0); navigate('/vendor/orders'); };

  return (
    <>
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
