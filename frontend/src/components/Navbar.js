import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import NotificationBell from './NotificationBell';
import { Home, UtensilsCrossed, ShoppingBag, LogOut, BarChart3, Users, Heart, Calendar, QrCode, Award, Sparkles, CalendarDays, Building2, ShieldCheck, Crown, Store, UploadCloud, MapPin, ClipboardList, Shield, MessageSquare, CalendarCheck, Megaphone, Mail, Receipt, Briefcase, KeyRound, Trash2, Menu as MenuIcon, X } from 'lucide-react';

const LOGO_URL = 'https://customer-assets.emergentagent.com/job_corporate-feast/artifacts/j6kduny0_WhatsApp%20Image%202026-05-27%20at%2011.03.31%20AM%20-%20Edited.png';

const Navbar = () => {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const getNavLinks = () => {
    switch (user?.role) {
      case 'employee':
        return [
          { path: '/employee/dashboard', label: 'Home', icon: Home },
          { path: '/employee/menu', label: 'Menu', icon: UtensilsCrossed },
          { path: '/employee/reservations', label: 'Pre-order', icon: CalendarCheck },
          { path: '/employee/orders', label: 'Orders', icon: ShoppingBag },
          { path: '/employee/bulk-order', label: 'Team Order', icon: Users },
          { path: '/employee/events', label: 'Events', icon: CalendarDays },
          { path: '/employee/loyalty', label: 'Rewards', icon: Award },
        ];
      case 'vendor':
        return [
          { path: '/vendor/dashboard', label: 'Dashboard', icon: Home },
          { path: '/vendor/orders', label: 'Orders', icon: ShoppingBag },
          { path: '/vendor/reservations', label: 'Reservations', icon: CalendarCheck },
          { path: '/vendor/menu', label: 'Menu', icon: UtensilsCrossed },
          { path: '/vendor/menu-requests', label: 'Menu Requests', icon: MessageSquare },
          { path: '/vendor/ai-insights', label: 'AI Insights', icon: Sparkles },
          { path: '/vendor/verify-pickup', label: 'Pickup', icon: QrCode },
        ];
      case 'corporate_admin':
        return [
          { path: '/admin/dashboard', label: 'Dashboard', icon: BarChart3 },
          { path: '/admin/employees', label: 'Employees', icon: Users },
          { path: '/admin/bulk-pre-order', label: 'Bulk Pre-Order', icon: ClipboardList },
          { path: '/admin/events', label: 'Events', icon: CalendarDays },
        ];
      case 'super_admin':
        return [
          { path: '/super-admin/dashboard', label: 'Dashboard', icon: Home },
        ];
      case 'master_admin':
        return [
          { path: '/master/dashboard', label: 'Dashboard', icon: Crown },
          { path: '/master/cities', label: 'Cities', icon: MapPin },
          { path: '/master/sites', label: 'Sites', icon: Building2 },
          { path: '/master/vendors', label: 'Vendors', icon: Store },
          { path: '/master/corporate-clients', label: 'Clients', icon: Briefcase },
          { path: '/admin/reservations', label: 'Reservations', icon: CalendarCheck },
          { path: '/master/billing', label: 'Billing', icon: Receipt },
          { path: '/onboarding', label: 'Onboarding', icon: ClipboardList },
          { path: '/admin/menu-requests', label: 'Menu Requests', icon: MessageSquare },
          { path: '/master/allowed-domains', label: 'Domains', icon: Mail },
          { path: '/master/broadcasts', label: 'Announce', icon: Megaphone },
          { path: '/master/admins', label: 'Admins', icon: ShieldCheck },
          { path: '/master/reset', label: 'Reset', icon: Trash2 },
        ];
      case 'site_admin':
        return [
          { path: '/site-admin/dashboard', label: 'Dashboard', icon: BarChart3 },
          { path: '/admin/reservations', label: 'Reservations', icon: CalendarCheck },
          { path: '/onboarding', label: 'Vendor Onboarding', icon: ClipboardList },
          { path: '/admin/menu-requests', label: 'Menu Requests', icon: MessageSquare },
        ];
      case 'city_admin':
        return [
          { path: '/onboarding', label: 'Onboarding', icon: ClipboardList },
        ];
      default:
        return [];
    }
  };

  return (
    <nav className="sticky top-0 z-50 glass border-b border-border-light px-4 sm:px-6 py-3 sm:py-4">
      <div className="max-w-7xl mx-auto flex justify-between items-center gap-4">
        <div className="flex items-center space-x-4 sm:space-x-6 flex-wrap">
          <button
            onClick={() => setMobileOpen(true)}
            className="md:hidden p-2 -ml-2 rounded-lg text-text-secondary hover:bg-background"
            aria-label="Open menu"
            data-testid="mobile-menu-toggle"
          >
            <MenuIcon className="h-6 w-6" />
          </button>
          <Link to="/" className="flex items-center space-x-2 flex-shrink-0">
            <img src={LOGO_URL} alt="Cravitoo" className="h-9 sm:h-10 w-auto object-contain" />
          </Link>
          
          <div className="hidden md:flex items-center space-x-1 flex-wrap">
            {getNavLinks().map((link) => {
              const Icon = link.icon;
              const isActive = location.pathname === link.path;
              return (
                <Link
                  key={link.path}
                  to={link.path}
                  data-testid={`nav-${link.label.toLowerCase().replace(' ', '-')}`}
                  className={`flex items-center space-x-2 px-3 py-2 rounded-lg transition-all duration-200 ${
                    isActive
                      ? 'bg-primary text-white'
                      : 'text-text-secondary hover:text-text-primary hover:bg-background'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span className="font-medium text-sm">{link.label}</span>
                </Link>
              );
            })}
          </div>
        </div>

        <div className="flex items-center space-x-3">
          {user?.role === 'employee' && (
            <Link to="/employee/preferences" data-testid="nav-preferences" className="hidden lg:flex items-center space-x-1 text-text-secondary hover:text-text-primary px-2 py-2 rounded-lg transition-all duration-200">
              <Heart className="h-4 w-4" />
              <span className="text-xs">Preferences</span>
            </Link>
          )}
          {user?.role === 'employee' && (
            <Link to="/employee/subscriptions" data-testid="nav-subscriptions" className="hidden lg:flex items-center space-x-1 text-text-secondary hover:text-text-primary px-2 py-2 rounded-lg transition-all duration-200">
              <Calendar className="h-4 w-4" />
              <span className="text-xs">Plans</span>
            </Link>
          )}
          <NotificationBell />
          <Link
            to="/settings/security"
            data-testid="nav-change-password"
            className="hidden lg:flex items-center space-x-1 text-text-secondary hover:text-primary px-2 py-2 rounded-lg transition-all duration-200"
            title="Change Password"
            aria-label="Change Password"
          >
            <KeyRound className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Change Password</span>
          </Link>
          <Link
            to="/settings/data"
            data-testid="nav-data-privacy"
            className="hidden lg:flex items-center space-x-1 text-text-secondary hover:text-text-primary px-2 py-2 rounded-lg transition-all duration-200"
            title="Data & Privacy"
          >
            <Shield className="h-4 w-4" />
          </Link>
          <div className="text-right hidden sm:block">
            <p className="text-sm font-medium text-text-primary">{user?.name}</p>
            <p className="text-xs text-text-muted capitalize">{user?.role?.replace('_', ' ')}</p>
          </div>
          <button
            onClick={handleLogout}
            data-testid="logout-button"
            aria-label="Logout"
            title="Logout"
            className="flex items-center space-x-2 px-3 py-2 text-text-secondary hover:text-red-600 hover:bg-red-50 rounded-lg transition-all duration-200"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Logout</span>
          </button>
        </div>
      </div>

      {/* Mobile slide-in drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-[60]" data-testid="mobile-menu-drawer">
          <button
            aria-label="Close menu"
            onClick={() => setMobileOpen(false)}
            className="absolute inset-0 bg-black/50"
          />
          <div className="absolute left-0 top-0 bottom-0 w-[84%] max-w-xs bg-card shadow-2xl flex flex-col animate-[slideRight_.2s_ease-out]">
            <div className="flex items-center justify-between px-4 py-4 border-b border-border-light">
              <img src={LOGO_URL} alt="Cravitoo" className="h-9 w-auto object-contain" />
              <button
                onClick={() => setMobileOpen(false)}
                aria-label="Close menu"
                data-testid="mobile-menu-close"
                className="p-2 rounded-lg text-text-secondary hover:bg-background"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-4 py-3 border-b border-border-light">
              <p className="text-sm font-medium text-text-primary truncate">{user?.name}</p>
              <p className="text-xs text-text-muted capitalize">{user?.role?.replace('_', ' ')}</p>
            </div>
            <div className="flex-1 overflow-y-auto py-2">
              {getNavLinks().map((link) => {
                const Icon = link.icon;
                const isActive = location.pathname === link.path;
                return (
                  <Link
                    key={link.path}
                    to={link.path}
                    data-testid={`mobile-nav-${link.label.toLowerCase().replace(/ /g, '-')}`}
                    className={`flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-primary-light text-primary'
                        : 'text-text-secondary hover:bg-background'
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                    {link.label}
                  </Link>
                );
              })}
              {user?.role === 'employee' && (
                <>
                  <Link to="/employee/preferences" className="flex items-center gap-3 px-4 py-3 text-sm text-text-secondary hover:bg-background">
                    <Heart className="h-5 w-5" /> Preferences
                  </Link>
                  <Link to="/employee/subscriptions" className="flex items-center gap-3 px-4 py-3 text-sm text-text-secondary hover:bg-background">
                    <Calendar className="h-5 w-5" /> Meal Plans
                  </Link>
                </>
              )}
              <Link to="/settings/security" className="flex items-center gap-3 px-4 py-3 text-sm text-text-secondary hover:bg-background">
                <KeyRound className="h-5 w-5" /> Change Password
              </Link>
              <Link to="/settings/data" className="flex items-center gap-3 px-4 py-3 text-sm text-text-secondary hover:bg-background">
                <Shield className="h-5 w-5" /> Data & Privacy
              </Link>
            </div>
            <button
              onClick={handleLogout}
              data-testid="mobile-logout"
              className="flex items-center gap-3 px-4 py-4 text-sm font-medium text-red-600 hover:bg-red-50 border-t border-border-light"
            >
              <LogOut className="h-5 w-5" /> Logout
            </button>
          </div>
          <style>{`
            @keyframes slideRight {
              from { transform: translateX(-100%); }
              to { transform: translateX(0); }
            }
          `}</style>
        </div>
      )}
    </nav>
  );
};

export default Navbar;
