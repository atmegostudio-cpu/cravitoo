import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import NotificationBell from './NotificationBell';
import { Home, UtensilsCrossed, ShoppingBag, LogOut, BarChart3, Users, Heart, Calendar, QrCode, Award, Sparkles, CalendarDays, Building2, ShieldCheck, Crown, Store, UploadCloud, MapPin, ClipboardList, Shield } from 'lucide-react';

const LOGO_URL = 'https://customer-assets.emergentagent.com/job_corporate-feast/artifacts/j6kduny0_WhatsApp%20Image%202026-05-27%20at%2011.03.31%20AM%20-%20Edited.png';

const Navbar = () => {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

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
          { path: '/employee/orders', label: 'Orders', icon: ShoppingBag },
          { path: '/employee/bulk-order', label: 'Team Order', icon: Users },
          { path: '/employee/events', label: 'Events', icon: CalendarDays },
          { path: '/employee/loyalty', label: 'Rewards', icon: Award },
        ];
      case 'vendor':
        return [
          { path: '/vendor/dashboard', label: 'Dashboard', icon: Home },
          { path: '/vendor/orders', label: 'Orders', icon: ShoppingBag },
          { path: '/vendor/menu', label: 'Menu', icon: UtensilsCrossed },
          { path: '/vendor/ai-insights', label: 'AI Insights', icon: Sparkles },
          { path: '/vendor/verify-pickup', label: 'Pickup', icon: QrCode },
        ];
      case 'corporate_admin':
        return [
          { path: '/admin/dashboard', label: 'Dashboard', icon: BarChart3 },
          { path: '/admin/employees', label: 'Employees', icon: Users },
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
          { path: '/onboarding', label: 'Onboarding', icon: ClipboardList },
          { path: '/master/admins', label: 'Admins', icon: ShieldCheck },
          { path: '/master/bulk-onboard', label: 'Bulk Onboard', icon: UploadCloud },
        ];
      case 'site_admin':
        return [
          { path: '/site-admin/dashboard', label: 'Dashboard', icon: BarChart3 },
          { path: '/onboarding', label: 'Vendor Onboarding', icon: ClipboardList },
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
    <nav className="sticky top-0 z-50 glass border-b border-border-light px-6 py-4">
      <div className="max-w-7xl mx-auto flex justify-between items-center gap-4">
        <div className="flex items-center space-x-6 flex-wrap">
          <Link to="/" className="flex items-center space-x-2 flex-shrink-0">
            <img src={LOGO_URL} alt="Cravitoo" className="h-10 w-auto object-contain" />
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
            data-testid="logout-btn"
            className="flex items-center space-x-2 px-3 py-2 text-text-secondary hover:text-red-600 hover:bg-red-50 rounded-lg transition-all duration-200"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
