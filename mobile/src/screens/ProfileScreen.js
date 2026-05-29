import React from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, Image, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { colors, spacing, borderRadius } from '../theme';

export default function ProfileScreen({ navigation }) {
  const { user, logout } = useAuth();

  const confirmLogout = () => {
    Alert.alert('Sign out?', 'You will need to log in again to use the app', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: logout },
    ]);
  };

  const SHORTCUTS = [
    { label: 'Favorites & Reorder', icon: 'heart', screen: 'Favorites' },
    { label: 'Meal Plans', icon: 'calendar', screen: 'Subscription' },
    { label: 'Event Catering', icon: 'people', screen: 'EventOrder' },
    { label: 'Refunds', icon: 'cash', screen: 'Refunds' },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Profile</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {user?.name?.charAt(0).toUpperCase() || 'U'}
            </Text>
          </View>
          <Text style={styles.userName}>{user?.name || 'User'}</Text>
          <Text style={styles.userEmail}>{user?.email}</Text>
          <View style={styles.roleBadge}>
            <Text style={styles.roleText}>{(user?.role || 'employee').replace('_', ' ')}</Text>
          </View>
        </View>

        {user?.role === 'employee' && (
          <View style={styles.shortcuts}>
            {SHORTCUTS.map((sc) => (
              <TouchableOpacity
                key={sc.screen}
                onPress={() => navigation.navigate(sc.screen)}
                style={styles.shortcut}
                testID={`shortcut-${sc.screen.toLowerCase()}`}
              >
                <View style={styles.shortcutIconBox}>
                  <Ionicons name={sc.icon} size={22} color={colors.primary} />
                </View>
                <Text style={styles.shortcutText}>{sc.label}</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>About Cravitoo</Text>
          <View style={styles.menuItem}>
            <Ionicons name="information-circle-outline" size={20} color={colors.textSecondary} />
            <Text style={styles.menuItemText}>Version 1.1.0</Text>
          </View>
          <View style={styles.menuItem}>
            <Ionicons name="globe-outline" size={20} color={colors.textSecondary} />
            <Text style={styles.menuItemText}>cravitoo.com</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.logoutBtn} onPress={confirmLogout}>
          <Ionicons name="log-out-outline" size={20} color={colors.error} />
          <Text style={styles.logoutText}>Sign Out</Text>
        </TouchableOpacity>

        <Text style={styles.footer}>Good Food. Easy Order. Happy Team.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { padding: spacing.lg, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  headerTitle: { fontSize: 28, fontWeight: '700', color: colors.textPrimary, letterSpacing: -0.5 },
  content: { padding: spacing.md, paddingBottom: 40 },
  profileCard: { backgroundColor: colors.card, alignItems: 'center', padding: spacing.lg, borderRadius: borderRadius.lg, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.borderLight },
  avatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center', marginBottom: spacing.md },
  avatarText: { color: '#fff', fontSize: 32, fontWeight: '700' },
  userName: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  userEmail: { fontSize: 14, color: colors.textSecondary, marginTop: 4 },
  roleBadge: { marginTop: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 6, backgroundColor: colors.primaryLight, borderRadius: borderRadius.full },
  roleText: { fontSize: 12, fontWeight: '600', color: colors.primary, textTransform: 'capitalize' },
  shortcuts: { backgroundColor: colors.card, borderRadius: borderRadius.md, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.borderLight, overflow: 'hidden' },
  shortcut: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  shortcutIconBox: { width: 38, height: 38, borderRadius: 10, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  shortcutText: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  section: { backgroundColor: colors.card, padding: spacing.md, borderRadius: borderRadius.md, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.borderLight },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm },
  menuItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, gap: spacing.md },
  menuItemText: { fontSize: 14, color: colors.textPrimary },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: spacing.md, borderRadius: borderRadius.md, borderWidth: 1, borderColor: colors.errorLight, backgroundColor: '#fff' },
  logoutText: { color: colors.error, fontSize: 15, fontWeight: '600' },
  footer: { textAlign: 'center', fontSize: 12, color: colors.textMuted, marginTop: spacing.lg },
});
