import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useParams } from 'react-router-dom';
import Navbar from '../../components/Navbar';
import { useAuth } from '../../context/AuthContext';
import { Building2, Store, Calendar, UtensilsCrossed, Settings, Plus, Trash2, Upload, ToggleLeft, ToggleRight, FileSpreadsheet, Sparkles, X, Check, Loader2 } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const MEAL_PERIODS = ['breakfast', 'lunch', 'snacks', 'dinner'];

const SiteDetail = () => {
  const { siteId } = useParams();
  const { user: currentUser } = useAuth();
  const [site, setSite] = useState(null);
  const [tab, setTab] = useState('vendors');
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/sites/${siteId}`, { withCredentials: true });
      setSite(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  useEffect(() => { reload(); }, [reload]);

  if (loading) {
    return (
      <>
        <Navbar />
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </>
    );
  }

  if (!site) {
    return (
      <>
        <Navbar />
        <div className="min-h-screen bg-background flex items-center justify-center">
          <p className="text-text-secondary">Site not found</p>
        </div>
      </>
    );
  }

  const tabs = [
    { key: 'vendors', label: 'Vendors', icon: Store },
    { key: 'menu', label: 'Menu', icon: UtensilsCrossed },
    { key: 'schedule', label: 'Schedule', icon: Calendar },
    { key: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-background">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex items-start gap-4 mb-8 flex-wrap">
            <div className="bg-primary-light rounded-2xl p-4">
              <Building2 className="h-8 w-8 text-primary" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="font-heading text-3xl sm:text-4xl tracking-tighter font-semibold text-text-primary">{site.name}</h1>
                {site.lifecycle_status && (() => {
                  const s = site.lifecycle_status;
                  const sty = LIFECYCLE_INFO[s] || LIFECYCLE_INFO.live;
                  return (
                    <span data-testid={`header-lifecycle-${s}`} className={`inline-block px-2.5 py-1 text-xs font-medium rounded-full border ${sty.bg} ${sty.text} ${sty.border}`}>
                      {sty.label}
                    </span>
                  );
                })()}
              </div>
              <p className="text-text-secondary mt-1">{site.address}, {site.city}</p>
            </div>
          </div>

          <div className="flex gap-2 border-b border-border-light mb-6 overflow-x-auto">
            {tabs.map((t) => {
              const Icon = t.icon;
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  data-testid={`tab-${t.key}`}
                  onClick={() => setTab(t.key)}
                  className={`flex items-center gap-2 px-4 py-3 font-medium text-sm transition-all border-b-2 ${active ? 'border-primary text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'}`}
                >
                  <Icon className="h-4 w-4" /> {t.label}
                </button>
              );
            })}
          </div>

          {tab === 'vendors' && <VendorsTab siteId={siteId} />}
          {tab === 'menu' && <MenuTab siteId={siteId} />}
          {tab === 'schedule' && <ScheduleTab siteId={siteId} />}
          {tab === 'settings' && (
            <>
              <SiteLifecyclePanel site={site} reload={reload} currentUser={currentUser} />
              <SettingsTab site={site} reload={reload} />
            </>
          )}
        </div>
      </div>
    </>
  );
};

const VendorsTab = ({ siteId }) => {
  const [mapped, setMapped] = useState([]);
  const [allVendors, setAllVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [swapping, setSwapping] = useState(null); // vendor being swapped

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [m, all] = await Promise.all([
        axios.get(`${API}/sites/${siteId}/vendors`, { withCredentials: true }),
        axios.get(`${API}/vendors`, { withCredentials: true }),
      ]);
      setMapped(m.data);
      setAllVendors(all.data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [siteId]);

  useEffect(() => { load(); }, [load]);

  const addVendor = async (vendorId) => {
    setAdding(true);
    try {
      await axios.post(`${API}/sites/${siteId}/vendors`, { vendor_id: vendorId, site_id: siteId }, { withCredentials: true });
      await load();
    } catch (e) { alert(e?.response?.data?.detail || 'Failed'); }
    finally { setAdding(false); }
  };

  const removeVendor = async (vendorId) => {
    if (!window.confirm('Remove this vendor from this site?')) return;
    try {
      await axios.delete(`${API}/sites/${siteId}/vendors/${vendorId}`, { withCredentials: true });
      await load();
    } catch (e) { alert(e?.response?.data?.detail || 'Failed'); }
  };

  const swapVendor = async (oldVendorId, newVendorId) => {
    try {
      await axios.put(`${API}/sites/${siteId}/vendors/swap`, { old_vendor_id: oldVendorId, new_vendor_id: newVendorId }, { withCredentials: true });
      setSwapping(null);
      await load();
    } catch (e) { alert(e?.response?.data?.detail || 'Swap failed'); }
  };

  if (loading) return <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto" />;

  const mappedIds = new Set(mapped.map((v) => v.id));
  const unmapped = allVendors.filter((v) => !mappedIds.has(v.id));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="bg-card border border-border-light rounded-2xl p-6">
        <h3 className="font-heading text-xl font-medium mb-4">Active Vendors ({mapped.length})</h3>
        {mapped.length === 0 && <p className="text-text-muted text-sm">No vendors mapped to this site yet.</p>}
        <div className="space-y-2">
          {mapped.map((v) => (
            <div key={v.id} data-testid={`mapped-vendor-${v.id}`} className="p-3 bg-background rounded-lg">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-text-primary text-sm">{v.name}</p>
                  <p className="text-text-muted text-xs">{v.cuisine_type}</p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    data-testid={`swap-vendor-${v.id}`}
                    onClick={() => setSwapping(swapping?.id === v.id ? null : v)}
                    title="Change vendor"
                    className="text-amber-700 hover:bg-amber-50 px-2.5 py-1 rounded-lg text-xs font-medium"
                  >
                    Change
                  </button>
                  <button
                    data-testid={`unmap-vendor-${v.id}`}
                    onClick={() => removeVendor(v.id)}
                    title="Remove vendor"
                    className="text-red-600 hover:bg-red-50 p-2 rounded-lg"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              {swapping?.id === v.id && (
                <div className="mt-3 pt-3 border-t border-border-light" data-testid={`swap-panel-${v.id}`}>
                  <p className="text-xs text-text-muted mb-2">Replace <strong>{v.name}</strong> with:</p>
                  {unmapped.length === 0 ? (
                    <p className="text-xs text-amber-700">No other vendors available — onboard a vendor first.</p>
                  ) : (
                    <select
                      data-testid={`swap-select-${v.id}`}
                      defaultValue=""
                      onChange={(e) => { if (e.target.value) swapVendor(v.id, e.target.value); }}
                      className="w-full px-3 py-2 border border-border-light rounded-lg text-sm bg-card"
                    >
                      <option value="">— Pick replacement vendor —</option>
                      {unmapped.map((u) => (
                        <option key={u.id} value={u.id}>{u.name} ({u.cuisine_type})</option>
                      ))}
                    </select>
                  )}
                  <button
                    onClick={() => setSwapping(null)}
                    className="text-xs text-text-muted hover:text-text-primary mt-2"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="bg-card border border-border-light rounded-2xl p-6">
        <h3 className="font-heading text-xl font-medium mb-4">Add Vendors</h3>
        {unmapped.length === 0 && <p className="text-text-muted text-sm">All available vendors are already mapped.</p>}
        <div className="space-y-2">
          {unmapped.map((v) => (
            <div key={v.id} className="flex items-center justify-between p-3 bg-background rounded-lg">
              <div>
                <p className="font-medium text-text-primary text-sm">{v.name}</p>
                <p className="text-text-muted text-xs">{v.cuisine_type}</p>
              </div>
              <button data-testid={`add-vendor-${v.id}`} onClick={() => addVendor(v.id)} disabled={adding} className="bg-primary text-white px-3 py-1.5 rounded-lg text-sm disabled:opacity-50 hover:bg-primary-hover flex items-center gap-1">
                <Plus className="h-3 w-3" /> Add
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const AIPhotoModal = ({ item, onClose, onApplied }) => {
  const [count, setCount] = useState(1);
  const [cuisineHint, setCuisineHint] = useState(item?.category || '');
  const [promptOverride, setPromptOverride] = useState('');
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [promptUsed, setPromptUsed] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(null);
  const [error, setError] = useState('');

  const generate = async () => {
    setLoading(true);
    setError('');
    setSuggestions([]);
    setSelectedIdx(null);
    try {
      const { data } = await axios.post(
        `${API}/ai/menu-photos/suggest`,
        {
          name: item.name,
          is_vegetarian: item.is_vegetarian,
          cuisine_hint: cuisineHint || undefined,
          prompt_override: promptOverride.trim() || undefined,
          count,
        },
        { withCredentials: true, timeout: 120000 }
      );
      setSuggestions(data.suggestions || []);
      setPromptUsed(data.prompt_used || '');
    } catch (e) {
      setError(e?.response?.data?.detail || e?.message || 'AI generation failed');
    } finally {
      setLoading(false);
    }
  };

  const apply = async () => {
    if (selectedIdx === null) return;
    setApplying(true);
    setError('');
    try {
      await axios.post(
        `${API}/ai/menu-photos/apply`,
        { menu_item_id: item.id, photo_filename: suggestions[selectedIdx].filename },
        { withCredentials: true }
      );
      onApplied();
      onClose();
    } catch (e) {
      setError(e?.response?.data?.detail || 'Failed to apply photo');
    } finally {
      setApplying(false);
    }
  };

  return (
    <div data-testid="ai-photo-modal" className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-card border-b border-border-light px-6 py-4 flex items-center justify-between">
          <div>
            <h3 className="font-heading text-xl font-medium flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" /> AI Photo for "{item.name}"
            </h3>
            <p className="text-text-muted text-xs mt-1">Generates photorealistic menu photos via Cravitoo's AI.</p>
          </div>
          <button data-testid="ai-photo-close" onClick={onClose} className="text-text-muted hover:text-text-primary">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Controls */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-text-secondary uppercase">Cuisine hint (optional)</label>
              <input
                data-testid="ai-cuisine-input"
                type="text"
                value={cuisineHint}
                onChange={(e) => setCuisineHint(e.target.value)}
                placeholder="e.g. North Indian, South Indian, Continental"
                className="mt-1 w-full px-3 py-2 border border-border-light rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-text-secondary uppercase">Variants to generate</label>
              <select
                data-testid="ai-count-select"
                value={count}
                onChange={(e) => setCount(parseInt(e.target.value))}
                className="mt-1 w-full px-3 py-2 border border-border-light rounded-lg text-sm"
              >
                <option value={1}>1 (fastest, ~30s)</option>
                <option value={2}>2 (~50s)</option>
                <option value={3}>3 (~75s)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-text-secondary uppercase">Custom prompt (optional)</label>
            <textarea
              data-testid="ai-prompt-textarea"
              value={promptOverride}
              onChange={(e) => setPromptOverride(e.target.value)}
              placeholder="Leave blank to auto-generate from dish name + cuisine. Tip: describe the plating, lighting, garnish."
              rows={2}
              className="mt-1 w-full px-3 py-2 border border-border-light rounded-lg text-sm"
            />
          </div>

          <button
            data-testid="ai-generate-btn"
            onClick={generate}
            disabled={loading}
            className="w-full px-4 py-2.5 bg-primary text-white rounded-lg font-medium hover:bg-primary-hover disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {loading ? 'Generating… this can take ~30-75 seconds' : (suggestions.length > 0 ? 'Regenerate' : 'Generate Photo')}
          </button>

          {error && <p className="text-red-600 text-sm bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

          {promptUsed && !loading && (
            <p className="text-xs text-text-muted bg-background-secondary px-3 py-2 rounded-lg">
              <span className="font-medium">Prompt used:</span> {promptUsed}
            </p>
          )}

          {/* Suggestions grid */}
          {suggestions.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm text-text-secondary">Pick one to save as the menu photo:</p>
              <div className={`grid gap-3 ${suggestions.length === 1 ? 'grid-cols-1' : suggestions.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
                {suggestions.map((s, i) => (
                  <button
                    key={s.filename}
                    data-testid={`ai-suggestion-${i}`}
                    onClick={() => setSelectedIdx(i)}
                    className={`relative rounded-xl overflow-hidden border-4 transition-all ${selectedIdx === i ? 'border-primary shadow-xl scale-[1.02]' : 'border-transparent hover:border-border-light'}`}
                  >
                    <img src={s.url} alt={`Variant ${i + 1}`} className="w-full aspect-square object-cover" />
                    {selectedIdx === i && (
                      <div className="absolute top-2 right-2 bg-primary text-white rounded-full p-1.5">
                        <Check className="h-4 w-4" />
                      </div>
                    )}
                  </button>
                ))}
              </div>
              <button
                data-testid="ai-apply-btn"
                onClick={apply}
                disabled={selectedIdx === null || applying}
                className="w-full px-4 py-2.5 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {applying ? 'Saving…' : selectedIdx === null ? 'Pick a variant above' : 'Use this photo'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};


const MenuTab = ({ siteId }) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [vendors, setVendors] = useState([]);
  const [selectedVendor, setSelectedVendor] = useState('');
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');
  const [aiPhotoItem, setAiPhotoItem] = useState(null);
  const [bulkFilling, setBulkFilling] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);

  const runBulkFill = async () => {
    const missing = items.filter((it) => !it.image_url).length;
    if (missing === 0) {
      setBulkResult({ message: '🎉 All items already have photos!' });
      return;
    }
    const cap = Math.min(missing, 20);
    if (!window.confirm(`Generate AI photos for up to ${cap} items missing images?\n\nEstimated cost: ~₹${(cap * 3.5).toFixed(0)} (charged from your Emergent LLM key balance).\n\nThis may take ~${cap * 15} seconds.`)) {
      return;
    }
    setBulkFilling(true);
    setBulkResult(null);
    try {
      const { data } = await axios.post(
        `${API}/ai/menu-photos/bulk-fill`,
        { site_id: siteId, max_items: cap, dry_run: false },
        { withCredentials: true, timeout: cap * 30000 + 60000 }
      );
      setBulkResult(data);
      load();
    } catch (e) {
      setBulkResult({ error: e?.response?.data?.detail || e?.message || 'Bulk-fill failed' });
    } finally {
      setBulkFilling(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [m, v] = await Promise.all([
        axios.get(`${API}/sites/${siteId}/menu`, { withCredentials: true }),
        axios.get(`${API}/sites/${siteId}/vendors`, { withCredentials: true }),
      ]);
      setItems(m.data);
      setVendors(v.data);
      if (v.data.length > 0 && !selectedVendor) setSelectedVendor(v.data[0].id);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [siteId, selectedVendor]);

  useEffect(() => { load(); }, [load]);

  const toggleAvailable = async (item) => {
    try {
      await axios.patch(`${API}/menu/${item.id}/site-control`, { is_available: !item.is_available }, { withCredentials: true });
      await load();
    } catch (e) { alert(e?.response?.data?.detail || 'Failed'); }
  };

  const updatePrice = async (item, newPrice) => {
    const price = parseFloat(newPrice);
    if (isNaN(price) || price < 0) return;
    try {
      await axios.patch(`${API}/menu/${item.id}/site-control`, { price }, { withCredentials: true });
      await load();
    } catch (e) { alert(e?.response?.data?.detail || 'Failed'); }
  };

  const toggleShowPrice = async (item) => {
    try {
      await axios.patch(`${API}/menu/${item.id}/site-control`, { show_price: !item.show_price }, { withCredentials: true });
      await load();
    } catch (e) { alert(e?.response?.data?.detail || 'Failed'); }
  };

  const uploadExcel = async (e) => {
    e.preventDefault();
    if (!file || !selectedVendor) {
      setUploadMsg('Please choose a vendor and Excel file');
      return;
    }
    setUploading(true);
    setUploadMsg('');
    const fd = new FormData();
    fd.append('file', file);
    try {
      const { data } = await axios.post(`${API}/sites/${siteId}/menu/upload-excel?vendor_id=${selectedVendor}`, fd, {
        withCredentials: true,
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setUploadMsg(`✓ Inserted ${data.inserted} items${data.errors?.length ? ` (${data.errors.length} errors)` : ''}`);
      setFile(null);
      await load();
    } catch (e) {
      setUploadMsg('✗ ' + (e?.response?.data?.detail || 'Upload failed'));
    } finally {
      setUploading(false);
    }
  };

  if (loading) return <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto" />;

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border-light rounded-2xl p-6">
        <h3 className="font-heading text-xl font-medium mb-3 flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5 text-primary" /> Upload Menu via Excel
        </h3>
        <p className="text-text-muted text-xs mb-4">Required columns: <code>name, description, category, price</code>. Optional: <code>is_vegetarian, image_url, meal_periods</code> (comma-separated).</p>
        <form onSubmit={uploadExcel} className="flex flex-col md:flex-row gap-3">
          <select
            data-testid="upload-vendor-select"
            value={selectedVendor}
            onChange={(e) => setSelectedVendor(e.target.value)}
            className="px-3 py-2 border border-border-light rounded-lg flex-1"
          >
            <option value="">-- Select vendor --</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <input
            data-testid="upload-excel-file"
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => setFile(e.target.files[0])}
            className="px-3 py-2 border border-border-light rounded-lg flex-1"
          />
          <button data-testid="upload-excel-submit" type="submit" disabled={uploading || !file || !selectedVendor} className="px-4 py-2 bg-primary text-white rounded-lg font-medium hover:bg-primary-hover disabled:opacity-50 flex items-center gap-2">
            <Upload className="h-4 w-4" /> {uploading ? 'Uploading...' : 'Upload'}
          </button>
        </form>
        {uploadMsg && <p className={`mt-3 text-sm ${uploadMsg.startsWith('✓') ? 'text-emerald-600' : 'text-red-600'}`}>{uploadMsg}</p>}
      </div>

      <div className="bg-card border border-border-light rounded-2xl p-6">
        <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
          <h3 className="font-heading text-xl font-medium">Menu Items ({items.length})</h3>
          <button
            data-testid="bulk-fill-ai-btn"
            onClick={runBulkFill}
            disabled={bulkFilling || items.length === 0}
            className="px-3 py-2 text-sm bg-primary-light text-primary border border-primary/30 rounded-lg font-medium hover:bg-primary hover:text-white disabled:opacity-50 flex items-center gap-2"
            title="Use AI to fill in missing menu photos"
          >
            {bulkFilling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {bulkFilling ? 'Generating…' : `Fill missing photos with AI (${items.filter(i => !i.image_url).length})`}
          </button>
        </div>
        {bulkResult && (
          <div data-testid="bulk-fill-result" className={`mb-4 p-3 rounded-lg text-sm ${bulkResult.error ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-800'}`}>
            {bulkResult.error ? (
              <>❌ {bulkResult.error}</>
            ) : bulkResult.message ? (
              <>{bulkResult.message}</>
            ) : (
              <>✅ Filled <strong>{bulkResult.filled}</strong> photo(s){bulkResult.skipped > 0 && `, skipped ${bulkResult.skipped}`}{bulkResult.estimated_cost_inr > 0 && ` • Cost: ~₹${bulkResult.estimated_cost_inr}`}</>
            )}
          </div>
        )}
        {items.length === 0 && <p className="text-text-muted text-sm">No menu items yet. Upload via Excel or have vendors add them.</p>}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs text-text-muted uppercase border-b border-border-light">
                <th className="pb-2">Photo</th>
                <th className="pb-2">Name</th>
                <th className="pb-2">Category</th>
                <th className="pb-2">Price (₹)</th>
                <th className="pb-2">Show Price</th>
                <th className="pb-2">Available</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} data-testid={`menu-row-${it.id}`} className="border-b border-border-light/50">
                  <td className="py-3">
                    <div className="flex items-center gap-2">
                      {it.image_url ? (
                        <img
                          src={it.image_url}
                          alt={it.name}
                          className="w-12 h-12 rounded-lg object-cover border border-border-light"
                          onError={(e) => { e.target.style.display = 'none'; }}
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-lg bg-background-secondary border border-dashed border-border-light flex items-center justify-center text-text-muted text-xs">
                          ?
                        </div>
                      )}
                      <button
                        data-testid={`ai-photo-btn-${it.id}`}
                        onClick={() => setAiPhotoItem(it)}
                        className="text-xs text-primary hover:text-primary-hover flex items-center gap-1 underline-offset-2 hover:underline"
                        title="Generate AI photo"
                      >
                        <Sparkles className="h-3.5 w-3.5" /> AI
                      </button>
                    </div>
                  </td>
                  <td className="py-3">
                    <div>
                      <p className="font-medium text-text-primary text-sm">{it.name}</p>
                      <p className="text-text-muted text-xs">{it.is_vegetarian ? '🟢 Veg' : '🔴 Non-veg'} · {(it.meal_periods || []).join(', ') || 'any'}</p>
                    </div>
                  </td>
                  <td className="py-3 text-sm text-text-secondary">{it.category}</td>
                  <td className="py-3">
                    <input
                      data-testid={`price-input-${it.id}`}
                      type="number"
                      defaultValue={it.price}
                      onBlur={(e) => e.target.value != it.price && updatePrice(it, e.target.value)}
                      className="w-20 px-2 py-1 border border-border-light rounded text-sm"
                      step="0.01"
                    />
                  </td>
                  <td className="py-3">
                    <button data-testid={`toggle-show-price-${it.id}`} onClick={() => toggleShowPrice(it)}>
                      {it.show_price ? <ToggleRight className="h-6 w-6 text-emerald-500" /> : <ToggleLeft className="h-6 w-6 text-text-muted" />}
                    </button>
                  </td>
                  <td className="py-3">
                    <button data-testid={`toggle-available-${it.id}`} onClick={() => toggleAvailable(it)}>
                      {it.is_available ? <ToggleRight className="h-6 w-6 text-emerald-500" /> : <ToggleLeft className="h-6 w-6 text-text-muted" />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {aiPhotoItem && (
        <AIPhotoModal
          item={aiPhotoItem}
          onClose={() => setAiPhotoItem(null)}
          onApplied={load}
        />
      )}
    </div>
  );
};

const ScheduleTab = ({ siteId }) => {
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await axios.get(`${API}/sites/${siteId}/schedule`, { withCredentials: true });
        const sched = data.schedules || [];
        const filled = MEAL_PERIODS.map((p) => {
          const existing = sched.find((s) => s.meal_period === p);
          return existing || { meal_period: p, start_time: '12:00', end_time: '14:00', enabled: false };
        });
        setSchedules(filled);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    })();
  }, [siteId]);

  const save = async () => {
    setSaving(true);
    try {
      await axios.put(`${API}/sites/${siteId}/schedule`, { schedules: schedules.filter((s) => s.enabled || s.start_time !== '12:00') }, { withCredentials: true });
      alert('Schedule saved');
    } catch (e) { alert(e?.response?.data?.detail || 'Failed'); }
    finally { setSaving(false); }
  };

  const updateRow = (idx, key, val) => {
    const next = [...schedules];
    next[idx] = { ...next[idx], [key]: val };
    setSchedules(next);
  };

  if (loading) return <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto" />;

  return (
    <div className="bg-card border border-border-light rounded-2xl p-6 max-w-2xl">
      <h3 className="font-heading text-xl font-medium mb-2">Meal Schedule</h3>
      <p className="text-text-muted text-sm mb-6">Set when each meal type is orderable at this site.</p>
      <div className="space-y-3">
        {schedules.map((s, i) => (
          <div key={s.meal_period} data-testid={`schedule-row-${s.meal_period}`} className="grid grid-cols-4 gap-3 items-center">
            <label className="flex items-center gap-2 capitalize">
              <input type="checkbox" data-testid={`schedule-enable-${s.meal_period}`} checked={s.enabled} onChange={(e) => updateRow(i, 'enabled', e.target.checked)} />
              {s.meal_period}
            </label>
            <input type="time" value={s.start_time} onChange={(e) => updateRow(i, 'start_time', e.target.value)} className="px-2 py-1.5 border border-border-light rounded-lg text-sm" disabled={!s.enabled} />
            <span className="text-text-muted text-center text-sm">to</span>
            <input type="time" value={s.end_time} onChange={(e) => updateRow(i, 'end_time', e.target.value)} className="px-2 py-1.5 border border-border-light rounded-lg text-sm" disabled={!s.enabled} />
          </div>
        ))}
      </div>
      <button data-testid="save-schedule-btn" onClick={save} disabled={saving} className="mt-6 px-5 py-2.5 bg-primary text-white rounded-xl font-medium hover:bg-primary-hover disabled:opacity-50">
        {saving ? 'Saving...' : 'Save Schedule'}
      </button>
    </div>
  );
};

const LIFECYCLE_INFO = {
  draft: { label: 'Draft', bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-200', desc: 'Site is being set up. Employees cannot register yet.', next: 'configured', nextLabel: 'Mark as Configured' },
  configured: { label: 'Configured', bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-200', desc: 'Site is fully set up. Activate it to open sign-ups.', next: 'live', nextLabel: 'Activate (Go Live)' },
  live: { label: 'Live', bg: 'bg-emerald-100', text: 'text-emerald-800', border: 'border-emerald-200', desc: 'Employees can register and start ordering.', next: null, nextLabel: null },
};

const SiteLifecyclePanel = ({ site, reload, currentUser }) => {
  const status = site.lifecycle_status || 'live';
  const info = LIFECYCLE_INFO[status] || LIFECYCLE_INFO.live;
  const [busy, setBusy] = useState(false);
  const [pocName, setPocName] = useState('');
  const [showPocForm, setShowPocForm] = useState(false);

  const isMaster = currentUser?.role === 'master_admin';

  const transition = async (target, name = '') => {
    setBusy(true);
    try {
      const body = { to: target };
      if (name) body.poc_name = name;
      const { data } = await axios.post(`${API}/sites/${site.id}/lifecycle`, body, { withCredentials: true });
      if (target === 'live' && data?.site_activated_email_sent) {
        alert(`Site is now Live. Activation email sent to ${site.contact_email}.`);
      } else if (target === 'live') {
        alert(`Site is now Live. (Note: activation email could not be sent — check contact_email.)`);
      } else {
        alert(`Site moved to '${target}'`);
      }
      setShowPocForm(false);
      setPocName('');
      await reload();
    } catch (e) {
      alert(e?.response?.data?.detail || 'Failed to change lifecycle');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-card border border-border-light rounded-2xl p-6 max-w-xl mb-6" data-testid="site-lifecycle-panel">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs uppercase tracking-wider text-text-muted mb-2">Site Lifecycle</p>
          <div className="flex items-center gap-3">
            <span data-testid={`current-lifecycle-${status}`} className={`inline-block px-3 py-1 text-sm font-medium rounded-full border ${info.bg} ${info.text} ${info.border}`}>
              {info.label}
            </span>
          </div>
          <p className="text-sm text-text-secondary mt-3 max-w-md">{info.desc}</p>
        </div>
        {isMaster && info.next && !showPocForm && (
          <button
            data-testid={`advance-lifecycle-${info.next}-btn`}
            onClick={() => {
              if (info.next === 'live') {
                setShowPocForm(true);
              } else {
                transition(info.next);
              }
            }}
            disabled={busy}
            className="px-4 py-2 bg-primary text-white rounded-xl font-medium hover:bg-primary-hover disabled:opacity-50 text-sm"
          >
            {info.nextLabel}
          </button>
        )}
        {isMaster && status === 'live' && (
          <button
            data-testid="rollback-lifecycle-btn"
            onClick={() => transition('configured')}
            disabled={busy}
            className="px-3 py-1.5 text-xs border border-border-light rounded-lg text-text-secondary hover:bg-background disabled:opacity-50"
          >
            ← Back to Configured
          </button>
        )}
      </div>
      {isMaster && showPocForm && (
        <div className="mt-4 p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
          <p className="text-sm font-medium text-emerald-900 mb-2">Activate this site</p>
          <p className="text-xs text-emerald-800 mb-3">
            A &quot;Site Activated&quot; email will be sent to <strong>{site.contact_email || '(no contact email)'}</strong>.
            Employees from allowed domains can register starting now.
          </p>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className="text-xs text-emerald-900 block mb-1">POC name for greeting (optional)</label>
              <input
                data-testid="poc-name-input"
                value={pocName}
                onChange={(e) => setPocName(e.target.value)}
                placeholder="e.g. Anjali"
                className="w-full px-3 py-2 text-sm border border-emerald-200 rounded-lg focus:outline-none focus:border-emerald-500 bg-white"
              />
            </div>
            <button
              data-testid="confirm-go-live-btn"
              onClick={() => transition('live', pocName)}
              disabled={busy}
              className="px-4 py-2 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 disabled:opacity-50 text-sm"
            >
              {busy ? 'Activating…' : 'Confirm & Go Live'}
            </button>
            <button
              onClick={() => { setShowPocForm(false); setPocName(''); }}
              disabled={busy}
              className="px-3 py-2 text-sm border border-emerald-300 rounded-lg text-emerald-800 hover:bg-emerald-100"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const SettingsTab = ({ site, reload }) => {
  const [form, setForm] = useState({
    allow_pre_order: site.allow_pre_order,
    allow_cash_carry: site.allow_cash_carry,
    allow_company_paid: site.allow_company_paid,
    allow_employee_paid: site.allow_employee_paid,
    status: site.status || 'active',
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await axios.patch(`${API}/sites/${site.id}`, form, { withCredentials: true });
      await reload();
      alert('Settings updated');
    } catch (e) { alert(e?.response?.data?.detail || 'Failed'); }
    finally { setSaving(false); }
  };

  return (
    <div className="bg-card border border-border-light rounded-2xl p-6 max-w-xl">
      <h3 className="font-heading text-xl font-medium mb-6">Site Settings</h3>
      <div className="space-y-3 mb-6">
        {[
          { key: 'allow_pre_order', label: 'Allow Pre-order', desc: 'Employees can pre-book meals' },
          { key: 'allow_cash_carry', label: 'Allow Cash & Carry', desc: 'Walk-in payment at counter' },
          { key: 'allow_company_paid', label: 'Allow Company-paid', desc: 'Order billed to corporate account' },
          { key: 'allow_employee_paid', label: 'Allow Employee-paid', desc: 'Self-payment via Razorpay/UPI' },
        ].map((opt) => (
          <label key={opt.key} className="flex items-start justify-between gap-3 p-3 border border-border-light rounded-lg cursor-pointer hover:border-primary/40">
            <div>
              <p className="font-medium text-text-primary text-sm">{opt.label}</p>
              <p className="text-text-muted text-xs">{opt.desc}</p>
            </div>
            <input data-testid={`toggle-${opt.key}`} type="checkbox" checked={form[opt.key]} onChange={(e) => setForm({ ...form, [opt.key]: e.target.checked })} className="mt-1" />
          </label>
        ))}
      </div>
      <button data-testid="save-settings-btn" onClick={save} disabled={saving} className="px-5 py-2.5 bg-primary text-white rounded-xl font-medium hover:bg-primary-hover disabled:opacity-50">
        {saving ? 'Saving...' : 'Save Settings'}
      </button>
    </div>
  );
};

export default SiteDetail;
