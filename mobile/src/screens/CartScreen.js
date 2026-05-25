import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { colors, spacing, borderRadius } from '../theme';

export default function CartScreen({ route, navigation }) {
  const initialCart = route.params?.cart || {};
  const [cart, setCart] = useState(initialCart);
  const [submitting, setSubmitting] = useState(false);

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

  const totalAmount = Object.values(cart).reduce(
    (sum, vc) => sum + vc.items.reduce((s, i) => s + i.price * i.quantity, 0), 0
  );
  const totalItems = Object.values(cart).reduce(
    (sum, vc) => sum + vc.items.reduce((s, i) => s + i.quantity, 0), 0
  );

  const placeOrder = async () => {
    if (totalItems === 0) return;
    setSubmitting(true);
    try {
      const allVendorIds = Object.keys(cart);
      const orderIds = [];
      for (const vId of allVendorIds) {
        const vc = cart[vId];
        const { data } = await client.post('/orders', {
          vendor_id: vId,
          items: vc.items.map((it) => ({ menu_item_id: it.id, quantity: it.quantity, price: it.price })),
          delivery_type: 'pickup',
        });
        orderIds.push(data.id);
      }
      Alert.alert(
        'Order Placed!',
        `${orderIds.length} order${orderIds.length !== 1 ? 's' : ''} created. Total: ₹${totalAmount.toFixed(2)}\n\nNote: Payment will be handled on pickup in the mobile app.`,
        [{ text: 'View Orders', onPress: () => navigation.navigate('Main', { screen: 'Orders' }) }]
      );
    } catch (e) {
      Alert.alert('Order failed', e?.response?.data?.detail || 'Please try again');
    } finally {
      setSubmitting(false);
    }
  };

  if (totalItems === 0) {
    return (
      <View style={styles.empty}>
        <Ionicons name="cart-outline" size={64} color={colors.textMuted} />
        <Text style={styles.emptyTitle}>Your cart is empty</Text>
        <Text style={styles.emptySubtitle}>Add items from the menu to get started</Text>
        <TouchableOpacity style={styles.browseBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.browseBtnText}>Browse Menu</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {Object.entries(cart).map(([vId, vc]) => (
          <View key={vId} style={styles.vendorBlock}>
            <View style={styles.vendorHeader}>
              <Ionicons name="restaurant" size={18} color={colors.primary} />
              <Text style={styles.vendorName}>{vc.vendorName}</Text>
            </View>
            {vc.items.map((item) => (
              <View key={item.id} style={styles.cartItem}>
                <View style={styles.cartItemInfo}>
                  <Text style={styles.cartItemName}>{item.name}</Text>
                  <Text style={styles.cartItemPrice}>₹{item.price.toFixed(2)} × {item.quantity} = ₹{(item.price * item.quantity).toFixed(2)}</Text>
                </View>
                <View style={styles.qtyControls}>
                  <TouchableOpacity onPress={() => updateQuantity(vId, item.id, -1)} style={styles.qtyBtn}>
                    <Ionicons name="remove" size={16} color={colors.primary} />
                  </TouchableOpacity>
                  <Text style={styles.qtyText}>{item.quantity}</Text>
                  <TouchableOpacity onPress={() => updateQuantity(vId, item.id, 1)} style={styles.qtyBtn}>
                    <Ionicons name="add" size={16} color={colors.primary} />
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        ))}

        {Object.keys(cart).length > 1 && (
          <View style={styles.info}>
            <Ionicons name="information-circle" size={16} color={colors.textSecondary} />
            <Text style={styles.infoText}>
              {Object.keys(cart).length} separate orders will be created (one per vendor)
            </Text>
          </View>
        )}
      </ScrollView>

      <View style={styles.checkoutBar}>
        <View>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalAmount}>₹{totalAmount.toFixed(2)}</Text>
        </View>
        <TouchableOpacity style={styles.placeBtn} onPress={placeOrder} disabled={submitting}>
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Text style={styles.placeBtnText}>Place Order</Text>
              <Ionicons name="arrow-forward" size={18} color="#fff" />
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.lg, paddingBottom: 120 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl, backgroundColor: colors.background },
  emptyTitle: { fontSize: 20, fontWeight: '600', color: colors.textPrimary, marginTop: spacing.md },
  emptySubtitle: { fontSize: 14, color: colors.textSecondary, marginTop: 8, textAlign: 'center' },
  browseBtn: { marginTop: spacing.lg, backgroundColor: colors.primary, paddingHorizontal: spacing.lg, paddingVertical: 12, borderRadius: borderRadius.md },
  browseBtnText: { color: '#fff', fontWeight: '600' },
  vendorBlock: { backgroundColor: colors.card, borderRadius: borderRadius.md, padding: spacing.md, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.borderLight },
  vendorHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  vendorName: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  cartItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm },
  cartItemInfo: { flex: 1 },
  cartItemName: { fontSize: 15, color: colors.textPrimary, fontWeight: '500' },
  cartItemPrice: { fontSize: 13, color: colors.textSecondary, marginTop: 4 },
  qtyControls: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.primaryLight, borderRadius: borderRadius.sm, paddingHorizontal: 4 },
  qtyBtn: { padding: 6 },
  qtyText: { fontSize: 14, fontWeight: '600', color: colors.primary, marginHorizontal: 8 },
  info: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: spacing.sm, backgroundColor: colors.background, borderRadius: borderRadius.sm },
  infoText: { fontSize: 12, color: colors.textSecondary, flex: 1 },
  checkoutBar: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.borderLight, padding: spacing.md, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalLabel: { fontSize: 12, color: colors.textSecondary },
  totalAmount: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  placeBtn: { backgroundColor: colors.primary, paddingHorizontal: spacing.lg, paddingVertical: 14, borderRadius: borderRadius.md, flexDirection: 'row', alignItems: 'center', gap: 8 },
  placeBtnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
