import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator, RefreshControl, TouchableOpacity, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import useOrdersSocket from '../../hooks/useOrdersSocket';
import { colors, spacing, borderRadius } from '../../theme';

const LOGO_URL = 'https://customer-assets.emergentagent.com/job_corporate-feast/artifacts/lpcd18p4_29aaeaa4-ac4d-4437-8a14-0af8214d6039.png';

export default function VendorDashboard({ navigation }) {
  const { user } = useAuth();
  const [analytics, setAnalytics] = useState(null);
  const [recentOrders, setRecentOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [newOrderCount, setNewOrderCount] = useState(0);

  const load = async () => {
    try {
      const [a, o] = await Promise.all([
        client.get('/analytics/vendor'),
        client.get('/orders'),
      ]);
      setAnalytics(a.data);
      setRecentOrders(o.data.slice(0, 5));
    } catch (e) {
      console.log('Vendor dash error', e?.response?.data || e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
    const unsub = navigation.addListener('focus', load);
    return unsub;
  }, [navigation]);

  // Real-time order updates via WebSocket
  useOrdersSocket('vendor', (msg) => {
    if (msg.type === 'new_order') {
      setNewOrderCount((c) => c + 1);
      load();
    }
  });

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Image source={{ uri: LOGO_URL }} style={styles.logo} resizeMode="contain" />
        <Text style={styles.headerSubtitle}>Vendor Portal</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
      >
        <Text style={styles.greeting}>Welcome, {user?.name?.split(' ')[0]}!</Text>
        <Text style={styles.tagline}>Here's your business at a glance</Text>

        {newOrderCount > 0 && (
          <TouchableOpacity
            style={styles.newOrdersBanner}
            onPress={() => { setNewOrderCount(0); navigation.navigate('Orders'); }}
          >
            <Ionicons name="notifications" size={20} color="#fff" />
            <Text style={styles.newOrdersText}>
              {newOrderCount} new order{newOrderCount !== 1 ? 's' : ''} — tap to view
            </Text>
            <Ionicons name="arrow-forward" size={18} color="#fff" />
          </TouchableOpacity>
        )}

        <View style={styles.statsRow}>
          <LinearGradient colors={[colors.primary, '#E04815']} style={styles.statCard}>
            <Ionicons name="receipt" size={28} color="#fff" />
            <Text style={styles.statValueLight}>{analytics?.total_orders || 0}</Text>
            <Text style={styles.statLabelLight}>Total Orders</Text>
          </LinearGradient>

          <LinearGradient colors={['#16A34A', '#15803D']} style={styles.statCard}>
            <Ionicons name="cash" size={28} color="#fff" />
            <Text style={styles.statValueLight}>₹{(analytics?.total_revenue || 0).toFixed(0)}</Text>
            <Text style={styles.statLabelLight}>Revenue</Text>
          </LinearGradient>
        </View>

        <View style={styles.avgCard}>
          <View>
            <Text style={styles.avgLabel}>Average Order Value</Text>
            <Text style={styles.avgValue}>₹{(analytics?.average_order_value || 0).toFixed(2)}</Text>
          </View>
          <Ionicons name="trending-up" size={32} color={colors.success} />
        </View>

        <Text style={styles.sectionTitle}>Recent Orders</Text>
        {recentOrders.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="receipt-outline" size={32} color={colors.textMuted} />
            <Text style={styles.emptyText}>No orders yet</Text>
          </View>
        ) : (
          recentOrders.map((order) => (
            <TouchableOpacity
              key={order.id}
              style={styles.orderRow}
              onPress={() => navigation.navigate('Orders')}
            >
              <View style={styles.orderInfo}>
                <Text style={styles.orderId}>#{order.id.slice(-8)}</Text>
                <Text style={styles.orderDate}>
                  {new Date(order.created_at).toLocaleString('en-IN', {
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                  })}
                </Text>
              </View>
              <View style={styles.orderRight}>
                <Text style={styles.orderAmount}>₹{order.total_amount.toFixed(0)}</Text>
                <View style={[styles.statusPill, order.status === 'pending' ? styles.statusPending : styles.statusOther]}>
                  <Text style={styles.statusText}>{order.status}</Text>
                </View>
              </View>
            </TouchableOpacity>
          ))
        )}

        <View style={styles.quickActions}>
          <TouchableOpacity style={styles.quickAction} onPress={() => navigation.navigate('Menu')}>
            <Ionicons name="restaurant" size={22} color={colors.primary} />
            <Text style={styles.quickActionText}>Menu</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickAction} onPress={() => navigation.navigate('Scan')}>
            <Ionicons name="qr-code" size={22} color={colors.primary} />
            <Text style={styles.quickActionText}>Scan</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickAction} onPress={() => navigation.navigate('AIInsights')}>
            <Ionicons name="sparkles" size={22} color={colors.primary} />
            <Text style={styles.quickActionText}>AI</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  header: { padding: spacing.md, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.borderLight, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  logo: { width: 90, height: 36 },
  headerSubtitle: { fontSize: 13, color: colors.textSecondary, fontWeight: '500' },
  content: { padding: spacing.md, paddingBottom: 40 },
  greeting: { fontSize: 24, fontWeight: '700', color: colors.textPrimary, letterSpacing: -0.5 },
  tagline: { fontSize: 14, color: colors.textSecondary, marginTop: 4, marginBottom: spacing.lg },
  newOrdersBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.primary, padding: spacing.md, borderRadius: borderRadius.md, marginBottom: spacing.md, gap: spacing.sm },
  newOrdersText: { color: '#fff', fontWeight: '600', flex: 1, fontSize: 14 },
  statsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  statCard: { flex: 1, padding: spacing.md, borderRadius: borderRadius.lg, alignItems: 'flex-start' },
  statValueLight: { color: '#fff', fontSize: 24, fontWeight: '700', marginTop: spacing.sm },
  statLabelLight: { color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 2 },
  avgCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.card, padding: spacing.md, borderRadius: borderRadius.md, marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.borderLight },
  avgLabel: { fontSize: 13, color: colors.textSecondary },
  avgValue: { fontSize: 22, fontWeight: '700', color: colors.textPrimary, marginTop: 2 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.sm },
  emptyBox: { alignItems: 'center', padding: spacing.lg, backgroundColor: colors.card, borderRadius: borderRadius.md, borderWidth: 1, borderColor: colors.borderLight },
  emptyText: { color: colors.textSecondary, marginTop: spacing.sm },
  orderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.card, padding: spacing.md, borderRadius: borderRadius.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.borderLight },
  orderInfo: {},
  orderId: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  orderDate: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  orderRight: { alignItems: 'flex-end', gap: 4 },
  orderAmount: { fontSize: 16, fontWeight: '700', color: colors.primary },
  statusPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: borderRadius.full },
  statusPending: { backgroundColor: colors.warningLight },
  statusOther: { backgroundColor: colors.successLight },
  statusText: { fontSize: 10, fontWeight: '600', textTransform: 'capitalize', color: colors.textPrimary },
  quickActions: { flexDirection: 'row', justifyContent: 'space-around', marginTop: spacing.lg, backgroundColor: colors.card, padding: spacing.md, borderRadius: borderRadius.md, borderWidth: 1, borderColor: colors.borderLight },
  quickAction: { alignItems: 'center', padding: spacing.sm, gap: 4 },
  quickActionText: { fontSize: 12, color: colors.textPrimary, fontWeight: '500' },
});
