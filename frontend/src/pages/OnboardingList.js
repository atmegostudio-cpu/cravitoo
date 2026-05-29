import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { useAuth } from '../context/AuthContext';
import { ClipboardList, Plus, ChevronRight, Search, Filter } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const STATUS_META = {
  draft: { label: 'Draft', color: 'bg-gray-100 text-gray-700' },
  documents_pending: { label: 'Docs Pending', color: 'bg-amber-100 text-amber-700' },
  under_site_review: { label: 'Under Site Review', color: 'bg-blue-100 text-blue-700' },
  changes_requested: { label: 'Changes Requested', color: 'bg-orange-100 text-orange-700' },
  under_master_review: { label: 'Under Master Review', color: 'bg-purple-100 text-purple-700' },
  approved: { label: 'Approved', color: 'bg-emerald-100 text-emerald-700' },
  rejected: { label: 'Rejected', color: 'bg-red-100 text-red-700' },
  active: { label: 'Active', color: 'bg-emerald-100 text-emerald-700' },
};

const OnboardingList = () => {
  const { user } = useAuth();
  const [dashboard, setDashboard] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');

  const load = async () => {
    try {
      const [d, l] = await Promise.all([
        axios.get(`${API}/onboarding/dashboard`, { withCredentials: true }),
        axios.get(`${API}/onboarding/vendors${statusFilter ? `?status=${statusFilter}` : ''}`, { withCredentials: true }),
      ]);
      setDashboard(d.data);
      setItems(l.data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [statusFilter]);

  if (loading) {
    return (<><Navbar /><div className="min-h-screen bg-background flex items-center justify-center"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div></div></>);
  }

  const filtered = items.filter((it) => !search || (it.vendor_name?.toLowerCase().includes(search.toLowerCase()) || it.company_name?.toLowerCase().includes(search.toLowerCase())));
  const canCreate = ['site_admin', 'city_admin', 'master_admin'].includes(user?.role);

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-background">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex justify-between items-center mb-8 flex-wrap gap-4">
            <div>
              <h1 className="font-heading text-4xl sm:text-5xl tracking-tighter font-semibold text-text-primary">Vendor Onboarding</h1>
              <p className="text-text-secondary mt-2">Track applications through documents, review, and final approval</p>
            </div>
            {canCreate && (
              <div className="flex gap-2">
                <label className="cursor-pointer flex items-center gap-2 bg-card border border-border-light text-text-primary px-4 py-2.5 rounded-xl font-medium hover:bg-background" data-testid="bulk-import-onboarding-label">
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    data-testid="bulk-import-file"
                    onChange={async (e) => {
                      const f = e.target.files[0];
                      if (!f) return;
                      const sid = prompt('Enter site_id (leave blank if you are site_admin):') || '';
                      const fd = new FormData();
                      fd.append('file', f);
                      try {
                        const { data } = await axios.post(`${API}/onboarding/vendors/bulk-import?site_id=${sid}`, fd, { withCredentials: true, headers: { 'Content-Type': 'multipart/form-data' } });
                        alert(`Imported ${data.inserted} onboardings (${data.errors.length} errors)`);
                        await load();
                      } catch (err) {
                        alert(err?.response?.data?.detail || 'Failed');
                      }
                      e.target.value = '';
                    }}
                  />
                  <span>Bulk Import Excel</span>
                </label>
                <Link to="/onboarding/new" data-testid="new-onboarding-btn" className="flex items-center gap-2 bg-primary text-white px-5 py-2.5 rounded-xl font-medium hover:bg-primary-hover">
                  <Plus className="h-4 w-4" /> Onboard Vendor
                </Link>
              </div>
            )}
          </div>

          {dashboard && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
              <StatCard label="Total" value={dashboard.total} bg="bg-gray-50" color="text-text-primary" />
              <StatCard label="Pending Approvals" value={dashboard.pending_approvals} bg="bg-amber-50" color="text-amber-700" />
              <StatCard label="Approved" value={dashboard.approved} bg="bg-emerald-50" color="text-emerald-700" />
              <StatCard label="Rejected" value={dashboard.rejected} bg="bg-red-50" color="text-red-700" />
              <StatCard label="Avg Checklist" value={`${dashboard.avg_checklist_pct}%`} bg="bg-primary-light" color="text-primary" />
            </div>
          )}

          <div className="bg-card border border-border-light rounded-2xl p-4 mb-4 flex flex-wrap items-center gap-3">
            <div className="flex-1 relative min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" />
              <input
                data-testid="search-onboarding"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search vendor name..."
                className="w-full pl-9 pr-3 py-2 border border-border-light rounded-lg text-sm"
              />
            </div>
            <Filter className="h-4 w-4 text-text-muted" />
            <select
              data-testid="status-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-border-light rounded-lg text-sm"
            >
              <option value="">All statuses</option>
              {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>

          <div className="bg-card border border-border-light rounded-2xl overflow-hidden">
            <table className="w-full">
              <thead className="bg-background">
                <tr className="text-left text-xs text-text-muted uppercase">
                  <th className="px-4 py-3">Vendor</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Checklist</th>
                  <th className="px-4 py-3">Submitted</th>
                  <th className="px-4 py-3 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((it) => {
                  const meta = STATUS_META[it.status] || STATUS_META.draft;
                  return (
                    <tr key={it.id} data-testid={`onboarding-row-${it.id}`} className="border-t border-border-light/50 hover:bg-background">
                      <td className="px-4 py-3">
                        <Link to={`/onboarding/${it.id}`} className="block">
                          <p className="font-medium text-text-primary text-sm">{it.vendor_name}</p>
                          <p className="text-text-muted text-xs">{it.company_name} · {it.contact_person}</p>
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 ${meta.color} text-xs rounded-full font-medium`}>{meta.label}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-background rounded-full overflow-hidden max-w-[100px]">
                            <div className="h-full bg-primary rounded-full" style={{ width: `${it.checklist_pct}%` }} />
                          </div>
                          <span className="text-xs text-text-secondary font-medium">{it.checklist_pct}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-text-muted">
                        {it.created_at ? new Date(it.created_at).toLocaleDateString('en-IN') : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <Link to={`/onboarding/${it.id}`}>
                          <ChevronRight className="h-5 w-5 text-text-muted" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <div className="p-12 text-center">
                <ClipboardList className="h-10 w-10 text-text-muted mx-auto mb-3" />
                <p className="text-text-secondary">No vendor onboardings yet.</p>
                {canCreate && <p className="text-text-muted text-xs mt-2">Click "Onboard Vendor" to start.</p>}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

const StatCard = ({ label, value, bg, color }) => (
  <div className={`${bg} border border-border-light rounded-xl p-4`}>
    <p className="text-xs text-text-secondary mb-1">{label}</p>
    <p className={`font-heading text-2xl font-semibold ${color}`}>{value}</p>
  </div>
);

export default OnboardingList;
