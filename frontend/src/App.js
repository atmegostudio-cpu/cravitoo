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
import CorporateAdminEmployees from './pages/admin/Employees';

import SuperAdminDashboard from './pages/superadmin/Dashboard';

import MasterDashboard from './pages/master/Dashboard';
import MasterSites from './pages/master/Sites';
import MasterAdmins from './pages/master/Admins';
import MasterVendors from './pages/master/Vendors';
import MasterCities from './pages/master/Cities';
import MasterAllowedDomains from './pages/master/AllowedDomains';
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
import CookieConsent from './components/CookieConsent';

import VendorMenuRequests from './pages/vendor/MenuRequests';
import AdminMenuRequests from './pages/master/MenuRequests';

import EmployeeReservations from './pages/employee/Reservations';
import VendorReservations from './pages/vendor/Reservations';
import AdminReservations from './pages/master/Reservations';
import MasterBroadcasts from './pages/master/Broadcasts';

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
        <ProtectedRoute allowedRoles={['employee']}>
          <EmployeeDashboard />
        </ProtectedRoute>
      } />
      <Route path="/employee/menu" element={
        <ProtectedRoute allowedRoles={['employee']}>
          <EmployeeMenu />
        </ProtectedRoute>
      } />
      <Route path="/employee/orders" element={
        <ProtectedRoute allowedRoles={['employee']}>
          <EmployeeOrders />
        </ProtectedRoute>
      } />
      <Route path="/employee/preferences" element={
        <ProtectedRoute allowedRoles={['employee']}>
          <EmployeePreferences />
        </ProtectedRoute>
      } />
      <Route path="/employee/subscriptions" element={
        <ProtectedRoute allowedRoles={['employee']}>
          <EmployeeSubscriptions />
        </ProtectedRoute>
      } />
      <Route path="/employee/loyalty" element={
        <ProtectedRoute allowedRoles={['employee']}>
          <EmployeeLoyalty />
        </ProtectedRoute>
      } />
      <Route path="/employee/bulk-order" element={
        <ProtectedRoute allowedRoles={['employee']}>
          <BulkOrder />
        </ProtectedRoute>
      } />
      <Route path="/employee/events" element={
        <ProtectedRoute allowedRoles={['employee']}>
          <EventCatering />
        </ProtectedRoute>
      } />
      
      {/* Vendor Routes */}
      <Route path="/vendor/dashboard" element={
        <ProtectedRoute allowedRoles={['vendor']}>
          <VendorDashboard />
        </ProtectedRoute>
      } />
      <Route path="/vendor/orders" element={
        <ProtectedRoute allowedRoles={['vendor']}>
          <VendorOrders />
        </ProtectedRoute>
      } />
      <Route path="/vendor/menu" element={
        <ProtectedRoute allowedRoles={['vendor']}>
          <VendorMenu />
        </ProtectedRoute>
      } />
      <Route path="/vendor/verify-pickup" element={
        <ProtectedRoute allowedRoles={['vendor']}>
          <VendorVerifyPickup />
        </ProtectedRoute>
      } />
      <Route path="/vendor/ai-insights" element={
        <ProtectedRoute allowedRoles={['vendor']}>
          <VendorAIInsights />
        </ProtectedRoute>
      } />
      
      {/* Corporate Admin Routes */}
      <Route path="/admin/dashboard" element={
        <ProtectedRoute allowedRoles={['corporate_admin']}>
          <CorporateAdminDashboard />
        </ProtectedRoute>
      } />
      <Route path="/admin/employees" element={
        <ProtectedRoute allowedRoles={['corporate_admin']}>
          <CorporateAdminEmployees />
        </ProtectedRoute>
      } />
      <Route path="/admin/events" element={
        <ProtectedRoute allowedRoles={['corporate_admin']}>
          <EventCatering />
        </ProtectedRoute>
      } />
      
      {/* Super Admin Routes */}
      <Route path="/super-admin/dashboard" element={
        <ProtectedRoute allowedRoles={['super_admin']}>
          <SuperAdminDashboard />
        </ProtectedRoute>
      } />

      {/* Master Admin Routes */}
      <Route path="/master/dashboard" element={
        <ProtectedRoute allowedRoles={['master_admin']}>
          <MasterDashboard />
        </ProtectedRoute>
      } />
      <Route path="/master/sites" element={
        <ProtectedRoute allowedRoles={['master_admin']}>
          <MasterSites />
        </ProtectedRoute>
      } />
      <Route path="/master/sites/:siteId" element={
        <ProtectedRoute allowedRoles={['master_admin', 'super_admin']}>
          <SiteDetail />
        </ProtectedRoute>
      } />
      <Route path="/master/admins" element={
        <ProtectedRoute allowedRoles={['master_admin']}>
          <MasterAdmins />
        </ProtectedRoute>
      } />
      <Route path="/master/vendors" element={
        <ProtectedRoute allowedRoles={['master_admin']}>
          <MasterVendors />
        </ProtectedRoute>
      } />
      <Route path="/master/bulk-onboard" element={
        <ProtectedRoute allowedRoles={['master_admin', 'corporate_admin']}>
          <BulkOnboard />
        </ProtectedRoute>
      } />
      <Route path="/master/cities" element={
        <ProtectedRoute allowedRoles={['master_admin']}>
          <MasterCities />
        </ProtectedRoute>
      } />
      <Route path="/master/broadcasts" element={
        <ProtectedRoute allowedRoles={['master_admin']}>
          <MasterBroadcasts />
        </ProtectedRoute>
      } />
      <Route path="/master/allowed-domains" element={
        <ProtectedRoute allowedRoles={['master_admin']}>
          <MasterAllowedDomains />
        </ProtectedRoute>
      } />

      {/* Vendor Onboarding (shared by site_admin / city_admin / master_admin) */}
      <Route path="/onboarding" element={
        <ProtectedRoute allowedRoles={['master_admin', 'city_admin', 'site_admin']}>
          <OnboardingList />
        </ProtectedRoute>
      } />
      <Route path="/onboarding/new" element={
        <ProtectedRoute allowedRoles={['master_admin', 'city_admin', 'site_admin']}>
          <OnboardingNew />
        </ProtectedRoute>
      } />
      <Route path="/onboarding/:onbId" element={
        <ProtectedRoute allowedRoles={['master_admin', 'city_admin', 'site_admin']}>
          <OnboardingDetail />
        </ProtectedRoute>
      } />

      {/* Site Admin Routes */}
      <Route path="/site-admin/dashboard" element={
        <ProtectedRoute allowedRoles={['site_admin']}>
          <SiteAdminDashboard />
        </ProtectedRoute>
      } />
      <Route path="/site-admin/site/:siteId" element={
        <ProtectedRoute allowedRoles={['site_admin', 'master_admin', 'super_admin']}>
          <SiteDetail />
        </ProtectedRoute>
      } />

      {/* Legal & Privacy (public + protected for data settings) */}
      <Route path="/privacy" element={<PrivacyPolicy />} />
      <Route path="/terms" element={<TermsOfService />} />
      <Route path="/settings/data" element={
        <ProtectedRoute allowedRoles={['employee', 'vendor', 'corporate_admin', 'super_admin', 'master_admin', 'site_admin', 'city_admin']}>
          <DataSettings />
        </ProtectedRoute>
      } />

      {/* Menu change requests */}
      <Route path="/vendor/menu-requests" element={
        <ProtectedRoute allowedRoles={['vendor']}>
          <VendorMenuRequests />
        </ProtectedRoute>
      } />
      <Route path="/admin/menu-requests" element={
        <ProtectedRoute allowedRoles={['master_admin', 'super_admin', 'site_admin', 'city_admin']}>
          <AdminMenuRequests />
        </ProtectedRoute>
      } />

      {/* Meal reservations (pre-orders / head-count) */}
      <Route path="/employee/reservations" element={
        <ProtectedRoute allowedRoles={['employee']}>
          <EmployeeReservations />
        </ProtectedRoute>
      } />
      <Route path="/vendor/reservations" element={
        <ProtectedRoute allowedRoles={['vendor']}>
          <VendorReservations />
        </ProtectedRoute>
      } />
      <Route path="/admin/reservations" element={
        <ProtectedRoute allowedRoles={['master_admin', 'super_admin', 'site_admin', 'city_admin']}>
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
