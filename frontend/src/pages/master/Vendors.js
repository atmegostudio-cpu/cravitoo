import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Navbar from '../../components/Navbar';
import { Store, Percent, Edit, Save, X, Plus } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const MasterVendors = () => {
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [pct, setPct] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const { data } = await axios.get(`${API}/vendors`, { withCredentials: true });
      setVendors(data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const save = async (vendorId) => {
    const v = parseFloat(pct);
    if (isNaN(v) || v < 0 || v > 50) {
      alert('Commission must be between 0 and 50');
      return;
    }
    setSaving(true);
    try {
      await axios.patch(`${API}/admin/vendors/${vendorId}/commission`,
        { commission_pct: v }, { withCredentials: true });
      setEditing(null);
      await load();
    } catch (e) {
      alert(e?.response?.data?.detail || 'Failed');
    } finally {
      setSaving(false);
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
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex justify-between items-center mb-8 flex-wrap gap-4">
            <div>
              <h1 className="font-heading text-4xl sm:text-5xl tracking-tighter font-semibold text-text-primary">Vendors</h1>
              <p className="text-text-secondary mt-2">Manage platform vendors & commission rates</p>
            </div>
          </div>

          <div className="bg-card border border-border-light rounded-2xl overflow-hidden">
            <table className="w-full">
              <thead className="bg-background">
                <tr className="text-left text-xs text-text-muted uppercase">
                  <th className="px-4 py-3">Vendor</th>
                  <th className="px-4 py-3">Cuisine</th>
                  <th className="px-4 py-3">Rating</th>
                  <th className="px-4 py-3">Commission %</th>
                </tr>
              </thead>
              <tbody>
                {vendors.map((v) => (
                  <tr key={v.id} data-testid={`vendor-row-${v.id}`} className="border-t border-border-light/50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="bg-primary-light rounded-lg p-2">
                          <Store className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                          <p className="font-medium text-text-primary text-sm">{v.name}</p>
                          <p className="text-text-muted text-xs truncate max-w-xs">{v.description || ''}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-text-secondary">{v.cuisine_type || '—'}</td>
                    <td className="px-4 py-3 text-sm text-text-secondary">
                      {v.rating ? `${v.rating.toFixed(1)} ⭐` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {editing === v.id ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            value={pct}
                            onChange={(e) => setPct(e.target.value)}
                            className="w-20 px-2 py-1 border border-border-light rounded text-sm"
                            min="0"
                            max="50"
                            step="0.5"
                            data-testid={`commission-input-${v.id}`}
                          />
                          <button
                            onClick={() => save(v.id)}
                            disabled={saving}
                            data-testid={`save-commission-${v.id}`}
                            className="text-emerald-600 hover:bg-emerald-50 p-1.5 rounded"
                          >
                            <Save className="h-4 w-4" />
                          </button>
                          <button onClick={() => setEditing(null)} className="text-text-muted hover:bg-background p-1.5 rounded">
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-text-primary">{(v.commission_pct ?? 15).toFixed(1)}%</span>
                          <button
                            onClick={() => { setEditing(v.id); setPct(String(v.commission_pct ?? 15)); }}
                            data-testid={`edit-commission-${v.id}`}
                            className="text-primary hover:bg-primary-light p-1.5 rounded"
                          >
                            <Edit className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {vendors.length === 0 && (
              <div className="p-12 text-center">
                <Store className="h-10 w-10 text-text-muted mx-auto mb-3" />
                <p className="text-text-secondary">No vendors yet.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default MasterVendors;
