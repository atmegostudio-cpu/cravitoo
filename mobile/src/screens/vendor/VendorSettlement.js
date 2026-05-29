import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, Switch, TextInput, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';
import { colors, spacing, borderRadius } from '../../theme';

export default function VendorSettlement({ navigation }) {
  const [settings, setSettings] = useState({ auto_confirm: false, low_stock_threshold: 5, commission_pct: 15 });
  const [settlement, setSettlement] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savingThreshold, setSavingThreshold] = useState(false);
  const [threshold, setThreshold] = useState('5');

  const load = useCallback(async () => {
    try {
      const [s, st] = await Promise.all([
        client.get('/vendor/settings'),
        client.get('/vendor/settlement?days=7'),
      ]);
      setSettings(s.data);
      setSettlement(st.data);
      setThreshold(String(s.data.low_stock_threshold));
    } catch (e) {
      console.log('Settlement load error', e?.response?.data || e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleAutoConfirm = async (v) => {
    setSettings((s) => ({ ...s, auto_confirm: v }));
    try {
      await client.patch('/vendor/settings', { auto_confirm: v });
    } catch (e) {
      setSettings((s) => ({ ...s, auto_confirm: !v }));
      Alert.alert('Update failed', e?.response?.data?.detail || 'Try again');
    }
  };

  const saveThreshold = async () => {
    const n = parseInt(threshold, 10);
    if (isNaN(n) || n < 0) return;
    setSavingThreshold(true);
    try {
      await client.patch('/vendor/settings', { low_stock_threshold: n });
      setSettings((s) => ({ ...s, low_stock_threshold: n }));
      Alert.alert('Saved', `Low-stock alert at ${n} units.`);
    } catch (e) {
      Alert.alert('Update failed', e?.response?.data?.detail || 'Try again');
    } finally {
      setSavingThreshold(false);
    }
  };

  if (loading) {
    return <View style={s.center}><ActivityIndicator size="large" color={colors.primary} /></View>;
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Settings & Earnings</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: 60 }}>
        <Text style={s.sectionTitle}>Operational Settings</Text>

        <View style={s.card}>
          <View style={s.rowBetween}>
            <View style={{ flex: 1 }}>
              <Text style={s.rowTitle}>Auto-confirm new orders</Text>
              <Text style={s.rowSub}>Skip the manual "Confirm" tap. Orders go straight to "Preparing".</Text>
            </View>
            <Switch
              value={settings.auto_confirm}
              onValueChange={toggleAutoConfirm}
              trackColor={{ true: colors.success }}
              testID="auto-confirm-switch"
            />
          </View>
        </View>

        <View style={s.card}>
          <Text style={s.rowTitle}>Low-stock alert threshold</Text>
          <Text style={s.rowSub}>Get notified when an item's daily sales hit this number.</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <TextInput
              value={threshold}
              onChangeText={(v) => setThreshold(v.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              style={s.input}
              maxLength={4}
            />
            <TouchableOpacity onPress={saveThreshold} disabled={savingThreshold} style={s.btn}>
              <Text style={s.btnText}>{savingThreshold ? '...' : 'Save'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={s.sectionTitle}>Settlement (last 7 days)</Text>

        {settlement && (
          <>
            <View style={s.summaryCard}>
              <View style={s.summaryRow}>
                <Text style={s.summaryLabel}>Gross revenue</Text>
                <Text style={s.summaryValue}>₹{settlement.total_gross.toFixed(2)}</Text>
              </View>
              <View style={s.summaryRow}>
                <Text style={s.summaryLabel}>Platform commission ({settlement.commission_pct}%)</Text>
                <Text style={[s.summaryValue, { color: colors.error }]}>-₹{settlement.total_commission.toFixed(2)}</Text>
              </View>
              <View style={[s.summaryRow, s.summaryDivider]}>
                <Text style={s.summaryNetLabel}>Net payout</Text>
                <Text style={s.summaryNetValue}>₹{settlement.total_payout.toFixed(2)}</Text>
              </View>
              <Text style={s.summaryFoot}>{settlement.total_orders} paid orders</Text>
            </View>

            <Text style={s.sectionTitle}>Daily breakdown</Text>
            {settlement.daily.length === 0 && <Text style={s.emptyText}>No paid orders in the last 7 days.</Text>}
            {settlement.daily.map((row) => (
              <View key={row.date} style={s.dailyCard}>
                <View>
                  <Text style={s.dailyDate}>{row.date}</Text>
                  <Text style={s.dailyOrders}>{row.orders} orders</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={s.dailyPayout}>₹{row.payout.toFixed(2)}</Text>
                  <Text style={s.dailyGross}>Gross ₹{row.gross.toFixed(2)}</Text>
                </View>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.borderLight, backgroundColor: colors.card },
  headerTitle: { fontSize: 18, fontWeight: '700', color: colors.textPrimary },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: colors.textMuted, marginTop: spacing.md, marginBottom: spacing.sm, textTransform: 'uppercase', letterSpacing: 0.5 },
  card: { backgroundColor: colors.card, padding: spacing.md, borderRadius: borderRadius.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.borderLight },
  rowBetween: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowTitle: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  rowSub: { fontSize: 12, color: colors.textSecondary, marginTop: 4 },
  input: { flex: 1, padding: 10, fontSize: 15, borderWidth: 1, borderColor: colors.borderLight, borderRadius: borderRadius.sm, backgroundColor: colors.background, color: colors.textPrimary },
  btn: { backgroundColor: colors.primary, paddingHorizontal: 18, paddingVertical: 10, borderRadius: borderRadius.sm },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  summaryCard: { backgroundColor: colors.card, padding: spacing.md, borderRadius: borderRadius.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.borderLight },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  summaryLabel: { fontSize: 13, color: colors.textSecondary },
  summaryValue: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  summaryDivider: { borderTopWidth: 1, borderTopColor: colors.borderLight, paddingTop: 10, marginTop: 4 },
  summaryNetLabel: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  summaryNetValue: { fontSize: 22, fontWeight: '800', color: colors.success },
  summaryFoot: { fontSize: 11, color: colors.textMuted, marginTop: 4, textAlign: 'right' },
  dailyCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.card, padding: spacing.sm, borderRadius: borderRadius.sm, marginBottom: 6, borderWidth: 1, borderColor: colors.borderLight },
  dailyDate: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  dailyOrders: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  dailyPayout: { fontSize: 15, fontWeight: '700', color: colors.success },
  dailyGross: { fontSize: 10, color: colors.textMuted, marginTop: 2 },
  emptyText: { color: colors.textMuted, padding: spacing.md, textAlign: 'center' },
});
