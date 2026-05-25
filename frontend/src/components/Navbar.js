import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Utensils, Home, UtensilsCrossed, ShoppingBag, LogOut, BarChart3, Building2, Users, Heart, Calendar, QrCode } from 'lucide-react';

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
          { path: '/employee/dashboard', label: 'Dashboard', icon: Home },
          { path: '/employee/menu', label: 'Menu', icon: UtensilsCrossed },
          { path: '/employee/orders', label: 'Orders', icon: ShoppingBag },
          { path: '/employee/subscriptions', label: 'Subscriptions', icon: Calendar },
          { path: '/employee/preferences', label: 'Preferences', icon: Heart },
        ];
      case 'vendor':
        return [
          { path: '/vendor/dashboard', label: 'Dashboard', icon: Home },
          { path: '/vendor/orders', label: 'Orders', icon: ShoppingBag },
          { path: '/vendor/menu', label: 'Menu', icon: UtensilsCrossed },
          { path: '/vendor/verify-pickup', label: 'Verify Pickup', icon: QrCode },
        ];
      case 'corporate_admin':
        return [
          { path: '/admin/dashboard', label: 'Dashboard', icon: BarChart3 },
        ];
      case 'super_admin':
        return [
          { path: '/super-admin/dashboard', label: 'Dashboard', icon: Home },
        ];
      default:
        return [];
    }
  };

  return (
    <nav className="sticky top-0 z-50 glass border-b border-border-light px-6 py-4">
      <div className="max-w-7xl mx-auto flex justify-between items-center">
        <div className="flex items-center space-x-8">
          <Link to="/" className="flex items-center space-x-2">
            <Utensils className="h-7 w-7 text-primary" />
            <span className="font-heading text-xl font-semibold text-text-primary">Cravitoo</span>
          </Link>
          
          <div className="hidden md:flex items-center space-x-1">
            {getNavLinks().map((link) => {
              const Icon = link.icon;
              const isActive = location.pathname === link.path;
              return (
                <Link
                  key={link.path}
                  to={link.path}
                  data-testid={`nav-${link.label.toLowerCase().replace(' ', '-')}`}
                  className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-all duration-200 ${
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

        <div className="flex items-center space-x-4">
          <div className="text-right hidden sm:block">
            <p className="text-sm font-medium text-text-primary">{user?.name}</p>
            <p className="text-xs text-text-muted capitalize">{user?.role?.replace('_', ' ')}</p>
          </div>
          <button
            onClick={handleLogout}
            data-testid="logout-btn"
            className="flex items-center space-x-2 px-4 py-2 text-text-secondary hover:text-red-600 hover:bg-red-50 rounded-lg transition-all duration-200"
          >
            <LogOut className="h-4 w-4" />
            <span className="font-medium text-sm hidden sm:inline">Logout</span>
          </button>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;