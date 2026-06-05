import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';
import { colors, spacing, borderRadius } from '../../theme';

const MEAL_META = {
  breakfast: { icon: 'sunny-outline', label: 'Breakfast', emoji: '🌅' },
  lunch:     { icon: 'sunny', label: 'Lunch', emoji: '🍽️' },
  snacks:    { icon: 'cafe-outline', label: 'Snacks', emoji: '☕' },
  dinner:    { icon: 'moon-outline', label: 'Dinner', emoji: '🌙' },
};

export default function VendorReservationsScreen() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchCounts = useCallback(async () => {
    try {
      const { data } = await client.get('/reservations/vendor/counts');
      setData(data);
    } catch (e) {
      console.log('Vendor reservations error', e?.response?.data || e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchCounts(); }, [fetchCounts]);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const meals = Object.entries(MEAL_META);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Tomorrow's Reservations</Text>
        <View style={styles.headerSubRow}>
          <Ionicons name="calendar-outline" size={14} color={colors.textSecondary} />
          <Text style={styles.headerSub} testID="vendor-reservations-date"> {data?.date}</Text>
        </View>
      </View>

      <FlatList
        data={data?.reservations || []}
        keyExtractor={(r) => r.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchCounts(); }} />
        }
        ListHeaderComponent={() => (
          <>
            {/* Head-count cards */}
            <View style={styles.countsRow}>
              {meals.map(([meal, meta]) => {
                const c = data?.counts?.[meal] || { reserved: 0, consumed: 0 };
                return (
                  <View key={meal} style={styles.countCard} testID={`vendor-count-${meal}`}>
                    <View style={styles.countIconBubble}>
                      <Ionicons name={meta.icon} size={16} color={colors.primary} />
                    </View>
                    <Text style={styles.countLabel}>{meta.emoji} {meta.label}</Text>
                    <Text style={styles.countNumber}>{c.reserved}</Text>
                    <Text style={styles.countSub}>{c.consumed} consumed</Text>
                  </View>
                );
              })}
            </View>

            {/* Total */}
            <View style={styles.totalCard}>
              <Ionicons name="people" size={32} color="#fff" />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.totalLabel}>Total reservations</Text>
                <Text style={styles.totalNumber}>{data?.total || 0}</Text>
              </View>
              <Text style={styles.totalHint}>Plan prep accordingly</Text>
            </View>

            <Text style={styles.sectionTitle}>Customer List</Text>
          </>
        )}
        ListEmptyComponent={() => (
          <View style={styles.empty}>
            <Ionicons name="calendar-outline" size={48} color={colors.textMuted} />
            <Text style={styles.emptyText}>No reservations yet for tomorrow</Text>
            <Text style={styles.emptySub}>Pull to refresh</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <View style={styles.row} testID={`vendor-reservation-${item.id}`}>
            <View style={styles.rowLeft}>
              <Text style={styles.rowEmoji}>{MEAL_META[item.meal_period]?.emoji}</Text>
              <View>
                <Text style={styles.rowName}>{item.employee_name || 'Employee'}</Text>
                <Text style={styles.rowEmail}>{item.employee_email}</Text>
              </View>
            </View>
            <Text style={styles.rowMeal}>{item.meal_period}</Text>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  header: { padding: spacing.md, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  headerTitle: { fontSize: 22, fontWeight: '700', color: colors.textPrimary, letterSpacing: -0.5 },
  headerSubRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  headerSub: { fontSize: 12, color: colors.textSecondary },
  list: { padding: spacing.md, flexGrow: 1 },

  countsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.sm },
  countCard: { flexBasis: '48%', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderLight, borderRadius: borderRadius.md, padding: 12 },
  countIconBubble: { width: 28, height: 28, borderRadius: 8, backgroundColor: colors.primaryLight, justifyContent: 'center', alignItems: 'center', marginBottom: 6 },
  countLabel: { fontSize: 11, color: colors.textSecondary, fontWeight: '500' },
  countNumber: { fontSize: 22, fontWeight: '700', color: colors.textPrimary, marginTop: 2 },
  countSub: { fontSize: 10, color: colors.textMuted, marginTop: 2 },

  totalCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.primary, padding: spacing.md, borderRadius: borderRadius.md, marginBottom: spacing.md },
  totalLabel: { fontSize: 11, color: '#fff', opacity: 0.9 },
  totalNumber: { fontSize: 26, fontWeight: '700', color: '#fff', marginTop: 2 },
  totalHint: { fontSize: 11, color: '#fff', opacity: 0.85 },

  sectionTitle: { fontSize: 15, fontWeight: '600', color: colors.textPrimary, marginBottom: 8, marginTop: 4 },

  empty: { alignItems: 'center', paddingVertical: 40 },
  emptyText: { fontSize: 14, color: colors.textSecondary, marginTop: 12, fontWeight: '500' },
  emptySub: { fontSize: 12, color: colors.textMuted, marginTop: 4 },

  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.card, padding: 12, borderRadius: borderRadius.sm, marginBottom: 6, borderWidth: 1, borderColor: colors.borderLight },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  rowEmoji: { fontSize: 20 },
  rowName: { fontSize: 13, fontWeight: '500', color: colors.textPrimary },
  rowEmail: { fontSize: 11, color: colors.textMuted, marginTop: 1 },
  rowMeal: { fontSize: 11, color: colors.textSecondary, textTransform: 'capitalize', fontWeight: '500' },
});
