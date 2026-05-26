import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, RefreshControl, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';
import { useAuth, isMasterAdmin, isSiteAdmin } from '../../context/AuthContext';
import { colors, spacing, borderRadius } from '../../theme';

export default function AdminDashboard({ navigation }) {
  const { user, logout } = useAuth();
  const [data, setData] = useState(null);
  const [siteData, setSiteData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      if (isMasterAdmin(user)) {
        const { data } = await client.get('/reports/master-dashboard');
        setData(data);
      } else if (isSiteAdmin(user) && user?.site_id) {
        const [s, r] = await Promise.all([
          client.get(`/sites/${user.site_id}`),
          client.get(`/reports/site/${user.site_id}`),
        ]);
        setSiteData({ site: s.data, report: r.data });
      }
    } catch (e) {
      console.log('Admin dash error', e?.response?.data || e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    load();
    const unsub = navigation.addListener('focus', load);
    return unsub;
  }, [navigation, load]);

  if (loading) {
    return (
      <View style={s.center}><ActivityIndicator size="large" color={colors.primary} /></View>
    );
  }

  const onRefresh = () => { setRefreshing(true); load(); };

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.md, paddingBottom: 80 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={s.header}>
          <View>
            <Text style={s.greeting}>Hello, {user?.name}</Text>
            <Text style={s.roleTag}>{isMasterAdmin(user) ? 'Master Admin' : 'Site Admin'}</Text>
          </View>
          <TouchableOpacity onPress={logout} style={s.logoutBtn}>
            <Ionicons name="log-out-outline" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {isMasterAdmin(user) && data && (
          <>
            <View style={s.heroRevenue}>
              <View>
                <Text style={s.heroLabel}>Total Revenue</Text>
                <Text style={s.heroValue}>₹{(data.total_revenue || 0).toLocaleString('en-IN')}</Text>
              </View>
              <Ionicons name="trending-up" size={36} color="#fff" />
            </View>

            <View style={s.statsGrid}>
              <StatCard label="Sites" value={data.total_sites} icon="business" color="#3B82F6" bg="#DBEAFE" />
              <StatCard label="Vendors" value={data.total_vendors} icon="storefront" color={colors.primary} bg={colors.primaryLight} />
              <StatCard label="Users" value={data.total_users} icon="people" color="#8B5CF6" bg="#EDE9FE" />
              <StatCard label="Orders" value={data.total_orders} icon="bag" color="#10B981" bg="#D1FAE5" />
            </View>

            <Text style={s.sectionTitle}>Top Vendors</Text>
            {(data.top_vendors || []).length === 0 && (
              <Text style={s.emptyText}>No vendor orders yet.</Text>
            )}
            {(data.top_vendors || []).map((v) => (
              <View key={v.vendor_id} style={s.listRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.listTitle}>{v.name}</Text>
                  <Text style={s.listSub}>{v.orders} orders</Text>
                </View>
                <Text style={s.listAmount}>₹{v.revenue.toLocaleString('en-IN')}</Text>
              </View>
            ))}

            <TouchableOpacity style={s.ctaBtn} onPress={() => navigation.navigate('AdminSites')}>
              <Ionicons name="business" size={20} color="#fff" />
              <Text style={s.ctaText}>Manage Sites & Admins</Text>
            </TouchableOpacity>
          </>
        )}

        {isSiteAdmin(user) && siteData && (
          <>
            <View style={s.siteHero}>
              <Ionicons name="business" size={32} color={colors.primary} />
              <View style={{ marginLeft: spacing.md, flex: 1 }}>
                <Text style={s.siteName}>{siteData.site.name}</Text>
                <Text style={s.siteAddr}>{siteData.site.city}</Text>
              </View>
            </View>

            <View style={s.statsGrid}>
              <StatCard label="Total Orders" value={siteData.report.total_orders} icon="bag" color="#10B981" bg="#D1FAE5" />
              <StatCard label="Paid" value={siteData.report.paid_orders} icon="checkmark-circle" color="#3B82F6" bg="#DBEAFE" />
              <StatCard label="Revenue" value={`₹${(siteData.report.total_revenue || 0).toLocaleString('en-IN')}`} icon="cash" color={colors.primary} bg={colors.primaryLight} />
              <StatCard label="Employees" value={siteData.report.employees} icon="people" color="#8B5CF6" bg="#EDE9FE" />
            </View>

            <Text style={s.sectionTitle}>Vendor Performance</Text>
            {(siteData.report.vendors || []).length === 0 && (
              <Text style={s.emptyText}>No paid orders from any vendor yet.</Text>
            )}
            {(siteData.report.vendors || []).map((v) => (
              <View key={v.vendor_id} style={s.listRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.listTitle}>{v.name}</Text>
                  <Text style={s.listSub}>{v.orders} orders</Text>
                </View>
                <Text style={s.listAmount}>₹{v.revenue.toLocaleString('en-IN')}</Text>
              </View>
            ))}

            <TouchableOpacity style={s.ctaBtn} onPress={() => navigation.navigate('SiteManagement', { siteId: siteData.site.id })}>
              <Ionicons name="settings" size={20} color="#fff" />
              <Text style={s.ctaText}>Manage Site</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const StatCard = ({ label, value, icon, color, bg }) => (
  <View style={s.statCard}>
    <View style={[s.statIcon, { backgroundColor: bg }]}><Ionicons name={icon} size={18} color={color} /></View>
    <Text style={s.statValue}>{value}</Text>
    <Text style={s.statLabel}>{label}</Text>
  </View>
);

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.lg },
  greeting: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  roleTag: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  logoutBtn: { padding: spacing.sm },
  heroRevenue: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.primary, padding: spacing.lg, borderRadius: borderRadius.lg, marginBottom: spacing.md },
  heroLabel: { color: '#fff', opacity: 0.9, fontSize: 12 },
  heroValue: { color: '#fff', fontSize: 28, fontWeight: '700', marginTop: 4 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  statCard: { width: '48%', backgroundColor: colors.card, borderRadius: borderRadius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.borderLight },
  statIcon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  statValue: { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
  statLabel: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: colors.textPrimary, marginTop: spacing.md, marginBottom: spacing.sm },
  emptyText: { color: colors.textMuted, fontSize: 13, padding: spacing.md, textAlign: 'center' },
  listRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, padding: spacing.md, borderRadius: borderRadius.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.borderLight },
  listTitle: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  listSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  listAmount: { fontSize: 15, fontWeight: '700', color: colors.primary },
  siteHero: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, padding: spacing.md, borderRadius: borderRadius.lg, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.borderLight },
  siteName: { fontSize: 18, fontWeight: '700', color: colors.textPrimary },
  siteAddr: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  ctaBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: colors.primary, padding: spacing.md, borderRadius: borderRadius.md, marginTop: spacing.md },
  ctaText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
