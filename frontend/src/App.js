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
import VendorDashboard from './pages/vendor/Dashboard';
import VendorOrders from './pages/vendor/Orders';
import VendorMenu from './pages/vendor/Menu';
import VendorVerifyPickup from './pages/vendor/VerifyPickup';
import CorporateAdminDashboard from './pages/admin/Dashboard';
import SuperAdminDashboard from './pages/superadmin/Dashboard';

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
      default:
        return '/';
    }
  };

  return (
    <Routes>
      <Route path="/" element={user ? <Navigate to={getDefaultRoute()} replace /> : <LandingPage />} />
      <Route path="/login" element={user ? <Navigate to={getDefaultRoute()} replace /> : <LoginPage />} />
      <Route path="/register" element={user ? <Navigate to={getDefaultRoute()} replace /> : <RegisterPage />} />
      
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
      
      <Route path="/admin/dashboard" element={
        <ProtectedRoute allowedRoles={['corporate_admin']}>
          <CorporateAdminDashboard />
        </ProtectedRoute>
      } />
      
      <Route path="/super-admin/dashboard" element={
        <ProtectedRoute allowedRoles={['super_admin']}>
          <SuperAdminDashboard />
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
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;