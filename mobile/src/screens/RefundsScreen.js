import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { colors, spacing, borderRadius } from '../theme';

const STATUS_META = {
  refunded: { color: colors.success, label: 'Refunded', bg: '#D1FAE5' },
  refunded_mock: { color: colors.success, label: 'Refunded', bg: '#D1FAE5' },
  refund_pending: { color: '#F59E0B', label: 'Refund Pending', bg: '#FEF3C7' },
  refund_failed: { color: colors.error, label: 'Refund Failed', bg: '#FEE2E2' },
};

export default function RefundsScreen({ navigation }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await client.get('/refunds');
      setItems(data);
    } catch (e) { console.log(e?.response?.data || e.message); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <SafeAreaView style={s.safe}><ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} /></SafeAreaView>;
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <Text style={s.title}>Refunds & Cancellations</Text>
        <Text style={s.subtitle}>Track your refunds and cancelled orders</Text>
      </View>

      <FlatList
        data={items}
        keyExtractor={(it) => it.order_id}
        contentContainerStyle={{ padding: spacing.md, paddingBottom: 60 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        ListEmptyComponent={() => (
          <View style={s.empty}>
            <Ionicons name="receipt-outline" size={48} color={colors.textMuted} />
            <Text style={s.emptyText}>No refunds or cancellations yet</Text>
            <Text style={s.emptySub}>If you ever cancel an order, it'll show up here with refund status.</Text>
          </View>
        )}
        renderItem={({ item }) => {
          const meta = STATUS_META[item.refund_status] || { color: colors.textMuted, label: 'Cancelled', bg: colors.background };
          return (
            <View style={s.card} testID={`refund-${item.order_id}`}>
              <View style={s.cardHeader}>
                <View>
                  <Text style={s.orderId}>#{item.order_id.slice(-8)}</Text>
                  <Text style={s.date}>{new Date(item.created_at).toLocaleDateString('en-IN')}</Text>
                </View>
                <View style={[s.statusPill, { backgroundColor: meta.bg }]}>
                  <Text style={[s.statusText, { color: meta.color }]}>{meta.label}</Text>
                </View>
              </View>

              <View style={s.amountRow}>
                <Text style={s.amountLabel}>{item.refund_status ? 'Refund amount' : 'Order amount'}</Text>
                <Text style={s.amount}>₹{item.total_amount.toFixed(2)}</Text>
              </View>

              {item.cancelled_at && (
                <View style={s.timelineRow}>
                  <Ionicons name="close-circle" size={14} color={colors.error} />
                  <Text style={s.timelineText}>Cancelled by {item.cancelled_by || 'system'} · {new Date(item.cancelled_at).toLocaleString('en-IN')}</Text>
                </View>
              )}
              {item.refunded_at && (
                <View style={s.timelineRow}>
                  <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                  <Text style={s.timelineText}>Refund processed · {new Date(item.refunded_at).toLocaleString('en-IN')}</Text>
                </View>
              )}
              {item.refund_status === 'refund_pending' && (
                <Text style={s.note}>💡 Refunds typically reach your bank/wallet in 5–7 business days.</Text>
              )}
              {item.refund_status === 'refund_failed' && (
                <Text style={[s.note, { color: colors.error }]}>⚠️ Refund failed at gateway. Please contact support.</Text>
              )}
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { padding: spacing.md, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  title: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  subtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 4 },
  empty: { alignItems: 'center', padding: spacing.xl, marginTop: 60 },
  emptyText: { fontSize: 16, color: colors.textSecondary, fontWeight: '600', marginTop: 12 },
  emptySub: { fontSize: 13, color: colors.textMuted, marginTop: 6, textAlign: 'center', paddingHorizontal: 30 },
  card: { backgroundColor: colors.card, padding: spacing.md, borderRadius: borderRadius.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.borderLight },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  orderId: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  date: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  statusText: { fontSize: 11, fontWeight: '700' },
  amountRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', borderTopWidth: 1, borderTopColor: colors.borderLight, paddingTop: 8, marginBottom: 8 },
  amountLabel: { fontSize: 12, color: colors.textSecondary },
  amount: { fontSize: 18, fontWeight: '700', color: colors.primary },
  timelineRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  timelineText: { fontSize: 11, color: colors.textSecondary, flex: 1 },
  note: { fontSize: 11, color: colors.textMuted, marginTop: 6, fontStyle: 'italic' },
});
