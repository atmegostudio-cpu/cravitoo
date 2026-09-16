import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import axios from 'axios';
import VendorOrderNotifier from './VendorOrderNotifier';
import NotificationBell from './NotificationBell';
import { Home, UtensilsCrossed, ShoppingBag, LogOut, BarChart3, Users, Heart, Calendar, QrCode, Award, Sparkles, CalendarDays, Building2, ShieldCheck, Crown, Store, MapPin, ClipboardList, Shield, MessageSquare, CalendarCheck, Megaphone, Mail, Receipt, Briefcase, KeyRound, Trash2, Menu as MenuIcon, X, ChevronDown, LayoutGrid, FileText } from 'lucide-react';

const LOGO_URL = '/logo.png';
const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const OutletSwitcher = () => {
  const [data, setData] = useState(null);
  useEffect(() => {
    axios.get(`${API}/vendor/my-outlets`, { withCredentials: true }).then((r) => setData(r.data)).catch(() => {});
  }, []);
  if (!data || !data.is_operator || (data.outlets || []).length < 2) return null;
  const change = async (vid) => {
    if (vid === data.active_vendor_id) return;
    try {
      await axios.post(`${API}/vendor/switch-outlet`, { vendor_id: vid }, { withCredentials: true });
      window.location.reload();
    } catch { /* ignore */ }
  };
  return (
    <div className="flex items-center gap-1.5" data-testid="outlet-switcher" title="Switch outlet">
      <Store className="h-4 w-4 text-primary flex-shrink-0" />
      <select
        data-testid="outlet-switcher-select"
        value={data.active_vendor_id || ''}
        onChange={(e) => change(e.target.value)}
        className="text-sm font-medium bg-background border border-border-light rounded-lg px-2 py-1.5 max-w-[128px] focus:outline-none focus:ring-2 focus:ring-primary/40"
      >
        {data.outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </div>
  );
};

// ── Navigation config ─────────────────────────────────────────────────────
// A role's nav is a flat list of entries. An entry is either a direct link
// ({path,label,icon}) or a group ({group,icon,links:[...]}) rendered as a
// dropdown on desktop and a labelled section in the mobile drawer.
const getNavItems = (user) => {
  switch (user?.role) {
    case 'employee':
      return [
        { path: '/employee/dashboard', label: 'Home', icon: Home },
        { path: '/employee/menu', label: 'Menu', icon: UtensilsCrossed },
        { path: '/employee/orders', label: 'Orders', icon: ShoppingBag },
        {
          group: 'More', icon: LayoutGrid, links: [
            { path: '/employee/reservations', label: 'Pre-order', icon: CalendarCheck },
            { path: '/employee/bulk-order', label: 'Team Order', icon: Users },
            { path: '/employee/events', label: 'Events', icon: CalendarDays },
            { path: '/employee/loyalty', label: 'Rewards', icon: Award },
            { path: '/employee/feedback', label: 'Feedback', icon: MessageSquare },
          ],
        },
      ];
    case 'vendor': {
      const isOperator = (user?.assigned_vendors?.length || 0) > 1;
      return [
        { path: '/vendor/dashboard', label: 'Dashboard', icon: Home },
        { path: '/vendor/orders', label: 'Orders', icon: ShoppingBag },
        ...(isOperator ? [{
          group: 'Outlets', icon: Store, links: [
            { path: '/vendor/all-orders', label: 'All Outlets', icon: Store },
            { path: '/vendor/all-outlets-sales', label: 'Total Sales', icon: BarChart3 },
          ],
        }] : []),
        {
          group: 'Menu', icon: UtensilsCrossed, links: [
            { path: '/vendor/menu', label: 'Menu', icon: UtensilsCrossed },
            { path: '/vendor/menu-requests', label: 'Menu Requests', icon: FileText },
            { path: '/vendor/ai-insights', label: 'AI Insights', icon: Sparkles },
          ],
        },
        {
          group: 'More', icon: LayoutGrid, links: [
            { path: '/vendor/manual-order', label: 'Manual Order', icon: ClipboardList },
            { path: '/vendor/feedback', label: 'Feedback', icon: MessageSquare },
            { path: '/vendor/reservations', label: 'Reservations', icon: CalendarCheck },
            { path: '/vendor/verify-pickup', label: 'Pickup', icon: QrCode },
          ],
        },
      ];
    }
    case 'corporate_admin':
      return [
        { path: '/admin/dashboard', label: 'Dashboard', icon: BarChart3 },
        { path: '/admin/employees', label: 'Employees', icon: Users },
        { path: '/reports/sales', label: 'Sales', icon: BarChart3 },
        { path: '/admin/feedback', label: 'Feedback', icon: MessageSquare },
        { path: '/admin/bulk-pre-order', label: 'Bulk Pre-Order', icon: ClipboardList },
        { path: '/admin/events', label: 'Events', icon: CalendarDays },
      ];
    case 'super_admin':
      return [
        { path: '/super-admin/dashboard', label: 'Dashboard', icon: Home },
      ];
    case 'sub_admin': {
      const perms = user?.permissions || [];
      const links = [{ path: '/sub-admin/dashboard', label: 'Home', icon: Home }];
      if (perms.includes('vendors:onboard')) links.push({ path: '/onboarding', label: 'Vendor Onboarding', icon: ClipboardList });
      if (perms.includes('sales:view') || perms.includes('sales:view_all')) links.push({ path: '/reports/sales', label: 'Sales', icon: BarChart3 });
      if (perms.includes('feedback:view')) links.push({ path: '/admin/feedback', label: 'Feedback', icon: MessageSquare });
      if (perms.includes('menu_requests:view')) links.push({ path: '/admin/menu-requests', label: 'Menu Requests', icon: FileText });
      return links;
    }
    case 'master_admin':
      return [
        { path: '/master/dashboard', label: 'Dashboard', icon: Crown },
        {
          group: 'Network', icon: Building2, links: [
            { path: '/master/cities', label: 'Cities', icon: MapPin },
            { path: '/master/sites', label: 'Sites', icon: Building2 },
            { path: '/master/vendors', label: 'Vendors', icon: Store },
            { path: '/master/corporate-clients', label: 'Clients', icon: Briefcase },
            { path: '/master/customer-types', label: 'Customer Types', icon: Users },
          ],
        },
        {
          group: 'Operations', icon: ClipboardList, links: [
            { path: '/onboarding', label: 'Onboarding', icon: ClipboardList },
            { path: '/admin/menu-requests', label: 'Menu Requests', icon: FileText },
            { path: '/admin/reservations', label: 'Reservations', icon: CalendarCheck },
          ],
        },
        {
          group: 'Insights', icon: BarChart3, links: [
            { path: '/reports/sales', label: 'Sales', icon: BarChart3 },
            { path: '/admin/feedback', label: 'Feedback', icon: MessageSquare },
            { path: '/master/billing', label: 'Billing', icon: Receipt },
          ],
        },
        {
          group: 'System', icon: ShieldCheck, links: [
            { path: '/master/allowed-domains', label: 'Domains', icon: Mail },
            { path: '/master/broadcasts', label: 'Announce', icon: Megaphone },
            { path: '/master/admins', label: 'Admins', icon: ShieldCheck },
            { path: '/master/reset', label: 'Reset', icon: Trash2 },
          ],
        },
      ];
    case 'site_admin':
      return [
        { path: '/site-admin/dashboard', label: 'Dashboard', icon: BarChart3 },
        { path: '/reports/sales', label: 'Sales', icon: BarChart3 },
        { path: '/admin/reservations', label: 'Reservations', icon: CalendarCheck },
        { path: '/onboarding', label: 'Vendor Onboarding', icon: ClipboardList },
        { path: '/admin/menu-requests', label: 'Menu Requests', icon: FileText },
      ];
    case 'city_admin':
      return [
        { path: '/onboarding', label: 'Onboarding', icon: ClipboardList },
      ];
    default:
      return [];
  }
};

const slug = (s) => s.toLowerCase().replace(/ /g, '-');

// ── Desktop dropdown for a nav group ────────────────────────────────────────
const NavDropdown = ({ group, icon: Icon, links }) => {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const active = links.some((l) => location.pathname === l.path);

  useEffect(() => { setOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-testid={`nav-group-${slug(group)}`}
        aria-expanded={open}
        className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg transition-all duration-200 ${
          active || open ? 'bg-primary/10 text-primary' : 'text-text-secondary hover:text-text-primary hover:bg-background'
        }`}
      >
        <Icon className="h-4 w-4" />
        <span className="font-medium text-sm">{group}</span>
        <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          data-testid={`nav-group-panel-${slug(group)}`}
          className="nav-pop-in absolute left-0 mt-2 w-60 rounded-2xl border border-border-light bg-card shadow-xl p-1.5 z-[70]"
        >
          {links.map((l) => {
            const LinkIcon = l.icon;
            const isActive = location.pathname === l.path;
            return (
              <Link
                key={l.path}
                to={l.path}
                data-testid={`nav-${slug(l.label)}`}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors ${
                  isActive ? 'bg-primary text-white' : 'text-text-secondary hover:bg-background hover:text-text-primary'
                }`}
              >
                <LinkIcon className="h-4 w-4 flex-shrink-0" />
                <span className="font-medium">{l.label}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
};

const Navbar = () => {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => { setMobileOpen(false); }, [location.pathname]);
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const items = getNavItems(user);
  // Vendor has a heavier right cluster (outlet switcher + alerts pill), so its
  // horizontal nav needs more room — show it only from xl; others from lg.
  const isVendor = user?.role === 'vendor';
  const desktopNavClass = isVendor ? 'hidden xl:flex' : 'hidden lg:flex';
  const hamburgerClass = isVendor ? 'xl:hidden' : 'lg:hidden';
  const drawerHideClass = isVendor ? 'xl:hidden' : 'lg:hidden';

  return (
    <nav className="sticky top-0 z-50 glass border-b border-border-light px-4 sm:px-6 py-3 sm:py-4">
      <div className="max-w-7xl mx-auto flex justify-between items-center gap-4">
        <div className="flex items-center gap-4 sm:gap-6 min-w-0">
          <button
            onClick={() => setMobileOpen(true)}
            className={`${hamburgerClass} p-2 -ml-2 rounded-lg text-text-secondary hover:bg-background`}
            aria-label="Open menu"
            data-testid="mobile-menu-toggle"
          >
            <MenuIcon className="h-6 w-6" />
          </button>
          <Link to="/" className="flex items-center flex-shrink-0">
            <img src={LOGO_URL} alt="Cravitoo" className="h-9 sm:h-10 w-auto object-contain" />
          </Link>

          <div className={`${desktopNavClass} items-center gap-0.5 min-w-0`}>
            {items.map((item) => {
              if (item.group) {
                return <NavDropdown key={item.group} group={item.group} icon={item.icon} links={item.links} />;
              }
              const Icon = item.icon;
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  data-testid={`nav-${slug(item.label)}`}
                  className={`flex items-center gap-2 px-2.5 py-2 rounded-lg transition-all duration-200 ${
                    isActive ? 'bg-primary text-white' : 'text-text-secondary hover:text-text-primary hover:bg-background'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span className="font-medium text-sm">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>

        <div className="flex items-center space-x-3 flex-shrink-0">
          {user?.role === 'employee' && (
            <Link to="/employee/preferences" data-testid="nav-preferences" className="hidden xl:flex items-center space-x-1 text-text-secondary hover:text-text-primary px-2 py-2 rounded-lg transition-all duration-200" title="Preferences">
              <Heart className="h-4 w-4" />
              <span className="text-xs">Preferences</span>
            </Link>
          )}
          {user?.role === 'employee' && (
            <Link to="/employee/subscriptions" data-testid="nav-subscriptions" className="hidden xl:flex items-center space-x-1 text-text-secondary hover:text-text-primary px-2 py-2 rounded-lg transition-all duration-200" title="Meal Plans">
              <Calendar className="h-4 w-4" />
              <span className="text-xs">Plans</span>
            </Link>
          )}
          {user?.role === 'vendor' && <OutletSwitcher />}
          {user?.role === 'corporate_admin' && (
            <button
              data-testid="switch-to-employee-btn"
              onClick={async () => { try { await axios.post(`${API}/auth/employee-mode`, { on: true }, { withCredentials: true }); window.location.href = '/employee/dashboard'; } catch { /* ignore */ } }}
              className="hidden sm:inline-flex items-center gap-1.5 text-sm font-medium text-primary border border-primary/30 rounded-lg px-3 py-1.5 hover:bg-primary/5"
            >
              Switch to Employee
            </button>
          )}
          {user?.impersonating_admin && (
            <button
              data-testid="back-to-admin-btn"
              onClick={async () => { try { await axios.post(`${API}/auth/employee-mode`, { on: false }, { withCredentials: true }); window.location.href = '/admin/dashboard'; } catch { /* ignore */ } }}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-white bg-primary rounded-lg px-3 py-1.5 hover:bg-primary-hover"
            >
              Back to Admin
            </button>
          )}
          <NotificationBell />
          <Link
            to="/settings/security"
            data-testid="nav-change-password"
            className="hidden xl:flex items-center space-x-1 text-text-secondary hover:text-primary px-2 py-2 rounded-lg transition-all duration-200"
            title="Change Password"
            aria-label="Change Password"
          >
            <KeyRound className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Change Password</span>
          </Link>
          <Link
            to="/settings/data"
            data-testid="nav-data-privacy"
            className="hidden xl:flex items-center space-x-1 text-text-secondary hover:text-text-primary px-2 py-2 rounded-lg transition-all duration-200"
            title="Data & Privacy"
          >
            <Shield className="h-4 w-4" />
          </Link>
          {user?.role === 'vendor' && <VendorOrderNotifier />}
          <div className="text-right hidden sm:block pl-1">
            <p className="text-sm font-medium text-text-primary leading-tight">{user?.name}</p>
            <p className="text-xs text-text-muted capitalize leading-tight">{user?.role?.replace('_', ' ')}</p>
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

      {user?.impersonating_admin && (
        <div data-testid="employee-mode-banner" className="-mx-4 sm:-mx-6 -mb-3 sm:-mb-4 mt-3 sm:mt-4 bg-primary text-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2 flex items-center justify-center gap-3 text-sm">
            <span className="text-center"><span className="font-semibold">Employee view</span> — you're ordering as your own account{user?.employee_mode_since ? ` · since ${new Date(user.employee_mode_since).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : ''}</span>
            <button
              data-testid="employee-banner-back"
              onClick={async () => { try { await axios.post(`${API}/auth/employee-mode`, { on: false }, { withCredentials: true }); window.location.href = '/admin/dashboard'; } catch { /* ignore */ } }}
              className="ml-1 bg-white text-primary rounded-full px-3 py-0.5 text-xs font-semibold hover:bg-white/90 whitespace-nowrap"
            >Back to Admin</button>
          </div>
        </div>
      )}

      {/* Mobile slide-in drawer */}
      {mobileOpen && createPortal(
        <div className={`${drawerHideClass} fixed inset-0 z-[60]`} data-testid="mobile-menu-drawer">
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
              {items.map((item) => {
                if (item.group) {
                  return (
                    <div key={item.group} className="mt-2">
                      <p className="px-4 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">{item.group}</p>
                      {item.links.map((l) => {
                        const Icon = l.icon;
                        const isActive = location.pathname === l.path;
                        return (
                          <Link
                            key={l.path}
                            to={l.path}
                            data-testid={`mobile-nav-${slug(l.label)}`}
                            className={`flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors ${
                              isActive ? 'bg-primary-light text-primary' : 'text-text-secondary hover:bg-background'
                            }`}
                          >
                            <Icon className="h-5 w-5" />
                            {l.label}
                          </Link>
                        );
                      })}
                    </div>
                  );
                }
                const Icon = item.icon;
                const isActive = location.pathname === item.path;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    data-testid={`mobile-nav-${slug(item.label)}`}
                    className={`flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors ${
                      isActive ? 'bg-primary-light text-primary' : 'text-text-secondary hover:bg-background'
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                    {item.label}
                  </Link>
                );
              })}

              <div className="mt-2 border-t border-border-light pt-2">
                {user?.role === 'corporate_admin' && (
                  <button
                    onClick={async () => { try { await axios.post(`${API}/auth/employee-mode`, { on: true }, { withCredentials: true }); window.location.href = '/employee/dashboard'; } catch { /* ignore */ } }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm font-medium text-primary hover:bg-primary/5"
                  >
                    <Users className="h-5 w-5" /> Switch to Employee
                  </button>
                )}
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
        </div>,
        document.body,
      )}
    </nav>
  );
};

export default Navbar;
