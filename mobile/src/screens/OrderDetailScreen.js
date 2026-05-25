import React from 'react';
import {
  View, Text, ScrollView, StyleSheet, Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, borderRadius } from '../theme';

export default function OrderDetailScreen({ route }) {
  const { order } = route.params;
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
          <View style={styles.statusBadge}>
            <Text style={styles.statusText}>{order.status}</Text>
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

        <View style={styles.row}>
          <Text style={styles.label}>Date</Text>
          <Text style={styles.value}>
            {new Date(order.created_at).toLocaleString('en-IN')}
          </Text>
        </View>
      </View>

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
