import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import Navbar from '../../components/Navbar';
import { Plus, X, Edit3, Trash2, Clock, CheckCircle, XCircle, Send, Image as ImageIcon, MessageSquare, Upload } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const STATUS_STYLES = {
  pending: { icon: Clock, bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', label: 'Pending review' },
  approved: { icon: CheckCircle, bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200', label: 'Approved' },
  rejected: { icon: XCircle, bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', label: 'Rejected' },
  cancelled: { icon: X, bg: 'bg-gray-50', text: 'text-gray-700', border: 'border-gray-200', label: 'Cancelled' },
};

const VendorMenuRequests = () => {
  const [requests, setRequests] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [requestType, setRequestType] = useState('add');
  const [selectedItemId, setSelectedItemId] = useState('');
  const [formData, setFormData] = useState({
    name: '', description: '', category: '', price: '', image_url: '', is_vegetarian: false, reason: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [photoFile, setPhotoFile] = useState(null);
  const fileInputRef = useRef(null);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [reqRes, menuRes] = await Promise.all([
        axios.get(`${API}/menu-change-requests`, { withCredentials: true }),
        axios.get(`${API}/menu/vendor/all`, { withCredentials: true }),
      ]);
      setRequests(reqRes.data);
      setMenuItems(menuRes.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  const resetForm = () => {
    setRequestType('add');
    setSelectedItemId('');
    setFormData({ name: '', description: '', category: '', price: '', image_url: '', is_vegetarian: false, reason: '' });
    setSubmitError('');
  };

  const handleTypeChange = (newType) => {
    setRequestType(newType);
    setSelectedItemId('');
    setFormData({ name: '', description: '', category: '', price: '', image_url: '', is_vegetarian: false, reason: '' });
    setSubmitError('');
  };

  const handleItemSelect = (itemId) => {
    setSelectedItemId(itemId);
    const item = menuItems.find((i) => i.id === itemId);
    if (item && requestType === 'edit') {
      setFormData({
        name: item.name || '',
        description: item.description || '',
        category: item.category || '',
        price: item.price?.toString() || '',
        image_url: item.image_url || '',
        is_vegetarian: !!item.is_vegetarian,
        reason: '',
      });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError('');
    try {
      const payload = { request_type: requestType, reason: formData.reason || null };
      if (requestType === 'add') {
        Object.assign(payload, {
          name: formData.name,
          description: formData.description,
          category: formData.category,
          price: parseFloat(formData.price),
          image_url: formData.image_url || null,
          is_vegetarian: formData.is_vegetarian,
        });
      } else if (requestType === 'edit') {
        payload.item_id = selectedItemId;
        // Only include fields that changed
        const item = menuItems.find((i) => i.id === selectedItemId);
        if (item) {
          if (formData.name !== item.name) payload.name = formData.name;
          if (formData.description !== item.description) payload.description = formData.description;
          if (parseFloat(formData.price) !== item.price) payload.price = parseFloat(formData.price);
          if (formData.image_url !== (item.image_url || '')) payload.image_url = formData.image_url || null;
          if (formData.is_vegetarian !== !!item.is_vegetarian) payload.is_vegetarian = formData.is_vegetarian;
        }
      } else if (requestType === 'remove') {
        payload.item_id = selectedItemId;
      }
      const { data: created } = await axios.post(`${API}/menu-change-requests`, payload, { withCredentials: true });
      // Upload attached photo (if any) — best-effort, doesn't roll back the request on failure
      if (photoFile && created?.id) {
        try {
          const fd = new FormData();
          fd.append('file', photoFile);
          await axios.post(`${API}/menu-change-requests/${created.id}/upload-photo`, fd, {
            withCredentials: true,
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: 60000,
          });
        } catch (upErr) {
          // Note: don't block the user — request was created, photo upload can be retried later
          console.warn('Photo upload failed:', upErr);
        }
      }
      setShowForm(false);
      resetForm();
      setPhotoFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      fetchAll();
    } catch (e) {
      setSubmitError(e.response?.data?.detail || 'Failed to submit request');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (id) => {
    if (!window.confirm('Cancel this menu change request?')) return;
    try {
      await axios.delete(`${API}/menu-change-requests/${id}`, { withCredentials: true });
      fetchAll();
    } catch (e) {
      alert(e.response?.data?.detail || 'Cancel failed');
    }
  };

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

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-background">
        <div className="max-w-6xl mx-auto px-6 py-8">
          <div className="flex justify-between items-start mb-8 flex-wrap gap-4">
            <div>
              <h1 className="font-heading text-4xl sm:text-5xl tracking-tighter font-semibold text-text-primary">
                Menu Change Requests
              </h1>
              <p className="text-text-secondary mt-2">Submit menu, price, or description changes for Cravitoo approval</p>
            </div>
            <button
              onClick={() => setShowForm(true)}
              data-testid="new-menu-request-btn"
              className="bg-primary hover:bg-primary-hover text-white px-5 py-2.5 rounded-lg font-medium transition-all duration-200 flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              <span>New Request</span>
            </button>
          </div>

          {/* How it works banner */}
          <div className="bg-primary-light border border-primary/20 rounded-2xl p-5 mb-6 flex items-start space-x-3">
            <MessageSquare className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
            <div className="text-sm text-text-secondary">
              <strong className="text-text-primary">How it works:</strong> Submit your request, Cravitoo reviews it within 24-48 hours.
              Description changes and item removals can be approved by your Site Admin.
              New items and price changes require Master Admin approval.
            </div>
          </div>

          {/* Requests list */}
          {requests.length === 0 ? (
            <div data-testid="empty-state" className="bg-card border border-border-light rounded-2xl p-12 text-center">
              <MessageSquare className="h-12 w-12 text-text-muted mx-auto mb-3" />
              <p className="text-text-secondary mb-2 font-medium">No menu change requests yet</p>
              <p className="text-sm text-text-muted">Submit one to add, edit, or remove menu items.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {requests.map((r) => {
                const S = STATUS_STYLES[r.status] || STATUS_STYLES.pending;
                const Icon = S.icon;
                const TypeIcon = r.request_type === 'add' ? Plus : r.request_type === 'edit' ? Edit3 : Trash2;
                return (
                  <div key={r.id} data-testid={`request-${r.id}`} className="bg-card border border-border-light rounded-2xl p-5 hover:shadow-md transition-shadow">
                    <div className="flex justify-between items-start mb-3 flex-wrap gap-2">
                      <div className="flex items-center gap-3">
                        <div className="bg-background rounded-xl p-2.5">
                          <TypeIcon className="h-5 w-5 text-text-primary" />
                        </div>
                        <div>
                          <p className="font-heading text-lg font-semibold text-text-primary capitalize">{r.request_type} request</p>
                          <p className="text-xs text-text-muted">Submitted {new Date(r.created_at).toLocaleString()}</p>
                        </div>
                      </div>
                      <div className={`${S.bg} ${S.text} ${S.border} border rounded-lg px-3 py-1.5 flex items-center gap-1.5 text-xs font-medium`}>
                        <Icon className="h-3.5 w-3.5" />
                        {S.label}
                      </div>
                    </div>

                    {/* Body — diff/preview */}
                    {r.request_type === 'add' && (
                      <div className="bg-background rounded-lg p-3 text-sm">
                        <p className="font-semibold text-text-primary">{r.proposed?.name}</p>
                        <p className="text-text-secondary text-xs mt-1">{r.proposed?.description}</p>
                        <div className="flex gap-4 mt-2 text-xs text-text-secondary">
                          <span>₹{r.proposed?.price}</span>
                          <span>{r.proposed?.category}</span>
                          {r.proposed?.is_vegetarian && <span className="text-green-600">Vegetarian</span>}
                        </div>
                      </div>
                    )}

                    {r.request_type === 'edit' && r.existing_snapshot && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="bg-background rounded-lg p-3 text-sm">
                          <p className="text-xs text-text-muted mb-1.5">CURRENT</p>
                          <p className="font-medium text-text-primary">{r.existing_snapshot.name}</p>
                          <p className="text-xs text-text-secondary mt-1 line-clamp-2">{r.existing_snapshot.description}</p>
                          <p className="text-xs text-text-secondary mt-1">₹{r.existing_snapshot.price}</p>
                        </div>
                        <div className="bg-primary-light rounded-lg p-3 text-sm border border-primary/20">
                          <p className="text-xs text-primary mb-1.5 font-semibold">PROPOSED</p>
                          <p className="font-medium text-text-primary">{r.proposed.name || r.existing_snapshot.name}</p>
                          <p className="text-xs text-text-secondary mt-1 line-clamp-2">{r.proposed.description || r.existing_snapshot.description}</p>
                          <p className="text-xs text-text-secondary mt-1">₹{r.proposed.price ?? r.existing_snapshot.price}</p>
                        </div>
                      </div>
                    )}

                    {r.request_type === 'remove' && r.existing_snapshot && (
                      <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm">
                        <p className="text-xs text-red-600 mb-1.5 font-semibold">TO BE REMOVED</p>
                        <p className="font-medium text-text-primary line-through">{r.existing_snapshot.name}</p>
                        <p className="text-xs text-text-secondary mt-1">₹{r.existing_snapshot.price}</p>
                      </div>
                    )}

                    {r.reason && (
                      <p className="text-xs text-text-secondary mt-3 italic">"{r.reason}"</p>
                    )}

                    {r.status === 'pending' && (
                      <div className="mt-4 flex justify-end">
                        <button
                          onClick={() => handleCancel(r.id)}
                          data-testid={`cancel-${r.id}`}
                          className="text-xs text-text-secondary hover:text-red-600 transition-colors"
                        >
                          Cancel request
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* New Request Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-card w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-card border-b border-border-light px-6 py-4 flex justify-between items-center">
              <h2 className="font-heading text-xl font-semibold text-text-primary">New Menu Change Request</h2>
              <button onClick={() => { setShowForm(false); resetForm(); }} data-testid="close-form-btn">
                <X className="h-5 w-5 text-text-muted hover:text-text-primary" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              {/* Type selector */}
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">Request type</label>
                <div className="grid grid-cols-3 gap-2">
                  {['add', 'edit', 'remove'].map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => handleTypeChange(t)}
                      data-testid={`type-${t}`}
                      className={`py-3 rounded-lg border text-sm font-medium capitalize transition-all ${requestType === t ? 'bg-primary-light border-primary text-primary' : 'bg-background border-border-light text-text-secondary hover:border-primary/40'}`}
                    >
                      {t === 'add' ? 'Add new' : t}
                    </button>
                  ))}
                </div>
              </div>

              {/* For edit/remove — item picker */}
              {(requestType === 'edit' || requestType === 'remove') && (
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">Select menu item</label>
                  <select
                    value={selectedItemId}
                    onChange={(e) => handleItemSelect(e.target.value)}
                    required
                    data-testid="item-select"
                    className="w-full px-3 py-2.5 border border-border-light rounded-lg bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  >
                    <option value="">Choose an item...</option>
                    {menuItems.map((i) => (
                      <option key={i.id} value={i.id}>{i.name} — ₹{i.price}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Fields for add and edit */}
              {requestType !== 'remove' && (selectedItemId || requestType === 'add') && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-text-primary mb-2">Name {requestType === 'add' && '*'}</label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      required={requestType === 'add'}
                      data-testid="name-input"
                      className="w-full px-3 py-2.5 border border-border-light rounded-lg bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-text-primary mb-2">Description {requestType === 'add' && '*'}</label>
                    <textarea
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      required={requestType === 'add'}
                      rows={3}
                      data-testid="description-input"
                      className="w-full px-3 py-2.5 border border-border-light rounded-lg bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-text-primary mb-2">Category {requestType === 'add' && '*'}</label>
                      <input
                        type="text"
                        value={formData.category}
                        onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                        required={requestType === 'add'}
                        placeholder="e.g. Main Course"
                        data-testid="category-input"
                        className="w-full px-3 py-2.5 border border-border-light rounded-lg bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-text-primary mb-2">Price (₹) {requestType === 'add' && '*'}</label>
                      <input
                        type="number" min="0" step="0.01"
                        value={formData.price}
                        onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                        required={requestType === 'add'}
                        data-testid="price-input"
                        className="w-full px-3 py-2.5 border border-border-light rounded-lg bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-text-primary mb-2">Photo URL (optional)</label>
                    <div className="relative">
                      <ImageIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" />
                      <input
                        type="url"
                        value={formData.image_url}
                        onChange={(e) => setFormData({ ...formData, image_url: e.target.value })}
                        placeholder="https://..."
                        data-testid="image-url-input"
                        className="w-full pl-9 pr-3 py-2.5 border border-border-light rounded-lg bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary"
                      />
                    </div>
                    <p className="text-xs text-text-muted mt-1">Public image URL. Cravitoo may replace it with a professional photo on approval.</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-text-primary mb-2">Or upload a photo (optional)</label>
                    <div className="flex items-center gap-3">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/jpg,image/webp"
                        onChange={(e) => setPhotoFile(e.target.files?.[0] || null)}
                        data-testid="photo-file-input"
                        className="hidden"
                        id="mcr-photo-input"
                      />
                      <label
                        htmlFor="mcr-photo-input"
                        className="px-3 py-2 text-sm bg-background border border-dashed border-border-light rounded-lg cursor-pointer hover:border-primary hover:text-primary flex items-center gap-2"
                      >
                        <Upload className="h-4 w-4" />
                        {photoFile ? 'Change photo' : 'Choose file (PNG/JPG, ≤5MB)'}
                      </label>
                      {photoFile && (
                        <span data-testid="photo-file-name" className="text-xs text-text-muted truncate max-w-[200px]">
                          {photoFile.name} ({(photoFile.size / 1024).toFixed(0)} KB)
                        </span>
                      )}
                      {photoFile && (
                        <button
                          type="button"
                          onClick={() => {
                            setPhotoFile(null);
                            if (fileInputRef.current) fileInputRef.current.value = '';
                          }}
                          className="text-xs text-red-600 hover:text-red-700"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-text-muted mt-1">Uploaded directly to Cravitoo's servers — no URL needed.</p>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.is_vegetarian}
                      onChange={(e) => setFormData({ ...formData, is_vegetarian: e.target.checked })}
                      data-testid="veg-checkbox"
                      className="w-4 h-4 rounded border-border-light accent-primary"
                    />
                    <span className="text-sm text-text-primary">Vegetarian</span>
                  </label>
                </>
              )}

              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">
                  Reason / context for Cravitoo {requestType === 'remove' && '*'}
                </label>
                <textarea
                  value={formData.reason}
                  onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                  rows={2}
                  required={requestType === 'remove'}
                  placeholder={requestType === 'remove' ? 'e.g. Discontinued by kitchen / low demand' : 'Help Cravitoo understand the change (optional)'}
                  data-testid="reason-input"
                  className="w-full px-3 py-2.5 border border-border-light rounded-lg bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
              </div>

              {submitError && (
                <div data-testid="submit-error" className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{submitError}</div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowForm(false); resetForm(); }}
                  className="px-5 py-2.5 rounded-lg border border-border-light text-text-secondary hover:bg-background transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  data-testid="submit-request-btn"
                  className="bg-primary hover:bg-primary-hover text-white px-5 py-2.5 rounded-lg font-medium transition-colors flex items-center gap-2 disabled:opacity-50"
                >
                  <Send className="h-4 w-4" />
                  <span>{submitting ? 'Submitting...' : 'Submit Request'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};

export default VendorMenuRequests;
