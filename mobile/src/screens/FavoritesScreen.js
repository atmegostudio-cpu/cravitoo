import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { colors, spacing, borderRadius } from '../theme';

export default function FavoritesScreen({ navigation }) {
  const [favs, setFavs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reordering, setReordering] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await client.get('/favorites');
      setFavs(data);
    } catch (e) { console.log(e?.response?.data || e.message); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => {
    load();
    const unsub = navigation.addListener('focus', load);
    return unsub;
  }, [navigation, load]);

  const removeFav = async (vendorId) => {
    Alert.alert('Remove favorite?', '', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        try { await client.delete(`/favorites/${vendorId}`); await load(); }
        catch (e) { Alert.alert('Failed', e?.response?.data?.detail || 'Try again'); }
      }},
    ]);
  };

  const reorderMyUsual = async () => {
    setReordering(true);
    try {
      const { data } = await client.get('/orders/last');
      // Convert to cart format and navigate
      const cart = {
        [data.vendor_id]: {
          vendorName: 'Reorder',
          items: data.items.map((it) => ({
            id: it.menu_item_id,
            name: it.name || 'Item',
            price: it.price,
            quantity: it.quantity,
            image_url: '',
            is_vegetarian: false,
          })),
        },
      };
      navigation.navigate('Cart', { cart });
    } catch (e) {
      Alert.alert('No previous orders', e?.response?.data?.detail || 'Place your first order to enable this.');
    } finally {
      setReordering(false);
    }
  };

  if (loading) {
    return <SafeAreaView style={s.safe}><ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} /></SafeAreaView>;
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <Text style={s.title}>Favorites</Text>
        <Text style={s.subtitle}>Quick reorder your usual</Text>
      </View>

      <TouchableOpacity onPress={reorderMyUsual} disabled={reordering} style={s.heroBtn} testID="reorder-usual-btn">
        <Ionicons name="repeat" size={22} color="#fff" />
        <View style={{ flex: 1 }}>
          <Text style={s.heroTitle}>Reorder my last order</Text>
          <Text style={s.heroSub}>One tap to recreate your most recent meal</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color="#fff" />
      </TouchableOpacity>

      <Text style={s.sectionTitle}>Your favorite vendors</Text>

      <FlatList
        data={favs}
        keyExtractor={(it) => it.vendor_id}
        contentContainerStyle={{ padding: spacing.md, paddingBottom: 60 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        ListEmptyComponent={() => (
          <View style={s.empty}>
            <Ionicons name="heart-outline" size={48} color={colors.textMuted} />
            <Text style={s.emptyText}>No favorites yet</Text>
            <Text style={s.emptySub}>Tap the heart icon on any vendor to save them here.</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <View style={s.card} testID={`fav-${item.vendor_id}`}>
            <View style={{ flex: 1 }}>
              <Text style={s.vName}>{item.name}</Text>
              <Text style={s.vCuisine}>{item.cuisine_type}{item.rating ? ` · ${item.rating.toFixed(1)} ⭐` : ''}</Text>
            </View>
            <TouchableOpacity onPress={() => navigation.navigate('Menu', { vendorId: item.vendor_id })} style={s.orderBtn} testID={`order-${item.vendor_id}`}>
              <Text style={s.orderBtnText}>Order</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => removeFav(item.vendor_id)} style={s.removeBtn} testID={`unfav-${item.vendor_id}`}>
              <Ionicons name="heart" size={20} color={colors.error} />
            </TouchableOpacity>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { padding: spacing.md, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  title: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  subtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 4 },
  heroBtn: { flexDirection: 'row', alignItems: 'center', gap: 12, margin: spacing.md, padding: spacing.md, backgroundColor: colors.primary, borderRadius: borderRadius.md },
  heroTitle: { color: '#fff', fontWeight: '700', fontSize: 15 },
  heroSub: { color: '#fff', opacity: 0.9, fontSize: 11, marginTop: 2 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.textMuted, marginHorizontal: spacing.md, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  empty: { alignItems: 'center', padding: spacing.xl, marginTop: 40 },
  emptyText: { fontSize: 16, color: colors.textSecondary, fontWeight: '600', marginTop: 12 },
  emptySub: { fontSize: 13, color: colors.textMuted, marginTop: 6, textAlign: 'center', paddingHorizontal: 30 },
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.card, padding: spacing.md, borderRadius: borderRadius.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.borderLight },
  vName: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  vCuisine: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  orderBtn: { backgroundColor: colors.primary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: borderRadius.sm },
  orderBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  removeBtn: { padding: 6 },
});
