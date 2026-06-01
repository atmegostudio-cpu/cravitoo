import React, { useEffect, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, ActivityIndicator,
  Alert, Image, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';
import { colors, spacing, borderRadius } from '../../theme';

export default function VendorMenu() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const { data } = await client.get('/menu/vendor/all');
      setItems(data);
    } catch (e) {
      console.log('Vendor menu error', e?.response?.data || e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const quickToggleAvailable = async (item) => {
    // Optimistic update
    setItems((prev) => prev.map((x) => x.id === item.id ? { ...x, is_available: !x.is_available } : x));
    try {
      await client.patch(`/menu/${item.id}/availability`);
    } catch (e) {
      // Revert on failure
      setItems((prev) => prev.map((x) => x.id === item.id ? { ...x, is_available: item.is_available } : x));
      Alert.alert('Toggle failed', e?.response?.data?.detail || 'Try again');
    }
  };

  const contactCravitoo = () => {
    Linking.openURL('mailto:partners@cravitoo.com?subject=Menu%20change%20request').catch(() => {
      Alert.alert('Contact Cravitoo', 'Please email partners@cravitoo.com to request menu changes.');
    });
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
        <Text style={styles.headerTitle}>Menu</Text>
        <Text style={styles.headerSub}>Toggle items in / out of stock</Text>
      </View>

      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={() => (
          <View style={styles.banner} testID="cravitoo-managed-banner">
            <View style={styles.bannerIcon}>
              <Ionicons name="lock-closed" size={18} color="#fff" />
            </View>
            <View style={styles.bannerBody}>
              <Text style={styles.bannerTitle}>Managed by Cravitoo</Text>
              <Text style={styles.bannerText}>
                Menu items, photos, and prices are centrally managed. You can only mark items in or out of stock.
              </Text>
              <TouchableOpacity onPress={contactCravitoo} testID="contact-cravitoo-btn">
                <Text style={styles.bannerLink}>Request menu change →</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        ListEmptyComponent={() => (
          <View style={styles.empty}>
            <Ionicons name="restaurant-outline" size={48} color={colors.textMuted} />
            <Text style={styles.emptyText}>No menu items yet</Text>
            <Text style={styles.emptySub}>
              Cravitoo will load your menu shortly. Contact your account manager for help.
            </Text>
          </View>
        )}
        renderItem={({ item }) => (
          <View style={styles.itemCard}>
            {item.image_url ? (
              <Image source={{ uri: item.image_url }} style={styles.itemImg} />
            ) : (
              <View style={[styles.itemImg, styles.itemImgPlaceholder]}>
                <Ionicons name="restaurant" size={32} color={colors.textMuted} />
              </View>
            )}
            <View style={styles.itemInfo}>
              <View style={styles.itemTopRow}>
                <Text style={styles.itemName}>{item.name}</Text>
                {item.is_vegetarian && (
                  <View style={styles.vegIndicator}>
                    <View style={styles.vegDot} />
                  </View>
                )}
              </View>
              <Text style={styles.itemDesc} numberOfLines={2}>{item.description}</Text>
              <View style={styles.itemMeta}>
                <Text style={styles.itemPrice}>₹{item.price.toFixed(2)}</Text>
                <Text style={styles.itemCategory}>{item.category}</Text>
              </View>
              <TouchableOpacity
                style={[styles.toggleBtn, item.is_available ? styles.toggleIn : styles.toggleOut]}
                onPress={() => quickToggleAvailable(item)}
                testID={`toggle-avail-${item.id}`}
              >
                <Ionicons
                  name={item.is_available ? 'checkmark-circle' : 'close-circle'}
                  size={16}
                  color={item.is_available ? colors.success : colors.error}
                />
                <Text style={[styles.toggleText, { color: item.is_available ? colors.success : colors.error }]}>
                  {item.is_available ? 'In stock — tap to mark out' : "Out of stock — tap to restock"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { padding: spacing.md, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  headerTitle: { fontSize: 26, fontWeight: '700', color: colors.textPrimary, letterSpacing: -0.5 },
  headerSub: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  list: { padding: spacing.md, flexGrow: 1 },

  banner: { flexDirection: 'row', backgroundColor: colors.primaryLight, padding: spacing.md, borderRadius: borderRadius.md, marginBottom: spacing.md, gap: spacing.sm, borderWidth: 1, borderColor: colors.primary + '33' },
  bannerIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center' },
  bannerBody: { flex: 1 },
  bannerTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, marginBottom: 2 },
  bannerText: { fontSize: 12, color: colors.textSecondary, lineHeight: 16, marginBottom: 6 },
  bannerLink: { fontSize: 13, fontWeight: '600', color: colors.primary },

  empty: { alignItems: 'center', paddingVertical: spacing.xxl, paddingHorizontal: spacing.lg },
  emptyText: { fontSize: 14, color: colors.textSecondary, marginTop: spacing.sm, fontWeight: '600' },
  emptySub: { fontSize: 12, color: colors.textMuted, marginTop: 4, textAlign: 'center' },

  itemCard: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: borderRadius.md, marginBottom: spacing.sm, overflow: 'hidden', borderWidth: 1, borderColor: colors.borderLight },
  itemImg: { width: 100, height: 'auto', minHeight: 130, backgroundColor: colors.background },
  itemImgPlaceholder: { justifyContent: 'center', alignItems: 'center' },
  itemInfo: { flex: 1, padding: spacing.sm },
  itemTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  itemName: { fontSize: 15, fontWeight: '600', color: colors.textPrimary, flex: 1 },
  vegIndicator: { width: 16, height: 16, borderWidth: 1.5, borderColor: colors.success, justifyContent: 'center', alignItems: 'center' },
  vegDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success },
  itemDesc: { fontSize: 12, color: colors.textSecondary, marginTop: 4, marginBottom: 6 },
  itemMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  itemPrice: { fontSize: 16, fontWeight: '700', color: colors.primary },
  itemCategory: { fontSize: 11, color: colors.textMuted },

  toggleBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 10, borderRadius: borderRadius.sm, borderWidth: 1 },
  toggleIn: { backgroundColor: colors.successLight, borderColor: colors.success + '33' },
  toggleOut: { backgroundColor: colors.errorLight, borderColor: colors.error + '33' },
  toggleText: { fontSize: 12, fontWeight: '600' },
});
