import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Image,
  ActivityIndicator, FlatList, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { colors, spacing, borderRadius } from '../theme';

const CART_KEY = '@cravitoo_cart';

export default function MenuScreen({ route, navigation }) {
  const [vendors, setVendors] = useState([]);
  const [selectedVendorId, setSelectedVendorId] = useState(route?.params?.vendorId || null);
  const [menu, setMenu] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState({}); // { vendorId: { vendorName, items: [{id, name, price, quantity, image_url, is_vegetarian}] } }

  useEffect(() => {
    loadVendors();
  }, []);

  useEffect(() => {
    if (selectedVendorId) loadMenu();
  }, [selectedVendorId]);

  const loadVendors = async () => {
    try {
      const { data } = await client.get('/vendors');
      setVendors(data);
      if (!selectedVendorId && data.length > 0) {
        setSelectedVendorId(data[0].id);
      }
    } catch (e) {
      Alert.alert('Error', 'Failed to load vendors');
    } finally {
      setLoading(false);
    }
  };

  const loadMenu = async () => {
    try {
      const { data } = await client.get(`/menu/${selectedVendorId}`);
      setMenu(data);
    } catch (e) {
      console.error('Menu load error', e?.response?.data || e.message);
    }
  };

  const currentVendor = vendors.find((v) => v.id === selectedVendorId);

  const addToCart = (item) => {
    setCart((prev) => {
      const vendorCart = prev[selectedVendorId] || { vendorName: currentVendor.name, items: [] };
      const existing = vendorCart.items.find((i) => i.id === item.id);
      const newItems = existing
        ? vendorCart.items.map((i) => (i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i))
        : [...vendorCart.items, { ...item, quantity: 1 }];
      return { ...prev, [selectedVendorId]: { ...vendorCart, items: newItems } };
    });
  };

  const updateQuantity = (vendorId, itemId, delta) => {
    setCart((prev) => {
      const vc = prev[vendorId];
      if (!vc) return prev;
      const newItems = vc.items
        .map((i) => (i.id === itemId ? { ...i, quantity: i.quantity + delta } : i))
        .filter((i) => i.quantity > 0);
      if (newItems.length === 0) {
        const { [vendorId]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [vendorId]: { ...vc, items: newItems } };
    });
  };

  const totalItems = Object.values(cart).reduce(
    (sum, vc) => sum + vc.items.reduce((s, i) => s + i.quantity, 0), 0
  );
  const totalAmount = Object.values(cart).reduce(
    (sum, vc) => sum + vc.items.reduce((s, i) => s + i.price * i.quantity, 0), 0
  );

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
        <Text style={styles.headerTitle}>Browse Menu</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.vendorTabsScroll} contentContainerStyle={styles.vendorTabs}>
        {vendors.map((v) => (
          <TouchableOpacity
            key={v.id}
            onPress={() => setSelectedVendorId(v.id)}
            style={[styles.vendorTab, selectedVendorId === v.id && styles.vendorTabActive]}
          >
            <Text style={[styles.vendorTabText, selectedVendorId === v.id && styles.vendorTabTextActive]}>
              {v.name}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <FlatList
        data={menu}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.menuList}
        renderItem={({ item }) => {
          const inCart = cart[selectedVendorId]?.items.find((i) => i.id === item.id);
          return (
            <View style={styles.menuCard}>
              {item.image_url ? (
                <Image source={{ uri: item.image_url }} style={styles.menuImage} />
              ) : (
                <View style={[styles.menuImage, styles.menuImagePlaceholder]}>
                  <Ionicons name="restaurant" size={32} color={colors.textMuted} />
                </View>
              )}
              <View style={styles.menuInfo}>
                <View style={styles.menuInfoTop}>
                  <Text style={styles.menuName}>{item.name}</Text>
                  {item.is_vegetarian && (
                    <View style={styles.vegIndicator}>
                      <View style={styles.vegDot} />
                    </View>
                  )}
                </View>
                <Text style={styles.menuDesc} numberOfLines={2}>{item.description}</Text>
                <View style={styles.menuFooter}>
                  <Text style={styles.menuPrice}>₹{item.price.toFixed(2)}</Text>
                  {inCart ? (
                    <View style={styles.qtyControls}>
                      <TouchableOpacity onPress={() => updateQuantity(selectedVendorId, item.id, -1)} style={styles.qtyBtn}>
                        <Ionicons name="remove" size={16} color={colors.primary} />
                      </TouchableOpacity>
                      <Text style={styles.qtyText}>{inCart.quantity}</Text>
                      <TouchableOpacity onPress={() => updateQuantity(selectedVendorId, item.id, 1)} style={styles.qtyBtn}>
                        <Ionicons name="add" size={16} color={colors.primary} />
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity onPress={() => addToCart(item)} style={styles.addBtn}>
                      <Ionicons name="add" size={16} color="#fff" />
                      <Text style={styles.addBtnText}>Add</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            </View>
          );
        }}
      />

      {totalItems > 0 && (
        <TouchableOpacity
          style={styles.cartBar}
          onPress={() => navigation.navigate('Cart', { cart })}
        >
          <View>
            <Text style={styles.cartBarItems}>{totalItems} item{totalItems !== 1 ? 's' : ''} · ₹{totalAmount.toFixed(2)}</Text>
            <Text style={styles.cartBarLabel}>View cart</Text>
          </View>
          <View style={styles.cartBarRight}>
            <Ionicons name="cart" size={20} color="#fff" />
            <Ionicons name="chevron-forward" size={18} color="#fff" />
          </View>
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  header: { padding: spacing.lg, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  headerTitle: { fontSize: 28, fontWeight: '700', color: colors.textPrimary, letterSpacing: -0.5 },
  vendorTabsScroll: { maxHeight: 60 },
  vendorTabs: { padding: spacing.md, gap: spacing.sm },
  vendorTab: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.card, borderRadius: borderRadius.full, borderWidth: 1, borderColor: colors.borderLight, marginRight: spacing.sm },
  vendorTabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  vendorTabText: { fontSize: 14, fontWeight: '500', color: colors.textSecondary },
  vendorTabTextActive: { color: '#fff' },
  menuList: { padding: spacing.md, paddingBottom: 120 },
  menuCard: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: borderRadius.md, marginBottom: spacing.sm, overflow: 'hidden', borderWidth: 1, borderColor: colors.borderLight },
  menuImage: { width: 100, height: 100 },
  menuImagePlaceholder: { backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' },
  menuInfo: { flex: 1, padding: spacing.md, justifyContent: 'space-between' },
  menuInfoTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  menuName: { fontSize: 15, fontWeight: '600', color: colors.textPrimary, flex: 1 },
  vegIndicator: { width: 18, height: 18, borderWidth: 1.5, borderColor: '#16A34A', justifyContent: 'center', alignItems: 'center' },
  vegDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#16A34A' },
  menuDesc: { fontSize: 12, color: colors.textSecondary, marginTop: 4, marginBottom: 8 },
  menuFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  menuPrice: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  addBtn: { backgroundColor: colors.primary, paddingHorizontal: 14, paddingVertical: 6, borderRadius: borderRadius.sm, flexDirection: 'row', alignItems: 'center', gap: 4 },
  addBtnText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  qtyControls: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.primaryLight, borderRadius: borderRadius.sm, paddingHorizontal: 4 },
  qtyBtn: { padding: 6 },
  qtyText: { fontSize: 14, fontWeight: '600', color: colors.primary, marginHorizontal: 8 },
  cartBar: { position: 'absolute', bottom: spacing.md, left: spacing.md, right: spacing.md, backgroundColor: colors.primary, borderRadius: borderRadius.md, padding: spacing.md, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, elevation: 4 },
  cartBarItems: { color: '#fff', fontWeight: '600', fontSize: 15 },
  cartBarLabel: { color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 2 },
  cartBarRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
