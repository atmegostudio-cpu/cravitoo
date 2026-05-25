import React, { useEffect, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, ActivityIndicator, RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { colors, spacing, borderRadius } from '../theme';

export default function NotificationsScreen() {
  const [notifs, setNotifs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    try {
      const { data } = await client.get('/notifications');
      setNotifs(data);
    } catch (e) {
      console.error('Notifications load error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); }, []);

  const markRead = async (id) => {
    try {
      await client.patch(`/notifications/${id}/read`);
      load();
    } catch (e) {}
  };

  const markAllRead = async () => {
    try {
      await client.post('/notifications/mark-all-read');
      load();
    } catch (e) {}
  };

  const unreadCount = notifs.filter((n) => !n.read).length;

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {unreadCount > 0 && (
        <TouchableOpacity style={styles.markAllBtn} onPress={markAllRead}>
          <Ionicons name="checkmark-done" size={16} color={colors.primary} />
          <Text style={styles.markAllText}>Mark all as read</Text>
        </TouchableOpacity>
      )}

      <FlatList
        data={notifs}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
        ListEmptyComponent={() => (
          <View style={styles.empty}>
            <Ionicons name="notifications-off-outline" size={64} color={colors.textMuted} />
            <Text style={styles.emptyText}>No notifications</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.notifCard, !item.read && styles.notifUnread]}
            onPress={() => !item.read && markRead(item.id)}
            activeOpacity={0.7}
          >
            <View style={styles.notifIconBox}>
              <Ionicons
                name={item.type === 'order' ? 'receipt-outline' : 'information-circle-outline'}
                size={20}
                color={colors.primary}
              />
            </View>
            <View style={styles.notifContent}>
              <View style={styles.notifTitleRow}>
                <Text style={styles.notifTitle}>{item.title}</Text>
                {!item.read && <View style={styles.unreadDot} />}
              </View>
              <Text style={styles.notifMsg}>{item.message}</Text>
              <Text style={styles.notifTime}>
                {new Date(item.created_at).toLocaleString('en-IN', {
                  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                })}
              </Text>
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  list: { padding: spacing.md, flexGrow: 1 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: spacing.xxl },
  emptyText: { fontSize: 16, color: colors.textSecondary, marginTop: spacing.md },
  markAllBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: spacing.sm, gap: 4, backgroundColor: colors.primaryLight },
  markAllText: { fontSize: 13, color: colors.primary, fontWeight: '500' },
  notifCard: { flexDirection: 'row', backgroundColor: colors.card, padding: spacing.md, borderRadius: borderRadius.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.borderLight },
  notifUnread: { backgroundColor: '#FFF9F5', borderColor: colors.primaryLight },
  notifIconBox: { backgroundColor: colors.primaryLight, padding: spacing.sm, borderRadius: borderRadius.sm, marginRight: spacing.md, alignSelf: 'flex-start' },
  notifContent: { flex: 1 },
  notifTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  notifTitle: { fontSize: 14, fontWeight: '600', color: colors.textPrimary, flex: 1 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary, marginLeft: 8 },
  notifMsg: { fontSize: 13, color: colors.textSecondary, marginTop: 4 },
  notifTime: { fontSize: 11, color: colors.textMuted, marginTop: 6 },
});
