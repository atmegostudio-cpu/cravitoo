import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity, Alert, Switch, TextInput, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import client from '../../api/client';
import { colors, spacing, borderRadius } from '../../theme';

const TABS = [
  { key: 'vendors', label: 'Vendors', icon: 'storefront' },
  { key: 'menu', label: 'Menu', icon: 'restaurant' },
  { key: 'schedule', label: 'Schedule', icon: 'calendar' },
  { key: 'settings', label: 'Settings', icon: 'settings' },
];

export default function SiteManagement({ route, navigation }) {
  const siteId = route?.params?.siteId;
  const [site, setSite] = useState(null);
  const [tab, setTab] = useState('vendors');
  const [loading, setLoading] = useState(true);

  const loadSite = useCallback(async () => {
    try {
      const { data } = await client.get(`/sites/${siteId}`);
      setSite(data);
    } catch (e) { console.log(e?.response?.data || e.message); }
    finally { setLoading(false); }
  }, [siteId]);

  useEffect(() => { if (siteId) loadSite(); }, [siteId, loadSite]);

  if (loading) return <View style={s.center}><ActivityIndicator size="large" color={colors.primary} /></View>;
  if (!site) return <View style={s.center}><Text style={{ color: colors.textMuted }}>Site not found</Text></View>;

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Ionicons name="chevron-back" size={26} color={colors.textPrimary} /></TouchableOpacity>
        <View style={{ flex: 1, marginLeft: spacing.sm }}>
          <Text style={s.title} numberOfLines={1}>{site.name}</Text>
          <Text style={s.sub} numberOfLines={1}>{site.city}</Text>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tabBar} contentContainerStyle={{ paddingHorizontal: spacing.md }}>
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <TouchableOpacity key={t.key} onPress={() => setTab(t.key)} style={[s.tab, active && s.tabActive]}>
              <Ionicons name={t.icon} size={16} color={active ? colors.primary : colors.textSecondary} />
              <Text style={[s.tabLabel, active && { color: colors.primary }]}>{t.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={{ flex: 1 }}>
        {tab === 'vendors' && <VendorsTab siteId={siteId} />}
        {tab === 'menu' && <MenuTab siteId={siteId} />}
        {tab === 'schedule' && <ScheduleTab siteId={siteId} />}
        {tab === 'settings' && <SettingsTab site={site} reload={loadSite} />}
      </View>
    </SafeAreaView>
  );
}

const VendorsTab = ({ siteId }) => {
  const [mapped, setMapped] = useState([]);
  const [all, setAll] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [m, a] = await Promise.all([
        client.get(`/sites/${siteId}/vendors`),
        client.get('/vendors'),
      ]);
      setMapped(m.data);
      setAll(a.data);
    } catch (e) { console.log(e?.response?.data || e.message); }
    finally { setLoading(false); }
  }, [siteId]);

  useEffect(() => { load(); }, [load]);

  const add = async (vendorId) => {
    try {
      await client.post(`/sites/${siteId}/vendors`, { vendor_id: vendorId, site_id: siteId });
      await load();
    } catch (e) { Alert.alert('Failed', e?.response?.data?.detail || 'Could not add vendor'); }
  };
  const remove = async (vendorId) => {
    Alert.alert('Remove vendor?', 'Customers at this site will no longer see this vendor.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        try { await client.delete(`/sites/${siteId}/vendors/${vendorId}`); await load(); }
        catch (e) { Alert.alert('Failed', e?.response?.data?.detail || 'Could not remove'); }
      }},
    ]);
  };

  if (loading) return <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: spacing.lg }} />;

  const mappedIds = new Set(mapped.map((v) => v.id));
  const unmapped = all.filter((v) => !mappedIds.has(v.id));

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: 80 }}>
      <Text style={s.sectionTitle}>Active ({mapped.length})</Text>
      {mapped.length === 0 && <Text style={s.emptyText}>No vendors mapped.</Text>}
      {mapped.map((v) => (
        <View key={v.id} style={s.rowCard}>
          <View style={{ flex: 1 }}>
            <Text style={s.rowTitle}>{v.name}</Text>
            <Text style={s.rowSub}>{v.cuisine_type}</Text>
          </View>
          <TouchableOpacity onPress={() => remove(v.id)} style={s.iconBtn}>
            <Ionicons name="trash-outline" size={18} color={colors.error} />
          </TouchableOpacity>
        </View>
      ))}

      <Text style={s.sectionTitle}>Add Vendors</Text>
      {unmapped.length === 0 && <Text style={s.emptyText}>All vendors already mapped.</Text>}
      {unmapped.map((v) => (
        <View key={v.id} style={s.rowCard}>
          <View style={{ flex: 1 }}>
            <Text style={s.rowTitle}>{v.name}</Text>
            <Text style={s.rowSub}>{v.cuisine_type}</Text>
          </View>
          <TouchableOpacity onPress={() => add(v.id)} style={s.addPill}>
            <Ionicons name="add" size={14} color="#fff" />
            <Text style={s.addPillText}>Add</Text>
          </TouchableOpacity>
        </View>
      ))}
    </ScrollView>
  );
};

const MenuTab = ({ siteId }) => {
  const [items, setItems] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [selectedVendor, setSelectedVendor] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [m, v] = await Promise.all([
        client.get(`/sites/${siteId}/menu`),
        client.get(`/sites/${siteId}/vendors`),
      ]);
      setItems(m.data);
      setVendors(v.data);
      if (v.data.length > 0 && !selectedVendor) setSelectedVendor(v.data[0].id);
    } catch (e) { console.log(e?.response?.data || e.message); }
    finally { setLoading(false); }
  }, [siteId, selectedVendor]);

  useEffect(() => { load(); }, [load]);

  const uploadExcel = async () => {
    if (!selectedVendor) {
      Alert.alert('Select vendor', 'Please choose which vendor this menu is for.');
      return;
    }
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'],
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;
    setUploading(true);
    try {
      const asset = result.assets[0];
      const fd = new FormData();
      fd.append('file', {
        uri: asset.uri,
        name: asset.name,
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const { data } = await client.post(`/sites/${siteId}/menu/upload-excel?vendor_id=${selectedVendor}`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      Alert.alert('Success', `Inserted ${data.inserted} items${data.errors?.length ? ` (${data.errors.length} errors)` : ''}`);
      await load();
    } catch (e) {
      Alert.alert('Upload failed', e?.response?.data?.detail || 'Try again');
    } finally {
      setUploading(false);
    }
  };

  const toggleAvail = async (item) => {
    try {
      await client.patch(`/menu/${item.id}/site-control`, { is_available: !item.is_available });
      setItems((prev) => prev.map((x) => x.id === item.id ? { ...x, is_available: !x.is_available } : x));
    } catch (e) { Alert.alert('Failed', e?.response?.data?.detail || 'Could not update'); }
  };
  const toggleShow = async (item) => {
    try {
      await client.patch(`/menu/${item.id}/site-control`, { show_price: !item.show_price });
      setItems((prev) => prev.map((x) => x.id === item.id ? { ...x, show_price: !x.show_price } : x));
    } catch (e) { Alert.alert('Failed', e?.response?.data?.detail || 'Could not update'); }
  };
  const savePrice = async (item, price) => {
    const p = parseFloat(price);
    if (isNaN(p) || p < 0) return;
    if (p === item.price) return;
    try {
      await client.patch(`/menu/${item.id}/site-control`, { price: p });
      setItems((prev) => prev.map((x) => x.id === item.id ? { ...x, price: p } : x));
    } catch (e) { Alert.alert('Failed', e?.response?.data?.detail || 'Could not update'); }
  };

  if (loading) return <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: spacing.lg }} />;

  return (
    <FlatList
      data={items}
      keyExtractor={(it) => it.id}
      contentContainerStyle={{ padding: spacing.md, paddingBottom: 80 }}
      ListHeaderComponent={() => (
        <View style={{ marginBottom: spacing.md }}>
          {vendors.length > 0 && (
            <View style={s.vendorPickerCard}>
              <Text style={s.uploadTitle}>📄 Upload menu via Excel</Text>
              <Text style={s.uploadSub}>Choose vendor, then pick .xlsx file. Columns: name, description, category, price.</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
                {vendors.map((v) => (
                  <TouchableOpacity
                    key={v.id}
                    onPress={() => setSelectedVendor(v.id)}
                    style={[s.vendorChip, selectedVendor === v.id && s.vendorChipActive]}
                  >
                    <Text style={[s.vendorChipText, selectedVendor === v.id && { color: '#fff' }]} numberOfLines={1}>{v.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <TouchableOpacity onPress={uploadExcel} disabled={uploading} style={[s.uploadBtn, uploading && { opacity: 0.6 }]}>
                <Ionicons name="cloud-upload" size={16} color="#fff" />
                <Text style={s.uploadBtnText}>{uploading ? 'Uploading...' : 'Pick Excel & Upload'}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}
      ListEmptyComponent={() => <Text style={s.emptyText}>No menu items yet.</Text>}
      renderItem={({ item }) => (
        <View style={s.menuCard}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={s.rowTitle}>{item.name}</Text>
              <Text style={s.rowSub}>{item.category} · {item.is_vegetarian ? '🟢 Veg' : '🔴 Non-veg'}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={s.rowSub}>Available</Text>
              <Switch value={item.is_available} onValueChange={() => toggleAvail(item)} trackColor={{ true: colors.success }} />
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <Text style={s.rowSub}>Price (₹)</Text>
              <TextInput defaultValue={String(item.price)} onEndEditing={(e) => savePrice(item, e.nativeEvent.text)} keyboardType="decimal-pad" style={s.priceInput} />
            </View>
            <View>
              <Text style={s.rowSub}>Show Price</Text>
              <Switch value={item.show_price} onValueChange={() => toggleShow(item)} trackColor={{ true: colors.success }} />
            </View>
          </View>
        </View>
      )}
    />
  );
};

const ScheduleTab = ({ siteId }) => {
  const PERIODS = ['breakfast', 'lunch', 'snacks', 'dinner'];
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await client.get(`/sites/${siteId}/schedule`);
        const sched = data.schedules || [];
        const filled = PERIODS.map((p) => {
          const existing = sched.find((s) => s.meal_period === p);
          return existing || { meal_period: p, start_time: '12:00', end_time: '14:00', enabled: false };
        });
        setSchedules(filled);
      } catch (e) { console.log(e?.response?.data || e.message); }
      finally { setLoading(false); }
    })();
  }, [siteId]);

  const update = (idx, key, val) => {
    const next = [...schedules];
    next[idx] = { ...next[idx], [key]: val };
    setSchedules(next);
  };

  const save = async () => {
    setSaving(true);
    try {
      await client.put(`/sites/${siteId}/schedule`, { schedules });
      Alert.alert('Saved', 'Schedule updated successfully.');
    } catch (e) { Alert.alert('Failed', e?.response?.data?.detail || 'Could not save'); }
    finally { setSaving(false); }
  };

  if (loading) return <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: spacing.lg }} />;

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: 80 }}>
      <Text style={s.note}>Set the time-window when each meal period is orderable.</Text>
      {schedules.map((row, i) => (
        <View key={row.meal_period} style={s.menuCard}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Text style={[s.rowTitle, { textTransform: 'capitalize' }]}>{row.meal_period}</Text>
            <Switch value={row.enabled} onValueChange={(v) => update(i, 'enabled', v)} trackColor={{ true: colors.success }} />
          </View>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={s.rowSub}>Start (HH:MM)</Text>
              <TextInput value={row.start_time} onChangeText={(v) => update(i, 'start_time', v)} editable={row.enabled} style={s.priceInput} placeholder="08:00" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.rowSub}>End (HH:MM)</Text>
              <TextInput value={row.end_time} onChangeText={(v) => update(i, 'end_time', v)} editable={row.enabled} style={s.priceInput} placeholder="10:30" />
            </View>
          </View>
        </View>
      ))}
      <TouchableOpacity onPress={save} disabled={saving} style={[s.saveBtn, saving && { opacity: 0.6 }]}>
        <Text style={s.saveBtnText}>{saving ? 'Saving...' : 'Save Schedule'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const SettingsTab = ({ site, reload }) => {
  const [form, setForm] = useState({
    allow_pre_order: site.allow_pre_order,
    allow_cash_carry: site.allow_cash_carry,
    allow_company_paid: site.allow_company_paid,
    allow_employee_paid: site.allow_employee_paid,
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await client.patch(`/sites/${site.id}`, form);
      await reload();
      Alert.alert('Saved', 'Site settings updated.');
    } catch (e) { Alert.alert('Failed', e?.response?.data?.detail || 'Could not save'); }
    finally { setSaving(false); }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: 80 }}>
      <Text style={s.note}>Toggle the ordering modes available at this site.</Text>
      {[
        { key: 'allow_pre_order', label: 'Pre-order', desc: 'Employees can pre-book meals' },
        { key: 'allow_cash_carry', label: 'Cash & Carry', desc: 'Walk-in payment at counter' },
        { key: 'allow_company_paid', label: 'Company-paid', desc: 'Order billed to corporate account' },
        { key: 'allow_employee_paid', label: 'Employee-paid', desc: 'Self-payment via Razorpay/UPI' },
      ].map((opt) => (
        <View key={opt.key} style={s.menuCard}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <Text style={s.rowTitle}>{opt.label}</Text>
              <Text style={s.rowSub}>{opt.desc}</Text>
            </View>
            <Switch value={form[opt.key]} onValueChange={(v) => setForm({ ...form, [opt.key]: v })} trackColor={{ true: colors.success }} />
          </View>
        </View>
      ))}
      <TouchableOpacity onPress={save} disabled={saving} style={[s.saveBtn, saving && { opacity: 0.6 }]}>
        <Text style={s.saveBtnText}>{saving ? 'Saving...' : 'Save Settings'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.borderLight, backgroundColor: colors.card },
  title: { fontSize: 17, fontWeight: '700', color: colors.textPrimary },
  sub: { fontSize: 12, color: colors.textMuted },
  tabBar: { backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.borderLight, maxHeight: 50 },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: colors.primary },
  tabLabel: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, marginTop: spacing.md, marginBottom: spacing.sm },
  emptyText: { color: colors.textMuted, fontSize: 13, padding: spacing.md, textAlign: 'center' },
  rowCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, padding: spacing.md, borderRadius: borderRadius.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.borderLight },
  rowTitle: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  rowSub: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  iconBtn: { padding: 8 },
  addPill: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: colors.primary, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  addPillText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  note: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.md, fontStyle: 'italic' },
  vendorPickerCard: { backgroundColor: colors.card, padding: spacing.md, borderRadius: borderRadius.md, borderWidth: 1, borderColor: colors.borderLight },
  uploadTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  uploadSub: { fontSize: 11, color: colors.textMuted, marginTop: 4 },
  vendorChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.borderLight, marginRight: 6 },
  vendorChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  vendorChipText: { fontSize: 12, fontWeight: '600', color: colors.textPrimary, maxWidth: 120 },
  uploadBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.primary, padding: 10, borderRadius: borderRadius.sm, marginTop: 10 },
  uploadBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  menuCard: { backgroundColor: colors.card, padding: spacing.md, borderRadius: borderRadius.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.borderLight },
  priceInput: { borderWidth: 1, borderColor: colors.borderLight, borderRadius: borderRadius.sm, padding: 8, fontSize: 14, color: colors.textPrimary, marginTop: 4, backgroundColor: colors.background },
  saveBtn: { backgroundColor: colors.primary, padding: spacing.md, borderRadius: borderRadius.md, alignItems: 'center', marginTop: spacing.md },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
