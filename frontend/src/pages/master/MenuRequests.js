import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Navbar from '../../components/Navbar';
import { Check, X, Clock, CheckCircle, XCircle, Plus, Edit3, Trash2, Filter, Store, Loader2 } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const STATUS_STYLES = {
  pending: { icon: Clock, bg: 'bg-amber-50', text: 'text-amber-700', label: 'Pending' },
  approved: { icon: CheckCircle, bg: 'bg-green-50', text: 'text-green-700', label: 'Approved' },
  rejected: { icon: XCircle, bg: 'bg-red-50', text: 'text-red-700', label: 'Rejected' },
  cancelled: { icon: X, bg: 'bg-gray-50', text: 'text-gray-700', label: 'Cancelled' },
};

const AdminMenuRequests = () => {
  const [requests, setRequests] = useState([]);
  const [filter, setFilter] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [decidingId, setDecidingId] = useState(null);
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectRemarks, setRejectRemarks] = useState('');

  const fetchRequests = async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API}/menu-change-requests?status=${filter}`, { withCredentials: true });
      setRequests(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchRequests(); }, [filter]);

  const handleApprove = async (id) => {
    setDecidingId(id);
    try {
      await axios.post(`${API}/menu-change-requests/${id}/decision`, {
        decision: 'approve', auto_apply: true,
      }, { withCredentials: true });
      fetchRequests();
    } catch (e) {
      alert(e.response?.data?.detail || 'Approve failed');
    } finally {
      setDecidingId(null);
    }
  };

  const handleReject = async () => {
    if (!rejectingId) return;
    setDecidingId(rejectingId);
    try {
      await axios.post(`${API}/menu-change-requests/${rejectingId}/decision`, {
        decision: 'reject', remarks: rejectRemarks || null,
      }, { withCredentials: true });
      setRejectingId(null);
      setRejectRemarks('');
      fetchRequests();
    } catch (e) {
      alert(e.response?.data?.detail || 'Reject failed');
    } finally {
      setDecidingId(null);
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
          <div className="mb-8">
            <h1 className="font-heading text-4xl sm:text-5xl tracking-tighter font-semibold text-text-primary">
              Menu Change Requests
            </h1>
            <p className="text-text-secondary mt-2">Review and approve menu changes submitted by vendors</p>
          </div>

          {/* Filter pills */}
          <div className="flex items-center gap-2 mb-6 flex-wrap">
            <Filter className="h-4 w-4 text-text-muted" />
            {['pending', 'approved', 'rejected', 'all'].map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                data-testid={`filter-${f}`}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${filter === f ? 'bg-primary text-white' : 'bg-card border border-border-light text-text-secondary hover:border-primary/40'}`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>

          {requests.length === 0 ? (
            <div data-testid="empty-state" className="bg-card border border-border-light rounded-2xl p-12 text-center">
              <CheckCircle className="h-12 w-12 text-text-muted mx-auto mb-3" />
              <p className="text-text-secondary font-medium">No {filter !== 'all' ? filter : ''} requests right now</p>
              <p className="text-sm text-text-muted mt-1">When vendors submit menu changes, they'll appear here for review.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {requests.map((r) => {
                const S = STATUS_STYLES[r.status] || STATUS_STYLES.pending;
                const StatusIcon = S.icon;
                const TypeIcon = r.request_type === 'add' ? Plus : r.request_type === 'edit' ? Edit3 : Trash2;
                const isDeciding = decidingId === r.id;

                return (
                  <div key={r.id} data-testid={`admin-request-${r.id}`} className="bg-card border border-border-light rounded-2xl p-5">
                    <div className="flex justify-between items-start mb-3 flex-wrap gap-2">
                      <div className="flex items-center gap-3">
                        <div className="bg-background rounded-xl p-2.5">
                          <TypeIcon className="h-5 w-5 text-text-primary" />
                        </div>
                        <div>
                          <p className="font-heading text-lg font-semibold text-text-primary capitalize">{r.request_type} request</p>
                          <div className="flex items-center gap-2 text-xs text-text-muted">
                            <Store className="h-3 w-3" />
                            <span>{r.vendor_name}</span>
                            <span>•</span>
                            <span>{new Date(r.created_at).toLocaleString()}</span>
                          </div>
                        </div>
                      </div>
                      <div className={`${S.bg} ${S.text} rounded-lg px-3 py-1.5 flex items-center gap-1.5 text-xs font-medium`}>
                        <StatusIcon className="h-3.5 w-3.5" />
                        {S.label}
                      </div>
                    </div>

                    {/* Diff view */}
                    {r.request_type === 'add' && (
                      <div className="bg-primary-light border border-primary/20 rounded-lg p-3 text-sm">
                        <p className="text-xs text-primary mb-1.5 font-semibold">NEW ITEM</p>
                        <p className="font-medium text-text-primary">{r.proposed?.name}</p>
                        <p className="text-xs text-text-secondary mt-1">{r.proposed?.description}</p>
                        <div className="flex gap-4 mt-2 text-xs text-text-secondary">
                          <span><strong>₹{r.proposed?.price}</strong></span>
                          <span>{r.proposed?.category}</span>
                          {r.proposed?.is_vegetarian && <span className="text-green-600">Vegetarian</span>}
                        </div>
                        {r.proposed?.image_url && (
                          <img src={r.proposed.image_url} alt={r.proposed.name} className="mt-2 h-24 w-24 object-cover rounded-lg" onError={(e) => { e.target.style.display = 'none'; }} />
                        )}
                      </div>
                    )}

                    {r.request_type === 'edit' && r.existing_snapshot && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="bg-background rounded-lg p-3 text-sm">
                          <p className="text-xs text-text-muted mb-1.5 font-semibold">CURRENT</p>
                          <p className="font-medium text-text-primary">{r.existing_snapshot.name}</p>
                          <p className="text-xs text-text-secondary mt-1 line-clamp-2">{r.existing_snapshot.description}</p>
                          <p className="text-xs text-text-secondary mt-1">₹{r.existing_snapshot.price}</p>
                        </div>
                        <div className="bg-primary-light rounded-lg p-3 text-sm border border-primary/20">
                          <p className="text-xs text-primary mb-1.5 font-semibold">PROPOSED</p>
                          <p className="font-medium text-text-primary">{r.proposed.name || r.existing_snapshot.name}</p>
                          <p className="text-xs text-text-secondary mt-1 line-clamp-2">{r.proposed.description || r.existing_snapshot.description}</p>
                          <p className="text-xs text-text-secondary mt-1">
                            ₹{r.proposed.price ?? r.existing_snapshot.price}
                            {r.proposed.price != null && r.proposed.price !== r.existing_snapshot.price && (
                              <span className="ml-2 text-amber-600 font-semibold">(price change)</span>
                            )}
                          </p>
                        </div>
                      </div>
                    )}

                    {r.request_type === 'remove' && r.existing_snapshot && (
                      <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm">
                        <p className="text-xs text-red-600 mb-1.5 font-semibold">REMOVE</p>
                        <p className="font-medium text-text-primary line-through">{r.existing_snapshot.name}</p>
                        <p className="text-xs text-text-secondary mt-1">{r.existing_snapshot.description}</p>
                        <p className="text-xs text-text-secondary mt-1">₹{r.existing_snapshot.price}</p>
                      </div>
                    )}

                    {r.reason && (
                      <div className="mt-3 bg-background rounded-lg p-3">
                        <p className="text-xs text-text-muted">Vendor's note:</p>
                        <p className="text-sm text-text-primary italic">"{r.reason}"</p>
                      </div>
                    )}

                    {/* Decision actions */}
                    {r.status === 'pending' && (
                      <div className="mt-4 flex justify-end gap-2">
                        <button
                          onClick={() => setRejectingId(r.id)}
                          disabled={isDeciding}
                          data-testid={`reject-${r.id}`}
                          className="px-4 py-2 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 text-sm font-medium flex items-center gap-1.5 disabled:opacity-50"
                        >
                          <X className="h-4 w-4" /> Reject
                        </button>
                        <button
                          onClick={() => handleApprove(r.id)}
                          disabled={isDeciding}
                          data-testid={`approve-${r.id}`}
                          className="px-4 py-2 rounded-lg bg-primary hover:bg-primary-hover text-white text-sm font-medium flex items-center gap-1.5 disabled:opacity-50"
                        >
                          {isDeciding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                          {isDeciding ? 'Applying...' : 'Approve & Apply'}
                        </button>
                      </div>
                    )}

                    {/* Audit trail for decided requests */}
                    {r.status !== 'pending' && r.audit_trail && r.audit_trail.length > 1 && (
                      <details className="mt-3">
                        <summary className="text-xs text-text-muted cursor-pointer hover:text-text-primary">View audit trail ({r.audit_trail.length})</summary>
                        <ul className="mt-2 space-y-1 text-xs text-text-secondary pl-2 border-l-2 border-border-light">
                          {r.audit_trail.map((e, i) => (
                            <li key={`${r.id}-${e.at}-${i}`} className="pl-2">
                              <span className="capitalize font-medium">{e.event}</span> by {e.by_email} on {new Date(e.at).toLocaleString()}
                              {e.remarks && <span className="block text-text-muted">"{e.remarks}"</span>}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Reject modal */}
      {rejectingId && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-card max-w-md w-full rounded-2xl p-6">
            <h3 className="font-heading text-lg font-semibold text-text-primary mb-2">Reject this request?</h3>
            <p className="text-sm text-text-secondary mb-4">The vendor will be notified. You can leave a note explaining why (optional but recommended).</p>
            <textarea
              value={rejectRemarks}
              onChange={(e) => setRejectRemarks(e.target.value)}
              rows={3}
              data-testid="reject-remarks-input"
              placeholder="e.g. Price exceeds approved range, please resubmit between ₹X-Y"
              className="w-full px-3 py-2.5 border border-border-light rounded-lg bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary mb-4"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setRejectingId(null); setRejectRemarks(''); }}
                data-testid="cancel-reject-btn"
                className="px-5 py-2.5 rounded-lg border border-border-light text-text-secondary hover:bg-background"
              >
                Cancel
              </button>
              <button
                onClick={handleReject}
                disabled={decidingId === rejectingId}
                data-testid="confirm-reject-btn"
                className="px-5 py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium disabled:opacity-50"
              >
                {decidingId === rejectingId ? 'Rejecting...' : 'Reject Request'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default AdminMenuRequests;
