import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import client from '../api/client';
import { colors, spacing, borderRadius } from '../theme';

const TIER_GRADIENTS = {
  Starter: ['#F3F4F6', '#E5E7EB'],
  Bronze: ['#FED7AA', '#FCD34D'],
  Silver: ['#E5E7EB', '#94A3B8'],
  Gold: ['#FEF3C7', '#F59E0B'],
};

export default function LoyaltyScreen({ navigation }) {
  const [loyalty, setLoyalty] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    try {
      const { data } = await client.get('/loyalty');
      setLoyalty(data);
    } catch (e) {
      console.error('Loyalty load error', e?.response?.data || e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
    const unsub = navigation.addListener('focus', load);
    return unsub;
  }, [navigation]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const tier = loyalty?.tier || 'Starter';
  const gradient = TIER_GRADIENTS[tier] || TIER_GRADIENTS.Starter;

  const progress = loyalty?.next_tier_at
    ? Math.min((loyalty.total_spent / (loyalty.total_spent + loyalty.next_tier_at)) * 100, 100)
    : 100;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Rewards</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
      >
        <LinearGradient colors={gradient} style={styles.tierCard}>
          <View style={styles.tierTop}>
            <View>
              <Text style={styles.tierLabel}>Your tier</Text>
              <Text style={styles.tierName}>{tier}</Text>
            </View>
            <View style={styles.trophyIconBox}>
              <Ionicons name="trophy" size={40} color={colors.primary} />
            </View>
          </View>

          <View style={styles.pointsRow}>
            <View>
              <Text style={styles.pointsLabel}>Available Points</Text>
              <Text style={styles.pointsValue}>{loyalty?.available_points || 0}</Text>
              <Text style={styles.pointsConversion}>= ₹{loyalty?.available_points || 0} discount</Text>
            </View>
          </View>

          {loyalty?.next_tier_at && (
            <View style={styles.progressBlock}>
              <Text style={styles.progressLabel}>
                Spend ₹{loyalty.next_tier_at.toFixed(0)} more to reach the next tier
              </Text>
              <View style={styles.progressBar}>
                <View style={[styles.progressFill, { width: `${progress}%` }]} />
              </View>
            </View>
          )}
        </LinearGradient>

        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <View style={styles.statIconBox}>
              <Ionicons name="cash-outline" size={20} color={colors.primary} />
            </View>
            <Text style={styles.statValue}>₹{(loyalty?.total_spent || 0).toFixed(0)}</Text>
            <Text style={styles.statLabel}>Total Spent</Text>
          </View>
          <View style={styles.statCard}>
            <View style={[styles.statIconBox, { backgroundColor: colors.accentLight }]}>
              <Ionicons name="star" size={20} color={colors.accentHover} />
            </View>
            <Text style={styles.statValue}>{loyalty?.points_earned || 0}</Text>
            <Text style={styles.statLabel}>Earned</Text>
          </View>
          <View style={styles.statCard}>
            <View style={[styles.statIconBox, { backgroundColor: '#DBEAFE' }]}>
              <Ionicons name="receipt-outline" size={20} color="#2563EB" />
            </View>
            <Text style={styles.statValue}>{loyalty?.order_count || 0}</Text>
            <Text style={styles.statLabel}>Orders</Text>
          </View>
        </View>

        <View style={styles.howCard}>
          <Text style={styles.howTitle}>How rewards work</Text>
          {[
            { icon: 'cart-outline', text: 'Earn 1 point for every ₹100 spent' },
            { icon: 'trending-up-outline', text: 'Unlock tiers: Bronze → Silver → Gold' },
            { icon: 'gift-outline', text: 'Redeem as discount (1 point = ₹1)' },
          ].map((step, i) => (
            <View key={i} style={styles.howStep}>
              <View style={styles.howIconBox}>
                <Ionicons name={step.icon} size={18} color={colors.primary} />
              </View>
              <Text style={styles.howText}>{step.text}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  header: { padding: spacing.lg, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  headerTitle: { fontSize: 28, fontWeight: '700', color: colors.textPrimary, letterSpacing: -0.5 },
  content: { padding: spacing.md, paddingBottom: 40 },
  tierCard: { padding: spacing.lg, borderRadius: borderRadius.lg, marginBottom: spacing.md },
  tierTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  tierLabel: { fontSize: 12, color: colors.textSecondary },
  tierName: { fontSize: 32, fontWeight: '700', color: colors.textPrimary, letterSpacing: -0.5 },
  trophyIconBox: { backgroundColor: '#fff', padding: spacing.md, borderRadius: borderRadius.full },
  pointsRow: { backgroundColor: 'rgba(255,255,255,0.7)', padding: spacing.md, borderRadius: borderRadius.md },
  pointsLabel: { fontSize: 12, color: colors.textSecondary },
  pointsValue: { fontSize: 36, fontWeight: '700', color: colors.primary, marginTop: 2 },
  pointsConversion: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  progressBlock: { marginTop: spacing.md },
  progressLabel: { fontSize: 12, color: colors.textSecondary, marginBottom: spacing.xs },
  progressBar: { height: 8, backgroundColor: '#fff', borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.primary },
  statsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  statCard: { flex: 1, backgroundColor: colors.card, padding: spacing.md, borderRadius: borderRadius.md, alignItems: 'center', borderWidth: 1, borderColor: colors.borderLight },
  statIconBox: { backgroundColor: colors.primaryLight, padding: 8, borderRadius: borderRadius.sm, marginBottom: spacing.xs },
  statValue: { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
  statLabel: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  howCard: { backgroundColor: colors.card, padding: spacing.md, borderRadius: borderRadius.md, borderWidth: 1, borderColor: colors.borderLight },
  howTitle: { fontSize: 16, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.md },
  howStep: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  howIconBox: { backgroundColor: colors.primaryLight, padding: 8, borderRadius: borderRadius.full, marginRight: spacing.md },
  howText: { fontSize: 14, color: colors.textPrimary, flex: 1 },
});
