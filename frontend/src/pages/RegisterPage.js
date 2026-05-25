import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { UserPlus } from 'lucide-react';

const LOGO_URL = 'https://customer-assets.emergentagent.com/job_corporate-feast/artifacts/lpcd18p4_29aaeaa4-ac4d-4437-8a14-0af8214d6039.png';

const formatApiErrorDetail = (detail) => {
  if (detail == null) return 'Something went wrong. Please try again.';
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail))
    return detail.map((e) => (e && typeof e.msg === 'string' ? e.msg : JSON.stringify(e))).filter(Boolean).join(' ');
  if (detail && typeof detail.msg === 'string') return detail.msg;
  return String(detail);
};

const RegisterPage = () => {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    role: 'employee'
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const user = await register(formData.email, formData.password, formData.name, formData.role);
      
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
          <h1 className="font-heading text-3xl font-semibold text-text-primary mb-2">Create Account</h1>
          <p className="text-text-secondary">Join the Cravitoo platform today</p>
        </div>

        <div className="bg-card border border-border-light rounded-2xl p-8 shadow-sm">
          <form onSubmit={handleSubmit} data-testid="register-form">
            <div className="mb-6">
              <label className="block text-sm font-medium text-text-primary mb-2" htmlFor="name">
                Full Name
              </label>
              <input
                type="text"
                id="name"
                data-testid="register-name-input"
                value={formData.name}
                onChange={(e) => setFormData({...formData, name: e.target.value})}
                className="w-full px-4 py-3 border border-border-light rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-200 bg-background"
                placeholder="John Doe"
                required
              />
            </div>

            <div className="mb-6">
              <label className="block text-sm font-medium text-text-primary mb-2" htmlFor="email">
                Email Address
              </label>
              <input
                type="email"
                id="email"
                data-testid="register-email-input"
                value={formData.email}
                onChange={(e) => setFormData({...formData, email: e.target.value})}
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
                data-testid="register-password-input"
                value={formData.password}
                onChange={(e) => setFormData({...formData, password: e.target.value})}
                className="w-full px-4 py-3 border border-border-light rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-200 bg-background"
                placeholder="••••••••"
                required
                minLength={6}
              />
            </div>

            <div className="mb-6">
              <label className="block text-sm font-medium text-text-primary mb-2" htmlFor="role">
                I am a
              </label>
              <select
                id="role"
                data-testid="register-role-select"
                value={formData.role}
                onChange={(e) => setFormData({...formData, role: e.target.value})}
                className="w-full px-4 py-3 border border-border-light rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-200 bg-background"
              >
                <option value="employee">Employee</option>
                <option value="vendor">Vendor</option>
                <option value="corporate_admin">Corporate Admin</option>
              </select>
            </div>

            {error && (
              <div data-testid="register-error" className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              data-testid="register-submit-btn"
              disabled={loading}
              className="w-full bg-primary hover:bg-primary-hover text-white font-medium py-3 rounded-lg transition-all duration-200 flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
              ) : (
                <>
                  <UserPlus className="h-5 w-5" />
                  <span>Create Account</span>
                </>
              )}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-text-secondary text-sm">
              Already have an account?{' '}
              <Link to="/login" data-testid="register-login-link" className="text-primary hover:text-primary-hover font-medium transition-all duration-200">
                Sign In
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RegisterPage;