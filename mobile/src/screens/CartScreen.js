import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, Platform, TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import { colors, spacing, borderRadius } from '../theme';

// Lazy import - react-native-razorpay is a native module not in Expo Go
let RazorpayCheckout = null;
try {
  RazorpayCheckout = require('react-native-razorpay').default;
} catch (e) {
  // Not available in Expo Go - we'll use mock mode
}

export default function CartScreen({ route, navigation }) {
  const { user } = useAuth();
  const initialCart = route.params?.cart || {};
  const [cart, setCart] = useState(initialCart);
  const [submitting, setSubmitting] = useState(false);
  const [loyalty, setLoyalty] = useState(null);
  const [pointsToUse, setPointsToUse] = useState('');
  const [appliedDiscount, setAppliedDiscount] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await client.get('/loyalty');
        setLoyalty(data);
      } catch (e) { /* ignore */ }
    })();
  }, []);

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
  const payableAmount = Math.max(0, totalAmount - appliedDiscount);

  const maxRedeemable = loyalty
    ? Math.min(loyalty.available_points || 0, Math.floor(totalAmount))
    : 0;

  const placeOrderWithPayment = async () => {
    if (totalItems === 0) return;
    setSubmitting(true);
    try {
      // Step 1: Create orders for each vendor
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

      // Step 1.5: Apply loyalty redemption on the first order (mobile keeps it simple)
      const firstOrderId = orderIds[0];
      if (appliedDiscount > 0) {
        try {
          await client.post('/loyalty/redeem', { order_id: firstOrderId, points: appliedDiscount });
        } catch (e) {
          // Redemption failed but order created — surface but continue with full price
          Alert.alert('Loyalty redemption failed', e?.response?.data?.detail || 'Order will be charged full price.');
        }
      }

      // Step 2: For each order, create Razorpay payment session
      const { data: rpOrder } = await client.post('/payments/razorpay/create-order', {
        order_id: firstOrderId,
      });

      // Step 3: Open Razorpay checkout (or mock)
      if (rpOrder.mock_mode || !RazorpayCheckout) {
        // MOCK PAYMENT - simulate successful payment without native SDK
        Alert.alert(
          '🧪 Mock Payment Mode',
          `Razorpay would charge ₹${(rpOrder.amount / 100).toFixed(2)} here.\n\nIn production:\n• UPI apps open\n• Cards/wallets/net banking\n• Real payment processing\n\nFor now, we'll simulate a successful payment.`,
          [
            {
              text: 'Cancel',
              style: 'cancel',
              onPress: () => {
                Alert.alert('Order created but unpaid', 'Your order was created but not paid. You can pay later from Orders.');
                navigation.navigate('Main', { screen: 'Orders' });
              }
            },
            {
              text: 'Simulate Success ✓',
              onPress: async () => {
                try {
                  await client.post('/payments/razorpay/verify', {
                    order_id: firstOrderId,
                    razorpay_payment_id: `pay_mock_${Date.now()}`,
                    razorpay_order_id: rpOrder.razorpay_order_id,
                    razorpay_signature: 'mock_signature',
                  });
                  Alert.alert('✓ Payment Successful', `Order #${firstOrderId.slice(-8)} confirmed!`, [
                    { text: 'View Orders', onPress: () => navigation.navigate('Main', { screen: 'Orders' }) },
                  ]);
                } catch (e) {
                  Alert.alert('Payment verification failed', e?.response?.data?.detail || 'Try again');
                }
              }
            },
          ]
        );
      } else {
        // REAL RAZORPAY SDK
        const options = {
          key: rpOrder.key_id,
          amount: rpOrder.amount,
          currency: rpOrder.currency,
          order_id: rpOrder.razorpay_order_id,
          name: 'Cravitoo',
          description: `Order #${firstOrderId.slice(-8)}`,
          prefill: {
            email: user?.email,
            name: user?.name,
          },
          theme: { color: colors.primary },
        };
        try {
          const result = await RazorpayCheckout.open(options);
          await client.post('/payments/razorpay/verify', {
            order_id: firstOrderId,
            razorpay_payment_id: result.razorpay_payment_id,
            razorpay_order_id: result.razorpay_order_id,
            razorpay_signature: result.razorpay_signature,
          });
          Alert.alert('✓ Payment Successful', `Order #${firstOrderId.slice(-8)} confirmed!`, [
            { text: 'View Orders', onPress: () => navigation.navigate('Main', { screen: 'Orders' }) },
          ]);
        } catch (e) {
          // User cancelled or payment failed
          if (e?.code === 'PAYMENT_CANCELLED' || e?.description?.toLowerCase().includes('cancel')) {
            Alert.alert('Payment cancelled', 'You can complete payment later from Orders.');
          } else {
            Alert.alert('Payment failed', e?.description || 'Please try again');
          }
        }
      }
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

        {loyalty && loyalty.available_points >= 100 && maxRedeemable >= 100 && (
          <View style={styles.loyaltyCard}>
            <View style={styles.loyaltyHeader}>
              <Ionicons name="trophy" size={18} color={colors.accent} />
              <Text style={styles.loyaltyTitle}>You have {loyalty.available_points} points</Text>
            </View>
            <Text style={styles.loyaltySub}>
              Redeem up to {maxRedeemable} points (₹{maxRedeemable} off). Min 100 points.
            </Text>
            <View style={styles.loyaltyRow}>
              <TextInput
                style={styles.pointsInput}
                value={pointsToUse}
                onChangeText={(v) => setPointsToUse(v.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad"
                placeholder="Points"
                placeholderTextColor={colors.textMuted}
                editable={!appliedDiscount}
                testID="points-input"
              />
              {appliedDiscount > 0 ? (
                <TouchableOpacity
                  onPress={() => { setAppliedDiscount(0); setPointsToUse(''); }}
                  style={[styles.loyaltyBtn, { backgroundColor: colors.errorLight }]}
                  testID="loyalty-remove-btn"
                >
                  <Text style={[styles.loyaltyBtnText, { color: colors.error }]}>Remove</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  onPress={() => {
                    const n = parseInt(pointsToUse, 10);
                    if (isNaN(n) || n < 100) return Alert.alert('Min 100 points');
                    if (n > maxRedeemable) return Alert.alert(`Max ${maxRedeemable} points usable for this order`);
                    setAppliedDiscount(n);
                  }}
                  style={[styles.loyaltyBtn, { backgroundColor: colors.accent }]}
                  testID="apply-loyalty-btn"
                >
                  <Text style={styles.loyaltyBtnText}>Apply</Text>
                </TouchableOpacity>
              )}
            </View>
            {appliedDiscount > 0 && (
              <View style={styles.loyaltyApplied}>
                <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                <Text style={styles.loyaltyAppliedText}>-₹{appliedDiscount} applied</Text>
              </View>
            )}
          </View>
        )}

        <View style={styles.paymentInfo}>
          <Ionicons name="card" size={18} color={colors.primary} />
          <Text style={styles.paymentText}>Pay via Razorpay — UPI, Cards, Wallets, Net Banking</Text>
        </View>
      </ScrollView>

      <View style={styles.checkoutBar}>
        <View>
          {appliedDiscount > 0 ? (
            <>
              <Text style={styles.subtotalLine}>Subtotal ₹{totalAmount.toFixed(2)}  ·  -₹{appliedDiscount} pts</Text>
              <Text style={styles.totalAmount}>₹{payableAmount.toFixed(2)}</Text>
            </>
          ) : (
            <>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalAmount}>₹{totalAmount.toFixed(2)}</Text>
            </>
          )}
        </View>
        <TouchableOpacity style={styles.placeBtn} onPress={placeOrderWithPayment} disabled={submitting}>
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Text style={styles.placeBtnText}>Pay & Order</Text>
              <Ionicons name="lock-closed" size={16} color="#fff" />
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
  info: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: spacing.sm, backgroundColor: colors.background, borderRadius: borderRadius.sm, marginBottom: spacing.sm },
  infoText: { fontSize: 12, color: colors.textSecondary, flex: 1 },
  paymentInfo: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: spacing.md, backgroundColor: colors.primaryLight, borderRadius: borderRadius.sm },
  paymentText: { fontSize: 13, color: colors.primary, fontWeight: '500', flex: 1 },
  loyaltyCard: { backgroundColor: colors.accentLight, padding: spacing.md, borderRadius: borderRadius.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.accent },
  loyaltyHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  loyaltyTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  loyaltySub: { fontSize: 12, color: colors.textSecondary, marginBottom: spacing.sm },
  loyaltyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pointsInput: { flex: 1, borderWidth: 1, borderColor: colors.borderLight, borderRadius: borderRadius.sm, padding: 8, fontSize: 14, color: colors.textPrimary, backgroundColor: colors.card },
  loyaltyBtn: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: borderRadius.sm },
  loyaltyBtnText: { fontWeight: '700', fontSize: 13, color: colors.textPrimary },
  loyaltyApplied: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.sm },
  loyaltyAppliedText: { fontSize: 12, color: colors.success, fontWeight: '600' },
  subtotalLine: { fontSize: 11, color: colors.textSecondary },
  checkoutBar: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.borderLight, padding: spacing.md, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalLabel: { fontSize: 12, color: colors.textSecondary },
  totalAmount: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  placeBtn: { backgroundColor: colors.primary, paddingHorizontal: spacing.lg, paddingVertical: 14, borderRadius: borderRadius.md, flexDirection: 'row', alignItems: 'center', gap: 8 },
  placeBtnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
