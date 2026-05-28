import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LogIn } from 'lucide-react';

const LOGO_URL = 'https://customer-assets.emergentagent.com/job_corporate-feast/artifacts/j6kduny0_WhatsApp%20Image%202026-05-27%20at%2011.03.31%20AM%20-%20Edited.png';

const formatApiErrorDetail = (detail) => {
  if (detail == null) return 'Something went wrong. Please try again.';
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail))
    return detail.map((e) => (e && typeof e.msg === 'string' ? e.msg : JSON.stringify(e))).filter(Boolean).join(' ');
  if (detail && typeof detail.msg === 'string') return detail.msg;
  return String(detail);
};

const LoginPage = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const user = await login(email, password);
      
      switch (user.role) {
        case 'employee':
          navigate('/employee/dashboard');
          break;
        case 'vendor':
          navigate('/vendor/dashboard');
          break;
        case 'corporate_admin':
          navigate('/admin/dashboard');
          break;
        case 'super_admin':
          navigate('/super-admin/dashboard');
          break;
        default:
          navigate('/');
      }
    } catch (err) {
      setError(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center justify-center mb-6">
            <img src={LOGO_URL} alt="Cravitoo" className="h-20 w-auto object-contain" />
          </Link>
          <h1 className="font-heading text-3xl font-semibold text-text-primary mb-2">Welcome Back</h1>
          <p className="text-text-secondary">Sign in to your account to continue</p>
        </div>

        <div className="bg-card border border-border-light rounded-2xl p-8 shadow-sm">
          <form onSubmit={handleSubmit} data-testid="login-form">
            <div className="mb-6">
              <label className="block text-sm font-medium text-text-primary mb-2" htmlFor="email">
                Email Address
              </label>
              <input
                type="email"
                id="email"
                data-testid="login-email-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 border border-border-light rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-200 bg-background"
                placeholder="you@company.com"
                required
              />
            </div>

            <div className="mb-6">
              <label className="block text-sm font-medium text-text-primary mb-2" htmlFor="password">
                Password
              </label>
              <input
                type="password"
                id="password"
                data-testid="login-password-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 border border-border-light rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-200 bg-background"
                placeholder="••••••••"
                required
              />
            </div>

            {error && (
              <div data-testid="login-error" className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              data-testid="login-submit-btn"
              disabled={loading}
              className="w-full bg-primary hover:bg-primary-hover text-white font-medium py-3 rounded-lg transition-all duration-200 flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
              ) : (
                <>
                  <LogIn className="h-5 w-5" />
                  <span>Sign In</span>
                </>
              )}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-text-secondary text-sm">
              Don't have an account?{' '}
              <Link to="/register" data-testid="login-register-link" className="text-primary hover:text-primary-hover font-medium transition-all duration-200">
                Create Account
              </Link>
            </p>
          </div>

          <div className="mt-6 pt-6 border-t border-border-light">
            <p className="text-xs text-text-muted text-center mb-4">Demo Accounts:</p>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="bg-background p-3 rounded-lg">
                <p className="font-medium text-text-primary mb-1">Employee</p>
                <p className="text-text-muted">employee@techcorp.com</p>
                <p className="text-text-muted">employee123</p>
              </div>
              <div className="bg-background p-3 rounded-lg">
                <p className="font-medium text-text-primary mb-1">Vendor</p>
                <p className="text-text-muted">vendor@spicekitchen.com</p>
                <p className="text-text-muted">vendor123</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;