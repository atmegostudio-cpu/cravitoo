import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, ActivityIndicator, Modal, TextInput, ScrollView, Alert, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';
import { colors, spacing, borderRadius } from '../../theme';

export default function AdminSites({ navigation }) {
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: '', address: '', city: '', contact_email: '', contact_phone: '',
    allow_pre_order: true, allow_cash_carry: true, allow_company_paid: false, allow_employee_paid: true,
  });
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await client.get('/sites');
      setSites(data);
    } catch (e) { console.log(e?.response?.data || e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const unsub = navigation.addListener('focus', load);
    return unsub;
  }, [navigation, load]);

  const create = async () => {
    if (!form.name || !form.address || !form.city || !form.contact_email || !form.contact_phone) {
      Alert.alert('Missing fields', 'Please fill all required fields.');
      return;
    }
    setSubmitting(true);
    try {
      await client.post('/sites', form);
      setShowForm(false);
      setForm({ name: '', address: '', city: '', contact_email: '', contact_phone: '', allow_pre_order: true, allow_cash_carry: true, allow_company_paid: false, allow_employee_paid: true });
      await load();
    } catch (e) {
      Alert.alert('Failed', e?.response?.data?.detail || 'Could not create site');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <View style={s.center}><ActivityIndicator size="large" color={colors.primary} /></View>;

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Ionicons name="chevron-back" size={26} color={colors.textPrimary} /></TouchableOpacity>
        <Text style={s.title}>Sites</Text>
        <TouchableOpacity onPress={() => setShowForm(true)} style={s.addBtn}>
          <Ionicons name="add" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      <FlatList
        data={sites}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: spacing.md, paddingBottom: 80 }}
        ListEmptyComponent={() => <Text style={s.emptyText}>No sites yet. Tap + to create one.</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity style={s.card} onPress={() => navigation.navigate('SiteManagement', { siteId: item.id })}>
            <View style={{ flex: 1 }}>
              <Text style={s.cardTitle}>{item.name}</Text>
              <Text style={s.cardSub}>{item.address}, {item.city}</Text>
              <View style={s.tagRow}>
                {item.allow_pre_order && <Tag label="Pre-order" />}
                {item.allow_cash_carry && <Tag label="Cash" />}
                {item.allow_company_paid && <Tag label="Corp-paid" />}
                {item.allow_employee_paid && <Tag label="Self-paid" />}
              </View>
            </View>
            <Ionicons name="chevron-forward" size={22} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      />

      <Modal visible={showForm} animationType="slide" presentationStyle="formSheet">
        <SafeAreaView style={s.container} edges={['top']}>
          <View style={s.header}>
            <TouchableOpacity onPress={() => setShowForm(false)}><Ionicons name="close" size={26} color={colors.textPrimary} /></TouchableOpacity>
            <Text style={s.title}>New Site</Text>
            <View style={{ width: 32 }} />
          </View>
          <ScrollView contentContainerStyle={{ padding: spacing.md }}>
            <Field label="Name *" value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} placeholder="Tech Corp - Mumbai" />
            <Field label="City *" value={form.city} onChangeText={(v) => setForm({ ...form, city: v })} placeholder="Mumbai" />
            <Field label="Address *" value={form.address} onChangeText={(v) => setForm({ ...form, address: v })} placeholder="Business Park, BKC" />
            <Field label="Contact Email *" value={form.contact_email} onChangeText={(v) => setForm({ ...form, contact_email: v })} placeholder="admin@site.com" keyboardType="email-address" autoCapitalize="none" />
            <Field label="Contact Phone *" value={form.contact_phone} onChangeText={(v) => setForm({ ...form, contact_phone: v })} placeholder="+91-9876543210" keyboardType="phone-pad" />

            <Text style={s.sectionLbl}>Ordering modes</Text>
            <ToggleRow label="Pre-order" value={form.allow_pre_order} onChange={(v) => setForm({ ...form, allow_pre_order: v })} />
            <ToggleRow label="Cash & Carry" value={form.allow_cash_carry} onChange={(v) => setForm({ ...form, allow_cash_carry: v })} />
            <ToggleRow label="Company-paid" value={form.allow_company_paid} onChange={(v) => setForm({ ...form, allow_company_paid: v })} />
            <ToggleRow label="Employee-paid" value={form.allow_employee_paid} onChange={(v) => setForm({ ...form, allow_employee_paid: v })} />

            <TouchableOpacity onPress={create} disabled={submitting} style={[s.submitBtn, submitting && { opacity: 0.6 }]}>
              <Text style={s.submitText}>{submitting ? 'Creating...' : 'Create Site'}</Text>
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const Tag = ({ label }) => (
  <View style={s.tag}><Text style={s.tagText}>{label}</Text></View>
);

const Field = ({ label, ...props }) => (
  <View style={{ marginBottom: spacing.md }}>
    <Text style={s.fieldLabel}>{label}</Text>
    <TextInput style={s.input} placeholderTextColor={colors.textMuted} {...props} />
  </View>
);

const ToggleRow = ({ label, value, onChange }) => (
  <View style={s.toggleRow}>
    <Text style={s.toggleLabel}>{label}</Text>
    <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.primary }} />
  </View>
);

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.borderLight, backgroundColor: colors.card },
  title: { fontSize: 18, fontWeight: '700', color: colors.textPrimary },
  addBtn: { backgroundColor: colors.primary, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, padding: spacing.md, borderRadius: borderRadius.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.borderLight },
  cardTitle: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  cardSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  tag: { paddingHorizontal: 8, paddingVertical: 2, backgroundColor: colors.primaryLight, borderRadius: 999 },
  tagText: { fontSize: 10, color: colors.primary, fontWeight: '600' },
  emptyText: { textAlign: 'center', color: colors.textMuted, padding: spacing.xl },
  fieldLabel: { fontSize: 13, fontWeight: '500', color: colors.textPrimary, marginBottom: 6 },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderLight, borderRadius: borderRadius.sm, padding: spacing.sm, fontSize: 14, color: colors.textPrimary },
  sectionLbl: { fontSize: 13, fontWeight: '600', color: colors.textPrimary, marginTop: spacing.sm, marginBottom: spacing.sm },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.card, padding: spacing.md, borderRadius: borderRadius.sm, borderWidth: 1, borderColor: colors.borderLight, marginBottom: spacing.xs },
  toggleLabel: { fontSize: 14, color: colors.textPrimary },
  submitBtn: { backgroundColor: colors.primary, padding: spacing.md, borderRadius: borderRadius.md, alignItems: 'center', marginTop: spacing.md, marginBottom: spacing.lg },
  submitText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
