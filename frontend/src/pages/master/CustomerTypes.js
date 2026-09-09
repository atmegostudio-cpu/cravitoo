import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import Navbar from '../../components/Navbar';
import { Users, Plus, Pencil, Trash2, Check, X, Loader2 } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const MasterCustomerTypes = () => {
  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editName, setEditName] = useState('');

  const fetchTypes = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/customer-types`, { withCredentials: true });
      setTypes(data);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTypes(); }, [fetchTypes]);

  const add = async () => {
    const name = newName.trim();
    if (!name) return;
    setAdding(true);
    try {
      await axios.post(`${API}/admin/customer-types`, { name }, { withCredentials: true });
      setNewName('');
      await fetchTypes();
    } catch (e) {
      alert(e?.response?.data?.detail || 'Could not add');
    } finally {
      setAdding(false);
    }
  };

  const saveRename = async (id) => {
    const name = editName.trim();
    if (!name) return;
    try {
      await axios.patch(`${API}/admin/customer-types/${id}`, { name }, { withCredentials: true });
      setEditId(null); setEditName('');
      await fetchTypes();
    } catch (e) {
      alert(e?.response?.data?.detail || 'Could not rename');
    }
  };

  const remove = async (id, name) => {
    if (!window.confirm(`Remove "${name}"? Vendors will no longer see it for new manual orders.`)) return;
    try {
      await axios.delete(`${API}/admin/customer-types/${id}`, { withCredentials: true });
      await fetchTypes();
    } catch (e) {
      alert(e?.response?.data?.detail || 'Could not remove');
    }
  };

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-background">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8" data-testid="customer-types-page">
          <div className="flex items-center gap-3 mb-2">
            <Users className="h-6 w-6 text-primary" />
            <h1 className="font-heading text-2xl font-bold text-text-primary">Customer Types</h1>
          </div>
          <p className="text-sm text-text-secondary mb-6">
            Used by vendors when punching a manual order for non-corporate customers (Guest, Housekeeping, etc.).
          </p>

          <div className="bg-card border border-border-light rounded-2xl p-4 sm:p-5 mb-6">
            <div className="flex items-center gap-2">
              <input
                data-testid="customer-type-new-input"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && add()}
                placeholder="Add a customer type (e.g. Interns)"
                className="flex-1 bg-background border border-border-light rounded-xl px-4 py-2.5 text-sm text-text-primary focus:outline-none focus:border-primary/50"
              />
              <button
                data-testid="customer-type-add-btn"
                onClick={add}
                disabled={adding || !newName.trim()}
                className="flex items-center gap-2 bg-primary text-white px-4 py-2.5 rounded-xl font-medium disabled:opacity-50 hover:bg-primary/90 transition-colors"
              >
                {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add
              </button>
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
          ) : (
            <div className="space-y-2" data-testid="customer-types-list">
              {types.length === 0 ? (
                <div className="text-center text-text-muted py-10">No customer types yet.</div>
              ) : types.map((t) => (
                <div key={t.id} data-testid={`customer-type-row-${t.id}`}
                     className="bg-card border border-border-light rounded-xl px-4 py-3 flex items-center justify-between gap-3">
                  {editId === t.id ? (
                    <>
                      <input
                        data-testid="customer-type-edit-input"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && saveRename(t.id)}
                        className="flex-1 bg-background border border-border-light rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50"
                        autoFocus
                      />
                      <button data-testid="customer-type-save-btn" onClick={() => saveRename(t.id)}
                              className="p-2 rounded-lg text-green-600 hover:bg-green-50"><Check className="h-4 w-4" /></button>
                      <button onClick={() => { setEditId(null); setEditName(''); }}
                              className="p-2 rounded-lg text-text-muted hover:bg-background"><X className="h-4 w-4" /></button>
                    </>
                  ) : (
                    <>
                      <span className="text-sm font-medium text-text-primary">{t.name}</span>
                      <div className="flex items-center gap-1">
                        <button data-testid={`customer-type-edit-${t.id}`}
                                onClick={() => { setEditId(t.id); setEditName(t.name); }}
                                className="p-2 rounded-lg text-text-muted hover:text-primary hover:bg-background"><Pencil className="h-4 w-4" /></button>
                        <button data-testid={`customer-type-delete-${t.id}`}
                                onClick={() => remove(t.id, t.name)}
                                className="p-2 rounded-lg text-text-muted hover:text-red-500 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default MasterCustomerTypes;
