import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, ActivityIndicator, Modal, TextInput, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';
import { colors, spacing, borderRadius } from '../../theme';

const ROLE_META = {
  master_admin: { label: 'Master', color: '#DC2626', bg: '#FEE2E2', icon: 'star' },
  super_admin: { label: 'Super', color: '#7C3AED', bg: '#EDE9FE', icon: 'shield' },
  site_admin: { label: 'Site', color: '#2563EB', bg: '#DBEAFE', icon: 'location' },
};

export default function AdminAdmins({ navigation }) {
  const [admins, setAdmins] = useState([]);
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [role, setRole] = useState('site_admin');
  const [form, setForm] = useState({ email: '', password: '', name: '', site_id: '' });
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [a, s] = await Promise.all([
        client.get('/admin/admins'),
        client.get('/sites'),
      ]);
      setAdmins(a.data);
      setSites(s.data);
    } catch (e) { console.log(e?.response?.data || e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const unsub = navigation.addListener('focus', load);
    return unsub;
  }, [navigation, load]);

  const submit = async () => {
    if (!form.email || !form.password || !form.name) {
      Alert.alert('Missing fields', 'Email, password, and name are required.');
      return;
    }
    setSubmitting(true);
    try {
      if (role === 'site_admin') {
        if (!form.site_id) throw new Error('Select a site');
        await client.post('/admin/site-admins', { email: form.email, password: form.password, name: form.name, site_id: form.site_id });
      } else if (role === 'super_admin') {
        await client.post('/admin/super-admins', { email: form.email, password: form.password, name: form.name, assigned_sites: [] });
      } else {
        if (!form.email.endsWith('@cravitoo.com')) throw new Error('Master email must end with @cravitoo.com');
        await client.post('/admin/master-admins', { email: form.email, password: form.password, name: form.name });
      }
      setShowForm(false);
      setForm({ email: '', password: '', name: '', site_id: '' });
      await load();
    } catch (e) {
      Alert.alert('Failed', e?.response?.data?.detail || e.message || 'Could not create admin');
    } finally {
      setSubmitting(false);
    }
  };

  const removeAdmin = (a) => {
    Alert.alert('Delete admin?', a.email, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await client.delete(`/admin/admins/${a.id}`); await load(); }
        catch (e) { Alert.alert('Failed', e?.response?.data?.detail || 'Could not delete'); }
      }},
    ]);
  };

  if (loading) return <View style={s.center}><ActivityIndicator size="large" color={colors.primary} /></View>;

  const siteName = (id) => sites.find((x) => x.id === id)?.name || id;

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Ionicons name="chevron-back" size={26} color={colors.textPrimary} /></TouchableOpacity>
        <Text style={s.title}>Admins</Text>
        <TouchableOpacity onPress={() => setShowForm(true)} style={s.addBtn}>
          <Ionicons name="add" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      <FlatList
        data={admins}
        keyExtractor={(it) => it.id}
        contentContainerStyle={{ padding: spacing.md, paddingBottom: 80 }}
        ListEmptyComponent={() => <Text style={s.emptyText}>No admins yet.</Text>}
        renderItem={({ item }) => {
          const meta = ROLE_META[item.role] || ROLE_META.site_admin;
          return (
            <View style={s.card}>
              <View style={[s.roleIcon, { backgroundColor: meta.bg }]}>
                <Ionicons name={meta.icon} size={16} color={meta.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.cardTitle}>{item.name || item.email}</Text>
                <Text style={s.cardSub}>{item.email}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                  <View style={[s.badge, { backgroundColor: meta.bg }]}>
                    <Text style={[s.badgeText, { color: meta.color }]}>{meta.label}</Text>
                  </View>
                  {item.role === 'site_admin' && item.site_id && (
                    <Text style={s.cardSub} numberOfLines={1}>{siteName(item.site_id)}</Text>
                  )}
                </View>
              </View>
              <TouchableOpacity onPress={() => removeAdmin(item)} style={s.iconBtn}>
                <Ionicons name="trash-outline" size={18} color={colors.error} />
              </TouchableOpacity>
            </View>
          );
        }}
      />

      <Modal visible={showForm} animationType="slide" presentationStyle="formSheet">
        <SafeAreaView style={s.container} edges={['top']}>
          <View style={s.header}>
            <TouchableOpacity onPress={() => setShowForm(false)}><Ionicons name="close" size={26} color={colors.textPrimary} /></TouchableOpacity>
            <Text style={s.title}>New Admin</Text>
            <View style={{ width: 32 }} />
          </View>
          <ScrollView contentContainerStyle={{ padding: spacing.md }}>
            <Text style={s.fieldLabel}>Role</Text>
            <View style={s.roleSwitcher}>
              {Object.entries(ROLE_META).map(([key, m]) => (
                <TouchableOpacity key={key} onPress={() => setRole(key)} style={[s.rolePill, role === key && { backgroundColor: m.bg, borderColor: m.color }]}>
                  <Text style={[s.rolePillText, role === key && { color: m.color, fontWeight: '700' }]}>{m.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={s.fieldLabel}>Name *</Text>
            <TextInput style={s.input} value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} placeholder="Jane Doe" placeholderTextColor={colors.textMuted} />

            <Text style={s.fieldLabel}>Email *</Text>
            <TextInput style={s.input} value={form.email} onChangeText={(v) => setForm({ ...form, email: v })} placeholder={role === 'master_admin' ? 'name@cravitoo.com' : 'admin@company.com'} placeholderTextColor={colors.textMuted} autoCapitalize="none" keyboardType="email-address" />

            <Text style={s.fieldLabel}>Password *</Text>
            <TextInput style={s.input} value={form.password} onChangeText={(v) => setForm({ ...form, password: v })} secureTextEntry placeholder="min 6 chars" placeholderTextColor={colors.textMuted} />

            {role === 'site_admin' && (
              <>
                <Text style={s.fieldLabel}>Assigned Site *</Text>
                <View style={s.siteList}>
                  {sites.map((site) => (
                    <TouchableOpacity key={site.id} onPress={() => setForm({ ...form, site_id: site.id })} style={[s.siteOpt, form.site_id === site.id && { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}>
                      <Text style={{ color: form.site_id === site.id ? colors.primary : colors.textPrimary, fontSize: 13 }}>{site.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            <TouchableOpacity onPress={submit} disabled={submitting} style={[s.submitBtn, submitting && { opacity: 0.6 }]}>
              <Text style={s.submitText}>{submitting ? 'Creating...' : 'Create Admin'}</Text>
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.borderLight, backgroundColor: colors.card },
  title: { fontSize: 18, fontWeight: '700', color: colors.textPrimary },
  addBtn: { backgroundColor: colors.primary, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, padding: spacing.md, borderRadius: borderRadius.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.borderLight, gap: spacing.sm },
  cardTitle: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  cardSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  roleIcon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  badgeText: { fontSize: 10, fontWeight: '700' },
  iconBtn: { padding: 8 },
  emptyText: { textAlign: 'center', color: colors.textMuted, padding: spacing.xl },
  fieldLabel: { fontSize: 13, fontWeight: '500', color: colors.textPrimary, marginTop: spacing.sm, marginBottom: 6 },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderLight, borderRadius: borderRadius.sm, padding: spacing.sm, fontSize: 14, color: colors.textPrimary },
  roleSwitcher: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm },
  rolePill: { flex: 1, paddingVertical: 10, borderRadius: 999, borderWidth: 1, borderColor: colors.borderLight, alignItems: 'center', backgroundColor: colors.card },
  rolePillText: { fontSize: 13, color: colors.textSecondary },
  siteList: { gap: spacing.xs },
  siteOpt: { padding: spacing.sm, borderRadius: borderRadius.sm, borderWidth: 1, borderColor: colors.borderLight, backgroundColor: colors.card },
  submitBtn: { backgroundColor: colors.primary, padding: spacing.md, borderRadius: borderRadius.md, alignItems: 'center', marginTop: spacing.lg },
  submitText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
