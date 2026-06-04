import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Cookie, X } from 'lucide-react';

const STORAGE_KEY = 'cravitoo_cookie_consent_v1';

const CookieConsent = () => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) {
        // Slight delay so it doesn't flash on first paint
        const t = setTimeout(() => setVisible(true), 800);
        return () => clearTimeout(t);
      }
    } catch {
      // localStorage may be unavailable (incognito etc.) — just don't show banner
    }
    return undefined;
  }, []);

  const acknowledge = (choice) => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ choice, at: new Date().toISOString() })
      );
    } catch {
      /* ignore */
    }
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      data-testid="cookie-consent-banner"
      className="fixed bottom-0 left-0 right-0 z-50 px-4 pb-4 sm:px-6 sm:pb-6 pointer-events-none"
      role="dialog"
      aria-live="polite"
      aria-label="Cookie notice"
    >
      <div className="max-w-3xl mx-auto pointer-events-auto bg-card border border-border-light rounded-2xl shadow-lg p-5 sm:p-6">
        <div className="flex items-start gap-4">
          <div className="bg-primary-light rounded-xl p-2.5 flex-shrink-0">
            <Cookie className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-heading text-base font-semibold text-text-primary">
                Cookies on Cravitoo
              </h3>
              <button
                onClick={() => acknowledge('dismissed')}
                data-testid="cookie-dismiss-btn"
                aria-label="Dismiss"
                className="text-text-muted hover:text-text-primary p-1 -m-1 rounded transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-sm text-text-secondary mt-1.5 leading-relaxed">
              We use <strong>only essential cookies</strong> to keep you signed in (
              <code className="text-xs px-1 py-0.5 bg-background rounded">access_token</code>,{' '}
              <code className="text-xs px-1 py-0.5 bg-background rounded">refresh_token</code>).
              No tracking, no third-party advertising. See our{' '}
              <Link
                to="/privacy"
                data-testid="cookie-privacy-link"
                className="text-primary font-semibold hover:underline"
              >
                Privacy Policy
              </Link>
              .
            </p>
            <div className="flex flex-wrap gap-2 mt-4">
              <button
                onClick={() => acknowledge('accepted')}
                data-testid="cookie-accept-btn"
                className="bg-primary hover:bg-primary-hover text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
              >
                Got it
              </button>
              <Link
                to="/privacy"
                data-testid="cookie-learn-more-btn"
                className="text-text-secondary hover:text-text-primary text-sm font-medium px-5 py-2 rounded-lg border border-border-light hover:border-text-secondary transition-colors"
              >
                Learn more
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CookieConsent;
