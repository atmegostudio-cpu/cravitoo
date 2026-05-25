import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator, Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { colors, spacing, borderRadius } from '../theme';

const LOGO_URL = 'https://customer-assets.emergentagent.com/job_corporate-feast/artifacts/lpcd18p4_29aaeaa4-ac4d-4437-8a14-0af8214d6039.png';

export default function RegisterScreen({ navigation }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();

  const handleRegister = async () => {
    if (!name || !email || !password) {
      Alert.alert('Missing fields', 'Please fill all fields');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Weak password', 'Password must be at least 6 characters');
      return;
    }
    setLoading(true);
    try {
      await register(email, password, name);
    } catch (error) {
      Alert.alert('Registration failed', error.response?.data?.detail || 'Please try again');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.logoContainer}>
          <Image source={{ uri: LOGO_URL }} style={styles.logo} resizeMode="contain" />
        </View>

        <Text style={styles.title}>Create Account</Text>
        <Text style={styles.subtitle}>Join Cravitoo and discover great food</Text>

        <View style={styles.form}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Full Name</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="person-outline" size={20} color={colors.textMuted} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="John Doe"
                value={name}
                onChangeText={setName}
                placeholderTextColor={colors.textMuted}
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Email</Text>
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
                placeholder="At least 6 characters"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                placeholderTextColor={colors.textMuted}
              />
            </View>
          </View>

          <TouchableOpacity style={styles.button} onPress={handleRegister} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign Up</Text>}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => navigation.navigate('Login')}>
            <Text style={styles.linkText}>
              Already have an account? <Text style={styles.linkAccent}>Sign in</Text>
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
  logo: { width: 120, height: 120 },
  title: { fontSize: 32, fontWeight: '700', color: colors.textPrimary, textAlign: 'center', marginBottom: spacing.sm, letterSpacing: -0.5 },
  subtitle: { fontSize: 16, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.xl },
  form: { gap: spacing.md },
  inputGroup: { marginBottom: spacing.md },
  label: { fontSize: 14, fontWeight: '500', color: colors.textPrimary, marginBottom: spacing.xs },
  inputWrapper: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: borderRadius.md, borderWidth: 1, borderColor: colors.borderLight, paddingHorizontal: spacing.md },
  inputIcon: { marginRight: spacing.sm },
  input: { flex: 1, paddingVertical: 14, fontSize: 16, color: colors.textPrimary },
  button: { backgroundColor: colors.primary, paddingVertical: 16, borderRadius: borderRadius.md, alignItems: 'center', marginTop: spacing.sm },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  linkText: { textAlign: 'center', color: colors.textSecondary, marginTop: spacing.md },
  linkAccent: { color: colors.primary, fontWeight: '600' },
});
