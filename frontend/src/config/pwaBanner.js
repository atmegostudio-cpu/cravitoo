// ─────────────────────────────────────────────────────────────────────────
// PWA "Add Cravitoo to your home screen" install banner — control panel.
//
//  • enabled:    master ON/OFF switch. Set to `false` to hide the banner
//                everywhere instantly (e.g. the day the native app launches).
//  • expiryDate: the banner auto-hides AFTER this date (device local time).
//                Format 'YYYY-MM-DD'. Set to `null` to never auto-expire.
//                Handy so you don't have to remember to turn it off manually.
// ─────────────────────────────────────────────────────────────────────────
export const PWA_BANNER_CONFIG = {
  enabled: true,
  expiryDate: '2026-12-31',
};

export function isBannerActive(now = new Date()) {
  if (!PWA_BANNER_CONFIG.enabled) return false;
  if (PWA_BANNER_CONFIG.expiryDate) {
    // Expire at end of the given day (23:59:59 local).
    const end = new Date(`${PWA_BANNER_CONFIG.expiryDate}T23:59:59`);
    if (!isNaN(end.getTime()) && now > end) return false;
  }
  return true;
}
