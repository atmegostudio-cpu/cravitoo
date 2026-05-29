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
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkLog, setBulkLog] = useState([]);

  useEffect(() => {
    setScanned(false);
    setResult(null);
  }, []);

  const onBarCodeScanned = async ({ data }) => {
    if (scanned || processing) return;
    setScanned(true);
    setProcessing(true);

    try {
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

      const r = { success: true, message: response.data.message, orderId };
      setResult(r);
      if (bulkMode) {
        setBulkLog((log) => [{ ...r, at: new Date().toLocaleTimeString() }, ...log].slice(0, 8));
        // Auto-reset after 1.5s for next scan
        setTimeout(() => { setScanned(false); setResult(null); }, 1500);
      }
    } catch (error) {
      const r = { success: false, message: error?.response?.data?.detail || 'Verification failed' };
      setResult(r);
      if (bulkMode) {
        setBulkLog((log) => [{ ...r, at: new Date().toLocaleTimeString() }, ...log].slice(0, 8));
        setTimeout(() => { setScanned(false); setResult(null); }, 2000);
      }
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
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Scan Pickup QR</Text>
          <Text style={styles.headerSubtitle}>{bulkMode ? 'Bulk mode — auto-rearm after each scan' : 'Point camera at customer\'s QR code'}</Text>
        </View>
        <TouchableOpacity
          onPress={() => { setBulkMode(!bulkMode); setBulkLog([]); setResult(null); setScanned(false); }}
          style={[styles.bulkToggle, bulkMode && styles.bulkToggleOn]}
          testID="bulk-mode-toggle"
        >
          <Ionicons name="layers" size={16} color={bulkMode ? '#fff' : colors.primary} />
          <Text style={[styles.bulkToggleText, bulkMode && { color: '#fff' }]}>Bulk</Text>
        </TouchableOpacity>
      </View>

      {bulkMode && bulkLog.length > 0 && (
        <View style={styles.bulkLog}>
          <Text style={styles.bulkLogTitle}>Recent ({bulkLog.length}):</Text>
          {bulkLog.slice(0, 4).map((b, idx) => (
            <View key={idx} style={styles.bulkLogRow}>
              <Ionicons name={b.success ? 'checkmark-circle' : 'close-circle'} size={14} color={b.success ? colors.success : colors.error} />
              <Text style={styles.bulkLogText} numberOfLines={1}>
                {b.success ? `#${b.orderId?.slice(-8)} verified` : b.message}
              </Text>
              <Text style={styles.bulkLogTime}>{b.at}</Text>
            </View>
          ))}
        </View>
      )}

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
  header: { padding: spacing.md, backgroundColor: colors.card, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headerTitle: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  headerSubtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 4 },
  bulkToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: borderRadius.full, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.primaryLight },
  bulkToggleOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  bulkToggleText: { fontSize: 12, fontWeight: '700', color: colors.primary },
  bulkLog: { padding: spacing.sm, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  bulkLogTitle: { fontSize: 11, fontWeight: '700', color: colors.textMuted, marginBottom: 4 },
  bulkLogRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2 },
  bulkLogText: { flex: 1, fontSize: 12, color: colors.textPrimary },
  bulkLogTime: { fontSize: 10, color: colors.textMuted },
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
