import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Image, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import { colors, spacing, borderRadius } from '../theme';

const LOGO_URL = 'https://customer-assets.emergentagent.com/job_corporate-feast/artifacts/j6kduny0_WhatsApp%20Image%202026-05-27%20at%2011.03.31%20AM%20-%20Edited.png';

export default function HomeScreen({ navigation }) {
  const { user } = useAuth();
  const [vendors, setVendors] = useState([]);
  const [recommendations, setRecommendations] = useState('');
  const [loadingRecs, setLoadingRecs] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const loadData = async () => {
    try {
      const [vendorsRes, notifsRes] = await Promise.all([
        client.get('/vendors'),
        client.get('/notifications').catch(() => ({ data: [] })),
      ]);
      setVendors(vendorsRes.data);
      setUnreadCount(notifsRes.data.filter((n) => !n.read).length);
    } catch (e) {
      console.error('HomeScreen load error', e?.response?.data || e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
    const unsubscribe = navigation.addListener('focus', loadData);
    return unsubscribe;
  }, [navigation]);

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const getRecommendations = async () => {
    setLoadingRecs(true);
    try {
      let body = { user_preferences: 'healthy options', dietary_restrictions: 'None' };
      try {
        const { data: prefs } = await client.get('/preferences');
        if (prefs.favorite_cuisines?.length || prefs.dietary_preferences?.length) {
          body = {
            user_preferences: `Cuisines: ${prefs.favorite_cuisines?.join(', ') || 'any'}. Diet: ${prefs.dietary_preferences?.join(', ') || 'any'}`,
            dietary_restrictions: prefs.allergies?.length ? `Allergic to: ${prefs.allergies.join(', ')}` : 'None',
          };
        }
      } catch {}
      const { data } = await client.post('/ai/recommendations', body);
      setRecommendations(data.recommendations);
    } catch (e) {
      console.error('AI recs error', e?.response?.data || e.message);
    } finally {
      setLoadingRecs(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Image source={{ uri: LOGO_URL }} style={styles.headerLogo} resizeMode="contain" />
        </View>
        <TouchableOpacity onPress={() => navigation.navigate('Notifications')} style={styles.bellWrap}>
          <Ionicons name="notifications-outline" size={24} color={colors.textPrimary} />
          {unreadCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <Text style={styles.greeting}>Hello, {user?.name?.split(' ')[0]}! 👋</Text>
        <Text style={styles.tagline}>What would you like to eat today?</Text>

        <LinearGradient
          colors={[colors.primaryLight, colors.accentLight]}
          style={styles.aiCard}
        >
          <View style={styles.aiCardHeader}>
            <View style={styles.aiIconWrap}>
              <Ionicons name="sparkles" size={20} color={colors.primary} />
            </View>
            <Text style={styles.aiCardTitle}>AI Food Picks</Text>
          </View>
          <Text style={styles.aiCardSubtitle}>
            Personalized meal suggestions just for you
          </Text>
          <TouchableOpacity
            style={styles.aiButton}
            onPress={getRecommendations}
            disabled={loadingRecs}
          >
            {loadingRecs ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.aiButtonText}>Get Recommendations</Text>
            )}
          </TouchableOpacity>
          {recommendations ? (
            <View style={styles.recBox}>
              <Text style={styles.recText}>{recommendations}</Text>
            </View>
          ) : null}
        </LinearGradient>

        <Text style={styles.sectionTitle}>Vendors near you</Text>
        {vendors.map((vendor) => (
          <TouchableOpacity
            key={vendor.id}
            style={styles.vendorCard}
            onPress={() => navigation.navigate('Menu', { vendorId: vendor.id })}
            activeOpacity={0.7}
          >
            <View style={styles.vendorIconWrap}>
              <Ionicons name="restaurant" size={24} color={colors.primary} />
            </View>
            <View style={styles.vendorInfo}>
              <Text style={styles.vendorName}>{vendor.name}</Text>
              <Text style={styles.vendorCuisine}>{vendor.cuisine_type}</Text>
              <View style={styles.ratingRow}>
                <Ionicons name="star" size={14} color={colors.accent} />
                <Text style={styles.ratingText}>{vendor.rating?.toFixed(1)}</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center' },
  headerLogo: { width: 90, height: 36 },
  bellWrap: { position: 'relative', padding: spacing.xs },
  badge: {
    position: 'absolute',
    top: 0,
    right: 0,
    backgroundColor: colors.primary,
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '600' },
  content: { padding: spacing.lg, paddingBottom: 100 },
  greeting: { fontSize: 26, fontWeight: '700', color: colors.textPrimary, letterSpacing: -0.5 },
  tagline: { fontSize: 16, color: colors.textSecondary, marginTop: 4, marginBottom: spacing.lg },
  aiCard: { padding: spacing.lg, borderRadius: borderRadius.lg, marginBottom: spacing.lg },
  aiCardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  aiIconWrap: { backgroundColor: '#fff', padding: 8, borderRadius: borderRadius.sm, marginRight: spacing.sm },
  aiCardTitle: { fontSize: 18, fontWeight: '600', color: colors.textPrimary },
  aiCardSubtitle: { fontSize: 14, color: colors.textSecondary, marginBottom: spacing.md },
  aiButton: { backgroundColor: colors.primary, paddingVertical: 12, paddingHorizontal: 24, borderRadius: borderRadius.md, alignSelf: 'flex-start' },
  aiButtonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  recBox: { backgroundColor: 'rgba(255,255,255,0.7)', padding: spacing.md, borderRadius: borderRadius.md, marginTop: spacing.md },
  recText: { fontSize: 13, color: colors.textPrimary, lineHeight: 20 },
  sectionTitle: { fontSize: 20, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.md },
  vendorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  vendorIconWrap: { backgroundColor: colors.primaryLight, padding: 12, borderRadius: borderRadius.md, marginRight: spacing.md },
  vendorInfo: { flex: 1 },
  vendorName: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  vendorCuisine: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  ratingText: { fontSize: 12, color: colors.textSecondary, marginLeft: 4 },
});
