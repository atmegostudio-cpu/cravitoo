import React from 'react';
import { Link } from 'react-router-dom';
import { Utensils, Building2, TrendingUp, Sparkles, ChevronRight } from 'lucide-react';

const LOGO_URL = 'https://customer-assets.emergentagent.com/job_corporate-feast/artifacts/lpcd18p4_29aaeaa4-ac4d-4437-8a14-0af8214d6039.png';

const LandingPage = () => {
  return (
    <div className="min-h-screen bg-background">
      <nav className="sticky top-0 z-50 glass border-b border-border-light px-6 py-4">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <img src={LOGO_URL} alt="Cravitoo" className="h-12 w-auto object-contain" />
          </div>
          <div className="flex items-center space-x-4">
            <Link to="/login" data-testid="nav-login-btn" className="text-text-secondary hover:text-text-primary transition-all duration-200 font-medium">Login</Link>
            <Link to="/register" data-testid="nav-register-btn" className="bg-primary hover:bg-primary-hover text-white px-6 py-2 rounded-full font-medium transition-all duration-200">Get Started</Link>
          </div>
        </div>
      </nav>

      <section className="relative min-h-[600px] flex items-center overflow-hidden" style={{ backgroundImage: `linear-gradient(rgba(17, 24, 39, 0.7), rgba(17, 24, 39, 0.85)), url('https://static.prod-images.emergentagent.com/jobs/1c60e779-4d9f-4612-a5fc-aea4121ed517/images/062b1c693ac2158f2ceb57e8bdde872c29adbfb5544089ac7fba431547124f6a.png')`, backgroundSize: 'cover', backgroundPosition: 'center' }}>
        <div className="max-w-7xl mx-auto px-6 py-20 relative z-10">
          <div className="max-w-3xl">
            <h1 className="font-heading text-4xl sm:text-5xl lg:text-6xl tracking-tighter font-semibold text-text-inverse mb-6 leading-none">
              Smart Corporate Food Ordering for Modern Workplaces
            </h1>
            <p className="text-lg text-gray-300 mb-8 leading-relaxed">
              Transform your office cafeteria experience with AI-powered meal recommendations, seamless ordering, and real-time tracking. Built for enterprises, loved by employees.
            </p>
            <div className="flex flex-wrap gap-4">
              <Link to="/register" data-testid="hero-cta-btn" className="bg-primary hover:bg-primary-hover text-white px-8 py-3 rounded-full font-medium transition-all duration-200 flex items-center space-x-2">
                <span>Get Started Free</span>
                <ChevronRight className="h-5 w-5" />
              </Link>
              <button data-testid="demo-btn" className="bg-white/10 backdrop-blur-sm hover:bg-white/20 text-white border border-white/30 px-8 py-3 rounded-full font-medium transition-all duration-200">
                Watch Demo
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-6 py-20">
        <div className="text-center mb-16">
          <h2 className="font-heading text-2xl sm:text-3xl lg:text-4xl tracking-tight font-medium text-text-primary mb-4">
            Everything Your Corporate Cafeteria Needs
          </h2>
          <p className="text-text-secondary text-lg max-w-2xl mx-auto">
            A complete ecosystem connecting employees, vendors, and administrators
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div data-testid="feature-employees" className="bg-card border border-border-light rounded-2xl p-8 hover:shadow-lg transition-all duration-200">
            <div className="bg-primary-light rounded-xl w-14 h-14 flex items-center justify-center mb-6">
              <Utensils className="h-7 w-7 text-primary" />
            </div>
            <h3 className="font-heading text-xl font-medium text-text-primary mb-3">For Employees</h3>
            <p className="text-text-secondary leading-relaxed mb-4">
              Browse menus, get AI recommendations, pre-order meals, track orders in real-time, and manage meal subscriptions.
            </p>
            <ul className="space-y-2 text-sm text-text-secondary">
              <li className="flex items-start">
                <span className="text-primary mr-2">✓</span>
                <span>Smart meal recommendations</span>
              </li>
              <li className="flex items-start">
                <span className="text-primary mr-2">✓</span>
                <span>Pre-order & scheduled ordering</span>
              </li>
              <li className="flex items-start">
                <span className="text-primary mr-2">✓</span>
                <span>QR code pickup</span>
              </li>
            </ul>
          </div>

          <div data-testid="feature-vendors" className="bg-card border border-border-light rounded-2xl p-8 hover:shadow-lg transition-all duration-200">
            <div className="bg-accent-light rounded-xl w-14 h-14 flex items-center justify-center mb-6">
              <Building2 className="h-7 w-7 text-accent-hover" />
            </div>
            <h3 className="font-heading text-xl font-medium text-text-primary mb-3">For Vendors</h3>
            <p className="text-text-secondary leading-relaxed mb-4">
              Manage orders, update menus dynamically, track inventory, and access powerful analytics dashboards.
            </p>
            <ul className="space-y-2 text-sm text-text-secondary">
              <li className="flex items-start">
                <span className="text-accent-hover mr-2">✓</span>
                <span>Live order management</span>
              </li>
              <li className="flex items-start">
                <span className="text-accent-hover mr-2">✓</span>
                <span>Revenue analytics</span>
              </li>
              <li className="flex items-start">
                <span className="text-accent-hover mr-2">✓</span>
                <span>Inventory tracking</span>
              </li>
            </ul>
          </div>

          <div data-testid="feature-admins" className="bg-card border border-border-light rounded-2xl p-8 hover:shadow-lg transition-all duration-200">
            <div className="bg-blue-50 rounded-xl w-14 h-14 flex items-center justify-center mb-6">
              <TrendingUp className="h-7 w-7 text-blue-600" />
            </div>
            <h3 className="font-heading text-xl font-medium text-text-primary mb-3">For Admins</h3>
            <p className="text-text-secondary leading-relaxed mb-4">
              Corporate and super admin dashboards with employee management, billing, and comprehensive analytics.
            </p>
            <ul className="space-y-2 text-sm text-text-secondary">
              <li className="flex items-start">
                <span className="text-blue-600 mr-2">✓</span>
                <span>Employee spending insights</span>
              </li>
              <li className="flex items-start">
                <span className="text-blue-600 mr-2">✓</span>
                <span>Subsidy management</span>
              </li>
              <li className="flex items-start">
                <span className="text-blue-600 mr-2">✓</span>
                <span>Vendor performance tracking</span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      <section className="bg-gradient-to-br from-primary-light to-accent-light py-20">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex items-center justify-between flex-wrap gap-8">
            <div className="flex items-center space-x-4">
              <Sparkles className="h-12 w-12 text-primary" />
              <div>
                <h3 className="font-heading text-2xl font-medium text-text-primary mb-1">AI-Powered Recommendations</h3>
                <p className="text-text-secondary">Personalized meal suggestions based on preferences and dietary needs</p>
              </div>
            </div>
            <Link to="/register" data-testid="ai-cta-btn" className="bg-primary hover:bg-primary-hover text-white px-8 py-3 rounded-full font-medium transition-all duration-200 whitespace-nowrap">
              Try AI Features
            </Link>
          </div>
        </div>
      </section>

      <footer className="bg-dark-sections text-text-inverse py-12">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex justify-between items-center flex-wrap gap-8">
            <div className="flex items-center space-x-2">
              <img src={LOGO_URL} alt="Cravitoo" className="h-10 w-auto object-contain bg-white p-1 rounded" />
            </div>
            <p className="text-gray-400 text-sm">
              © 2026 Cravitoo. Good Food. Easy Order. Happy Team.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;