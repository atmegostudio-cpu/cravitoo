import React, { useEffect, useState, useCallback } from 'react';
import { Download, X, Share, Plus } from 'lucide-react';
import { isBannerActive } from '../config/pwaBanner';

const DISMISS_KEY = 'cravitoo_pwa_banner_dismissed_v1';
const COOKIE_KEY = 'cravitoo_cookie_consent_v1';
const LOGO = '/icons/icon-192.png';

const cookieAccepted = () => {
  try { return localStorage.getItem(COOKIE_KEY) !== null; } catch { return true; }
};

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  window.navigator.standalone === true;

const isIOS = () => {
  const ua = window.navigator.userAgent || '';
  const iOSDevice = /iP(hone|ad|od)/.test(ua);
  // iPadOS 13+ reports as Macintosh — detect via touch points
  const iPadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  return iOSDevice || iPadOS;
};

const isMobile = () => {
  const ua = window.navigator.userAgent || '';
  return /Android|iP(hone|ad|od)|Mobile/i.test(ua) || isIOS();
};

/**
 * Friendly, temporary "Add to Home Screen" prompt for mobile employees.
 * - Android/Chromium: uses the native beforeinstallprompt → one-tap install.
 * - iOS Safari: shows the manual Share → Add to Home Screen instructions.
 * Controlled by src/config/pwaBanner.js (on/off switch + auto-expiry date).
 */
export default function PWAInstallBanner() {
  const [visible, setVisible] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [iosMode, setIosMode] = useState(false);

  const dismissedBefore = useCallback(() => {
    try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
  }, []);

  const rememberDismiss = useCallback(() => {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    // Hard gates — never show if disabled/expired, already installed, not mobile,
    // or the user already dismissed it.
    if (!isBannerActive()) return;
    if (isStandalone()) return;
    if (!isMobile()) return;
    if (dismissedBefore()) return;

    let showTimer;
    let cookieTimer;

    // Reveal only once the cookie-consent bar is out of the way (both are
    // bottom-fixed on mobile). Retry every 2s so it still appears in-session
    // right after the user accepts cookies.
    const reveal = () => {
      if (cookieAccepted()) {
        setVisible(true);
      } else {
        cookieTimer = setTimeout(reveal, 2000);
      }
    };

    const onBeforeInstall = (e) => {
      e.preventDefault();               // stop Chrome's default mini-infobar
      setDeferredPrompt(e);
      showTimer = setTimeout(reveal, 2500);
    };

    const onInstalled = () => {
      setVisible(false);
      rememberDismiss();
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);

    // iOS has no beforeinstallprompt — show manual instructions after a delay.
    if (isIOS()) {
      setIosMode(true);
      showTimer = setTimeout(reveal, 2500);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
      if (showTimer) clearTimeout(showTimer);
      if (cookieTimer) clearTimeout(cookieTimer);
    };
  }, [dismissedBefore, rememberDismiss]);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    try {
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') rememberDismiss();
    } catch { /* ignore */ }
    setDeferredPrompt(null);
    setVisible(false);
  };

  const handleDismiss = () => {
    rememberDismiss();
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      data-testid="pwa-install-banner"
      className="fixed inset-x-0 bottom-0 z-[9999] px-3 pb-3 sm:hidden animate-[slideUp_.35s_ease-out]"
      style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}
    >
      <style>{`@keyframes slideUp{from{transform:translateY(120%);opacity:0}to{transform:translateY(0);opacity:1}}`}</style>
      <div className="mx-auto max-w-md rounded-2xl bg-[#051A47] text-white shadow-2xl ring-1 ring-white/10 overflow-hidden">
        <div className="flex items-start gap-3 p-4">
          <img
            src={LOGO}
            alt="Cravitoo"
            className="h-12 w-12 rounded-xl flex-shrink-0 ring-1 ring-white/15"
          />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-[15px] leading-tight">Add Cravitoo to your home screen</p>
            {iosMode ? (
              <p className="mt-1 text-[13px] text-white/70 leading-snug flex items-center flex-wrap gap-1">
                Tap <Share className="inline h-3.5 w-3.5 mx-0.5" /> then
                <span className="inline-flex items-center gap-0.5 font-medium text-white/90">
                  <Plus className="h-3.5 w-3.5" /> Add to Home Screen
                </span>
              </p>
            ) : (
              <p className="mt-1 text-[13px] text-white/70 leading-snug">
                Order lunch in one tap — no browser, no typing the address.
              </p>
            )}
          </div>
          <button
            data-testid="pwa-install-dismiss"
            onClick={handleDismiss}
            aria-label="Dismiss"
            className="text-white/50 hover:text-white transition-colors p-1 -mt-1 -mr-1"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {!iosMode && (
          <div className="flex gap-2 px-4 pb-4">
            <button
              data-testid="pwa-install-button"
              onClick={handleInstall}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-[#FF5A1F] hover:bg-[#e64e18] active:scale-[.98] transition-all py-2.5 font-semibold text-[15px]"
            >
              <Download className="h-4 w-4" /> Install app
            </button>
            <button
              data-testid="pwa-install-later"
              onClick={handleDismiss}
              className="rounded-xl px-4 py-2.5 font-medium text-[14px] text-white/70 hover:text-white hover:bg-white/5 transition-colors"
            >
              Not now
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
