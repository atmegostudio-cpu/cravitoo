import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Navbar from '../../components/Navbar';
import { Upload, Users, FileText, Download, AlertCircle, CheckCircle2 } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const BulkOnboard = () => {
  const [file, setFile] = useState(null);
  const [companyId, setCompanyId] = useState('');
  const [companies, setCompanies] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await axios.get(`${API}/companies`, { withCredentials: true });
        setCompanies(data);
        if (data.length === 1) setCompanyId(data[0].id);
      } catch (e) { /* ignore */ }
    })();
  }, []);

  const upload = async (e) => {
    e.preventDefault();
    if (!file || !companyId) {
      alert('Please choose a company and CSV file');
      return;
    }
    setUploading(true);
    setResult(null);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const { data } = await axios.post(`${API}/admin/employees/bulk-csv?company_id=${companyId}`,
        fd, { withCredentials: true, headers: { 'Content-Type': 'multipart/form-data' } });
      setResult(data);
      setFile(null);
    } catch (e) {
      alert(e?.response?.data?.detail || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const downloadTemplate = () => {
    const csv = 'email,name,password,phone\njohn.doe@techcorp.com,John Doe,changeme123,9876543210\njane.smith@techcorp.com,Jane Smith,changeme123,9876543211\n';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'cravitoo-employees-template.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-background">
        <div className="max-w-4xl mx-auto px-6 py-8">
          <h1 className="font-heading text-4xl sm:text-5xl tracking-tighter font-semibold text-text-primary mb-2">Bulk Employee Onboarding</h1>
          <p className="text-text-secondary mb-8">Upload a CSV to create multiple employee accounts at once.</p>

          <div className="bg-card border border-border-light rounded-2xl p-6 mb-6">
            <div className="flex items-start gap-3 mb-4">
              <FileText className="h-5 w-5 text-primary mt-0.5" />
              <div>
                <p className="font-medium text-text-primary text-sm">CSV format</p>
                <p className="text-text-muted text-xs">Required columns: <code>email, name, password</code>. Optional: <code>phone, site_id</code>. Password must be ≥ 6 characters.</p>
              </div>
            </div>
            <button onClick={downloadTemplate} data-testid="download-template-btn" className="flex items-center gap-2 text-primary hover:underline text-sm">
              <Download className="h-4 w-4" /> Download template CSV
            </button>
          </div>

          <form onSubmit={upload} className="bg-card border border-border-light rounded-2xl p-6 space-y-4">
            <div>
              <label className="text-sm font-medium text-text-primary">Company</label>
              <select
                data-testid="company-select"
                required
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                className="mt-1 w-full px-3 py-2 border border-border-light rounded-lg"
              >
                <option value="">-- choose company --</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-text-primary">CSV file</label>
              <input
                data-testid="csv-file-input"
                type="file"
                accept=".csv"
                onChange={(e) => setFile(e.target.files[0])}
                className="mt-1 w-full px-3 py-2 border border-border-light rounded-lg"
              />
            </div>
            <button data-testid="upload-csv-btn" type="submit" disabled={uploading || !file || !companyId} className="w-full flex items-center justify-center gap-2 bg-primary text-white px-5 py-3 rounded-xl font-medium hover:bg-primary-hover disabled:opacity-50">
              <Upload className="h-4 w-4" /> {uploading ? 'Uploading...' : 'Onboard employees'}
            </button>
          </form>

          {result && (
            <div className="mt-6 bg-card border border-border-light rounded-2xl p-6" data-testid="upload-result">
              <div className="flex items-center gap-3 mb-4">
                <CheckCircle2 className="h-6 w-6 text-emerald-500" />
                <div>
                  <p className="font-heading text-xl font-medium text-text-primary">{result.inserted} employees onboarded</p>
                  <p className="text-text-muted text-xs">{result.total_attempted} rows attempted · {result.errors.length} errors</p>
                </div>
              </div>
              {result.errors.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertCircle className="h-4 w-4 text-amber-600" />
                    <p className="font-medium text-amber-900 text-sm">Errors</p>
                  </div>
                  <ul className="space-y-1 text-xs text-amber-900">
                    {result.errors.slice(0, 20).map((err, idx) => (
                      <li key={idx}>Row {err.row}: {err.error}</li>
                    ))}
                    {result.errors.length > 20 && <li>...and {result.errors.length - 20} more</li>}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default BulkOnboard;
