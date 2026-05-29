import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, View, StyleSheet, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth, isPartnerApp, isMasterAdmin, isSiteAdmin, isPartnerRole } from './src/context/AuthContext';
import { colors } from './src/theme';

// Auth Screens
import LoginScreen from './src/screens/LoginScreen';
import RegisterScreen from './src/screens/RegisterScreen';

// Employee Screens
import HomeScreen from './src/screens/HomeScreen';
import MenuScreen from './src/screens/MenuScreen';
import CartScreen from './src/screens/CartScreen';
import OrdersScreen from './src/screens/OrdersScreen';
import OrderDetailScreen from './src/screens/OrderDetailScreen';
import LoyaltyScreen from './src/screens/LoyaltyScreen';
import NotificationsScreen from './src/screens/NotificationsScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import FavoritesScreen from './src/screens/FavoritesScreen';
import RefundsScreen from './src/screens/RefundsScreen';
import SubscriptionScreen from './src/screens/SubscriptionScreen';
import EventOrderScreen from './src/screens/EventOrderScreen';

// Vendor Screens
import VendorDashboard from './src/screens/vendor/VendorDashboard';
import VendorOrders from './src/screens/vendor/VendorOrders';
import VendorMenu from './src/screens/vendor/VendorMenu';
import VendorScanQR from './src/screens/vendor/VendorScanQR';
import VendorAIInsights from './src/screens/vendor/VendorAIInsights';
import VendorSettlement from './src/screens/vendor/VendorSettlement';

// Admin Screens
import AdminDashboard from './src/screens/admin/AdminDashboard';
import AdminSites from './src/screens/admin/AdminSites';
import AdminAdmins from './src/screens/admin/AdminAdmins';
import SiteManagement from './src/screens/admin/SiteManagement';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function EmployeeTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.borderLight,
          paddingTop: 8,
          paddingBottom: 8,
          height: 64,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '500' },
        tabBarIcon: ({ color, size }) => {
          let iconName = 'home';
          if (route.name === 'Home') iconName = 'home';
          if (route.name === 'Menu') iconName = 'restaurant';
          if (route.name === 'Orders') iconName = 'receipt';
          if (route.name === 'Rewards') iconName = 'trophy';
          if (route.name === 'Profile') iconName = 'person';
          return <Ionicons name={iconName} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Menu" component={MenuScreen} />
      <Tab.Screen name="Orders" component={OrdersScreen} />
      <Tab.Screen name="Rewards" component={LoyaltyScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

function VendorTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.borderLight,
          paddingTop: 8,
          paddingBottom: 8,
          height: 64,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '500' },
        tabBarIcon: ({ color, size }) => {
          let iconName = 'home';
          if (route.name === 'Dashboard') iconName = 'home';
          if (route.name === 'Orders') iconName = 'receipt';
          if (route.name === 'Menu') iconName = 'restaurant';
          if (route.name === 'Scan') iconName = 'qr-code';
          if (route.name === 'AIInsights') iconName = 'sparkles';
          return <Ionicons name={iconName} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Dashboard" component={VendorDashboard} />
      <Tab.Screen name="Orders" component={VendorOrders} />
      <Tab.Screen name="Menu" component={VendorMenu} />
      <Tab.Screen name="Scan" component={VendorScanQR} />
      <Tab.Screen name="AIInsights" component={VendorAIInsights} options={{ tabBarLabel: 'AI' }} />
    </Tab.Navigator>
  );
}

function MasterAdminTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.borderLight, paddingTop: 8, paddingBottom: 8, height: 64 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '500' },
        tabBarIcon: ({ color, size }) => {
          let iconName = 'home';
          if (route.name === 'Dashboard') iconName = 'star';
          if (route.name === 'AdminSites') iconName = 'business';
          if (route.name === 'AdminAdmins') iconName = 'shield-checkmark';
          return <Ionicons name={iconName} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Dashboard" component={AdminDashboard} />
      <Tab.Screen name="AdminSites" component={AdminSites} options={{ tabBarLabel: 'Sites' }} />
      <Tab.Screen name="AdminAdmins" component={AdminAdmins} options={{ tabBarLabel: 'Admins' }} />
    </Tab.Navigator>
  );
}

function SiteAdminTabs() {
  // Site admin only has 1 main entry that opens their site directly via Dashboard CTA.
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Dashboard" component={AdminDashboard} />
    </Stack.Navigator>
  );
}

function UnsupportedRoleScreen() {
  const { logout, user } = useAuth();
  const PARTNER = isPartnerApp();
  return (
    <View style={styles.unsupported}>
      <Ionicons name="alert-circle-outline" size={80} color={colors.warning} />
      <Text style={styles.unsupportedTitle}>
        {PARTNER ? 'Partner accounts only' : 'Mobile app coming soon for your role'}
      </Text>
      <Text style={styles.unsupportedText}>
        {PARTNER
          ? 'The Cravitoo Partner app is for vendors and admins (Master / Site).\n\nIf you are a customer/employee, please download the "Cravitoo" app instead.'
          : 'The Cravitoo customer app is for employees only.\n\nIf you are a restaurant/vendor partner or admin, please download the "Cravitoo Partner" app instead.'}
        {'\n\n'}
        Your role: <Text style={{ fontWeight: '600' }}>{user?.role?.replace('_', ' ')}</Text>
      </Text>
      <Text style={styles.unsupportedLink} onPress={logout}>
        Sign out
      </Text>
    </View>
  );
}

function RootNavigator() {
  const { user, loading } = useAuth();
  const PARTNER = isPartnerApp();

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!user) {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Register" component={RegisterScreen} />
      </Stack.Navigator>
    );
  }

  // Partner app — vendor / master_admin / site_admin
  if (PARTNER) {
    if (!isPartnerRole(user)) return <UnsupportedRoleScreen />;
    if (isMasterAdmin(user)) {
      return (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="MasterMain" component={MasterAdminTabs} />
          <Stack.Screen name="SiteManagement" component={SiteManagement} />
          <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ headerShown: true, title: 'Notifications' }} />
          <Stack.Screen name="Profile" component={ProfileScreen} options={{ headerShown: true, title: 'Profile' }} />
        </Stack.Navigator>
      );
    }
    if (isSiteAdmin(user)) {
      return (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="SiteAdminMain" component={AdminDashboard} />
          <Stack.Screen name="SiteManagement" component={SiteManagement} />
          <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ headerShown: true, title: 'Notifications' }} />
          <Stack.Screen name="Profile" component={ProfileScreen} options={{ headerShown: true, title: 'Profile' }} />
        </Stack.Navigator>
      );
    }
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="VendorMain" component={VendorTabs} />
        <Stack.Screen name="VendorSettlement" component={VendorSettlement} />
        <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ headerShown: true, title: 'Notifications' }} />
        <Stack.Screen name="Profile" component={ProfileScreen} options={{ headerShown: true, title: 'Profile' }} />
      </Stack.Navigator>
    );
  }

  // Customer app — employee only
  if (user.role !== 'employee') return <UnsupportedRoleScreen />;
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Main" component={EmployeeTabs} />
      <Stack.Screen name="Cart" component={CartScreen} options={{ headerShown: true, title: 'Your Cart' }} />
      <Stack.Screen name="OrderDetail" component={OrderDetailScreen} options={{ headerShown: true, title: 'Order Details' }} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ headerShown: true, title: 'Notifications' }} />
      <Stack.Screen name="Favorites" component={FavoritesScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Refunds" component={RefundsScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Subscription" component={SubscriptionScreen} options={{ headerShown: false }} />
      <Stack.Screen name="EventOrder" component={EventOrderScreen} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <NavigationContainer>
          <StatusBar style="dark" />
          <RootNavigator />
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  unsupported: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: colors.background,
  },
  unsupportedTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.textPrimary,
    marginTop: 24,
    textAlign: 'center',
  },
  unsupportedText: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 16,
    textAlign: 'center',
    lineHeight: 22,
  },
  unsupportedLink: {
    fontSize: 16,
    color: colors.primary,
    fontWeight: '600',
    marginTop: 24,
    padding: 12,
  },
});
