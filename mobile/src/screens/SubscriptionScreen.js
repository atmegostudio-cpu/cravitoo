import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, Modal, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { colors, spacing, borderRadius } from '../theme';

export default function SubscriptionScreen({ navigation }) {
  const [subscriptions, setSubscriptions] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ vendor_id: '', plan_type: 'weekly_lunch', meals_per_week: 5 });

  const load = async () => {
    try {
      const [s, v] = await Promise.all([
        client.get('/subscriptions').catch(() => ({ data: [] })),
        client.get('/vendors'),
      ]);
      setSubscriptions(s.data);
      setVendors(v.data);
      if (v.data[0] && !form.vendor_id) setForm((f) => ({ ...f, vendor_id: v.data[0].id }));
    } catch (e) { console.log(e?.response?.data || e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const subscribe = async () => {
    if (!form.vendor_id) return Alert.alert('Pick a vendor');
    try {
      await client.post('/subscriptions', form);
      setShowForm(false);
      await load();
      Alert.alert('Subscribed!', 'You\'re all set. Meals will be auto-ordered.');
    } catch (e) {
      Alert.alert('Failed', e?.response?.data?.detail || 'Try again');
    }
  };

  const cancel = (id) => {
    Alert.alert('Cancel subscription?', 'You\'ll stop receiving auto-ordered meals.', [
      { text: 'Keep', style: 'cancel' },
      { text: 'Cancel', style: 'destructive', onPress: async () => {
        try { await client.delete(`/subscriptions/${id}`); await load(); }
        catch (e) { Alert.alert('Failed', e?.response?.data?.detail || 'Try again'); }
      }},
    ]);
  };

  if (loading) {
    return <SafeAreaView style={s.safe}><ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} /></SafeAreaView>;
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <Text style={s.title}>Meal Plans</Text>
        <Text style={s.subtitle}>Subscribe & save — auto-order your meals</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: 60 }}>
        {subscriptions.length === 0 ? (
          <View style={s.empty}>
            <Ionicons name="calendar" size={48} color={colors.textMuted} />
            <Text style={s.emptyText}>No active meal plan</Text>
            <Text style={s.emptySub}>Subscribe to a weekly or monthly plan to skip the daily ordering hassle.</Text>
          </View>
        ) : (
          subscriptions.map((sub) => (
            <View key={sub.id} style={s.subCard} testID={`sub-${sub.id}`}>
              <View style={s.subHeader}>
                <View>
                  <Text style={s.subTitle}>{sub.plan_type?.replace('_', ' ')}</Text>
                  <Text style={s.subVendor}>{sub.vendor_name || 'Vendor'}</Text>
                </View>
                <View style={[s.statusPill, { backgroundColor: sub.status === 'active' ? '#D1FAE5' : '#FEE2E2' }]}>
                  <Text style={[s.statusText, { color: sub.status === 'active' ? colors.success : colors.error }]}>{sub.status}</Text>
                </View>
              </View>
              <View style={s.subStats}>
                <View><Text style={s.subStatLabel}>Meals/week</Text><Text style={s.subStatValue}>{sub.meals_per_week || 5}</Text></View>
                <View><Text style={s.subStatLabel}>Started</Text><Text style={s.subStatValue}>{sub.start_date ? new Date(sub.start_date).toLocaleDateString('en-IN') : '—'}</Text></View>
              </View>
              <TouchableOpacity onPress={() => cancel(sub.id)} style={s.cancelBtn} testID={`cancel-sub-${sub.id}`}>
                <Text style={s.cancelBtnText}>Cancel Plan</Text>
              </TouchableOpacity>
            </View>
          ))
        )}

        <TouchableOpacity onPress={() => setShowForm(true)} style={s.newBtn} testID="new-subscription-btn">
          <Ionicons name="add-circle" size={22} color="#fff" />
          <Text style={s.newBtnText}>New Meal Plan</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal visible={showForm} animationType="slide" presentationStyle="formSheet">
        <SafeAreaView style={s.safe} edges={['top']}>
          <View style={s.modalHeader}>
            <TouchableOpacity onPress={() => setShowForm(false)}><Ionicons name="close" size={26} color={colors.textPrimary} /></TouchableOpacity>
            <Text style={s.title}>New Meal Plan</Text>
            <View style={{ width: 26 }} />
          </View>
          <ScrollView contentContainerStyle={{ padding: spacing.md }}>
            <Text style={s.fieldLabel}>Vendor</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.md }}>
              {vendors.map((v) => (
                <TouchableOpacity key={v.id} onPress={() => setForm({ ...form, vendor_id: v.id })} style={[s.vendorChip, form.vendor_id === v.id && s.vendorChipActive]}>
                  <Text style={[s.vendorChipText, form.vendor_id === v.id && { color: '#fff' }]}>{v.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={s.fieldLabel}>Plan type</Text>
            {['weekly_lunch', 'monthly_lunch', 'weekly_dinner', 'monthly_dinner'].map((p) => (
              <TouchableOpacity key={p} onPress={() => setForm({ ...form, plan_type: p })} style={[s.planRow, form.plan_type === p && s.planRowActive]}>
                <Text style={[s.planLabel, form.plan_type === p && { color: colors.primary, fontWeight: '700' }]}>{p.replace('_', ' ')}</Text>
                {form.plan_type === p && <Ionicons name="checkmark-circle" size={20} color={colors.primary} />}
              </TouchableOpacity>
            ))}

            <Text style={s.fieldLabel}>Meals per week</Text>
            <TextInput value={String(form.meals_per_week)} onChangeText={(v) => setForm({ ...form, meals_per_week: parseInt(v) || 5 })} keyboardType="number-pad" style={s.input} />

            <TouchableOpacity onPress={subscribe} style={s.submitBtn} testID="submit-subscription-btn">
              <Text style={s.submitText}>Subscribe</Text>
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { padding: spacing.md, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  title: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  subtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 4 },
  empty: { alignItems: 'center', padding: spacing.xl, marginTop: 40 },
  emptyText: { fontSize: 16, color: colors.textSecondary, fontWeight: '600', marginTop: 12 },
  emptySub: { fontSize: 13, color: colors.textMuted, marginTop: 6, textAlign: 'center', paddingHorizontal: 30 },
  subCard: { backgroundColor: colors.card, padding: spacing.md, borderRadius: borderRadius.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.borderLight },
  subHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  subTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, textTransform: 'capitalize' },
  subVendor: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  statusText: { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },
  subStats: { flexDirection: 'row', gap: spacing.lg, marginBottom: 10 },
  subStatLabel: { fontSize: 11, color: colors.textMuted },
  subStatValue: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  cancelBtn: { padding: 10, borderRadius: borderRadius.sm, backgroundColor: '#FEE2E2', alignItems: 'center' },
  cancelBtnText: { color: colors.error, fontWeight: '700', fontSize: 13 },
  newBtn: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, backgroundColor: colors.primary, padding: 14, borderRadius: borderRadius.md, marginTop: spacing.md },
  newBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.borderLight, backgroundColor: colors.card },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: colors.textPrimary, marginTop: spacing.sm, marginBottom: 8 },
  vendorChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderLight, marginRight: 8 },
  vendorChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  vendorChipText: { fontSize: 13, color: colors.textPrimary },
  planRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.md, borderRadius: borderRadius.sm, borderWidth: 1, borderColor: colors.borderLight, backgroundColor: colors.card, marginBottom: 6 },
  planRowActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  planLabel: { fontSize: 14, color: colors.textPrimary, textTransform: 'capitalize' },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderLight, borderRadius: borderRadius.sm, padding: spacing.sm, fontSize: 15 },
  submitBtn: { backgroundColor: colors.primary, padding: 14, borderRadius: borderRadius.md, alignItems: 'center', marginTop: spacing.lg },
  submitText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
