import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { useParams } from 'react-router-dom';
import Navbar from '../../components/Navbar';
import { useAuth } from '../../context/AuthContext';
import { Building2, Store, Calendar, UtensilsCrossed, Settings, Plus, Trash2, Upload, ToggleLeft, ToggleRight, FileSpreadsheet, Sparkles, X, Check, Loader2, Clock, Coffee, Pencil } from 'lucide-react';
import logger from '../../lib/logger';
import ImageCropperModal from '../../components/ImageCropperModal';

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
      logger.error(e);
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
    { key: 'cafeterias', label: 'Cafeterias', icon: Coffee },
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
          {tab === 'cafeterias' && <CafeteriasTab siteId={siteId} />}
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
  const [cafeterias, setCafeterias] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [swapping, setSwapping] = useState(null); // vendor being swapped
  const [addCafeteria, setAddCafeteria] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [m, all, cafs] = await Promise.all([
        axios.get(`${API}/sites/${siteId}/vendors`, { withCredentials: true }),
        axios.get(`${API}/vendors`, { withCredentials: true }),
        axios.get(`${API}/sites/${siteId}/cafeterias`, { withCredentials: true }),
      ]);
      setMapped(m.data);
      setAllVendors(all.data);
      setCafeterias(cafs.data);
      if (!addCafeteria && cafs.data.length) {
        const def = cafs.data.find((c) => c.is_default) || cafs.data[0];
        setAddCafeteria(def.id);
      }
    } catch (e) { logger.error(e); }
    finally { setLoading(false); }
  }, [siteId, addCafeteria]);

  useEffect(() => { load(); }, [load]);

  const addVendor = async (vendorId) => {
    setAdding(true);
    try {
      await axios.post(`${API}/sites/${siteId}/vendors`, { vendor_id: vendorId, site_id: siteId, cafeteria_id: addCafeteria || null }, { withCredentials: true });
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

  const moveVendor = async (vendorId, cafeteriaId) => {
    try {
      await axios.patch(`${API}/sites/${siteId}/vendors/${vendorId}/cafeteria`, { cafeteria_id: cafeteriaId }, { withCredentials: true });
      await load();
    } catch (e) { alert(e?.response?.data?.detail || 'Move failed'); }
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
                  <span data-testid={`vendor-cafeteria-badge-${v.id}`} className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-xs font-medium">
                    <Coffee className="h-3 w-3" /> {v.cafeteria_name || 'Main Cafeteria'}
                  </span>
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
              {cafeterias.length > 1 && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-xs text-text-muted">Cafeteria:</span>
                  <select
                    data-testid={`vendor-cafeteria-select-${v.id}`}
                    value={v.cafeteria_id || ''}
                    onChange={(e) => { if (e.target.value && e.target.value !== v.cafeteria_id) moveVendor(v.id, e.target.value); }}
                    className="px-2 py-1 border border-border-light rounded-lg text-xs bg-card"
                  >
                    {cafeterias.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}{c.is_default ? ' (default)' : ''}</option>
                    ))}
                  </select>
                </div>
              )}
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
        {cafeterias.length > 1 && (
          <div className="mb-4 flex items-center gap-2">
            <span className="text-xs text-text-muted">Assign to cafeteria:</span>
            <select
              data-testid="add-vendor-cafeteria-select"
              value={addCafeteria}
              onChange={(e) => setAddCafeteria(e.target.value)}
              className="px-2 py-1 border border-border-light rounded-lg text-xs bg-card"
            >
              {cafeterias.map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.is_default ? ' (default)' : ''}</option>
              ))}
            </select>
          </div>
        )}
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

const CafeteriasTab = ({ siteId }) => {
  const [cafeterias, setCafeterias] = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null); // cafeteria being edited
  const [editName, setEditName] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API}/sites/${siteId}/cafeterias`, { withCredentials: true });
      setCafeterias(data);
    } catch (e) { logger.error(e); }
    finally { setLoading(false); }
  }, [siteId]);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      await axios.post(`${API}/sites/${siteId}/cafeterias`, { name, description }, { withCredentials: true });
      setName(''); setDescription('');
      await load();
    } catch (e) { alert(e?.response?.data?.detail || 'Failed to create'); }
    finally { setCreating(false); }
  };

  const saveEdit = async (id) => {
    try {
      await axios.patch(`${API}/cafeterias/${id}`, { name: editName }, { withCredentials: true });
      setEditing(null);
      await load();
    } catch (e) { alert(e?.response?.data?.detail || 'Failed to save'); }
  };

  const remove = async (c) => {
    if (!window.confirm(`Delete cafeteria "${c.name}"? Its vendors move back to the default cafeteria.`)) return;
    try {
      await axios.delete(`${API}/cafeterias/${c.id}`, { withCredentials: true });
      await load();
    } catch (e) { alert(e?.response?.data?.detail || 'Failed to delete'); }
  };

  if (loading) return <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto" />;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="bg-card border border-border-light rounded-2xl p-6" data-testid="cafeterias-list">
        <h3 className="font-heading text-xl font-medium mb-4">Cafeterias ({cafeterias.length})</h3>
        <p className="text-text-muted text-xs mb-4">Cafeterias group the vendors inside this site (e.g. "Tower A Food Court"). Every site has a default "Main Cafeteria".</p>
        <div className="space-y-2">
          {cafeterias.map((c) => (
            <div key={c.id} data-testid={`cafeteria-row-${c.id}`} className="p-3 bg-background rounded-lg">
              <div className="flex items-center justify-between gap-2">
                {editing === c.id ? (
                  <div className="flex items-center gap-2 flex-1">
                    <input
                      data-testid={`cafeteria-edit-input-${c.id}`}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="flex-1 px-2 py-1 border border-border-light rounded-lg text-sm bg-card"
                    />
                    <button data-testid={`cafeteria-save-${c.id}`} onClick={() => saveEdit(c.id)} className="text-emerald-600 p-1.5 rounded-lg hover:bg-emerald-50"><Check className="h-4 w-4" /></button>
                    <button onClick={() => setEditing(null)} className="text-text-muted p-1.5 rounded-lg hover:bg-background"><X className="h-4 w-4" /></button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <Coffee className="h-4 w-4 text-amber-600" />
                      <div>
                        <p className="font-medium text-text-primary text-sm flex items-center gap-2">
                          {c.name}
                          {c.is_default && <span className="px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-medium">Default</span>}
                        </p>
                        <p className="text-text-muted text-xs">{c.vendor_count} vendor{c.vendor_count === 1 ? '' : 's'}{c.description ? ` · ${c.description}` : ''}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button data-testid={`cafeteria-edit-${c.id}`} onClick={() => { setEditing(c.id); setEditName(c.name); }} className="text-text-secondary hover:bg-background p-2 rounded-lg" title="Rename"><Pencil className="h-4 w-4" /></button>
                      {!c.is_default && (
                        <button data-testid={`cafeteria-delete-${c.id}`} onClick={() => remove(c)} className="text-red-600 hover:bg-red-50 p-2 rounded-lg" title="Delete"><Trash2 className="h-4 w-4" /></button>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-card border border-border-light rounded-2xl p-6">
        <h3 className="font-heading text-xl font-medium mb-4">Add Cafeteria</h3>
        <div className="space-y-3">
          <input
            data-testid="cafeteria-name-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Cafeteria name (e.g. Tower A Food Court)"
            className="w-full px-3 py-2 border border-border-light rounded-lg text-sm bg-card"
          />
          <input
            data-testid="cafeteria-desc-input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            className="w-full px-3 py-2 border border-border-light rounded-lg text-sm bg-card"
          />
          <button
            data-testid="cafeteria-create-btn"
            onClick={create}
            disabled={creating || !name.trim()}
            className="bg-primary text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50 hover:bg-primary-hover flex items-center gap-1"
          >
            <Plus className="h-4 w-4" /> Create Cafeteria
          </button>
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
        { menu_item_id: item.id, photo_url: suggestions[selectedIdx].url },
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
  const [replaceMode, setReplaceMode] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [pendingUploads, setPendingUploads] = useState([]);
  const [versions, setVersions] = useState([]);
  const [previewDiff, setPreviewDiff] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editItems, setEditItems] = useState([]);
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [historyQuery, setHistoryQuery] = useState('');
  const [aiPhotoItem, setAiPhotoItem] = useState(null);
  const [bulkFilling, setBulkFilling] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);
  // Per-row regenerate: tracks which menu_item_id + source is currently
  // in-flight so we can disable the button + show a spinner.
  const [regenBusy, setRegenBusy] = useState({}); // { [item_id]: 'free' | 'paid' | 'upload' | 'remove' }
  const menuUploadFileRef = useRef(null);
  const [menuUploadItemId, setMenuUploadItemId] = useState(null);
  const [pendingCropFile, setPendingCropFile] = useState(null);

  const triggerMenuImageUpload = (item) => {
    if (regenBusy[item.id]) return;
    setMenuUploadItemId(item.id);
    setTimeout(() => menuUploadFileRef.current?.click(), 0);
  };

  const handleMenuImageChosen = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !menuUploadItemId) return;
    if (file.size > 5 * 1024 * 1024) { alert('Image must be under 5 MB.'); return; }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      alert('Only PNG, JPG or WEBP.');
      return;
    }
    setPendingCropFile(file);
  };

  const handleMenuCropConfirmed = async (blob) => {
    if (!menuUploadItemId) { setPendingCropFile(null); return; }
    const itemId = menuUploadItemId;
    setPendingCropFile(null);
    setRegenBusy((b) => ({ ...b, [itemId]: 'upload' }));
    try {
      const form = new FormData();
      form.append('file', blob, 'menu.jpg');
      const { data } = await axios.post(
        `${API}/menu/${itemId}/image`,
        form,
        {
          withCredentials: true,
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 60000,
        },
      );
      setItems((cur) => cur.map((it) => (it.id === itemId ? { ...it, image_url: data.image_url } : it)));
    } catch (err) {
      alert(err?.response?.data?.detail || 'Upload failed');
    } finally {
      setRegenBusy((b) => { const rest = { ...b }; delete rest[itemId]; return rest; });
      setMenuUploadItemId(null);
    }
  };

  const removeMenuPhoto = async (item) => {
    if (regenBusy[item.id]) return;
    if (!window.confirm(`Remove the photo on "${item.name}"?`)) return;
    setRegenBusy((b) => ({ ...b, [item.id]: 'remove' }));
    try {
      await axios.delete(`${API}/menu/${item.id}/image`, { withCredentials: true });
      setItems((cur) => cur.map((it) => (it.id === item.id ? { ...it, image_url: null } : it)));
    } catch (e) {
      alert(e?.response?.data?.detail || 'Remove failed');
    } finally {
      setRegenBusy((b) => { const rest = { ...b }; delete rest[item.id]; return rest; });
    }
  };

  const regenPhoto = async (item, source) => {
    if (source === 'paid' && !window.confirm(
      `Regenerate "${item.name}" using paid AI (gpt-image-1)?\n\nCost: ~₹3.50.\n\nThe current photo will be replaced.`
    )) return;
    setRegenBusy((b) => ({ ...b, [item.id]: source }));
    try {
      const { data } = await axios.post(
        `${API}/ai/menu-photos/regenerate/${item.id}`,
        { source },
        { withCredentials: true, timeout: 90000 },
      );
      // Optimistic in-place image swap so the whole table doesn't reload.
      setItems((cur) => cur.map((it) => (it.id === item.id ? { ...it, image_url: data.image_url } : it)));
    } catch (e) {
      alert(e?.response?.data?.detail || 'Regenerate failed');
    } finally {
      setRegenBusy((b) => {
        const rest = { ...b };
        delete rest[item.id];
        return rest;
      });
    }
  };

  const runBulkFill = async () => {
    const missing = items.filter((it) => !it.image_url).length;
    if (missing === 0) {
      setBulkResult({ message: '🎉 All items already have photos!' });
      return;
    }
    const cap = Math.min(missing, 20);
    if (!window.confirm(`Generate AI photos for up to ${cap} items missing images?\n\nEstimated cost: ~₹${(cap * 3.5).toFixed(0)} (charged from your AI provider balance).\n\nThis may take ~${cap * 15} seconds.`)) {
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
      try {
        const pu = await axios.get(`${API}/admin/menu-uploads?status=pending&site_id=${siteId}`, { withCredentials: true });
        setPendingUploads(pu.data);
      } catch { /* ignore */ }
    } catch (e) { logger.error(e); }
    finally { setLoading(false); }
  }, [siteId, selectedVendor]);

  useEffect(() => { load(); }, [load]);

  const loadVersions = useCallback(async () => {
    if (!selectedVendor) { setVersions([]); return; }
    try {
      const { data } = await axios.get(`${API}/sites/${siteId}/menu/versions?vendor_id=${selectedVendor}`, { withCredentials: true });
      setVersions(data);
    } catch (e) { logger.error(e); }
  }, [siteId, selectedVendor]);

  useEffect(() => { loadVersions(); }, [loadVersions]);

  const downloadTemplate = async () => {
    try {
      const res = await axios.get(`${API}/admin/menu-excel-template`, { withCredentials: true, responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url; a.download = 'cravitoo_menu_template.xlsx';
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) { setUploadMsg('✗ Could not download template'); }
  };

  const previewUpload = async () => {
    if (!file || !selectedVendor) { setUploadMsg('Choose a vendor and file to preview'); return; }
    setPreviewing(true); setPreviewDiff(null);
    try {
      const fd = new FormData(); fd.append('file', file);
      const { data } = await axios.post(`${API}/sites/${siteId}/menu/preview?vendor_id=${selectedVendor}`, fd, {
        withCredentials: true, headers: { 'Content-Type': 'multipart/form-data' },
      });
      setPreviewDiff(data);
    } catch (e) { setUploadMsg('✗ ' + (e?.response?.data?.detail || 'Preview failed')); }
    finally { setPreviewing(false); }
  };

  const restoreVersion = async (versionId) => {
    if (!window.confirm('Restore this menu snapshot? Current items will be replaced.')) return;
    try {
      const { data } = await axios.post(`${API}/sites/${siteId}/menu/versions/${versionId}/restore?vendor_id=${selectedVendor}`, {}, { withCredentials: true });
      setUploadMsg(`✓ Restored ${data.restored} item(s) from snapshot`);
      await load(); await loadVersions();
    } catch (e) { setUploadMsg('✗ ' + (e?.response?.data?.detail || 'Restore failed')); }
  };

  const approveUpload = async (id) => {
    try {
      await axios.post(`${API}/admin/menu-uploads/${id}/approve`, {}, { withCredentials: true });
      setUploadMsg('✓ Upload approved — menu is now live');
      await load(); await loadVersions();
    } catch (e) { setUploadMsg('✗ ' + (e?.response?.data?.detail || 'Approve failed')); }
  };

  const rejectUpload = async (id) => {
    const note = window.prompt('Reason for rejection (optional):') || '';
    try {
      await axios.post(`${API}/admin/menu-uploads/${id}/reject`, { note }, { withCredentials: true });
      setUploadMsg('Upload rejected');
      await load();
    } catch (e) { setUploadMsg('✗ ' + (e?.response?.data?.detail || 'Reject failed')); }
  };

  const openEdit = (p) => {
    setEditingId(p.id);
    setEditItems((p.items || []).map((it) => ({ ...it })));
  };
  const updateEditItem = (idx, field, val) => {
    setEditItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [field]: val } : it)));
  };
  const removeEditItem = (idx) => setEditItems((prev) => prev.filter((_, i) => i !== idx));
  const saveEditedItems = async (id) => {
    try {
      await axios.patch(`${API}/admin/menu-uploads/${id}/items`, { items: editItems }, { withCredentials: true });
      setUploadMsg('✓ Pending upload updated');
      setEditingId(null);
      await load();
    } catch (e) { setUploadMsg('✗ ' + (e?.response?.data?.detail || 'Save failed')); }
  };

  const loadHistory = async () => {
    try {
      const { data } = await axios.get(`${API}/admin/menu-uploads?status=decided&site_id=${siteId}`, { withCredentials: true });
      setHistory(data);
    } catch (e) { logger.error(e); }
  };
  const toggleHistory = async () => {
    const next = !showHistory;
    setShowHistory(next);
    if (next) await loadHistory();
  };
  const filteredHistory = history.filter((h) => {
    const q = historyQuery.trim().toLowerCase();
    if (!q) return true;
    return [h.vendor_name, h.file_name, h.decided_by, h.status, h.submitted_by]
      .some((v) => (v || '').toLowerCase().includes(q));
  });

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
      const mode = replaceMode ? 'replace' : 'append';
      const { data } = await axios.post(`${API}/sites/${siteId}/menu/upload-excel?vendor_id=${selectedVendor}&mode=${mode}`, fd, {
        withCredentials: true,
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const parts = [];
      if (data.removed) parts.push(`cleared ${data.removed} old`);
      if (data.inserted) parts.push(`added ${data.inserted}`);
      if (data.updated) parts.push(`updated ${data.updated}`);
      setUploadMsg(`✓ Menu ${replaceMode ? 'replaced' : 'merged'} — ${parts.join(', ') || 'no changes'}${data.errors?.length ? ` (${data.errors.length} row error(s))` : ''}`);
      setFile(null);
      await load();
    } catch (e) {
      setUploadMsg('✗ ' + (e?.response?.data?.detail || 'Upload failed'));
    } finally {
      setUploading(false);
    }
  };

  const clearMenu = async () => {
    if (!selectedVendor) { setUploadMsg('Select a vendor first to clear its menu'); return; }
    const vName = vendors.find((v) => v.id === selectedVendor)?.name || 'this vendor';
    if (!window.confirm(`Delete ALL menu items for ${vName} at this site? This cannot be undone.`)) return;
    setClearing(true);
    setUploadMsg('');
    try {
      const { data } = await axios.delete(`${API}/sites/${siteId}/menu?vendor_id=${selectedVendor}`, { withCredentials: true });
      setUploadMsg(`✓ Cleared ${data.removed} item(s). The menu is now empty across all apps.`);
      await load();
    } catch (e) {
      setUploadMsg('✗ ' + (e?.response?.data?.detail || 'Clear failed'));
    } finally {
      setClearing(false);
    }
  };

  if (loading) return <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto" />;

  return (
    <div className="space-y-6">
      {pendingCropFile && (
        <ImageCropperModal
          file={pendingCropFile}
          onConfirm={handleMenuCropConfirmed}
          onCancel={() => { setPendingCropFile(null); setMenuUploadItemId(null); }}
          testIdPrefix="sitemenu-"
        />
      )}
      {/* Hidden file input for per-row image upload */}
      <input
        ref={menuUploadFileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={handleMenuImageChosen}
        className="hidden"
        data-testid="site-menu-upload-input"
      />
      <div className="bg-card border border-border-light rounded-2xl p-6">
        <h3 className="font-heading text-xl font-medium mb-3 flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5 text-primary" /> Upload Menu via Excel
        </h3>
        <button data-testid="download-template-btn" onClick={downloadTemplate} className="text-sm text-primary font-medium hover:underline mb-3 inline-flex items-center gap-1">
          <Upload className="h-4 w-4 rotate-180" /> Download Excel template
        </button>
        <p className="text-text-muted text-xs mb-4">Required columns: <code>name, description, category, price</code>. Optional: <code>is_vegetarian, image_url, meal_periods</code> (comma-separated), <code>counter</code> (for multi-counter vendors).</p>
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
        <div className="flex flex-wrap items-center justify-between gap-3 mt-3">
          <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
            <input
              data-testid="upload-replace-toggle"
              type="checkbox"
              checked={replaceMode}
              onChange={(e) => setReplaceMode(e.target.checked)}
            />
            Replace existing menu (clears old items first — no duplicates)
          </label>
          <button
            type="button"
            data-testid="clear-menu-btn"
            onClick={clearMenu}
            disabled={clearing || !selectedVendor}
            className="flex items-center gap-2 px-3 py-2 text-sm border border-red-200 text-red-600 rounded-lg font-medium hover:bg-red-50 disabled:opacity-50"
            title="Delete all menu items for the selected vendor at this site"
          >
            <Trash2 className="h-4 w-4" /> {clearing ? 'Clearing…' : 'Clear Menu'}
          </button>
        </div>
        {!replaceMode && (
          <p className="text-text-muted text-xs mt-2">Merge mode: items with the same name are updated in place, new ones added — still no duplicates.</p>
        )}
        {uploadMsg && <p className={`mt-3 text-sm ${uploadMsg.startsWith('✓') ? 'text-emerald-600' : 'text-red-600'}`}>{uploadMsg}</p>}
        <button type="button" data-testid="preview-upload-btn" onClick={previewUpload} disabled={previewing || !file || !selectedVendor} className="mt-3 text-sm px-3 py-1.5 border border-border-light rounded-lg text-text-secondary hover:border-primary/40 disabled:opacity-50">
          {previewing ? 'Checking…' : 'Preview changes before upload'}
        </button>
        {previewDiff && (
          <div data-testid="preview-diff" className="mt-3 p-3 rounded-lg bg-slate-50 border border-border-light text-sm">
            <p className="text-text-secondary mb-2">
              File has <strong>{previewDiff.total_in_file}</strong> item(s). Current: <strong>{previewDiff.current_count}</strong>.
              {previewDiff.errors?.length ? ` (${previewDiff.errors.length} row error(s))` : ''}
            </p>
            <div className="grid grid-cols-3 gap-2">
              <div data-testid="diff-added" className="p-2 rounded bg-emerald-50 text-emerald-700"><strong>{previewDiff.added.length}</strong> added</div>
              <div data-testid="diff-updated" className="p-2 rounded bg-amber-50 text-amber-700"><strong>{previewDiff.updated.length}</strong> updated</div>
              <div data-testid="diff-removed" className="p-2 rounded bg-red-50 text-red-700"><strong>{previewDiff.removed.length}</strong> removed (replace mode)</div>
            </div>
          </div>
        )}
      </div>

      {pendingUploads.length > 0 && (
        <div className="bg-card border border-amber-200 rounded-2xl p-6" data-testid="pending-uploads-card">
          <h3 className="font-heading text-xl font-medium mb-4 flex items-center gap-2">
            <Clock className="h-5 w-5 text-amber-500" /> Vendor Menu Uploads awaiting approval ({pendingUploads.length})
          </h3>
          <div className="space-y-3">
            {pendingUploads.map((p) => (
              <div key={p.id} data-testid={`pending-upload-${p.id}`} className="p-3 border border-border-light rounded-lg">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-text-primary font-medium text-sm">{p.vendor_name} · {p.item_count} items</p>
                    <p className="text-text-muted text-xs">{p.file_name} · by {p.submitted_by}</p>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <button data-testid={`edit-upload-${p.id}`} onClick={() => (editingId === p.id ? setEditingId(null) : openEdit(p))} className="px-3 py-1.5 text-sm border border-border-light rounded-lg text-text-secondary hover:border-primary/40">{editingId === p.id ? 'Close editor' : 'Edit items'}</button>
                    <button data-testid={`approve-upload-${p.id}`} onClick={() => approveUpload(p.id)} className="px-3 py-1.5 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">Approve &amp; Publish</button>
                    <button data-testid={`reject-upload-${p.id}`} onClick={() => rejectUpload(p.id)} className="px-3 py-1.5 text-sm border border-red-200 text-red-600 rounded-lg hover:bg-red-50">Reject</button>
                  </div>
                </div>
                {editingId === p.id && (
                  <div data-testid={`edit-items-${p.id}`} className="mt-3 border-t border-border-light pt-3">
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[520px] text-sm">
                        <thead>
                          <tr className="text-left text-text-muted">
                            <th className="py-1 pr-3 font-medium">Item</th>
                            <th className="py-1 pr-3 font-medium">Price</th>
                            <th className="py-1 pr-3 font-medium">Counter</th>
                            <th className="py-1 font-medium"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {editItems.map((it, idx) => (
                            <tr key={idx} className="border-t border-border-light/60">
                              <td className="py-1.5 pr-3">
                                <input data-testid={`edit-name-${idx}`} value={it.name} onChange={(e) => updateEditItem(idx, 'name', e.target.value)} className="w-full px-2 py-1 border border-border-light rounded" />
                              </td>
                              <td className="py-1.5 pr-3">
                                <input data-testid={`edit-price-${idx}`} type="number" min="0" value={it.price} onChange={(e) => updateEditItem(idx, 'price', e.target.value)} className="w-24 px-2 py-1 border border-border-light rounded" />
                              </td>
                              <td className="py-1.5 pr-3">
                                <input data-testid={`edit-counter-${idx}`} value={it.counter || ''} onChange={(e) => updateEditItem(idx, 'counter', e.target.value)} className="w-28 px-2 py-1 border border-border-light rounded" placeholder="—" />
                              </td>
                              <td className="py-1.5">
                                <button data-testid={`edit-remove-${idx}`} onClick={() => removeEditItem(idx)} className="text-red-500 hover:text-red-700"><Trash2 className="h-4 w-4" /></button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="flex items-center gap-2 mt-3">
                      <button data-testid={`save-edit-${p.id}`} onClick={() => saveEditedItems(p.id)} disabled={editItems.length === 0} className="px-4 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary-hover disabled:opacity-50">Save changes</button>
                      <span className="text-text-muted text-xs">{editItems.length} item(s) will be published on approve</span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Approval history log */}
      <div className="bg-card border border-border-light rounded-2xl p-6" data-testid="approval-history-card">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-heading text-xl font-medium">Approval History</h3>
          <button data-testid="toggle-history-btn" onClick={toggleHistory} className="text-sm text-primary font-medium hover:underline">{showHistory ? 'Hide' : 'Show'}</button>
        </div>
        {showHistory && (
          <div className="mt-4">
            <input data-testid="history-search" value={historyQuery} onChange={(e) => setHistoryQuery(e.target.value)} placeholder="Search by vendor, file, admin or status…" className="w-full px-3 py-2 border border-border-light rounded-lg mb-3 text-sm" />
            {filteredHistory.length === 0 ? (
              <p data-testid="history-empty" className="text-text-secondary text-sm">No approval history yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="text-left text-text-muted border-b border-border-light">
                      <th className="py-2 pr-3 font-medium">When</th>
                      <th className="py-2 pr-3 font-medium">Vendor</th>
                      <th className="py-2 pr-3 font-medium">Items</th>
                      <th className="py-2 pr-3 font-medium">Decision</th>
                      <th className="py-2 pr-3 font-medium">By</th>
                      <th className="py-2 font-medium">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredHistory.map((h) => (
                      <tr key={h.id} data-testid={`history-row-${h.id}`} className="border-b border-border-light/60">
                        <td className="py-2 pr-3 text-text-secondary whitespace-nowrap">{h.decided_at ? new Date(h.decided_at).toLocaleString() : '—'}</td>
                        <td className="py-2 pr-3 text-text-primary">{h.vendor_name}</td>
                        <td className="py-2 pr-3 text-text-secondary">{h.item_count}</td>
                        <td className="py-2 pr-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${h.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{h.status}</span>
                        </td>
                        <td className="py-2 pr-3 text-text-secondary">{h.decided_by || '—'}</td>
                        <td className="py-2 text-text-muted">{h.decision_note || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {versions.length > 0 && (
        <div className="bg-card border border-border-light rounded-2xl p-6" data-testid="menu-versions-card">
          <h3 className="font-heading text-xl font-medium mb-4">Menu Version History (last {versions.length})</h3>
          <div className="space-y-2">
            {versions.map((v) => (
              <div key={v.id} data-testid={`menu-version-${v.id}`} className="flex items-center justify-between gap-3 p-3 border border-border-light rounded-lg text-sm flex-wrap">
                <span className="text-text-secondary">{new Date(v.created_at).toLocaleString()} · {v.item_count} items · {v.action}</span>
                <button data-testid={`restore-version-${v.id}`} onClick={() => restoreVersion(v.id)} className="px-3 py-1.5 text-xs border border-primary/30 text-primary rounded-lg hover:bg-primary hover:text-white">Restore</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-card border border-border-light rounded-2xl p-6">
        <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
          <h3 className="font-heading text-xl font-medium">Menu Items at this site — all vendors ({items.length})</h3>
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
                      <div className="flex flex-col gap-0.5">
                        <button
                          data-testid={`upload-photo-btn-${it.id}`}
                          onClick={() => triggerMenuImageUpload(it)}
                          disabled={!!regenBusy[it.id]}
                          className="text-[11px] text-sky-700 hover:text-sky-900 flex items-center gap-1 disabled:opacity-50"
                          title={it.image_url ? 'Upload a new photo from your device' : 'Upload a photo from your device'}
                        >
                          {regenBusy[it.id] === 'upload'
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <Upload className="h-3 w-3" />}
                          Upload
                        </button>
                        <button
                          data-testid={`regen-free-btn-${it.id}`}
                          onClick={() => regenPhoto(it, 'free')}
                          disabled={!!regenBusy[it.id]}
                          className="text-[11px] text-emerald-700 hover:text-emerald-900 flex items-center gap-1 disabled:opacity-50"
                          title={it.image_url ? 'Regenerate this photo automatically' : 'Auto-generate a photo based on the item name'}
                        >
                          {regenBusy[it.id] === 'free'
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <Sparkles className="h-3 w-3" />}
                          {it.image_url ? 'Regenerate' : 'Generate'}
                        </button>
                        {it.image_url && (
                          <button
                            data-testid={`remove-photo-btn-${it.id}`}
                            onClick={() => removeMenuPhoto(it)}
                            disabled={!!regenBusy[it.id]}
                            className="text-[11px] text-red-700 hover:text-red-900 flex items-center gap-1 disabled:opacity-50"
                            title="Remove the current photo"
                          >
                            {regenBusy[it.id] === 'remove'
                              ? <Loader2 className="h-3 w-3 animate-spin" />
                              : <Trash2 className="h-3 w-3" />}
                            Remove
                          </button>
                        )}
                      </div>
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
      } catch (e) { logger.error(e); }
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

const MEAL_PRICE_FIELDS = [
  { key: 'veg_meal', label: 'Veg Meal', def: 120 },
  { key: 'non_veg_meal', label: 'Non-Veg Meal', def: 150 },
  { key: 'veg_salad', label: 'Veg Salad', def: 100 },
  { key: 'non_veg_salad', label: 'Non-Veg Salad', def: 130 },
];

const SettingsTab = ({ site, reload }) => {
  const [form, setForm] = useState({
    allow_pre_order: site.allow_pre_order,
    allow_cash_carry: site.allow_cash_carry,
    allow_company_paid: site.allow_company_paid,
    allow_employee_paid: site.allow_employee_paid,
    status: site.status || 'active',
  });
  const [saving, setSaving] = useState(false);

  const [mealPrices, setMealPrices] = useState(() => {
    const mp = site.meal_prices || {};
    const out = {};
    MEAL_PRICE_FIELDS.forEach((f) => { out[f.key] = mp[f.key] ?? f.def; });
    return out;
  });
  const [savingPrices, setSavingPrices] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await axios.patch(`${API}/sites/${site.id}`, form, { withCredentials: true });
      await reload();
      alert('Settings updated');
    } catch (e) { alert(e?.response?.data?.detail || 'Failed'); }
    finally { setSaving(false); }
  };

  const savePrices = async () => {
    setSavingPrices(true);
    try {
      const payload = {};
      MEAL_PRICE_FIELDS.forEach((f) => { payload[f.key] = Number(mealPrices[f.key]) || 0; });
      await axios.patch(`${API}/sites/${site.id}`, { meal_prices: payload }, { withCredentials: true });
      await reload();
      alert('Meal prices updated');
    } catch (e) { alert(e?.response?.data?.detail || 'Failed'); }
    finally { setSavingPrices(false); }
  };

  return (
    <div className="space-y-6">
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

    <div className="bg-card border border-border-light rounded-2xl p-6 max-w-xl" data-testid="meal-prices-panel">
      <h3 className="font-heading text-xl font-medium mb-1">Meal Prices</h3>
      <p className="text-text-muted text-sm mb-5">Per-meal-type prices (INR) used for this site's monthly billing. Leave defaults if unsure.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        {MEAL_PRICE_FIELDS.map((f) => (
          <div key={f.key}>
            <label className="block text-sm font-medium text-text-secondary mb-1">{f.label}</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">₹</span>
              <input
                data-testid={`meal-price-${f.key}`}
                type="number" min="0" step="1"
                value={mealPrices[f.key]}
                onChange={(e) => setMealPrices({ ...mealPrices, [f.key]: e.target.value })}
                className="w-full pl-7 pr-3 py-2.5 border border-border-light rounded-xl focus:border-primary focus:ring-1 focus:ring-primary outline-none"
              />
            </div>
          </div>
        ))}
      </div>
      <button data-testid="save-meal-prices-btn" onClick={savePrices} disabled={savingPrices} className="px-5 py-2.5 bg-primary text-white rounded-xl font-medium hover:bg-primary-hover disabled:opacity-50">
        {savingPrices ? 'Saving...' : 'Save Meal Prices'}
      </button>
    </div>
    </div>
  );
};

export default SiteDetail;
