import React, { useState } from 'react';
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
import { useAuth } from '../context/AuthContext';
import { colors, spacing, borderRadius } from '../theme';

const LOGO_URL = 'https://customer-assets.emergentagent.com/job_corporate-feast/artifacts/lpcd18p4_29aaeaa4-ac4d-4437-8a14-0af8214d6039.png';

export default function LoginScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Missing fields', 'Please enter email and password');
      return;
    }
    setLoading(true);
    try {
      const user = await login(email, password);
      if (user.role !== 'employee') {
        Alert.alert('Mobile app for employees', 'This mobile app is currently available only for employees. Please use the web app for other roles.');
      }
    } catch (error) {
      Alert.alert('Login failed', error.response?.data?.detail || 'Please try again');
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

        <Text style={styles.title}>Welcome Back</Text>
        <Text style={styles.subtitle}>Sign in to order your favorite meals</Text>

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
              />
            </View>
          </View>

          <TouchableOpacity
            style={styles.button}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Sign In</Text>
            )}
          </TouchableOpacity>

          <View style={styles.demo}>
            <Text style={styles.demoText}>Demo Employee Account:</Text>
            <Text style={styles.demoCreds}>employee@techcorp.com / employee123</Text>
          </View>

          <TouchableOpacity onPress={() => navigation.navigate('Register')}>
            <Text style={styles.linkText}>
              New here? <Text style={styles.linkAccent}>Create an account</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { flexGrow: 1, padding: spacing.lg, justifyContent: 'center' },
  logoContainer: { alignItems: 'center', marginBottom: spacing.lg },
  logo: { width: 140, height: 140 },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.sm,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  form: { gap: spacing.md },
  inputGroup: { marginBottom: spacing.md },
  label: { fontSize: 14, fontWeight: '500', color: colors.textPrimary, marginBottom: spacing.xs },
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
  button: {
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  demo: {
    backgroundColor: colors.primaryLight,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    marginTop: spacing.md,
  },
  demoText: { fontSize: 13, fontWeight: '500', color: colors.textPrimary },
  demoCreds: { fontSize: 12, color: colors.textSecondary, marginTop: 4 },
  linkText: { textAlign: 'center', color: colors.textSecondary, marginTop: spacing.md },
  linkAccent: { color: colors.primary, fontWeight: '600' },
});
