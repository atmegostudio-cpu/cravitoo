import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LogIn, Mail, KeyRound, ArrowLeft, ShieldCheck } from 'lucide-react';

const LOGO_URL = 'https://customer-assets.emergentagent.com/job_corporate-feast/artifacts/j6kduny0_WhatsApp%20Image%202026-05-27%20at%2011.03.31%20AM%20-%20Edited.png';

const formatApiErrorDetail = (detail) => {
  if (detail == null) return null;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail))
    return detail.map((e) => (e && typeof e.msg === 'string' ? e.msg : JSON.stringify(e))).filter(Boolean).join(' ');
  if (detail && typeof detail.msg === 'string') return detail.msg;
  return String(detail);
};

const extractErrorMessage = (err) => {
  // 1. Server returned a structured error (4xx/5xx with JSON body)
  const detail = formatApiErrorDetail(err?.response?.data?.detail);
  if (detail) return detail;

  // 2. Server returned an unstructured error (HTML page, plain text)
  if (err?.response?.status) {
    const code = err.response.status;
    if (code === 401) return 'Invalid email or password.';
    if (code === 403) return 'Access denied.';
    if (code === 404) return 'Account not found.';
    if (code === 429) return 'Too many attempts. Please wait a few minutes and try again.';
    if (code >= 500) return `Our server hit a snag (${code}). Please try again in a moment.`;
    return `Request failed (${code}). Please try again.`;
  }

  // 3. Network-level failure (CORS, DNS, offline, timeout, certificate)
  const msg = (err?.message || '').toLowerCase();
  if (msg.includes('network') || msg.includes('failed to fetch')) {
    return "Can't reach Cravitoo right now. Check your internet connection and try again.";
  }
  if (msg.includes('timeout') || err?.code === 'ECONNABORTED') {
    return "Request timed out. Please try again.";
  }

  // 4. Last-resort fallback (include err.message if useful)
  return err?.message ? `Login failed: ${err.message}` : 'Login failed. Please try again.';
};

const routeByRole = (role) => {
  switch (role) {
    case 'employee': return '/employee/dashboard';
    case 'vendor': return '/vendor/dashboard';
    case 'corporate_admin': return '/admin/dashboard';
    case 'master_admin': return '/master/dashboard';
    case 'super_admin': return '/super-admin/dashboard';
    case 'site_admin': return '/site-admin/dashboard';
    case 'city_admin': return '/master/dashboard';
    default: return '/';
  }
};

const LoginPage = () => {
  const [mode, setMode] = useState('password'); // 'password' | 'otp-request' | 'otp-verify'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpCountdown, setOtpCountdown] = useState(0);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, loginWithOtp, requestOtp } = useAuth();
  const navigate = useNavigate();

  // Show a friendly message if the user was bounced here by the axios interceptor
  // due to a 401 (refresh token expired / no session)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('expired') === '1') {
      setInfo('Your session expired. Please log in again — your work is safe.');
    }
  }, []);

  useEffect(() => {
    if (otpCountdown <= 0) return undefined;
    const t = setTimeout(() => setOtpCountdown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [otpCountdown]);

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const user = await login(email, password);
      navigate(routeByRole(user.role));
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleRequestOtp = async (e) => {
    e.preventDefault();
    setError(''); setInfo(''); setLoading(true);
    try {
      const data = await requestOtp(email, 'email');
      setMode('otp-verify');
      setOtpCountdown((data.expires_in_minutes || 10) * 60);
      setInfo(`We sent a 6-digit code to ${email}. Check your inbox (and spam folder).`);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const data = await loginWithOtp(email, otpCode);
      if (data.auto_created) {
        setInfo("Welcome! We've created your Cravitoo account.");
      }
      navigate(routeByRole(data.role));
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const resetToPassword = () => {
    setMode('password');
    setError(''); setInfo('');
    setOtpCode(''); setOtpCountdown(0);
  };

  const goToOtpRequest = () => {
    setMode('otp-request');
    setError(''); setInfo('');
  };

  const formatCountdown = () => {
    if (otpCountdown <= 0) return null;
    const m = Math.floor(otpCountdown / 60);
    const s = otpCountdown % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center justify-center mb-6">
            <img src={LOGO_URL} alt="Cravitoo" className="h-20 w-auto object-contain" />
          </Link>
          <h1 className="font-heading text-3xl font-semibold text-text-primary mb-2">
            {mode === 'password' && 'Welcome Back'}
            {mode === 'otp-request' && 'Login with Email Code'}
            {mode === 'otp-verify' && 'Enter Verification Code'}
          </h1>
          <p className="text-text-secondary">
            {mode === 'password' && 'Sign in to your account to continue'}
            {mode === 'otp-request' && "We'll send a 6-digit code to your inbox"}
            {mode === 'otp-verify' && `Check the email we sent to ${email}`}
          </p>
        </div>

        <div className="bg-card border border-border-light rounded-2xl p-8 shadow-sm">
          {/* PASSWORD LOGIN */}
          {mode === 'password' && (
            <>
              <form onSubmit={handlePasswordSubmit} data-testid="login-form">
                <div className="mb-6">
                  <label className="block text-sm font-medium text-text-primary mb-2" htmlFor="email">Email Address</label>
                  <input
                    type="email" id="email" data-testid="login-email-input"
                    value={email} onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-4 py-3 border border-border-light rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-200 bg-background"
                    placeholder="you@company.com" required
                  />
                </div>
                <div className="mb-6">
                  <label className="block text-sm font-medium text-text-primary mb-2" htmlFor="password">Password</label>
                  <input
                    type="password" id="password" data-testid="login-password-input"
                    value={password} onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-4 py-3 border border-border-light rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-200 bg-background"
                    placeholder="••••••••" required
                  />
                </div>
                {error && (
                  <div data-testid="login-error" className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
                )}
                <button type="submit" data-testid="login-submit-btn" disabled={loading}
                  className="w-full bg-primary hover:bg-primary-hover text-white font-medium py-3 rounded-lg transition-all duration-200 flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed">
                  {loading ? <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div> : (<><LogIn className="h-5 w-5" /><span>Sign In</span></>)}
                </button>
              </form>

              {/* Divider */}
              <div className="mt-6 mb-6 flex items-center">
                <div className="flex-1 border-t border-border-light"></div>
                <span className="px-3 text-xs text-text-muted">OR</span>
                <div className="flex-1 border-t border-border-light"></div>
              </div>

              <button
                type="button"
                onClick={goToOtpRequest}
                data-testid="login-with-otp-btn"
                className="w-full bg-background hover:bg-primary-light text-text-primary border border-border-light hover:border-primary font-medium py-3 rounded-lg transition-all duration-200 flex items-center justify-center space-x-2"
              >
                <Mail className="h-5 w-5" />
                <span>Login with Email Code</span>
              </button>

              <div className="mt-6 text-center">
                <p className="text-text-secondary text-sm">
                  Don't have an account?{' '}
                  <Link to="/register" data-testid="login-register-link" className="text-primary hover:text-primary-hover font-medium transition-all duration-200">Create Account</Link>
                </p>
              </div>
            </>
          )}

          {/* OTP REQUEST */}
          {mode === 'otp-request' && (
            <form onSubmit={handleRequestOtp} data-testid="otp-request-form">
              <button type="button" onClick={resetToPassword} className="text-sm text-text-secondary hover:text-text-primary mb-4 flex items-center space-x-1" data-testid="otp-back-btn">
                <ArrowLeft className="h-4 w-4" /><span>Back to password login</span>
              </button>
              <div className="mb-6">
                <label className="block text-sm font-medium text-text-primary mb-2" htmlFor="otp-email">Email Address</label>
                <input
                  type="email" id="otp-email" data-testid="otp-email-input"
                  value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus
                  className="w-full px-4 py-3 border border-border-light rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-200 bg-background"
                  placeholder="you@company.com"
                />
                <p className="text-xs text-text-muted mt-2">No password needed. We'll send a code to this inbox.</p>
              </div>
              {error && <div data-testid="otp-error" className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}
              <button type="submit" data-testid="otp-request-submit-btn" disabled={loading}
                className="w-full bg-primary hover:bg-primary-hover text-white font-medium py-3 rounded-lg transition-all duration-200 flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed">
                {loading ? <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div> : (<><Mail className="h-5 w-5" /><span>Send Code</span></>)}
              </button>
            </form>
          )}

          {/* OTP VERIFY */}
          {mode === 'otp-verify' && (
            <form onSubmit={handleVerifyOtp} data-testid="otp-verify-form">
              <button type="button" onClick={() => setMode('otp-request')} className="text-sm text-text-secondary hover:text-text-primary mb-4 flex items-center space-x-1" data-testid="otp-verify-back-btn">
                <ArrowLeft className="h-4 w-4" /><span>Use a different email</span>
              </button>
              {info && (
                <div className="mb-4 p-3 bg-primary-light border border-primary/20 rounded-lg flex items-start space-x-2">
                  <ShieldCheck className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-text-primary">{info}</p>
                </div>
              )}
              <div className="mb-6">
                <label className="block text-sm font-medium text-text-primary mb-2" htmlFor="otp-code">6-digit code</label>
                <input
                  type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6}
                  id="otp-code" data-testid="otp-code-input"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                  autoFocus required
                  className="w-full px-4 py-3 border border-border-light rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-200 bg-background font-mono text-2xl text-center tracking-[0.6em]"
                  placeholder="000000"
                />
                <div className="flex justify-between mt-2 text-xs">
                  {otpCountdown > 0 ? (
                    <span className="text-text-muted" data-testid="otp-countdown">Expires in {formatCountdown()}</span>
                  ) : (
                    <span className="text-red-600" data-testid="otp-expired">Code expired</span>
                  )}
                  <button type="button" onClick={() => { setOtpCode(''); handleRequestOtp({ preventDefault: () => {} }); }} disabled={otpCountdown > 540} data-testid="otp-resend-btn" className="text-primary hover:underline disabled:text-text-muted disabled:no-underline disabled:cursor-not-allowed">
                    Resend code
                  </button>
                </div>
              </div>
              {error && <div data-testid="otp-verify-error" className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}
              <button type="submit" data-testid="otp-verify-submit-btn" disabled={loading || otpCode.length !== 6}
                className="w-full bg-primary hover:bg-primary-hover text-white font-medium py-3 rounded-lg transition-all duration-200 flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed">
                {loading ? <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div> : (<><KeyRound className="h-5 w-5" /><span>Verify &amp; Continue</span></>)}
              </button>
            </form>
          )}

          {/* Demo accounts always visible */}
          {mode === 'password' && (
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
          )}
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
