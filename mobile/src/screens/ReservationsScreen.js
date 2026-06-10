import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { colors, spacing, borderRadius } from '../theme';

const MEAL_META = {
  breakfast: { icon: 'sunny-outline', label: 'Breakfast', emoji: '🌅' },
  lunch:     { icon: 'sunny', label: 'Lunch', emoji: '🍽️' },
  snacks:    { icon: 'cafe-outline', label: 'Evening Snacks', emoji: '☕' },
  dinner:    { icon: 'moon-outline', label: 'Dinner', emoji: '🌙' },
};

const MEAL_TYPE_LABELS = {
  veg_meal: { label: 'Veg Meal', emoji: '🟢' },
  non_veg_meal: { label: 'Non-Veg Meal', emoji: '🔴' },
  veg_salad: { label: 'Veg Salad', emoji: '🥗' },
  non_veg_salad: { label: 'Non-Veg Salad', emoji: '🥗' },
};
const MEAL_TYPE_ORDER = ['veg_meal', 'non_veg_meal', 'veg_salad', 'non_veg_salad'];

function Countdown({ to }) {
  const [text, setText] = useState('');
  useEffect(() => {
    const tick = () => {
      const ms = new Date(to).getTime() - Date.now();
      if (ms <= 0) { setText(''); return; }
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      setText(`Cutoff in ${h}h ${m}m`);
    };
    tick();
    const i = setInterval(tick, 30000);
    return () => clearInterval(i);
  }, [to]);
  return text ? <Text style={styles.countdown}>{text}</Text> : null;
}

function MealCard({ meal, onReserve, onCancel, busy }) {
  const meta = MEAL_META[meal.meal_period];
  const isReserved = !!meal.already_reserved;
  const isDisabled = !meal.enabled;
  const cutoffPassed = meal.cutoff_passed;
  const lockedByOther = !!meal.locked_by_other;
  const lockedByMeal = meal.locked_by_meal;
  const [vendorId, setVendorId] = useState(meal.eligible_vendors?.[0]?.id || '');
  const [mealType, setMealType] = useState('veg_meal');
  const [showVendorPicker, setShowVendorPicker] = useState(false);

  const handleReserve = () => {
    if (!vendorId) {
      Alert.alert('No vendor available', 'No vendors are mapped to your site for this meal yet.');
      return;
    }
    onReserve(meal.meal_period, vendorId, mealType);
  };

  const handleCancel = () => {
    Alert.alert(
      'Cancel reservation?',
      `Cancel your ${meal.meal_period} reservation for tomorrow?`,
      [
        { text: 'Keep', style: 'cancel' },
        { text: 'Cancel', style: 'destructive', onPress: () => onCancel(meal.already_reserved.id) },
      ],
    );
  };

  const canReserve = !isReserved && !isDisabled && !cutoffPassed && !lockedByOther && (meal.eligible_vendors?.length > 0);
  const selectedVendor = meal.eligible_vendors?.find(v => v.id === vendorId);

  return (
    <View
      style={[
        styles.card,
        isReserved && styles.cardReserved,
        (isDisabled || cutoffPassed) && !isReserved && styles.cardDisabled,
      ]}
      testID={`reservation-card-${meal.meal_period}`}
    >
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderLeft}>
          <View style={styles.iconBubble}>
            <Ionicons name={meta.icon} size={20} color={colors.primary} />
          </View>
          <View>
            <Text style={styles.cardTitle}>{meta.emoji} {meta.label}</Text>
            <Text style={styles.cardSubtitle}>Tomorrow • {meal.delivery_date}</Text>
          </View>
        </View>
        {isReserved && (
          <View style={styles.badgeReserved} testID={`status-reserved-${meal.meal_period}`}>
            <Ionicons name="checkmark-circle" size={12} color={colors.success} />
            <Text style={styles.badgeReservedText}> Reserved</Text>
          </View>
        )}
        {isDisabled && (
          <View style={styles.badgeDisabled}>
            <Text style={styles.badgeDisabledText}>Off</Text>
          </View>
        )}
        {!isDisabled && !isReserved && cutoffPassed && (
          <View style={styles.badgeExpired}>
            <Ionicons name="time" size={12} color={colors.error} />
            <Text style={styles.badgeExpiredText}> Cutoff passed</Text>
          </View>
        )}
        {!isDisabled && !isReserved && !cutoffPassed && lockedByOther && (
          <View style={styles.badgeLocked} testID={`status-locked-${meal.meal_period}`}>
            <Ionicons name="lock-closed" size={12} color={colors.warning || '#B45309'} />
            <Text style={styles.badgeLockedText}> {lockedByMeal} booked</Text>
          </View>
        )}
      </View>

      {lockedByOther && !isReserved ? (
        <View style={styles.lockedBox} testID={`locked-msg-${meal.meal_period}`}>
          <Text style={styles.lockedText}>
            You can book only one meal per day. Cancel your {lockedByMeal} reservation to switch to {meta.label.toLowerCase()}.
          </Text>
        </View>
      ) : isReserved ? (
        <>
          <View style={styles.reservedBox}>
            <Text style={styles.reservedLabel}>Reserved with</Text>
            <Text style={styles.reservedVendor}>
              <Ionicons name="storefront" size={14} color={colors.textPrimary} /> {meal.already_reserved.vendor_name || 'Vendor'}
            </Text>
          </View>
          <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel} disabled={busy} testID={`cancel-reservation-${meal.meal_period}`}>
            <Text style={styles.cancelBtnText}>Cancel reservation</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          {meal.eligible_vendors?.length > 0 ? (
            <>
              <Text style={styles.label}>Vendor</Text>
              <TouchableOpacity
                style={[styles.vendorPicker, !canReserve && styles.vendorPickerDisabled]}
                onPress={() => canReserve && setShowVendorPicker(!showVendorPicker)}
                disabled={!canReserve}
                testID={`vendor-picker-${meal.meal_period}`}
              >
                <Text style={styles.vendorPickerText}>{selectedVendor?.name || 'Select vendor'}</Text>
                <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
              </TouchableOpacity>
              {showVendorPicker && meal.eligible_vendors.length > 1 && (
                <View style={styles.vendorDropdown}>
                  {meal.eligible_vendors.map(v => (
                    <TouchableOpacity
                      key={v.id}
                      style={styles.vendorOption}
                      onPress={() => { setVendorId(v.id); setShowVendorPicker(false); }}
                    >
                      <Text style={styles.vendorOptionText}>{v.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <Text style={styles.label}>Meal type</Text>
              <View style={styles.mealTypeRow}>
                {MEAL_TYPE_ORDER.map(mt => {
                  const isActive = mealType === mt;
                  return (
                    <TouchableOpacity
                      key={mt}
                      style={[styles.mealTypeChip, isActive && styles.mealTypeChipActive]}
                      onPress={() => canReserve && setMealType(mt)}
                      disabled={!canReserve}
                      testID={`meal-type-${meal.meal_period}-${mt}`}
                    >
                      <Text style={[styles.mealTypeText, isActive && styles.mealTypeTextActive]}>
                        {MEAL_TYPE_LABELS[mt].emoji} {MEAL_TYPE_LABELS[mt].label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <TouchableOpacity
                style={[styles.reserveBtn, !canReserve && styles.reserveBtnDisabled]}
                onPress={handleReserve}
                disabled={!canReserve || busy}
                testID={`reserve-btn-${meal.meal_period}`}
              >
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.reserveBtnText}>Reserve</Text>}
              </TouchableOpacity>
            </>
          ) : (
            <Text style={styles.noVendors}>No vendors available for this meal yet.</Text>
          )}
          {!cutoffPassed && !isDisabled && <Countdown to={meal.cutoff_at} />}
        </>
      )}
    </View>
  );
}

export default function ReservationsScreen() {
  const [availability, setAvailability] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetchAvailability = useCallback(async () => {
    try {
      const { data } = await client.get('/reservations/availability');
      setAvailability(data);
    } catch (e) {
      Alert.alert('Could not load reservations', e?.response?.data?.detail || e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchAvailability(); }, [fetchAvailability]);

  const handleReserve = async (mealPeriod, vendorId, mealType) => {
    setBusy(true);
    try {
      await client.post('/reservations', { vendor_id: vendorId, meal_period: mealPeriod, meal_type: mealType });
      Alert.alert('✅ Reserved', `${MEAL_TYPE_LABELS[mealType]?.label || ''} ${MEAL_META[mealPeriod].label} confirmed for tomorrow`);
      fetchAvailability();
    } catch (e) {
      Alert.alert('Reservation failed', e?.response?.data?.detail || e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async (reservationId) => {
    setBusy(true);
    try {
      await client.delete(`/reservations/${reservationId}`);
      fetchAvailability();
    } catch (e) {
      Alert.alert('Cancel failed', e?.response?.data?.detail || e.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Reserve Tomorrow's Meals</Text>
        <View style={styles.headerSubRow}>
          <Ionicons name="calendar-outline" size={14} color={colors.textSecondary} />
          <Text style={styles.headerSub} testID="reservation-date"> {availability?.date}</Text>
        </View>
      </View>

      <FlatList
        data={availability?.meals || []}
        keyExtractor={(m) => m.meal_period}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchAvailability(); }} />
        }
        ListHeaderComponent={() => (
          <View style={styles.banner}>
            <Ionicons name="information-circle" size={18} color={colors.primary} />
            <Text style={styles.bannerText}>
              Pick one meal per slot. Cutoff is 8 PM today (admin-configurable). No payment — this is a kitchen head-count.
            </Text>
          </View>
        )}
        renderItem={({ item }) => (
          <MealCard meal={item} onReserve={handleReserve} onCancel={handleCancel} busy={busy} />
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  header: { padding: spacing.md, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  headerTitle: { fontSize: 24, fontWeight: '700', color: colors.textPrimary, letterSpacing: -0.5 },
  headerSubRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  headerSub: { fontSize: 12, color: colors.textSecondary },
  list: { padding: spacing.md },

  banner: { flexDirection: 'row', gap: 10, backgroundColor: colors.primaryLight, padding: spacing.md, borderRadius: borderRadius.md, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.primary + '33' },
  bannerText: { flex: 1, fontSize: 12, color: colors.textSecondary, lineHeight: 16 },

  card: { backgroundColor: colors.card, borderRadius: borderRadius.md, padding: spacing.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.borderLight },
  cardReserved: { borderColor: colors.success + '60', backgroundColor: colors.successLight },
  cardDisabled: { opacity: 0.6 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing.sm },
  cardHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  iconBubble: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.primaryLight, justifyContent: 'center', alignItems: 'center' },
  cardTitle: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  cardSubtitle: { fontSize: 11, color: colors.textMuted, marginTop: 2 },

  badgeReserved: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#E6F7EE', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  badgeReservedText: { fontSize: 11, color: colors.success, fontWeight: '600' },
  badgeDisabled: { backgroundColor: '#EFEFEF', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  badgeDisabledText: { fontSize: 11, color: '#666', fontWeight: '600' },
  badgeExpired: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEEFEF', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  badgeExpiredText: { fontSize: 11, color: colors.error, fontWeight: '600' },

  reservedBox: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.success + '40', borderRadius: borderRadius.sm, padding: 12, marginTop: 4 },
  reservedLabel: { fontSize: 11, color: colors.textMuted },
  reservedVendor: { fontSize: 14, color: colors.textPrimary, fontWeight: '500', marginTop: 4 },
  cancelBtn: { marginTop: 10, padding: 10, borderRadius: borderRadius.sm, borderWidth: 1, borderColor: '#FECACA' },
  cancelBtnText: { color: colors.error, fontSize: 13, textAlign: 'center', fontWeight: '500' },

  label: { fontSize: 11, color: colors.textMuted, marginBottom: 6, marginTop: 4 },
  mealTypeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  badgeLocked: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEF3C7', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  badgeLockedText: { fontSize: 11, color: '#B45309', fontWeight: '500' },
  lockedBox: { backgroundColor: '#FEF3C7', borderColor: '#FCD34D', borderWidth: 1, padding: 12, borderRadius: 12, marginTop: 8 },
  lockedText: { fontSize: 12, color: '#92400E', lineHeight: 18 },
  mealTypeChip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: colors.borderLight, backgroundColor: colors.background },
  mealTypeChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  mealTypeText: { fontSize: 12, color: colors.textSecondary, fontWeight: '500' },
  mealTypeTextActive: { color: '#fff', fontWeight: '600' },
  vendorPicker: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.background, borderWidth: 1, borderColor: colors.borderLight, borderRadius: borderRadius.sm, paddingVertical: 10, paddingHorizontal: 12 },
  vendorPickerDisabled: { opacity: 0.5 },
  vendorPickerText: { fontSize: 14, color: colors.textPrimary },
  vendorDropdown: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.borderLight, borderRadius: borderRadius.sm, marginTop: 4, overflow: 'hidden' },
  vendorOption: { padding: 12, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  vendorOptionText: { fontSize: 14, color: colors.textPrimary },

  reserveBtn: { backgroundColor: colors.primary, paddingVertical: 12, borderRadius: borderRadius.sm, alignItems: 'center', marginTop: 12 },
  reserveBtnDisabled: { opacity: 0.4 },
  reserveBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },

  noVendors: { fontSize: 13, color: colors.textMuted, fontStyle: 'italic', paddingVertical: 6 },
  countdown: { textAlign: 'center', fontSize: 11, color: colors.textMuted, marginTop: 8 },
});
