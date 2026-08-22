/**
 * MenuTab — dedicated menu-management tab inside Vendor Onboarding.
 *
 * Vendors' menus are staged in `draft_menu` on the vendor_onboarding row
 * during onboarding. The instant the master admin approves the onboarding,
 * the backend materialises every row here into the live `menu_items`
 * collection, bound to the newly-created vendor and their site.
 */
import React, { useRef, useState } from 'react';
import axios from 'axios';
import { Upload, Plus, Pencil, Trash2, Save, X, Utensils, AlertCircle, Sparkles, Leaf, ImageIcon, ImageOff, ShieldAlert } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const MEAL_PERIODS = ['breakfast', 'lunch', 'snacks', 'dinner'];

// Canonical allergen taxonomy — MUST match /app/backend/allergen_classifier.py ALLERGEN_KEYS
const ALLERGEN_OPTIONS = [
  { key: 'milk',      label: 'Milk / Dairy' },
  { key: 'nuts',      label: 'Nuts' },
  { key: 'peanuts',   label: 'Peanuts' },
  { key: 'gluten',    label: 'Gluten / Wheat' },
  { key: 'soy',       label: 'Soy' },
  { key: 'sesame',    label: 'Sesame' },
  { key: 'egg',       label: 'Egg' },
  { key: 'fish',      label: 'Fish' },
  { key: 'shellfish', label: 'Shellfish' },
  { key: 'mustard',   label: 'Mustard' },
];
const allergenLabel = (key) => ALLERGEN_OPTIONS.find((a) => a.key === key)?.label || key;

const emptyForm = {
  name: '', description: '', category: 'Main', price: '',
  is_vegetarian: false, is_available: true, meal_periods: [], image_url: '',
  allergens: [],
};

const toNum = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

const MenuTab = ({ data, onbId, canEdit, reload }) => {
  const items = data.draft_menu || [];
  const [busy, setBusy] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [uploadResult, setUploadResult] = useState(null);

  const openAdd = () => { setForm(emptyForm); setEditId(null); setShowAdd(true); };
  const openEdit = (it) => {
    setForm({
      name: it.name || '',
      description: it.description || '',
      category: it.category || 'Main',
      price: it.price ?? '',
      is_vegetarian: !!it.is_vegetarian,
      is_available: it.is_available !== false,
      meal_periods: it.meal_periods || [],
      image_url: it.image_url || '',
      allergens: it.allergens || [],
    });
    setEditId(it.item_id);
    setShowAdd(true);
  };
  const closeForm = () => { setShowAdd(false); setEditId(null); setForm(emptyForm); };

  const toggleMealPeriod = (mp) => {
    setForm((f) => ({
      ...f,
      meal_periods: f.meal_periods.includes(mp)
        ? f.meal_periods.filter((x) => x !== mp)
        : [...f.meal_periods, mp],
    }));
  };

  const toggleAllergen = (key) => {
    setForm((f) => ({
      ...f,
      allergens: f.allergens.includes(key)
        ? f.allergens.filter((x) => x !== key)
        : [...f.allergens, key],
    }));
  };

  const submit = async () => {
    if (!form.name.trim()) return alert('Name is required');
    const price = toNum(form.price);
    if (price <= 0) return alert('Price must be greater than 0');
    setBusy(true);
    try {
      const payload = { ...form, price };
      if (editId) {
        await axios.patch(`${API}/onboarding/vendors/${onbId}/menu/${editId}`, payload, { withCredentials: true });
      } else {
        await axios.post(`${API}/onboarding/vendors/${onbId}/menu`, payload, { withCredentials: true });
      }
      closeForm();
      await reload();
    } catch (e) {
      alert(e?.response?.data?.detail || 'Failed to save item');
    } finally { setBusy(false); }
  };

  const removeItem = async (it) => {
    if (!window.confirm(`Delete "${it.name}"?`)) return;
    try {
      await axios.delete(`${API}/onboarding/vendors/${onbId}/menu/${it.item_id}`, { withCredentials: true });
      await reload();
    } catch (e) { alert(e?.response?.data?.detail || 'Delete failed'); }
  };

  const reclassifyVeg = async () => {
    try {
      const { data } = await axios.post(
        `${API}/onboarding/vendors/${onbId}/menu/reclassify-veg`,
        {},
        { withCredentials: true },
      );
      alert(data.changed
        ? `Updated ${data.changed} of ${data.total} items based on their names.`
        : `Every item already looks correctly classified (${data.total} checked).`);
      if (data.changed) await reload();
    } catch (e) {
      alert(e?.response?.data?.detail || 'Auto-classify failed');
    }
  };

  const reclassifyAllergens = async () => {
    const overwrite = window.confirm(
      'Auto-detect allergens for every menu item?\n\n' +
      'OK  → fill only items with NO allergens set (safe, preserves your manual selections)\n' +
      'Cancel → skip. Choose "OK & override" from the next prompt to overwrite everything.'
    );
    if (!overwrite) return;
    const forceOverwrite = window.confirm(
      'Overwrite EVERY item, including ones you already tagged manually?\n\n' +
      'OK → overwrite (destructive)\n' +
      'Cancel → only fill missing items (recommended)'
    );
    try {
      const { data } = await axios.post(
        `${API}/onboarding/vendors/${onbId}/menu/reclassify-allergens?overwrite=${forceOverwrite ? 'true' : 'false'}`,
        {},
        { withCredentials: true },
      );
      alert(data.changed
        ? `Updated ${data.changed} of ${data.total} items with detected allergens.`
        : `No changes — allergens already look correct (${data.total} checked).`);
      if (data.changed) await reload();
    } catch (e) {
      alert(e?.response?.data?.detail || 'Auto-classify failed');
    }
  };

  const [aiBusyId, setAiBusyId] = useState(null);
  const uploadFileRef = useRef(null);
  const [uploadItemId, setUploadItemId] = useState(null);

  const triggerUpload = (it) => {
    if (aiBusyId) return;
    setUploadItemId(it.item_id);
    // Give React one tick so the input mounts with the target itemId,
    // then programmatically click it. Avoids race where the ref is null.
    setTimeout(() => uploadFileRef.current?.click(), 0);
  };

  const handleUploadChosen = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';                     // reset so same-file re-upload fires change
    if (!file || !uploadItemId) return;
    if (file.size > 5 * 1024 * 1024) {
      alert('Image must be under 5 MB.');
      return;
    }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      alert('Only PNG, JPG or WEBP allowed.');
      return;
    }
    setAiBusyId(uploadItemId);
    try {
      const form = new FormData();
      form.append('file', file);
      await axios.post(
        `${API}/onboarding/vendors/${onbId}/menu/${uploadItemId}/image`,
        form,
        {
          withCredentials: true,
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 60000,
        },
      );
      await reload();
    } catch (err) {
      alert(err?.response?.data?.detail || 'Upload failed.');
    } finally {
      setAiBusyId(null);
      setUploadItemId(null);
    }
  };

  const removePhoto = async (it) => {
    if (aiBusyId) return;
    if (!window.confirm(`Remove the photo on "${it.name}"?`)) return;
    setAiBusyId(it.item_id);
    try {
      await axios.delete(
        `${API}/onboarding/vendors/${onbId}/menu/${it.item_id}/image`,
        { withCredentials: true },
      );
      await reload();
    } catch (err) {
      alert(err?.response?.data?.detail || 'Remove failed.');
    } finally {
      setAiBusyId(null);
    }
  };

  const generateFreePhoto = async (it) => {
    if (aiBusyId) return;
    setAiBusyId(it.item_id);
    try {
      const { data } = await axios.post(
        `${API}/ai/menu-photos/suggest-free`,
        {
          name: it.name,
          description: it.description || null,
          is_vegetarian: !!it.is_vegetarian,
          cuisine_hint: it.category || null,
          count: 1,
        },
        { withCredentials: true },
      );
      const url = data?.suggestions?.[0]?.url;
      if (!url) throw new Error('No image returned');
      await axios.patch(
        `${API}/onboarding/vendors/${onbId}/menu/${it.item_id}`,
        { image_url: url },
        { withCredentials: true },
      );
      await reload();
    } catch (e) {
      alert(e?.response?.data?.detail || e.message || 'Free photo lookup failed — try the paid AI button.');
    } finally {
      setAiBusyId(null);
    }
  };

  const generateAiPhoto = async (it) => {
    if (aiBusyId) return;
    if (!window.confirm(
      `Generate an AI photo for "${it.name}"?\n\n` +
      `This uses OpenAI gpt-image-1 (≈ ₹3.50 per photo). The result will replace ` +
      `the current image on this item.`
    )) return;
    setAiBusyId(it.item_id);
    try {
      const { data: suggest } = await axios.post(
        `${API}/ai/menu-photos/suggest`,
        {
          name: it.name,
          is_vegetarian: !!it.is_vegetarian,
          cuisine_hint: it.category || null,
          count: 1,
        },
        { withCredentials: true },
      );
      const url = suggest?.suggestions?.[0]?.url;
      if (!url) throw new Error('AI returned no image');
      await axios.patch(
        `${API}/onboarding/vendors/${onbId}/menu/${it.item_id}`,
        { image_url: url },
        { withCredentials: true },
      );
      await reload();
    } catch (e) {
      alert(e?.response?.data?.detail || e.message || 'AI photo generation failed');
    } finally {
      setAiBusyId(null);
    }
  };

  const toggleAvailability = async (it) => {
    try {
      await axios.patch(
        `${API}/onboarding/vendors/${onbId}/menu/${it.item_id}`,
        { is_available: !it.is_available },
        { withCredentials: true },
      );
      await reload();
    } catch (e) { alert(e?.response?.data?.detail || 'Toggle failed'); }
  };

  const onExcel = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (!window.confirm(`Uploading "${f.name}" REPLACES the current draft menu (${items.length} items). Continue?`)) {
      e.target.value = '';
      return;
    }
    const fd = new FormData();
    fd.append('file', f);
    setBusy(true);
    try {
      const { data: res } = await axios.post(
        `${API}/onboarding/vendors/${onbId}/menu/upload-excel`,
        fd,
        { withCredentials: true, headers: { 'Content-Type': 'multipart/form-data' } },
      );
      setUploadResult(res);
      await reload();
    } catch (err) {
      alert(err?.response?.data?.detail || 'Excel upload failed');
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  };

  return (
    <div className="space-y-6" data-testid="menu-tab-container">
      {/* Hidden file input drives the per-row Upload button (see triggerUpload) */}
      <input
        ref={uploadFileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={handleUploadChosen}
        className="hidden"
        data-testid="menu-tab-upload-input"
      />
      {/* Banner */}
      <div className="bg-primary-light border border-primary/30 rounded-2xl p-4 flex items-start gap-3">
        <Utensils className="h-5 w-5 text-primary mt-0.5" />
        <div className="flex-1">
          <p className="font-medium text-text-primary text-sm">Menu preview ({items.length} items)</p>
          <p className="text-text-secondary text-xs">
            {data.status === 'active' || data.vendor_id
              ? 'This vendor is live. The menu below has been published to the vendor account.'
              : 'These items will go live automatically the moment master admin approves this onboarding.'}
          </p>
        </div>
      </div>

      {/* Toolbar */}
      {canEdit && (
        <div className="flex flex-wrap gap-2 items-center">
          <button
            onClick={openAdd}
            data-testid="add-menu-item-btn"
            className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-hover"
          >
            <Plus className="h-4 w-4" /> Add item
          </button>
          <label
            data-testid="menu-excel-upload-label"
            className="cursor-pointer flex items-center gap-2 bg-card border border-border-light text-text-primary px-4 py-2 rounded-lg text-sm font-medium hover:bg-background"
          >
            <input
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              data-testid="menu-excel-upload"
              onChange={onExcel}
              disabled={busy}
            />
            <Upload className="h-4 w-4" /> Bulk upload Excel
          </label>
          {items.length > 0 && (
            <button
              onClick={reclassifyVeg}
              data-testid="reclassify-veg-btn"
              disabled={busy}
              title="Auto-detect veg / non-veg from item names (paneer, chicken, etc.)"
              className="flex items-center gap-2 bg-emerald-50 border border-emerald-300 text-emerald-800 px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-100 disabled:opacity-50"
            >
              <Leaf className="h-4 w-4" /> Auto-classify Veg
            </button>
          )}
          {items.length > 0 && (
            <button
              onClick={reclassifyAllergens}
              data-testid="reclassify-allergens-btn"
              disabled={busy}
              title="Auto-detect allergens (milk, nuts, gluten, egg, fish, etc.) from item names + descriptions"
              className="flex items-center gap-2 bg-amber-50 border border-amber-300 text-amber-800 px-4 py-2 rounded-lg text-sm font-medium hover:bg-amber-100 disabled:opacity-50"
            >
              <ShieldAlert className="h-4 w-4" /> Auto-classify Allergens
            </button>
          )}
          <a
            href="data:text/csv;charset=utf-8,name,category,price,description,meal_period,is_vegetarian,is_available,image_url,allergens%0AVeg%20Thali,Main,180,Full%20meal%20with%20rice%20and%20roti,lunch%20snacks,yes,yes,,gluten%0AMasala%20Chai,Beverage,25,Hot%20milk%20tea,breakfast%20snacks,yes,yes,,milk"
            download="cravitoo-menu-template.csv"
            className="text-xs text-primary hover:underline"
          >
            Download template
          </a>
        </div>
      )}

      {uploadResult && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800 text-sm px-4 py-3 flex items-start justify-between gap-3">
          <div>
            Inserted <strong>{uploadResult.inserted}</strong> items from Excel
            {uploadResult.errors?.length ? <> · {uploadResult.errors.length} row error(s)</> : null}
          </div>
          <button onClick={() => setUploadResult(null)} className="text-emerald-700"><X className="h-4 w-4" /></button>
        </div>
      )}

      {/* Add/Edit form */}
      {showAdd && (
        <div data-testid="menu-form" className="bg-card border-2 border-primary/40 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-heading font-medium text-lg">{editId ? 'Edit item' : 'Add new item'}</h3>
            <button onClick={closeForm} className="text-text-muted hover:text-text-primary"><X className="h-5 w-5" /></button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-text-secondary">Name *</label>
              <input
                data-testid="menu-form-name"
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 border border-border-light rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>
            <div>
              <label className="text-xs text-text-secondary">Category</label>
              <input
                data-testid="menu-form-category"
                type="text"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full px-3 py-2 border border-border-light rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>
            <div>
              <label className="text-xs text-text-secondary">Price (₹) *</label>
              <input
                data-testid="menu-form-price"
                type="number"
                min="1"
                step="1"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                className="w-full px-3 py-2 border border-border-light rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>
            <div>
              <label className="text-xs text-text-secondary">Image URL</label>
              <input
                data-testid="menu-form-image"
                type="text"
                value={form.image_url}
                onChange={(e) => setForm({ ...form, image_url: e.target.value })}
                placeholder="https://…"
                className="w-full px-3 py-2 border border-border-light rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-text-secondary">Description</label>
              <textarea
                data-testid="menu-form-description"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={2}
                className="w-full px-3 py-2 border border-border-light rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-text-secondary block mb-1">Meal periods</label>
              <div className="flex gap-2 flex-wrap">
                {MEAL_PERIODS.map((mp) => (
                  <button
                    key={mp}
                    type="button"
                    onClick={() => toggleMealPeriod(mp)}
                    data-testid={`menu-form-meal-${mp}`}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium capitalize border transition-colors ${
                      form.meal_periods.includes(mp)
                        ? 'bg-primary text-white border-primary'
                        : 'bg-card text-text-secondary border-border-light hover:border-primary'
                    }`}
                  >
                    {mp}
                  </button>
                ))}
              </div>
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-text-secondary flex items-center gap-1 mb-1">
                <ShieldAlert className="h-3.5 w-3.5 text-amber-600" />
                Allergens contained (required for FSSAI compliance)
              </label>
              <div className="flex gap-2 flex-wrap">
                {ALLERGEN_OPTIONS.map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggleAllergen(key)}
                    data-testid={`menu-form-allergen-${key}`}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                      form.allergens.includes(key)
                        ? 'bg-amber-500 text-white border-amber-500'
                        : 'bg-card text-text-secondary border-border-light hover:border-amber-400'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-text-muted mt-1">
                Tip: leave empty and use "Auto-classify Allergens" to have the system suggest based on the dish name.
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                data-testid="menu-form-veg"
                checked={form.is_vegetarian}
                onChange={(e) => setForm({ ...form, is_vegetarian: e.target.checked })}
              />
              Vegetarian
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                data-testid="menu-form-available"
                checked={form.is_available}
                onChange={(e) => setForm({ ...form, is_available: e.target.checked })}
              />
              Available for order
            </label>
          </div>
          <div className="flex gap-2 pt-2">
            <button
              onClick={submit}
              disabled={busy}
              data-testid="menu-form-save"
              className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-hover disabled:opacity-40"
            >
              <Save className="h-4 w-4" /> {editId ? 'Save changes' : 'Add item'}
            </button>
            <button onClick={closeForm} className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary">Cancel</button>
          </div>
        </div>
      )}

      {/* List */}
      {items.length === 0 ? (
        <div className="bg-card border border-dashed border-border-light rounded-2xl p-10 text-center">
          <AlertCircle className="h-10 w-10 mx-auto text-text-muted mb-3" />
          <p className="font-medium text-text-primary">No menu items yet</p>
          <p className="text-sm text-text-secondary">
            {canEdit ? 'Add items manually or upload an Excel sheet above.' : 'This onboarding has no menu items.'}
          </p>
        </div>
      ) : (
        <div className="bg-card border border-border-light rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-background text-text-secondary text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-3">Name</th>
                  <th className="text-left px-4 py-3">Category</th>
                  <th className="text-right px-4 py-3">Price</th>
                  <th className="text-left px-4 py-3">Meal Period</th>
                  <th className="text-left px-4 py-3">Veg</th>
                  <th className="text-left px-4 py-3">Allergens</th>
                  <th className="text-left px-4 py-3">Available</th>
                  {canEdit && <th className="text-right px-4 py-3">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.item_id || it.name} data-testid={`menu-row-${it.item_id}`} className="border-t border-border-light">
                    <td className="px-4 py-3">
                      <div className="font-medium text-text-primary">{it.name}</div>
                      {it.description && <div className="text-xs text-text-muted line-clamp-1">{it.description}</div>}
                    </td>
                    <td className="px-4 py-3 text-text-secondary">{it.category}</td>
                    <td className="px-4 py-3 text-right font-mono">₹{Number(it.price).toFixed(0)}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 flex-wrap">
                        {(it.meal_periods && it.meal_periods.length > 0)
                          ? it.meal_periods.map((mp) => (
                              <span key={mp} className="px-2 py-0.5 rounded-full text-xs bg-blue-50 text-blue-700 capitalize">{mp}</span>
                            ))
                          : <span className="text-xs text-text-muted">—</span>
                        }
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block w-2.5 h-2.5 rounded-full ${it.is_vegetarian ? 'bg-emerald-500' : 'bg-red-500'}`} title={it.is_vegetarian ? 'Veg' : 'Non-veg'} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 flex-wrap max-w-[180px]" data-testid={`menu-row-allergens-${it.item_id}`}>
                        {(it.allergens && it.allergens.length > 0)
                          ? it.allergens.map((a) => (
                              <span
                                key={a}
                                className="px-2 py-0.5 rounded-full text-[10px] bg-amber-50 text-amber-800 border border-amber-200"
                                title={allergenLabel(a)}
                              >
                                {allergenLabel(a)}
                              </span>
                            ))
                          : <span className="text-xs text-text-muted">—</span>
                        }
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {canEdit ? (
                        <button
                          onClick={() => toggleAvailability(it)}
                          data-testid={`menu-toggle-${it.item_id}`}
                          className={`text-xs px-2 py-1 rounded-full font-medium ${
                            it.is_available
                              ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                              : 'bg-red-50 text-red-700 hover:bg-red-100'
                          }`}
                        >
                          {it.is_available ? 'Yes' : 'No'}
                        </button>
                      ) : (
                        <span className={`text-xs ${it.is_available ? 'text-emerald-700' : 'text-red-700'}`}>
                          {it.is_available ? 'Yes' : 'No'}
                        </span>
                      )}
                    </td>
                    {canEdit && (
                      <td className="px-4 py-3">
                        <div className="flex gap-1 justify-end items-center">
                          {it.image_url && (
                            <img
                              src={it.image_url}
                              alt={it.name}
                              className="w-10 h-10 rounded object-cover border border-border-light mr-1"
                              onError={(e) => { e.target.style.display = 'none'; }}
                            />
                          )}
                          <button
                            onClick={() => triggerUpload(it)}
                            disabled={aiBusyId === it.item_id}
                            data-testid={`menu-upload-photo-${it.item_id}`}
                            className="p-1.5 text-sky-600 hover:text-white hover:bg-sky-600 rounded transition-colors disabled:opacity-40"
                            title={it.image_url ? 'Replace uploaded photo' : 'Upload a photo from your device'}
                          >
                            <Upload className={`h-4 w-4 ${aiBusyId === it.item_id ? 'animate-pulse' : ''}`} />
                          </button>
                          <button
                            onClick={() => generateFreePhoto(it)}
                            disabled={aiBusyId === it.item_id}
                            data-testid={`menu-free-photo-${it.item_id}`}
                            className="p-1.5 text-emerald-600 hover:text-white hover:bg-emerald-600 rounded transition-colors disabled:opacity-40"
                            title={it.image_url ? 'Regenerate photo automatically' : 'Auto-generate a photo from the item name (free)'}
                          >
                            <Sparkles className={`h-4 w-4 ${aiBusyId === it.item_id ? 'animate-pulse' : ''}`} />
                          </button>
                          {it.image_url && (
                            <button
                              onClick={() => removePhoto(it)}
                              disabled={aiBusyId === it.item_id}
                              data-testid={`menu-remove-photo-${it.item_id}`}
                              className="p-1.5 text-amber-600 hover:text-white hover:bg-amber-600 rounded transition-colors disabled:opacity-40"
                              title="Remove photo"
                            >
                              <ImageOff className="h-4 w-4" />
                            </button>
                          )}
                          <button
                            onClick={() => openEdit(it)}
                            data-testid={`menu-edit-${it.item_id}`}
                            className="p-1.5 text-text-secondary hover:text-primary rounded hover:bg-background"
                            title="Edit"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => removeItem(it)}
                            data-testid={`menu-delete-${it.item_id}`}
                            className="p-1.5 text-red-500 hover:text-white hover:bg-red-600 rounded"
                            title="Delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default MenuTab;
