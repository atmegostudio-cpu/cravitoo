import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';

import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';

import EmployeeDashboard from './pages/employee/Dashboard';
import EmployeeMenu from './pages/employee/Menu';
import EmployeeOrders from './pages/employee/Orders';
import EmployeePreferences from './pages/employee/Preferences';
import EmployeeSubscriptions from './pages/employee/Subscriptions';
import EmployeeLoyalty from './pages/employee/Loyalty';
import BulkOrder from './pages/employee/BulkOrder';

import VendorDashboard from './pages/vendor/Dashboard';
import VendorOrders from './pages/vendor/Orders';
import VendorMenu from './pages/vendor/Menu';
import VendorVerifyPickup from './pages/vendor/VerifyPickup';
import VendorAIInsights from './pages/vendor/AIInsights';

import CorporateAdminDashboard from './pages/admin/Dashboard';
import CorporateBulkPreOrder from './pages/admin/BulkPreOrder';
import CorporateAdminEmployees from './pages/admin/Employees';

import SuperAdminDashboard from './pages/superadmin/Dashboard';

import MasterDashboard from './pages/master/Dashboard';
import MasterSites from './pages/master/Sites';
import MasterAdmins from './pages/master/Admins';
import MasterVendors from './pages/master/Vendors';
import MasterCities from './pages/master/Cities';
import MasterAllowedDomains from './pages/master/AllowedDomains';
import MasterCorporateClients from './pages/master/CorporateClients';
import MasterBilling from './pages/master/Billing';
import BulkOnboard from './pages/master/BulkOnboard';
import SiteDetail from './pages/master/SiteDetail';

import SiteAdminDashboard from './pages/siteadmin/Dashboard';

import OnboardingList from './pages/OnboardingList';
import OnboardingNew from './pages/OnboardingNew';
import OnboardingDetail from './pages/OnboardingDetail';

import EventCatering from './pages/shared/EventCatering';

import PrivacyPolicy from './pages/legal/PrivacyPolicy';
import TermsOfService from './pages/legal/TermsOfService';
import DataSettings from './pages/legal/DataSettings';
import ChangePassword from './pages/legal/ChangePassword';
import ResetApp from './pages/master/ResetApp';
import CookieConsent from './components/CookieConsent';

import VendorMenuRequests from './pages/vendor/MenuRequests';
import AdminMenuRequests from './pages/master/MenuRequests';

import EmployeeReservations from './pages/employee/Reservations';
import VendorReservations from './pages/vendor/Reservations';
import AdminReservations from './pages/master/Reservations';
import MasterBroadcasts from './pages/master/Broadcasts';

// Stable role arrays — extracted from inline props to avoid churning React
// reconciler on every render (each inline `[...]` was a fresh reference).
const ROLES_EMPLOYEE = ['employee'];
const ROLES_VENDOR = ['vendor'];
const ROLES_CORPORATE = ['corporate_admin'];
const ROLES_SUPER = ['super_admin'];
const ROLES_MASTER = ['master_admin'];
const ROLES_SITE = ['site_admin'];
const ROLES_MASTER_CORPORATE = ['master_admin', 'corporate_admin'];
const ROLES_MASTER_SUPER = ['master_admin', 'super_admin'];
const ROLES_SITE_MASTER_SUPER = ['site_admin', 'master_admin', 'super_admin'];
const ROLES_ONBOARDING_STAFF = ['master_admin', 'city_admin', 'site_admin'];
const ROLES_ADMIN_ALL = ['master_admin', 'super_admin', 'site_admin', 'city_admin'];
const ROLES_ANY = ['employee', 'vendor', 'corporate_admin', 'super_admin', 'master_admin', 'site_admin', 'city_admin'];

function AppRoutes() {
  const { user } = useAuth();

  const getDefaultRoute = () => {
    if (!user) return '/';
    switch (user.role) {
      case 'employee':
        return '/employee/dashboard';
      case 'vendor':
        return '/vendor/dashboard';
      case 'corporate_admin':
        return '/admin/dashboard';
      case 'super_admin':
        return '/super-admin/dashboard';
      case 'master_admin':
        return '/master/dashboard';
      case 'site_admin':
        return '/site-admin/dashboard';
      case 'city_admin':
        return '/onboarding';
      default:
        return '/';
    }
  };

  return (
    <Routes>
      <Route path="/" element={user ? <Navigate to={getDefaultRoute()} replace /> : <LandingPage />} />
      <Route path="/login" element={user ? <Navigate to={getDefaultRoute()} replace /> : <LoginPage />} />
      <Route path="/register" element={user ? <Navigate to={getDefaultRoute()} replace /> : <RegisterPage />} />
      
      {/* Employee Routes */}
      <Route path="/employee/dashboard" element={
        <ProtectedRoute allowedRoles={ROLES_EMPLOYEE}>
          <EmployeeDashboard />
        </ProtectedRoute>
      } />
      <Route path="/employee/menu" element={
        <ProtectedRoute allowedRoles={ROLES_EMPLOYEE}>
          <EmployeeMenu />
        </ProtectedRoute>
      } />
      <Route path="/employee/orders" element={
        <ProtectedRoute allowedRoles={ROLES_EMPLOYEE}>
          <EmployeeOrders />
        </ProtectedRoute>
      } />
      <Route path="/employee/preferences" element={
        <ProtectedRoute allowedRoles={ROLES_EMPLOYEE}>
          <EmployeePreferences />
        </ProtectedRoute>
      } />
      <Route path="/employee/subscriptions" element={
        <ProtectedRoute allowedRoles={ROLES_EMPLOYEE}>
          <EmployeeSubscriptions />
        </ProtectedRoute>
      } />
      <Route path="/employee/loyalty" element={
        <ProtectedRoute allowedRoles={ROLES_EMPLOYEE}>
          <EmployeeLoyalty />
        </ProtectedRoute>
      } />
      <Route path="/employee/bulk-order" element={
        <ProtectedRoute allowedRoles={ROLES_EMPLOYEE}>
          <BulkOrder />
        </ProtectedRoute>
      } />
      <Route path="/employee/events" element={
        <ProtectedRoute allowedRoles={ROLES_EMPLOYEE}>
          <EventCatering />
        </ProtectedRoute>
      } />
      
      {/* Vendor Routes */}
      <Route path="/vendor/dashboard" element={
        <ProtectedRoute allowedRoles={ROLES_VENDOR}>
          <VendorDashboard />
        </ProtectedRoute>
      } />
      <Route path="/vendor/orders" element={
        <ProtectedRoute allowedRoles={ROLES_VENDOR}>
          <VendorOrders />
        </ProtectedRoute>
      } />
      <Route path="/vendor/menu" element={
        <ProtectedRoute allowedRoles={ROLES_VENDOR}>
          <VendorMenu />
        </ProtectedRoute>
      } />
      <Route path="/vendor/verify-pickup" element={
        <ProtectedRoute allowedRoles={ROLES_VENDOR}>
          <VendorVerifyPickup />
        </ProtectedRoute>
      } />
      <Route path="/vendor/ai-insights" element={
        <ProtectedRoute allowedRoles={ROLES_VENDOR}>
          <VendorAIInsights />
        </ProtectedRoute>
      } />
      
      {/* Corporate Admin Routes */}
      <Route path="/admin/dashboard" element={
        <ProtectedRoute allowedRoles={ROLES_CORPORATE}>
          <CorporateAdminDashboard />
        </ProtectedRoute>
      } />
      <Route path="/admin/employees" element={
        <ProtectedRoute allowedRoles={ROLES_CORPORATE}>
          <CorporateAdminEmployees />
        </ProtectedRoute>
      } />
      <Route path="/admin/events" element={
        <ProtectedRoute allowedRoles={ROLES_CORPORATE}>
          <EventCatering />
        </ProtectedRoute>
      } />
      <Route path="/admin/bulk-pre-order" element={
        <ProtectedRoute allowedRoles={ROLES_CORPORATE}>
          <CorporateBulkPreOrder />
        </ProtectedRoute>
      } />
      
      {/* Super Admin Routes */}
      <Route path="/super-admin/dashboard" element={
        <ProtectedRoute allowedRoles={ROLES_SUPER}>
          <SuperAdminDashboard />
        </ProtectedRoute>
      } />

      {/* Master Admin Routes */}
      <Route path="/master/dashboard" element={
        <ProtectedRoute allowedRoles={ROLES_MASTER}>
          <MasterDashboard />
        </ProtectedRoute>
      } />
      <Route path="/master/sites" element={
        <ProtectedRoute allowedRoles={ROLES_MASTER}>
          <MasterSites />
        </ProtectedRoute>
      } />
      <Route path="/master/sites/:siteId" element={
        <ProtectedRoute allowedRoles={ROLES_MASTER_SUPER}>
          <SiteDetail />
        </ProtectedRoute>
      } />
      <Route path="/master/admins" element={
        <ProtectedRoute allowedRoles={ROLES_MASTER}>
          <MasterAdmins />
        </ProtectedRoute>
      } />
      <Route path="/master/vendors" element={
        <ProtectedRoute allowedRoles={ROLES_MASTER}>
          <MasterVendors />
        </ProtectedRoute>
      } />
      <Route path="/master/bulk-onboard" element={
        <ProtectedRoute allowedRoles={ROLES_MASTER_CORPORATE}>
          <BulkOnboard />
        </ProtectedRoute>
      } />
      <Route path="/master/cities" element={
        <ProtectedRoute allowedRoles={ROLES_MASTER}>
          <MasterCities />
        </ProtectedRoute>
      } />
      <Route path="/master/broadcasts" element={
        <ProtectedRoute allowedRoles={ROLES_MASTER}>
          <MasterBroadcasts />
        </ProtectedRoute>
      } />
      <Route path="/master/allowed-domains" element={
        <ProtectedRoute allowedRoles={ROLES_MASTER}>
          <MasterAllowedDomains />
        </ProtectedRoute>
      } />
      <Route path="/master/corporate-clients" element={
        <ProtectedRoute allowedRoles={ROLES_MASTER}>
          <MasterCorporateClients />
        </ProtectedRoute>
      } />
      <Route path="/master/billing" element={
        <ProtectedRoute allowedRoles={ROLES_MASTER}>
          <MasterBilling />
        </ProtectedRoute>
      } />

      {/* Vendor Onboarding (shared by site_admin / city_admin / master_admin) */}
      <Route path="/onboarding" element={
        <ProtectedRoute allowedRoles={ROLES_ONBOARDING_STAFF}>
          <OnboardingList />
        </ProtectedRoute>
      } />
      <Route path="/onboarding/new" element={
        <ProtectedRoute allowedRoles={ROLES_ONBOARDING_STAFF}>
          <OnboardingNew />
        </ProtectedRoute>
      } />
      <Route path="/onboarding/:onbId" element={
        <ProtectedRoute allowedRoles={ROLES_ONBOARDING_STAFF}>
          <OnboardingDetail />
        </ProtectedRoute>
      } />

      {/* Site Admin Routes */}
      <Route path="/site-admin/dashboard" element={
        <ProtectedRoute allowedRoles={ROLES_SITE}>
          <SiteAdminDashboard />
        </ProtectedRoute>
      } />
      <Route path="/site-admin/site/:siteId" element={
        <ProtectedRoute allowedRoles={ROLES_SITE_MASTER_SUPER}>
          <SiteDetail />
        </ProtectedRoute>
      } />

      {/* Legal & Privacy (public + protected for data settings) */}
      <Route path="/privacy" element={<PrivacyPolicy />} />
      <Route path="/terms" element={<TermsOfService />} />
      <Route path="/settings/data" element={
        <ProtectedRoute allowedRoles={ROLES_ANY}>
          <DataSettings />
        </ProtectedRoute>
      } />
      <Route path="/settings/security" element={
        <ProtectedRoute allowedRoles={ROLES_ANY}>
          <ChangePassword />
        </ProtectedRoute>
      } />
      <Route path="/master/reset" element={
        <ProtectedRoute allowedRoles={ROLES_MASTER_SUPER}>
          <ResetApp />
        </ProtectedRoute>
      } />

      {/* Menu change requests */}
      <Route path="/vendor/menu-requests" element={
        <ProtectedRoute allowedRoles={ROLES_VENDOR}>
          <VendorMenuRequests />
        </ProtectedRoute>
      } />
      <Route path="/admin/menu-requests" element={
        <ProtectedRoute allowedRoles={ROLES_ADMIN_ALL}>
          <AdminMenuRequests />
        </ProtectedRoute>
      } />

      {/* Meal reservations (pre-orders / head-count) */}
      <Route path="/employee/reservations" element={
        <ProtectedRoute allowedRoles={ROLES_EMPLOYEE}>
          <EmployeeReservations />
        </ProtectedRoute>
      } />
      <Route path="/vendor/reservations" element={
        <ProtectedRoute allowedRoles={ROLES_VENDOR}>
          <VendorReservations />
        </ProtectedRoute>
      } />
      <Route path="/admin/reservations" element={
        <ProtectedRoute allowedRoles={ROLES_ADMIN_ALL}>
          <AdminReservations />
        </ProtectedRoute>
      } />
    </Routes>
  );
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
        <CookieConsent />
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
