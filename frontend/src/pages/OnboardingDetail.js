import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useParams, useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { useAuth } from '../context/AuthContext';
import {
  Store, ArrowLeft, Upload, FileText, CheckCircle2, XCircle, Clock, ChevronRight,
  Send, X, Eye, Trash2, AlertTriangle, Activity
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const STATUS_META = {
  draft: { label: 'Draft', color: 'bg-gray-100 text-gray-700', icon: FileText },
  documents_pending: { label: 'Docs Pending', color: 'bg-amber-100 text-amber-700', icon: Clock },
  under_site_review: { label: 'Under Site Review', color: 'bg-blue-100 text-blue-700', icon: Eye },
  changes_requested: { label: 'Changes Requested', color: 'bg-orange-100 text-orange-700', icon: AlertTriangle },
  under_master_review: { label: 'Under Master Review', color: 'bg-purple-100 text-purple-700', icon: Eye },
  approved: { label: 'Approved', color: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2 },
  rejected: { label: 'Rejected', color: 'bg-red-100 text-red-700', icon: XCircle },
  active: { label: 'Active', color: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2 },
};

const DOC_TYPES = [
  { key: 'gst_certificate', label: 'GST Certificate', required: true },
  { key: 'pan_card', label: 'PAN Card', required: true },
  { key: 'fssai_license', label: 'FSSAI License', required: true },
  { key: 'shop_establishment', label: 'Shop & Establishment License', required: true },
  { key: 'bank_details', label: 'Bank Account Details', required: true },
  { key: 'cancelled_cheque', label: 'Cancelled Cheque', required: true },
  { key: 'msme_certificate', label: 'MSME Certificate', required: false },
  { key: 'insurance', label: 'Insurance Documents', required: false },
];

const CHECKLIST = [
  { key: 'gst_verified', label: 'GST Verified' },
  { key: 'pan_verified', label: 'PAN Verified' },
  { key: 'fssai_verified', label: 'FSSAI Verified' },
  { key: 'bank_verified', label: 'Bank Details Verified' },
  { key: 'menu_uploaded', label: 'Menu Uploaded' },
  { key: 'pricing_verified', label: 'Pricing Verified' },
  { key: 'documents_uploaded', label: 'Required Documents Uploaded' },
  { key: 'site_visit_completed', label: 'Site Visit Completed' },
  { key: 'commercial_terms_accepted', label: 'Commercial Terms Accepted' },
  { key: 'agreement_signed', label: 'Agreement Signed' },
];

const OnboardingDetail = () => {
  const { onbId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [audit, setAudit] = useState([]);
  const [tab, setTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(null);
  const [decision, setDecision] = useState({ open: false, stage: '', decision: '', remarks: '' });

  const reload = useCallback(async () => {
    try {
      const [d, a] = await Promise.all([
        axios.get(`${API}/onboarding/vendors/${onbId}`, { withCredentials: true }),
        axios.get(`${API}/onboarding/vendors/${onbId}/audit-trail`, { withCredentials: true }),
      ]);
      setData(d.data);
      setAudit(a.data.audit_trail || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [onbId]);

  useEffect(() => { reload(); }, [reload]);

  const uploadDoc = async (docKey, file) => {
    setUploading(docKey);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await axios.post(`${API}/onboarding/vendors/${onbId}/documents/${docKey}`, fd, {
        withCredentials: true,
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      await reload();
    } catch (e) {
      alert(e?.response?.data?.detail || 'Upload failed');
    } finally {
      setUploading(null);
    }
  };

  const deleteDoc = async (docKey) => {
    if (!window.confirm('Remove this document?')) return;
    try {
      await axios.delete(`${API}/onboarding/vendors/${onbId}/documents/${docKey}`, { withCredentials: true });
      await reload();
    } catch (e) { alert(e?.response?.data?.detail || 'Failed'); }
  };

  const toggleChecklist = async (key) => {
    try {
      await axios.patch(`${API}/onboarding/vendors/${onbId}/checklist`,
        { [key]: !data.checklist[key] }, { withCredentials: true });
      await reload();
    } catch (e) { alert(e?.response?.data?.detail || 'Failed'); }
  };

  const submitDecision = async () => {
    try {
      const url = decision.stage === 'master'
        ? `${API}/onboarding/vendors/${onbId}/master-decision`
        : `${API}/onboarding/vendors/${onbId}/site-review`;
      await axios.post(url, { decision: decision.decision, remarks: decision.remarks }, { withCredentials: true });
      setDecision({ open: false, stage: '', decision: '', remarks: '' });
      await reload();
    } catch (e) { alert(e?.response?.data?.detail || 'Failed'); }
  };

  if (loading) return (<><Navbar /><div className="min-h-screen bg-background flex items-center justify-center"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div></div></>);
  if (!data) return (<><Navbar /><div className="min-h-screen bg-background flex items-center justify-center"><p>Not found</p></div></>);

  const meta = STATUS_META[data.status] || STATUS_META.draft;
  const StatusIcon = meta.icon;
  const isSite = user?.role === 'site_admin';
  const isMaster = user?.role === 'master_admin';
  const canSiteReview = (isSite || isMaster) && ['documents_pending', 'under_site_review', 'changes_requested'].includes(data.status);
  const canMasterReview = isMaster && data.status === 'under_master_review';
  const canEdit = !['approved', 'active', 'rejected'].includes(data.status);

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-background">
        <div className="max-w-6xl mx-auto px-6 py-8">
          <button onClick={() => navigate('/onboarding')} className="flex items-center gap-2 text-text-secondary hover:text-text-primary mb-4 text-sm">
            <ArrowLeft className="h-4 w-4" /> Back to list
          </button>

          <div className="bg-card border border-border-light rounded-2xl p-6 mb-6">
            <div className="flex items-start justify-between flex-wrap gap-4">
              <div className="flex items-start gap-4">
                <div className="bg-primary-light rounded-xl p-3">
                  <Store className="h-7 w-7 text-primary" />
                </div>
                <div>
                  <h1 className="font-heading text-2xl sm:text-3xl font-semibold text-text-primary">{data.vendor_name}</h1>
                  <p className="text-text-secondary text-sm mt-1">{data.company_name} · {data.contact_person} · {data.mobile_number}</p>
                </div>
              </div>
              <div className={`flex items-center gap-2 px-3 py-2 ${meta.color} rounded-xl`}>
                <StatusIcon className="h-5 w-5" />
                <span className="font-medium text-sm" data-testid="status-badge">{meta.label}</span>
              </div>
            </div>

            <div className="mt-6">
              <div className="flex justify-between items-baseline mb-2">
                <p className="text-sm font-medium text-text-primary">Verification checklist</p>
                <p className="text-sm text-text-secondary"><span className="font-semibold text-primary">{data.checklist_pct}%</span> complete</p>
              </div>
              <div className="h-3 bg-background rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${data.checklist_pct}%` }} />
              </div>
            </div>

            {canSiteReview && (
              <div className="flex gap-2 mt-6 flex-wrap">
                <button data-testid="site-approve-btn" onClick={() => setDecision({ open: true, stage: 'site', decision: 'approve' })} className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700">
                  <CheckCircle2 className="h-4 w-4" /> Submit to Master Admin
                </button>
                <button data-testid="site-changes-btn" onClick={() => setDecision({ open: true, stage: 'site', decision: 'request_changes' })} className="flex items-center gap-2 bg-amber-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-amber-600">
                  <AlertTriangle className="h-4 w-4" /> Request Changes
                </button>
                <button data-testid="site-reject-btn" onClick={() => setDecision({ open: true, stage: 'site', decision: 'reject' })} className="flex items-center gap-2 bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700">
                  <XCircle className="h-4 w-4" /> Reject
                </button>
              </div>
            )}
            {canMasterReview && (
              <div className="flex gap-2 mt-6 flex-wrap">
                <button data-testid="master-approve-btn" onClick={() => setDecision({ open: true, stage: 'master', decision: 'approve' })} className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700">
                  <CheckCircle2 className="h-4 w-4" /> Final Approve · Activate Vendor
                </button>
                <button data-testid="master-reject-btn" onClick={() => setDecision({ open: true, stage: 'master', decision: 'reject' })} className="flex items-center gap-2 bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700">
                  <XCircle className="h-4 w-4" /> Reject
                </button>
              </div>
            )}
          </div>

          <div className="flex gap-2 border-b border-border-light mb-6 overflow-x-auto">
            {[
              { k: 'overview', label: 'Overview' },
              { k: 'documents', label: `Documents (${Object.keys(data.documents || {}).length}/${DOC_TYPES.length})` },
              { k: 'checklist', label: 'Checklist' },
              { k: 'audit', label: 'Audit Trail' },
            ].map((t) => (
              <button key={t.k} data-testid={`tab-${t.k}`} onClick={() => setTab(t.k)} className={`px-4 py-3 font-medium text-sm transition-all border-b-2 ${tab === t.k ? 'border-primary text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'}`}>
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'overview' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <InfoCard label="Vendor Name" value={data.vendor_name} />
              <InfoCard label="Company Name" value={data.company_name} />
              <InfoCard label="Contact Person" value={data.contact_person} />
              <InfoCard label="Mobile" value={data.mobile_number} />
              <InfoCard label="Email" value={data.email} />
              <InfoCard label="Cuisine Type" value={data.cuisine_type} />
              <InfoCard label="Business Address" value={data.business_address} wide />
              {data.vendor_id && (
                <div className="md:col-span-2 bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  <div>
                    <p className="font-medium text-emerald-900 text-sm">Vendor activated</p>
                    <p className="text-emerald-700 text-xs">Vendor ID: {data.vendor_id} · Now visible to employees at this site</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'documents' && (
            <>
              {canEdit && (
                <div className="bg-primary-light border border-primary/30 rounded-2xl p-4 mb-4">
                  <p className="font-medium text-text-primary text-sm mb-1">📊 Bulk upload menu items</p>
                  <p className="text-text-secondary text-xs mb-3">Upload an Excel sheet with columns: name, category, price, description (optional), is_vegetarian (optional), image_url (optional). Auto-ticks "Menu uploaded" in checklist.</p>
                  <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-2 bg-card border border-primary text-primary rounded-lg text-sm font-medium hover:bg-primary-light" data-testid="upload-onb-menu-label">
                    <input
                      type="file"
                      accept=".xlsx,.xls"
                      className="hidden"
                      data-testid="upload-onb-menu"
                      onChange={async (e) => {
                        const f = e.target.files[0];
                        if (!f) return;
                        const fd = new FormData();
                        fd.append('file', f);
                        try {
                          const { data } = await axios.post(`${API}/onboarding/vendors/${onbId}/menu/upload-excel`, fd, { withCredentials: true, headers: { 'Content-Type': 'multipart/form-data' } });
                          alert(`Inserted ${data.inserted} menu items (${data.errors?.length || 0} errors)`);
                          await reload();
                        } catch (err) {
                          alert(err?.response?.data?.detail || 'Failed');
                        }
                        e.target.value = '';
                      }}
                    />
                    <Upload className="h-4 w-4" /> Pick Excel
                  </label>
                  {data.draft_menu && data.draft_menu.length > 0 && (
                    <p className="mt-2 text-xs text-emerald-700">✓ {data.draft_menu.length} menu items pre-loaded (will be activated when master approves)</p>
                  )}
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {DOC_TYPES.map((d) => {
                const uploaded = data.documents?.[d.key];
                return (
                  <div key={d.key} data-testid={`doc-row-${d.key}`} className="bg-card border border-border-light rounded-xl p-4">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div>
                        <p className="font-medium text-text-primary text-sm">{d.label} {d.required && <span className="text-red-500">*</span>}</p>
                        {uploaded && <p className="text-text-muted text-xs mt-1">Uploaded by {uploaded.uploaded_by}</p>}
                      </div>
                      {uploaded && <CheckCircle2 className="h-5 w-5 text-emerald-500 flex-shrink-0" />}
                    </div>
                    {uploaded ? (
                      <div className="flex gap-2 mt-2">
                        <a href={uploaded.url} target="_blank" rel="noreferrer" className="flex-1 text-center px-3 py-2 bg-background rounded-lg text-xs font-medium text-text-primary hover:bg-border-light">
                          <Eye className="h-3 w-3 inline mr-1" /> View
                        </a>
                        {canEdit && (
                          <button data-testid={`delete-doc-${d.key}`} onClick={() => deleteDoc(d.key)} className="px-3 py-2 bg-red-50 text-red-600 rounded-lg text-xs">
                            <Trash2 className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    ) : canEdit ? (
                      <label className="block mt-2" data-testid={`upload-label-${d.key}`}>
                        <input
                          type="file"
                          accept=".pdf,.png,.jpg,.jpeg,.webp"
                          onChange={(e) => e.target.files[0] && uploadDoc(d.key, e.target.files[0])}
                          className="hidden"
                          data-testid={`upload-input-${d.key}`}
                        />
                        <div className="cursor-pointer px-3 py-2 border border-dashed border-primary text-primary rounded-lg text-xs text-center hover:bg-primary-light">
                          {uploading === d.key ? 'Uploading...' : <><Upload className="h-3 w-3 inline mr-1" /> Upload</>}
                        </div>
                      </label>
                    ) : (
                      <p className="text-text-muted text-xs mt-2 italic">Locked — onboarding finalized</p>
                    )}
                  </div>
                );
              })}
              </div>
            </>
          )}

          {tab === 'checklist' && (
            <div className="bg-card border border-border-light rounded-2xl p-6 space-y-2 max-w-2xl">
              {CHECKLIST.map((c) => (
                <label key={c.key} className="flex items-center gap-3 p-3 border border-border-light rounded-lg cursor-pointer hover:bg-background" data-testid={`checklist-${c.key}`}>
                  <input
                    type="checkbox"
                    checked={!!data.checklist?.[c.key]}
                    onChange={() => canEdit && toggleChecklist(c.key)}
                    disabled={!canEdit}
                    className="h-4 w-4"
                  />
                  <span className="text-sm text-text-primary">{c.label}</span>
                </label>
              ))}
              <p className="text-xs text-text-muted pt-3 border-t border-border-light">At least 80% must be checked before submitting to master admin.</p>
            </div>
          )}

          {tab === 'audit' && (
            <div className="space-y-2">
              {audit.length === 0 && <p className="text-text-muted text-sm">No actions logged yet.</p>}
              {audit.map((a, idx) => (
                <div key={a.created_at ? `${a.created_at}-${idx}` : `audit-${idx}`} className="bg-card border border-border-light rounded-xl p-4 flex items-start gap-3" data-testid={`audit-${idx}`}>
                  <Activity className="h-4 w-4 text-primary mt-1 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm text-text-primary">
                      <span className="font-medium">{a.user_email}</span>
                      <span className="text-text-muted"> ({a.user_role})</span>
                      <span className="text-text-secondary"> · {a.action}</span>
                    </p>
                    {a.details && Object.keys(a.details).length > 0 && (
                      <p className="text-xs text-text-muted mt-1">{JSON.stringify(a.details)}</p>
                    )}
                    <p className="text-xs text-text-muted mt-1">{new Date(a.created_at).toLocaleString('en-IN')}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {decision.open && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setDecision({ ...decision, open: false })}>
          <div className="bg-card rounded-2xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-border-light">
              <h2 className="font-heading text-xl font-medium">
                {decision.decision === 'approve' && decision.stage === 'master' && 'Final Approval'}
                {decision.decision === 'approve' && decision.stage === 'site' && 'Submit to Master'}
                {decision.decision === 'reject' && 'Reject Onboarding'}
                {decision.decision === 'request_changes' && 'Request Changes'}
              </h2>
              <button onClick={() => setDecision({ ...decision, open: false })}><X className="h-5 w-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-sm font-medium">Remarks {decision.decision !== 'approve' && '*'}</label>
                <textarea
                  data-testid="decision-remarks"
                  value={decision.remarks}
                  onChange={(e) => setDecision({ ...decision, remarks: e.target.value })}
                  rows={4}
                  required={decision.decision !== 'approve'}
                  placeholder={decision.decision === 'approve' ? 'Optional notes...' : 'Reason / changes required...'}
                  className="mt-1 w-full px-3 py-2 border border-border-light rounded-lg text-sm"
                />
              </div>
              <div className="flex gap-3">
                <button onClick={() => setDecision({ ...decision, open: false })} className="flex-1 px-4 py-2.5 border border-border-light rounded-xl font-medium">Cancel</button>
                <button data-testid="confirm-decision-btn" onClick={submitDecision} className={`flex-1 px-4 py-2.5 text-white rounded-xl font-medium ${decision.decision === 'approve' ? 'bg-emerald-600 hover:bg-emerald-700' : decision.decision === 'reject' ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-500 hover:bg-amber-600'}`}>
                  Confirm
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

const InfoCard = ({ label, value, wide }) => (
  <div className={`bg-card border border-border-light rounded-xl p-4 ${wide ? 'md:col-span-2' : ''}`}>
    <p className="text-xs text-text-muted">{label}</p>
    <p className="text-sm text-text-primary font-medium mt-1">{value || '—'}</p>
  </div>
);

export default OnboardingDetail;
