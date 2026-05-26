import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Image, TouchableOpacity, Alert, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { colors, spacing, borderRadius } from '../theme';

const CANCEL_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

export default function OrderDetailScreen({ route, navigation }) {
  const [order, setOrder] = useState(route.params.order);
  const [cancelling, setCancelling] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);

  useEffect(() => {
    if (order.status !== 'pending') {
      setTimeLeft(0);
      return;
    }
    const tick = () => {
      const elapsed = Date.now() - new Date(order.created_at).getTime();
      setTimeLeft(Math.max(0, CANCEL_WINDOW_MS - elapsed));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [order.created_at, order.status]);

  const canCancel = order.status === 'pending' && timeLeft > 0;
  const minutes = Math.floor(timeLeft / 60000);
  const seconds = Math.floor((timeLeft % 60000) / 1000);

  const cancelOrder = () => {
    Alert.alert(
      'Cancel order?',
      order.payment_status === 'paid'
        ? `You'll receive a refund of ₹${order.total_amount.toFixed(2)} within 5–7 business days.`
        : 'This will release your order. You can place a new one anytime.',
      [
        { text: 'Keep order', style: 'cancel' },
        {
          text: 'Cancel order',
          style: 'destructive',
          onPress: async () => {
            setCancelling(true);
            try {
              const { data } = await client.post(`/orders/${order.id}/cancel`);
              setOrder({ ...order, status: 'cancelled', refund_status: data.refund_status });
              Alert.alert(
                'Order cancelled',
                data.refund_status ? `Refund: ${data.refund_status}` : 'Your order was cancelled successfully.'
              );
            } catch (e) {
              Alert.alert('Could not cancel', e?.response?.data?.detail || 'Try again');
            } finally {
              setCancelling(false);
            }
          },
        },
      ]
    );
  };

  const qrUrl = order.pickup_qr
    ? `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(order.pickup_qr)}`
    : null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.label}>Order ID</Text>
            <Text style={styles.value}>#{order.id.slice(-8)}</Text>
          </View>
          <View style={[styles.statusBadge, order.status === 'cancelled' && { backgroundColor: '#FEE2E2' }]}>
            <Text style={[styles.statusText, order.status === 'cancelled' && { color: colors.error }]}>{order.status}</Text>
          </View>
        </View>

        <View style={styles.divider} />

        <View style={styles.row}>
          <Text style={styles.label}>Total Amount</Text>
          <Text style={styles.totalAmount}>₹{order.total_amount.toFixed(2)}</Text>
        </View>

        <View style={styles.row}>
          <Text style={styles.label}>Payment</Text>
          <Text style={[styles.value, { color: order.payment_status === 'paid' ? colors.success : colors.warning }]}>
            {order.payment_status === 'paid' ? 'Paid' : 'Pending'}
          </Text>
        </View>

        {order.refund_status && (
          <View style={styles.row}>
            <Text style={styles.label}>Refund</Text>
            <Text style={[styles.value, { color: colors.success }]} testID="refund-status">{order.refund_status}</Text>
          </View>
        )}

        <View style={styles.row}>
          <Text style={styles.label}>Date</Text>
          <Text style={styles.value}>{new Date(order.created_at).toLocaleString('en-IN')}</Text>
        </View>
      </View>

      {canCancel && (
        <TouchableOpacity onPress={cancelOrder} disabled={cancelling} style={styles.cancelBtn} testID="cancel-order-btn">
          {cancelling ? (
            <ActivityIndicator color={colors.error} />
          ) : (
            <>
              <Ionicons name="close-circle-outline" size={20} color={colors.error} />
              <Text style={styles.cancelText}>Cancel order · {minutes}:{seconds.toString().padStart(2, '0')} left</Text>
            </>
          )}
        </TouchableOpacity>
      )}

      {(order.status === 'ready' || order.status === 'confirmed') && qrUrl && (
        <View style={styles.qrCard}>
          <Ionicons name="qr-code-outline" size={20} color={colors.primary} />
          <Text style={styles.qrTitle}>Pickup QR Code</Text>
          <Text style={styles.qrSubtitle}>Show this to the vendor for pickup</Text>
          <View style={styles.qrImageBox}>
            <Image source={{ uri: qrUrl }} style={styles.qrImage} />
          </View>
          <Text style={styles.qrCode}>{order.pickup_qr}</Text>
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Items</Text>
        {order.items.map((item, idx) => (
          <View key={idx} style={styles.itemRow}>
            <View style={styles.itemInfo}>
              <Text style={styles.itemName}>{item.name || 'Item'}</Text>
              <Text style={styles.itemQty}>Qty: {item.quantity}</Text>
            </View>
            <Text style={styles.itemPrice}>₹{(item.price * item.quantity).toFixed(2)}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  card: { backgroundColor: colors.card, borderRadius: borderRadius.md, padding: spacing.md, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.borderLight },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  label: { fontSize: 12, color: colors.textSecondary },
  value: { fontSize: 15, color: colors.textPrimary, fontWeight: '600', marginTop: 2 },
  statusBadge: { paddingHorizontal: spacing.sm, paddingVertical: 4, backgroundColor: colors.primaryLight, borderRadius: borderRadius.full },
  statusText: { fontSize: 12, fontWeight: '600', color: colors.primary, textTransform: 'capitalize' },
  divider: { height: 1, backgroundColor: colors.borderLight, marginVertical: spacing.md },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  totalAmount: { fontSize: 20, fontWeight: '700', color: colors.primary },
  cancelBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, padding: spacing.md, backgroundColor: '#FEE2E2', borderWidth: 1, borderColor: colors.error, borderRadius: borderRadius.md, marginBottom: spacing.md },
  cancelText: { color: colors.error, fontWeight: '700', fontSize: 14 },
  qrCard: { backgroundColor: colors.card, borderRadius: borderRadius.md, padding: spacing.lg, marginBottom: spacing.md, alignItems: 'center', borderWidth: 1, borderColor: colors.primary },
  qrTitle: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, marginTop: spacing.sm },
  qrSubtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 4 },
  qrImageBox: { backgroundColor: '#fff', padding: spacing.md, borderRadius: borderRadius.md, marginVertical: spacing.md, borderWidth: 1, borderColor: colors.borderLight },
  qrImage: { width: 220, height: 220 },
  qrCode: { fontSize: 11, color: colors.textMuted, fontFamily: 'monospace' },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.md },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  itemInfo: { flex: 1 },
  itemName: { fontSize: 14, color: colors.textPrimary, fontWeight: '500' },
  itemQty: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  itemPrice: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
});
