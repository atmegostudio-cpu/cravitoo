import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import client from '../../api/client';
import { colors, spacing, borderRadius } from '../../theme';

export default function VendorAIInsights() {
  const [forecast, setForecast] = useState(null);
  const [wastage, setWastage] = useState(null);
  const [loadingF, setLoadingF] = useState(false);
  const [loadingW, setLoadingW] = useState(false);

  const getForecast = async () => {
    setLoadingF(true);
    try {
      const { data } = await client.post('/ai/demand-forecast');
      setForecast(data);
    } catch (e) {
      console.log('forecast err');
    } finally {
      setLoadingF(false);
    }
  };

  const getWastage = async () => {
    setLoadingW(true);
    try {
      const { data } = await client.post('/ai/wastage-analysis');
      setWastage(data);
    } catch (e) {
      console.log('wastage err');
    } finally {
      setLoadingW(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="sparkles" size={24} color={colors.primary} />
          <View>
            <Text style={styles.headerTitle}>AI Insights</Text>
            <Text style={styles.headerSubtitle}>Powered by GPT-5.2</Text>
          </View>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <LinearGradient colors={[colors.primaryLight, '#FFF']} style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.iconBoxPrimary}>
              <Ionicons name="trending-up" size={20} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Demand Forecast</Text>
              <Text style={styles.cardSubtitle}>Predict next week's top items</Text>
            </View>
          </View>
          <TouchableOpacity style={styles.btn} onPress={getForecast} disabled={loadingF}>
            {loadingF ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.btnText}>Generate Forecast</Text>
            )}
          </TouchableOpacity>
          {forecast && (
            <View style={styles.resultBox}>
              <Text style={styles.resultText}>{forecast.forecast}</Text>
              {forecast.top_items?.length > 0 && (
                <View style={styles.topItemsBox}>
                  <Text style={styles.topItemsTitle}>Top Sellers</Text>
                  {forecast.top_items.slice(0, 5).map((it, i) => (
                    <View key={i} style={styles.topItemRow}>
                      <Text style={styles.topItemName}>{it.name}</Text>
                      <Text style={styles.topItemQty}>{it.quantity} sold</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}
        </LinearGradient>

        <LinearGradient colors={[colors.errorLight, '#FFF']} style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.iconBoxError}>
              <Ionicons name="warning" size={20} color={colors.error} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Wastage Analysis</Text>
              <Text style={styles.cardSubtitle}>Reduce food waste & boost margins</Text>
            </View>
          </View>
          <TouchableOpacity style={[styles.btn, { backgroundColor: colors.error }]} onPress={getWastage} disabled={loadingW}>
            {loadingW ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.btnText}>Analyze Wastage</Text>
            )}
          </TouchableOpacity>
          {wastage && (
            <View style={styles.resultBox}>
              <View style={styles.metricsRow}>
                <View style={styles.metricBox}>
                  <Text style={styles.metricValue}>{wastage.metrics.total_orders}</Text>
                  <Text style={styles.metricLabel}>Total</Text>
                </View>
                <View style={styles.metricBox}>
                  <Text style={[styles.metricValue, { color: colors.error }]}>{wastage.metrics.cancellation_rate}%</Text>
                  <Text style={styles.metricLabel}>Cancelled</Text>
                </View>
              </View>
              <Text style={styles.resultText}>{wastage.analysis}</Text>
            </View>
          )}
        </LinearGradient>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { padding: spacing.md, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headerTitle: { fontSize: 22, fontWeight: '700', color: colors.textPrimary, letterSpacing: -0.5 },
  headerSubtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  content: { padding: spacing.md, paddingBottom: 40 },
  card: { padding: spacing.md, borderRadius: borderRadius.lg, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.borderLight },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  iconBoxPrimary: { backgroundColor: '#fff', padding: 8, borderRadius: borderRadius.sm },
  iconBoxError: { backgroundColor: '#fff', padding: 8, borderRadius: borderRadius.sm },
  cardTitle: { fontSize: 17, fontWeight: '600', color: colors.textPrimary },
  cardSubtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  btn: { backgroundColor: colors.primary, paddingVertical: 12, borderRadius: borderRadius.md, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  resultBox: { marginTop: spacing.md, backgroundColor: 'rgba(255,255,255,0.7)', padding: spacing.md, borderRadius: borderRadius.sm },
  resultText: { fontSize: 13, color: colors.textPrimary, lineHeight: 20 },
  topItemsBox: { marginTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.borderLight, paddingTop: spacing.sm },
  topItemsTitle: { fontSize: 13, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.xs },
  topItemRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  topItemName: { fontSize: 13, color: colors.textPrimary },
  topItemQty: { fontSize: 12, color: colors.primary, fontWeight: '600' },
  metricsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  metricBox: { flex: 1, alignItems: 'center', backgroundColor: '#fff', padding: spacing.sm, borderRadius: borderRadius.sm },
  metricValue: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  metricLabel: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
});
