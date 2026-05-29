import React, { useEffect, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';
import useOrdersSocket from '../../hooks/useOrdersSocket';
import { colors, spacing, borderRadius } from '../../theme';

const STATUS_FLOW = {
  pending: { next: 'confirmed', label: 'Confirm', color: colors.success },
  confirmed: { next: 'preparing', label: 'Start Preparing', color: '#2563EB' },
  preparing: { next: 'ready', label: 'Mark Ready', color: colors.primary },
  ready: { next: 'completed', label: 'Complete', color: '#9333EA' },
  completed: { next: null, label: 'Done', color: colors.textMuted },
  cancelled: { next: null, label: 'Cancelled', color: colors.error },
};

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'New' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'preparing', label: 'Preparing' },
  { key: 'ready', label: 'Ready' },
  { key: 'completed', label: 'Done' },
];

export default function VendorOrders({ navigation }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState('all');
  const [updatingId, setUpdatingId] = useState(null);

  const load = async () => {
    try {
      const { data } = await client.get('/orders');
      setOrders(data);
    } catch (e) {
      console.log('Vendor orders error', e?.response?.data || e.message);
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

  // Live order updates
  useOrdersSocket('vendor', (msg) => {
    if (msg.type === 'new_order') load();
  });

  const updateStatus = async (orderId, newStatus) => {
    setUpdatingId(orderId);
    try {
      await client.patch(`/orders/${orderId}?status=${newStatus}`);
      load();
    } catch (e) {
      Alert.alert('Update failed', e?.response?.data?.detail || 'Try again');
    } finally {
      setUpdatingId(null);
    }
  };

  const refundOrder = (order) => {
    Alert.alert(
      'Refund this order?',
      `Customer will receive ₹${order.total_amount.toFixed(2)} back. This will also mark the order as cancelled.`,
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Yes, refund',
          style: 'destructive',
          onPress: async () => {
            setUpdatingId(order.id);
            try {
              const { data } = await client.post(`/orders/${order.id}/refund`);
              Alert.alert('Refunded', `Status: ${data.refund_status}`);
              load();
            } catch (e) {
              Alert.alert('Refund failed', e?.response?.data?.detail || 'Try again');
            } finally {
              setUpdatingId(null);
            }
          },
        },
      ]
    );
  };

  const filtered = filter === 'all' ? orders : orders.filter((o) => o.status === filter);

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
        <Text style={styles.headerTitle}>Orders</Text>
        <View style={styles.liveDot}>
          <View style={styles.dot} />
          <Text style={styles.liveText}>Live</Text>
        </View>
      </View>

      <View style={styles.filtersBar}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={FILTERS}
          keyExtractor={(f) => f.key}
          contentContainerStyle={{ paddingHorizontal: spacing.md, gap: spacing.sm }}
          renderItem={({ item }) => {
            const count = item.key === 'all' ? orders.length : orders.filter((o) => o.status === item.key).length;
            return (
              <TouchableOpacity
                onPress={() => setFilter(item.key)}
                style={[styles.filterChip, filter === item.key && styles.filterChipActive]}
              >
                <Text style={[styles.filterText, filter === item.key && styles.filterTextActive]}>
                  {item.label} ({count})
                </Text>
              </TouchableOpacity>
            );
          }}
        />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(o) => o.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
        ListEmptyComponent={() => (
          <View style={styles.empty}>
            <Ionicons name="receipt-outline" size={48} color={colors.textMuted} />
            <Text style={styles.emptyText}>No {filter !== 'all' ? filter : ''} orders</Text>
          </View>
        )}
        renderItem={({ item: order }) => {
          const flow = STATUS_FLOW[order.status] || {};
          return (
            <View style={styles.orderCard}>
              <View style={styles.orderHeader}>
                <View>
                  <Text style={styles.orderId}>Order #{order.id.slice(-8)}</Text>
                  <Text style={styles.orderTime}>
                    {new Date(order.created_at).toLocaleString('en-IN', {
                      hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric',
                    })}
                  </Text>
                </View>
                <View style={styles.orderAmountBox}>
                  <Text style={styles.orderAmount}>₹{order.total_amount.toFixed(0)}</Text>
                  <View style={[styles.paidBadge, order.payment_status === 'paid' ? styles.paidYes : styles.paidNo]}>
                    <Text style={[styles.paidText, order.payment_status === 'paid' ? { color: colors.success } : { color: colors.warning }]}>
                      {order.payment_status === 'paid' ? '✓ Paid' : 'Unpaid'}
                    </Text>
                  </View>
                </View>
              </View>

              <View style={styles.itemsList}>
                {order.items.map((it, i) => (
                  <Text key={i} style={styles.itemText}>
                    {it.quantity}× {it.name || 'Item'}
                  </Text>
                ))}
              </View>

              <View style={styles.orderActions}>
                <View style={[styles.statusChip, { backgroundColor: flow.color + '20' }]}>
                  <Text style={[styles.statusChipText, { color: flow.color }]}>{order.status}</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                  {order.payment_status === 'paid' && order.status !== 'cancelled' && order.refund_status !== 'refunded' && order.refund_status !== 'refunded_mock' && (
                    <TouchableOpacity
                      style={styles.refundBtn}
                      onPress={() => refundOrder(order)}
                      disabled={updatingId === order.id}
                    >
                      <Ionicons name="cash-outline" size={14} color={colors.error} />
                      <Text style={styles.refundBtnText}>Refund</Text>
                    </TouchableOpacity>
                  )}
                  {flow.next && (
                    <TouchableOpacity
                      style={[styles.actionBtn, { backgroundColor: flow.color }]}
                      onPress={() => updateStatus(order.id, flow.next)}
                      disabled={updatingId === order.id}
                    >
                      {updatingId === order.id ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <>
                          <Text style={styles.actionBtnText}>{flow.label}</Text>
                          <Ionicons name="arrow-forward" size={16} color="#fff" />
                        </>
                      )}
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.sm, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.borderLight, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerTitle: { fontSize: 26, fontWeight: '700', color: colors.textPrimary, letterSpacing: -0.5 },
  liveDot: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, backgroundColor: colors.success, borderRadius: 4 },
  liveText: { fontSize: 12, color: colors.success, fontWeight: '600' },
  filtersBar: { backgroundColor: colors.card, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  filterChip: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: borderRadius.full, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.borderLight },
  filterChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterText: { fontSize: 13, color: colors.textSecondary, fontWeight: '500' },
  filterTextActive: { color: '#fff' },
  list: { padding: spacing.md, flexGrow: 1 },
  empty: { alignItems: 'center', paddingVertical: spacing.xxl },
  emptyText: { fontSize: 14, color: colors.textSecondary, marginTop: spacing.sm },
  orderCard: { backgroundColor: colors.card, borderRadius: borderRadius.md, padding: spacing.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.borderLight },
  orderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing.sm },
  orderId: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  orderTime: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  orderAmountBox: { alignItems: 'flex-end' },
  orderAmount: { fontSize: 18, fontWeight: '700', color: colors.primary },
  paidBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: borderRadius.full, marginTop: 2 },
  paidYes: { backgroundColor: colors.successLight },
  paidNo: { backgroundColor: colors.warningLight },
  paidText: { fontSize: 11, fontWeight: '600' },
  itemsList: { paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.borderLight, marginBottom: spacing.sm },
  itemText: { fontSize: 13, color: colors.textSecondary, paddingVertical: 2 },
  orderActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.borderLight, paddingTop: spacing.sm },
  statusChip: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: borderRadius.full },
  statusChipText: { fontSize: 12, fontWeight: '600', textTransform: 'capitalize' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: borderRadius.sm },
  actionBtnText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  refundBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 7, borderRadius: borderRadius.sm, backgroundColor: '#FEE2E2', borderWidth: 1, borderColor: colors.error },
  refundBtnText: { color: colors.error, fontWeight: '700', fontSize: 12 },
});
