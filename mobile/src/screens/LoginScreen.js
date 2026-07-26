import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Image,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth, isPartnerApp, isPartnerRole } from '../context/AuthContext';
import { colors, spacing, borderRadius } from '../theme';

const LOGO_URL = 'https://customer-assets.emergentagent.com/job_corporate-feast/artifacts/j6kduny0_WhatsApp%20Image%202026-05-27%20at%2011.03.31%20AM%20-%20Edited.png';

export default function LoginScreen({ navigation }) {
  const [mode, setMode] = useState('password'); // 'password' | 'otp-request' | 'otp-verify'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpCountdown, setOtpCountdown] = useState(0);
  const [loading, setLoading] = useState(false);
  const { login, loginWithOtp, requestOtp } = useAuth();
  const PARTNER = isPartnerApp();

  useEffect(() => {
    if (otpCountdown <= 0) return undefined;
    const t = setTimeout(() => setOtpCountdown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [otpCountdown]);

  const formatError = (error) => {
    const detail = error.response?.data?.detail;
    if (detail) return typeof detail === 'string' ? detail : JSON.stringify(detail);
    if (error.message === 'Network Error' || error.code === 'ECONNABORTED') {
      return 'Cannot reach the server. Please check your internet connection and try again.';
    }
    return error.message || 'Please try again';
  };

  const formatCountdown = () => {
    const m = Math.floor(otpCountdown / 60);
    const s = otpCountdown % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const verifyVariantRole = (user) => {
    if (PARTNER && !isPartnerRole(user)) {
      Alert.alert(
        'Wrong app for this account',
        'The Cravitoo Partner app is for Vendors, Site Admins and Master Admins.\n\nIf you are an employee, please download the "Cravitoo" customer app instead.'
      );
    } else if (!PARTNER && user.role !== 'employee') {
      Alert.alert(
        'Wrong app for this account',
        'The Cravitoo customer app is for employees only.\n\nIf you are a vendor or admin, please download the "Cravitoo Partner" app instead.'
      );
    }
  };

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Missing fields', 'Please enter email and password');
      return;
    }
    setLoading(true);
    try {
      const user = await login(email, password);
      verifyVariantRole(user);
    } catch (error) {
      Alert.alert('Login failed', formatError(error));
    } finally {
      setLoading(false);
    }
  };

  const handleRequestOtp = async () => {
    if (!email) {
      Alert.alert('Missing email', 'Please enter your email address');
      return;
    }
    setLoading(true);
    try {
      const data = await requestOtp(email);
      setMode('otp-verify');
      setOtpCountdown((data.expires_in_minutes || 10) * 60);
      setOtpCode('');
    } catch (error) {
      Alert.alert('Could not send code', formatError(error));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (otpCode.length !== 6) {
      Alert.alert('Invalid code', 'Please enter the 6-digit code from your email');
      return;
    }
    setLoading(true);
    try {
      const user = await loginWithOtp(email, otpCode);
      verifyVariantRole(user);
    } catch (error) {
      Alert.alert('Verification failed', formatError(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.logoContainer}>
          <Image source={{ uri: LOGO_URL }} style={styles.logo} resizeMode="contain" />
        </View>

        {mode === 'password' && (
          <>
            <Text style={styles.title}>{PARTNER ? 'Partner Login' : 'Welcome Back'}</Text>
            <Text style={styles.subtitle}>
              {PARTNER ? 'Manage your restaurant on Cravitoo Partner' : 'Sign in to order your favorite meals'}
            </Text>

            <View style={styles.form}>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Email Address</Text>
                <View style={styles.inputWrapper}>
                  <Ionicons name="mail-outline" size={20} color={colors.textMuted} style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="you@company.com"
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    placeholderTextColor={colors.textMuted}
                    testID="login-email-input"
                  />
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Password</Text>
                <View style={styles.inputWrapper}>
                  <Ionicons name="lock-closed-outline" size={20} color={colors.textMuted} style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="••••••••"
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry
                    placeholderTextColor={colors.textMuted}
                    testID="login-password-input"
                  />
                </View>
              </View>

              <TouchableOpacity style={styles.button} onPress={handleLogin} disabled={loading} activeOpacity={0.8} testID="login-submit-btn">
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign In</Text>}
              </TouchableOpacity>

              <View style={styles.divider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>OR</Text>
                <View style={styles.dividerLine} />
              </View>

              <TouchableOpacity
                style={styles.buttonSecondary}
                onPress={() => setMode('otp-request')}
                disabled={loading}
                activeOpacity={0.8}
                testID="login-with-otp-btn"
              >
                <Ionicons name="mail" size={18} color={colors.primary} />
                <Text style={styles.buttonSecondaryText}>Login with Email Code</Text>
              </TouchableOpacity>

              {!PARTNER && (
                <TouchableOpacity onPress={() => navigation.navigate('Register')}>
                  <Text style={styles.linkText}>
                    New here? <Text style={styles.linkAccent}>Create an account</Text>
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </>
        )}

        {mode === 'otp-request' && (
          <>
            <TouchableOpacity onPress={() => setMode('password')} style={styles.backBtn} testID="otp-back-btn">
              <Ionicons name="arrow-back" size={20} color={colors.textSecondary} />
              <Text style={styles.backText}>Back to password login</Text>
            </TouchableOpacity>
            <Text style={styles.title}>Login with Email Code</Text>
            <Text style={styles.subtitle}>We'll send a 6-digit code to your inbox</Text>

            <View style={styles.form}>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Email Address</Text>
                <View style={styles.inputWrapper}>
                  <Ionicons name="mail-outline" size={20} color={colors.textMuted} style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="you@company.com"
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    autoFocus
                    placeholderTextColor={colors.textMuted}
                    testID="otp-email-input"
                  />
                </View>
                <Text style={styles.hint}>No password needed. We'll send a code to this inbox.</Text>
              </View>

              <TouchableOpacity style={styles.button} onPress={handleRequestOtp} disabled={loading} activeOpacity={0.8} testID="otp-request-submit-btn">
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Send Code</Text>}
              </TouchableOpacity>
            </View>
          </>
        )}

        {mode === 'otp-verify' && (
          <>
            <TouchableOpacity onPress={() => setMode('otp-request')} style={styles.backBtn} testID="otp-verify-back-btn">
              <Ionicons name="arrow-back" size={20} color={colors.textSecondary} />
              <Text style={styles.backText}>Use a different email</Text>
            </TouchableOpacity>
            <Text style={styles.title}>Enter Verification Code</Text>
            <Text style={styles.subtitle}>Check the email we sent to {email}</Text>

            <View style={styles.form}>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>6-digit code</Text>
                <TextInput
                  style={styles.otpInput}
                  placeholder="000000"
                  value={otpCode}
                  onChangeText={(t) => setOtpCode(t.replace(/[^0-9]/g, '').slice(0, 6))}
                  keyboardType="number-pad"
                  maxLength={6}
                  autoFocus
                  placeholderTextColor={colors.textMuted}
                  testID="otp-code-input"
                />
                <View style={styles.otpFooter}>
                  {otpCountdown > 0 ? (
                    <Text style={styles.otpCountdown}>Expires in {formatCountdown()}</Text>
                  ) : (
                    <Text style={styles.otpExpired}>Code expired</Text>
                  )}
                  <TouchableOpacity
                    onPress={handleRequestOtp}
                    disabled={otpCountdown > 540 || loading}
                    testID="otp-resend-btn"
                  >
                    <Text style={[styles.resendBtn, (otpCountdown > 540 || loading) && styles.resendBtnDisabled]}>
                      Resend code
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              <TouchableOpacity
                style={[styles.button, otpCode.length !== 6 && styles.buttonDisabled]}
                onPress={handleVerifyOtp}
                disabled={loading || otpCode.length !== 6}
                activeOpacity={0.8}
                testID="otp-verify-submit-btn"
              >
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Verify &amp; Continue</Text>}
              </TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { flexGrow: 1, padding: spacing.lg, justifyContent: 'center' },
  logoContainer: { alignItems: 'center', marginBottom: spacing.lg },
  logo: { width: 140, height: 140 },
  title: { fontSize: 32, fontWeight: '700', color: colors.textPrimary, textAlign: 'center', marginBottom: spacing.sm, letterSpacing: -0.5 },
  subtitle: { fontSize: 16, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.xl },
  form: { gap: spacing.md },
  inputGroup: { marginBottom: spacing.md },
  label: { fontSize: 14, fontWeight: '500', color: colors.textPrimary, marginBottom: spacing.xs },
  hint: { fontSize: 12, color: colors.textMuted, marginTop: 6 },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
    paddingHorizontal: spacing.md,
  },
  inputIcon: { marginRight: spacing.sm },
  input: { flex: 1, paddingVertical: 14, fontSize: 16, color: colors.textPrimary },
  otpInput: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
    paddingVertical: 18,
    paddingHorizontal: 16,
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 12,
    textAlign: 'center',
    color: colors.textPrimary,
  },
  otpFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  otpCountdown: { fontSize: 12, color: colors.textMuted },
  otpExpired: { fontSize: 12, color: colors.error },
  resendBtn: { fontSize: 12, color: colors.primary, fontWeight: '600' },
  resendBtnDisabled: { color: colors.textMuted, fontWeight: '400' },
  button: {
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  buttonSecondary: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    paddingVertical: 14,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  buttonSecondaryText: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: spacing.sm },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.borderLight },
  dividerText: { paddingHorizontal: 12, fontSize: 12, color: colors.textMuted },
  demo: { backgroundColor: colors.primaryLight, padding: spacing.md, borderRadius: borderRadius.md, marginTop: spacing.md },
  demoText: { fontSize: 13, fontWeight: '500', color: colors.textPrimary },
  demoCreds: { fontSize: 12, color: colors.textSecondary, marginTop: 4 },
  linkText: { textAlign: 'center', color: colors.textSecondary, marginTop: spacing.md },
  linkAccent: { color: colors.primary, fontWeight: '600' },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.sm },
  backText: { fontSize: 14, color: colors.textSecondary },
});
