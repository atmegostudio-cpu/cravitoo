import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, Modal, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { colors, spacing, borderRadius } from '../theme';

export default function EventOrderScreen({ navigation }) {
  const [vendors, setVendors] = useState([]);
  const [bulkOrders, setBulkOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    vendor_id: '',
    event_name: '',
    event_date: '',
    headcount: 20,
    notes: '',
    delivery_type: 'pickup',
  });

  const load = async () => {
    try {
      const [v, b] = await Promise.all([
        client.get('/vendors'),
        client.get('/bulk-orders').catch(() => ({ data: [] })),
      ]);
      setVendors(v.data);
      setBulkOrders(b.data);
      if (v.data[0] && !form.vendor_id) setForm((f) => ({ ...f, vendor_id: v.data[0].id }));
    } catch (e) { console.log(e?.response?.data || e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!form.vendor_id || !form.event_name || !form.event_date || form.headcount < 5) {
      Alert.alert('Missing info', 'Vendor, event name, date, and ≥5 people are required.');
      return;
    }
    try {
      await client.post('/bulk-orders', form);
      setShowForm(false);
      setForm({ ...form, event_name: '', event_date: '', headcount: 20, notes: '' });
      await load();
      Alert.alert('Request submitted!', 'Our team will reach out within 2 business hours with a quote.');
    } catch (e) {
      Alert.alert('Failed', e?.response?.data?.detail || 'Try again');
    }
  };

  if (loading) {
    return <SafeAreaView style={s.safe}><ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} /></SafeAreaView>;
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <Text style={s.title}>Bulk & Event Orders</Text>
        <Text style={s.subtitle}>Team lunches, parties, conferences</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: 60 }}>
        <View style={s.heroCard}>
          <Ionicons name="people" size={36} color={colors.primary} />
          <Text style={s.heroTitle}>Catering for your team</Text>
          <Text style={s.heroSub}>From 5 to 500 people. We deliver, set up, and clean up.</Text>
        </View>

        <Text style={s.sectionTitle}>Your event requests</Text>

        {bulkOrders.length === 0 && (
          <View style={s.empty}>
            <Ionicons name="restaurant-outline" size={36} color={colors.textMuted} />
            <Text style={s.emptyText}>No event orders yet</Text>
          </View>
        )}

        {bulkOrders.map((b) => (
          <View key={b.id} style={s.bCard} testID={`bulk-${b.id}`}>
            <View style={s.bHeader}>
              <View style={{ flex: 1 }}>
                <Text style={s.bTitle}>{b.event_name}</Text>
                <Text style={s.bDate}>{b.event_date} · {b.headcount} people</Text>
              </View>
              <View style={[s.statusPill, { backgroundColor: b.status === 'confirmed' ? '#D1FAE5' : b.status === 'rejected' ? '#FEE2E2' : '#FEF3C7' }]}>
                <Text style={[s.statusText, { color: b.status === 'confirmed' ? colors.success : b.status === 'rejected' ? colors.error : '#D97706' }]}>{b.status}</Text>
              </View>
            </View>
            {b.quoted_amount && (
              <Text style={s.quote}>Quote: ₹{b.quoted_amount.toFixed(2)}</Text>
            )}
            {b.notes && <Text style={s.notes}>"{b.notes}"</Text>}
          </View>
        ))}

        <TouchableOpacity onPress={() => setShowForm(true)} style={s.newBtn} testID="new-event-btn">
          <Ionicons name="add-circle" size={22} color="#fff" />
          <Text style={s.newBtnText}>Request Event Order</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal visible={showForm} animationType="slide" presentationStyle="formSheet">
        <SafeAreaView style={s.safe} edges={['top']}>
          <View style={s.modalHeader}>
            <TouchableOpacity onPress={() => setShowForm(false)}><Ionicons name="close" size={26} color={colors.textPrimary} /></TouchableOpacity>
            <Text style={s.title}>New Event Request</Text>
            <View style={{ width: 26 }} />
          </View>
          <ScrollView contentContainerStyle={{ padding: spacing.md }}>
            <Field label="Event name *" value={form.event_name} onChangeText={(v) => setForm({ ...form, event_name: v })} placeholder="Annual team offsite" />
            <Field label="Date (YYYY-MM-DD) *" value={form.event_date} onChangeText={(v) => setForm({ ...form, event_date: v })} placeholder="2026-03-15" />
            <Field label="Headcount *" value={String(form.headcount)} onChangeText={(v) => setForm({ ...form, headcount: parseInt(v) || 0 })} keyboardType="number-pad" placeholder="50" />

            <Text style={s.fieldLabel}>Vendor *</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.md }}>
              {vendors.map((v) => (
                <TouchableOpacity key={v.id} onPress={() => setForm({ ...form, vendor_id: v.id })} style={[s.vendorChip, form.vendor_id === v.id && s.vendorChipActive]}>
                  <Text style={[s.vendorChipText, form.vendor_id === v.id && { color: '#fff' }]}>{v.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Field label="Special requests (optional)" value={form.notes} onChangeText={(v) => setForm({ ...form, notes: v })} placeholder="Vegan options, no nuts, etc." multiline />

            <TouchableOpacity onPress={submit} style={s.submitBtn} testID="submit-event-btn">
              <Text style={s.submitText}>Submit Request</Text>
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const Field = ({ label, value, onChangeText, ...rest }) => (
  <View style={{ marginBottom: spacing.md }}>
    <Text style={s.fieldLabel}>{label}</Text>
    <TextInput value={value} onChangeText={onChangeText} placeholderTextColor={colors.textMuted} style={s.input} {...rest} />
  </View>
);

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { padding: spacing.md, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  title: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  subtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 4 },
  heroCard: { backgroundColor: colors.primaryLight, padding: spacing.lg, borderRadius: borderRadius.md, alignItems: 'center', marginBottom: spacing.md, borderWidth: 1, borderColor: colors.primary },
  heroTitle: { fontSize: 17, fontWeight: '700', color: colors.textPrimary, marginTop: 8 },
  heroSub: { fontSize: 12, color: colors.textSecondary, textAlign: 'center', marginTop: 4 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.textMuted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  empty: { alignItems: 'center', padding: spacing.lg, marginTop: 20 },
  emptyText: { fontSize: 14, color: colors.textSecondary, marginTop: 8 },
  bCard: { backgroundColor: colors.card, padding: spacing.md, borderRadius: borderRadius.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.borderLight },
  bHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  bTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  bDate: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  statusText: { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },
  quote: { fontSize: 14, fontWeight: '700', color: colors.primary, marginTop: 4 },
  notes: { fontSize: 12, color: colors.textMuted, fontStyle: 'italic', marginTop: 4 },
  newBtn: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, backgroundColor: colors.primary, padding: 14, borderRadius: borderRadius.md, marginTop: spacing.md },
  newBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.borderLight, backgroundColor: colors.card },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: colors.textPrimary, marginBottom: 6 },
  vendorChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderLight, marginRight: 8 },
  vendorChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  vendorChipText: { fontSize: 13, color: colors.textPrimary },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderLight, borderRadius: borderRadius.sm, padding: spacing.sm, fontSize: 15, color: colors.textPrimary },
  submitBtn: { backgroundColor: colors.primary, padding: 14, borderRadius: borderRadius.md, alignItems: 'center', marginTop: spacing.lg },
  submitText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
