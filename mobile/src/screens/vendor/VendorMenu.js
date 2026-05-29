import React, { useEffect, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, ActivityIndicator,
  Modal, TextInput, Switch, Alert, ScrollView, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import client from '../../api/client';
import { colors, spacing, borderRadius } from '../../theme';

const CATEGORIES = ['Appetizer', 'Main Course', 'Bread', 'Beverage', 'Dessert', 'Snack'];

export default function VendorMenu({ navigation }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({
    name: '', description: '', category: 'Main Course', price: '',
    image_url: '', is_vegetarian: false, is_available: true,
  });

  const load = async () => {
    try {
      const { data } = await client.get('/menu/vendor/all');
      setItems(data);
    } catch (e) {
      console.log('Vendor menu error', e?.response?.data || e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openAdd = () => {
    setEditing(null);
    setForm({ name: '', description: '', category: 'Main Course', price: '', image_url: '', is_vegetarian: false, is_available: true });
    setModalVisible(true);
  };

  const openEdit = (item) => {
    setEditing(item);
    setForm({
      name: item.name,
      description: item.description,
      category: item.category,
      price: item.price.toString(),
      image_url: item.image_url || '',
      is_vegetarian: item.is_vegetarian,
      is_available: item.is_available,
    });
    setModalVisible(true);
  };

  const save = async () => {
    if (!form.name || !form.description || !form.price) {
      Alert.alert('Missing fields', 'Please fill name, description, and price');
      return;
    }
    try {
      const payload = { ...form, price: parseFloat(form.price) };
      if (editing) {
        await client.patch(`/menu/${editing.id}`, payload);
      } else {
        await client.post('/menu', payload);
      }
      setModalVisible(false);
      load();
    } catch (e) {
      Alert.alert('Save failed', e?.response?.data?.detail || 'Try again');
    }
  };

  const remove = (item) => {
    Alert.alert('Delete item?', `Remove "${item.name}" from menu?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            await client.delete(`/menu/${item.id}`);
            load();
          } catch (e) {
            Alert.alert('Delete failed', e?.response?.data?.detail || 'Try again');
          }
        }
      },
    ]);
  };

  const quickToggleAvailable = async (item) => {
    // Optimistic update
    setItems((prev) => prev.map((x) => x.id === item.id ? { ...x, is_available: !x.is_available } : x));
    try {
      await client.patch(`/menu/${item.id}/availability`);
    } catch (e) {
      // Revert on failure
      setItems((prev) => prev.map((x) => x.id === item.id ? { ...x, is_available: item.is_available } : x));
      Alert.alert('Toggle failed', e?.response?.data?.detail || 'Try again');
    }
  };

  const [uploading, setUploading] = useState(false);
  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow photo access to upload menu images.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.7,
    });
    if (result.canceled) return;
    setUploading(true);
    try {
      const asset = result.assets[0];
      const formData = new FormData();
      formData.append('file', {
        uri: asset.uri,
        name: 'menu.jpg',
        type: 'image/jpeg',
      });
      const { data } = await client.post('/upload/menu-image', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setForm((prev) => ({ ...prev, image_url: data.url }));
    } catch (e) {
      Alert.alert('Upload failed', e?.response?.data?.detail || 'Try again');
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Menu</Text>
        <TouchableOpacity onPress={openAdd} style={styles.addBtn}>
          <Ionicons name="add" size={20} color="#fff" />
          <Text style={styles.addBtnText}>Add</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={() => (
          <View style={styles.empty}>
            <Ionicons name="restaurant-outline" size={48} color={colors.textMuted} />
            <Text style={styles.emptyText}>No menu items yet</Text>
            <TouchableOpacity style={styles.emptyBtn} onPress={openAdd}>
              <Text style={styles.emptyBtnText}>Add Your First Item</Text>
            </TouchableOpacity>
          </View>
        )}
        renderItem={({ item }) => (
          <View style={styles.itemCard}>
            {item.image_url ? (
              <Image source={{ uri: item.image_url }} style={styles.itemImg} />
            ) : (
              <View style={[styles.itemImg, styles.itemImgPlaceholder]}>
                <Ionicons name="restaurant" size={32} color={colors.textMuted} />
              </View>
            )}
            <View style={styles.itemInfo}>
              <View style={styles.itemTopRow}>
                <Text style={styles.itemName}>{item.name}</Text>
                {item.is_vegetarian && (
                  <View style={styles.vegIndicator}>
                    <View style={styles.vegDot} />
                  </View>
                )}
              </View>
              <Text style={styles.itemDesc} numberOfLines={2}>{item.description}</Text>
              <View style={styles.itemMeta}>
                <Text style={styles.itemPrice}>₹{item.price.toFixed(2)}</Text>
                <TouchableOpacity
                  style={[styles.availBadge, item.is_available ? styles.availYes : styles.availNo]}
                  onPress={() => quickToggleAvailable(item)}
                  testID={`toggle-avail-${item.id}`}
                >
                  <Ionicons name={item.is_available ? "checkmark-circle" : "close-circle"} size={12} color={item.is_available ? colors.success : colors.error} />
                  <Text style={[styles.availText, { color: item.is_available ? colors.success : colors.error }]}>
                    {item.is_available ? 'In stock' : '86\'d'}
                  </Text>
                </TouchableOpacity>
              </View>
              <View style={styles.itemActions}>
                <TouchableOpacity style={styles.editBtn} onPress={() => openEdit(item)}>
                  <Ionicons name="pencil" size={14} color={colors.primary} />
                  <Text style={styles.editBtnText}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.deleteBtn} onPress={() => remove(item)}>
                  <Ionicons name="trash" size={14} color={colors.error} />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      />

      <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalSafe}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setModalVisible(false)}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>{editing ? 'Edit Item' : 'New Item'}</Text>
            <TouchableOpacity onPress={save}>
              <Text style={styles.modalSave}>Save</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalBody}>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Name *</Text>
              <TextInput
                style={styles.input}
                value={form.name}
                onChangeText={(t) => setForm({ ...form, name: t })}
                placeholder="e.g., Butter Chicken"
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Description *</Text>
              <TextInput
                style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
                value={form.description}
                onChangeText={(t) => setForm({ ...form, description: t })}
                placeholder="Describe the dish"
                multiline
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Category</Text>
              <View style={styles.categoryRow}>
                {CATEGORIES.map((c) => (
                  <TouchableOpacity
                    key={c}
                    onPress={() => setForm({ ...form, category: c })}
                    style={[styles.categoryChip, form.category === c && styles.categoryChipActive]}
                  >
                    <Text style={[styles.categoryText, form.category === c && styles.categoryTextActive]}>{c}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Price (₹) *</Text>
              <TextInput
                style={styles.input}
                value={form.price}
                onChangeText={(t) => setForm({ ...form, price: t })}
                placeholder="180.00"
                keyboardType="decimal-pad"
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Image (optional)</Text>
              {form.image_url ? (
                <View style={styles.imagePreviewBox}>
                  <Image source={{ uri: form.image_url }} style={styles.imagePreview} />
                  <TouchableOpacity style={styles.imageRemove} onPress={() => setForm({ ...form, image_url: '' })}>
                    <Ionicons name="close-circle" size={22} color="#fff" />
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={styles.imagePickBtn} onPress={pickImage} disabled={uploading} testID="pick-image-btn">
                  {uploading ? (
                    <ActivityIndicator color={colors.primary} />
                  ) : (
                    <>
                      <Ionicons name="image" size={24} color={colors.primary} />
                      <Text style={styles.imagePickText}>Tap to upload a photo</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.switchRow}>
              <Text style={styles.fieldLabel}>Vegetarian</Text>
              <Switch
                value={form.is_vegetarian}
                onValueChange={(v) => setForm({ ...form, is_vegetarian: v })}
                trackColor={{ true: colors.primary }}
              />
            </View>

            <View style={styles.switchRow}>
              <Text style={styles.fieldLabel}>Available</Text>
              <Switch
                value={form.is_available}
                onValueChange={(v) => setForm({ ...form, is_available: v })}
                trackColor={{ true: colors.primary }}
              />
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.md, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  headerTitle: { fontSize: 26, fontWeight: '700', color: colors.textPrimary, letterSpacing: -0.5 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.primary, paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: borderRadius.sm },
  addBtnText: { color: '#fff', fontWeight: '600' },
  list: { padding: spacing.md, flexGrow: 1 },
  empty: { alignItems: 'center', paddingVertical: spacing.xxl },
  emptyText: { fontSize: 14, color: colors.textSecondary, marginTop: spacing.sm },
  emptyBtn: { marginTop: spacing.md, backgroundColor: colors.primary, paddingHorizontal: spacing.lg, paddingVertical: 12, borderRadius: borderRadius.md },
  emptyBtnText: { color: '#fff', fontWeight: '600' },
  itemCard: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: borderRadius.md, marginBottom: spacing.sm, overflow: 'hidden', borderWidth: 1, borderColor: colors.borderLight },
  itemImg: { width: 100, height: 'auto', minHeight: 130, backgroundColor: colors.background },
  itemImgPlaceholder: { justifyContent: 'center', alignItems: 'center' },
  itemInfo: { flex: 1, padding: spacing.sm },
  itemTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  itemName: { fontSize: 15, fontWeight: '600', color: colors.textPrimary, flex: 1 },
  vegIndicator: { width: 16, height: 16, borderWidth: 1.5, borderColor: colors.success, justifyContent: 'center', alignItems: 'center' },
  vegDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success },
  itemDesc: { fontSize: 12, color: colors.textSecondary, marginTop: 4, marginBottom: 6 },
  itemMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  itemPrice: { fontSize: 16, fontWeight: '700', color: colors.primary },
  availBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: borderRadius.full },
  availYes: { backgroundColor: colors.successLight },
  availNo: { backgroundColor: colors.errorLight },
  availText: { fontSize: 11, fontWeight: '600' },
  itemActions: { flexDirection: 'row', gap: spacing.sm },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.primaryLight, paddingHorizontal: 10, paddingVertical: 6, borderRadius: borderRadius.sm },
  editBtnText: { color: colors.primary, fontSize: 12, fontWeight: '600' },
  deleteBtn: { backgroundColor: colors.errorLight, padding: 6, borderRadius: borderRadius.sm },

  modalSafe: { flex: 1, backgroundColor: colors.background },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.borderLight, backgroundColor: colors.card },
  modalCancel: { fontSize: 16, color: colors.textSecondary },
  modalTitle: { fontSize: 17, fontWeight: '600', color: colors.textPrimary },
  modalSave: { fontSize: 16, color: colors.primary, fontWeight: '600' },
  modalBody: { padding: spacing.md },
  field: { marginBottom: spacing.md },
  fieldLabel: { fontSize: 13, fontWeight: '500', color: colors.textPrimary, marginBottom: spacing.xs },
  input: { backgroundColor: colors.card, borderRadius: borderRadius.sm, padding: 12, fontSize: 14, color: colors.textPrimary, borderWidth: 1, borderColor: colors.borderLight },
  categoryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  categoryChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: borderRadius.full, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.borderLight },
  categoryChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  categoryText: { fontSize: 12, color: colors.textSecondary },
  categoryTextActive: { color: '#fff' },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.card, padding: spacing.md, borderRadius: borderRadius.sm, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.borderLight },
  imagePickBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: spacing.md, borderRadius: borderRadius.sm, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.primary, backgroundColor: colors.primaryLight },
  imagePickText: { fontSize: 14, color: colors.primary, fontWeight: '600' },
  imagePreviewBox: { position: 'relative', borderRadius: borderRadius.sm, overflow: 'hidden' },
  imagePreview: { width: '100%', height: 180, backgroundColor: colors.background },
  imageRemove: { position: 'absolute', top: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 999 },
});
