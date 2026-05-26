import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';
import { colors, spacing, borderRadius } from '../../theme';

export default function VendorScanQR({ navigation }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    setScanned(false);
    setResult(null);
  }, []);

  const onBarCodeScanned = async ({ data }) => {
    if (scanned || processing) return;
    setScanned(true);
    setProcessing(true);

    try {
      // QR format: CRAVITOO-PICKUP-{order_id}-{hash}
      const parts = data.split('-');
      if (parts.length < 4 || parts[0] !== 'CRAVITOO' || parts[1] !== 'PICKUP') {
        setResult({ success: false, message: 'Not a valid Cravitoo pickup QR' });
        setProcessing(false);
        return;
      }

      const orderId = parts[2];
      const response = await client.post(
        `/orders/${orderId}/verify-pickup?qr_code=${encodeURIComponent(data)}`
      );

      setResult({ success: true, message: response.data.message, orderId });
    } catch (error) {
      setResult({
        success: false,
        message: error?.response?.data?.detail || 'Verification failed',
      });
    } finally {
      setProcessing(false);
    }
  };

  const reset = () => {
    setScanned(false);
    setResult(null);
  };

  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.permissionBox}>
          <Ionicons name="camera-outline" size={80} color={colors.primary} />
          <Text style={styles.permissionTitle}>Camera Access Required</Text>
          <Text style={styles.permissionText}>
            We need camera permission to scan customer pickup QR codes
          </Text>
          <TouchableOpacity style={styles.permissionBtn} onPress={requestPermission}>
            <Text style={styles.permissionBtnText}>Grant Permission</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Scan Pickup QR</Text>
        <Text style={styles.headerSubtitle}>Point camera at customer's QR code</Text>
      </View>

      <View style={styles.cameraContainer}>
        <CameraView
          style={StyleSheet.absoluteFillObject}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={scanned ? undefined : onBarCodeScanned}
        />

        <View style={styles.overlay}>
          <View style={styles.scanFrame}>
            <View style={[styles.corner, styles.cornerTL]} />
            <View style={[styles.corner, styles.cornerTR]} />
            <View style={[styles.corner, styles.cornerBL]} />
            <View style={[styles.corner, styles.cornerBR]} />
          </View>
        </View>

        {processing && (
          <View style={styles.processingOverlay}>
            <ActivityIndicator color="#fff" size="large" />
            <Text style={styles.processingText}>Verifying...</Text>
          </View>
        )}
      </View>

      {result && (
        <View style={[styles.resultBox, result.success ? styles.resultSuccess : styles.resultFail]}>
          <Ionicons
            name={result.success ? 'checkmark-circle' : 'close-circle'}
            size={36}
            color={result.success ? colors.success : colors.error}
          />
          <Text style={styles.resultTitle}>
            {result.success ? 'Pickup Verified!' : 'Verification Failed'}
          </Text>
          <Text style={styles.resultMessage}>{result.message}</Text>
          {result.success && result.orderId && (
            <Text style={styles.resultOrderId}>Order #{result.orderId.slice(-8)}</Text>
          )}
          <TouchableOpacity style={styles.scanAgainBtn} onPress={reset}>
            <Ionicons name="scan" size={18} color="#fff" />
            <Text style={styles.scanAgainText}>Scan Another</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  header: { padding: spacing.md, backgroundColor: colors.card },
  headerTitle: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  headerSubtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 4 },
  cameraContainer: { flex: 1, overflow: 'hidden' },
  overlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  scanFrame: { width: 240, height: 240, position: 'relative' },
  corner: { position: 'absolute', width: 30, height: 30, borderColor: colors.primary, borderWidth: 4 },
  cornerTL: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0 },
  cornerTR: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0 },
  cornerBL: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0 },
  cornerBR: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0 },
  processingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', gap: spacing.md },
  processingText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  resultBox: { padding: spacing.lg, backgroundColor: colors.card, alignItems: 'center', borderTopWidth: 4 },
  resultSuccess: { borderTopColor: colors.success },
  resultFail: { borderTopColor: colors.error },
  resultTitle: { fontSize: 20, fontWeight: '700', color: colors.textPrimary, marginTop: spacing.sm },
  resultMessage: { fontSize: 14, color: colors.textSecondary, marginTop: 4, textAlign: 'center' },
  resultOrderId: { fontSize: 12, color: colors.textMuted, marginTop: 4, fontFamily: 'monospace' },
  scanAgainBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: spacing.md, backgroundColor: colors.primary, paddingHorizontal: spacing.lg, paddingVertical: 12, borderRadius: borderRadius.md },
  scanAgainText: { color: '#fff', fontWeight: '600' },
  permissionBox: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl, backgroundColor: colors.background },
  permissionTitle: { fontSize: 22, fontWeight: '700', color: colors.textPrimary, marginTop: spacing.md },
  permissionText: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm, lineHeight: 22 },
  permissionBtn: { backgroundColor: colors.primary, paddingHorizontal: spacing.lg, paddingVertical: 14, borderRadius: borderRadius.md, marginTop: spacing.lg },
  permissionBtnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
