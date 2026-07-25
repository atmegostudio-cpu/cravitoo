/**
 * Reset App to Blank State — Master Admin only, /master/reset
 * Wipes ALL business data on the current environment while keeping the
 * master admin login + one allowed_domains row so onboarding can restart.
 */
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { AlertTriangle, Trash2, RefreshCw, ShieldCheck, Loader2, CheckCircle2 } from 'lucide-react';
import Navbar from '../../components/Navbar';
import { useAuth } from '../../context/AuthContext';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const CONFIRM_PHRASE = 'I_UNDERSTAND_THIS_DELETES_EVERYTHING';

const ResetApp = () => {
  const { user } = useAuth();
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [confirmText, setConfirmText] = useState('');
  const [keepDomain, setKeepDomain] = useState('cravitoo.com');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API}/admin/reset-preview`, { withCredentials: true });
      setPreview(data);
    } catch (e) {
      setError(e?.response?.data?.detail || 'Could not load preview');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const doReset = async () => {
    setError(''); setBusy(true); setResult(null);
    try {
      const { data } = await axios.post(
        `${API}/admin/reset-to-blank?confirm=${CONFIRM_PHRASE}&keep_domain=${encodeURIComponent(keepDomain)}`,
        {},
        { withCredentials: true }
      );
      setResult(data);
      await load();
    } catch (e) {
      setError(e?.response?.data?.detail || 'Reset failed');
    } finally {
      setBusy(false);
    }
  };

  const canReset = confirmText === CONFIRM_PHRASE && keepDomain.trim() && !busy;

  if (user?.role !== 'master_admin' && user?.role !== 'super_admin') {
    return (<><Navbar /><div className="min-h-screen flex items-center justify-center text-text-secondary">Master Admin only</div></>);
  }

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-background py-10">
        <div className="max-w-2xl mx-auto px-4">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-3 bg-red-50 rounded-xl"><AlertTriangle className="h-6 w-6 text-red-600" /></div>
            <div>
              <h1 data-testid="reset-title" className="text-2xl font-heading font-semibold">Reset App to Blank State</h1>
              <p className="text-sm text-text-secondary">Wipes ALL data. Keeps master admin + one signup domain.</p>
            </div>
          </div>

          {loading ? (
            <div className="p-8 text-center"><Loader2 className="h-6 w-6 animate-spin inline" /></div>
          ) : (
            <div className="bg-card border border-border-light rounded-2xl p-6 space-y-6">
              {/* What will be deleted */}
              <div>
                <h2 className="font-heading font-medium mb-3 flex items-center gap-2">
                  <Trash2 className="h-4 w-4 text-red-600" /> Will be permanently deleted
                </h2>
                {preview && (
                  <div className="grid grid-cols-2 gap-2 text-sm bg-background rounded-lg p-4 max-h-64 overflow-y-auto">
                    {Object.entries(preview.would_delete).filter(([, n]) => n > 0).map(([k, n]) => (
                      <div key={k} data-testid={`preview-${k}`} className="flex justify-between">
                        <span className="text-text-secondary">{k}</span>
                        <span className="font-mono text-red-600">{n}</span>
                      </div>
                    ))}
                    <div className="col-span-2 pt-2 mt-2 border-t border-border-light font-medium flex justify-between">
                      <span>Total rows</span><span className="font-mono">{preview.total}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* What will be kept */}
              <div>
                <h2 className="font-heading font-medium mb-3 flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" /> Will be preserved
                </h2>
                <ul className="text-sm text-text-secondary space-y-1 bg-emerald-50/50 rounded-lg p-4">
                  <li>• Your master admin login: <code className="font-mono">{user?.email}</code></li>
                  <li>• One allowed-domain row for new employee signups: <code className="font-mono">{keepDomain || '(none)'}</code></li>
                  <li>• A rollback backup collection <code className="font-mono">_reset_backup_&lt;ts&gt;</code></li>
                </ul>
              </div>

              {/* Domain input */}
              <div>
                <label className="block text-sm font-medium mb-1">Signup domain to preserve</label>
                <input
                  data-testid="keep-domain-input"
                  type="text"
                  value={keepDomain}
                  onChange={(e) => setKeepDomain(e.target.value)}
                  className="w-full px-4 py-2 border border-border-light rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary font-mono"
                />
                <p className="text-xs text-text-muted mt-1">Employees with this email domain will be able to register after the reset.</p>
              </div>

              {/* Confirmation phrase */}
              <div>
                <label className="block text-sm font-medium mb-1">
                  Type <code className="px-1.5 py-0.5 bg-red-50 text-red-700 rounded font-mono text-xs">{CONFIRM_PHRASE}</code> to enable the button
                </label>
                <input
                  data-testid="reset-confirm-input"
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  className="w-full px-4 py-2 border border-border-light rounded-lg focus:ring-2 focus:ring-red-500/20 focus:border-red-500 font-mono"
                  placeholder={CONFIRM_PHRASE}
                />
              </div>

              {error && (
                <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
              )}
              {result && (
                <div data-testid="reset-success" className="p-4 bg-emerald-50 text-emerald-800 rounded-lg text-sm space-y-2">
                  <div className="flex items-center gap-2 font-medium"><CheckCircle2 className="h-4 w-4" /> {result.message}</div>
                  <div>Backup collection: <code className="font-mono text-xs">{result.backup_collection}</code></div>
                  <details className="text-xs">
                    <summary className="cursor-pointer">Rollback command (mongosh)</summary>
                    <code className="block mt-1 bg-white p-2 rounded whitespace-pre-wrap">{result.rollback_hint}</code>
                  </details>
                </div>
              )}

              <button
                data-testid="reset-submit"
                onClick={doReset}
                disabled={!canReset}
                className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white py-3 rounded-lg font-medium transition-all"
              >
                {busy ? (<><Loader2 className="h-4 w-4 animate-spin" /> Resetting…</>) : (<><Trash2 className="h-4 w-4" /> Reset app to blank state</>)}
              </button>

              <button
                data-testid="reset-reload"
                onClick={load}
                className="w-full flex items-center justify-center gap-2 text-text-secondary hover:text-primary py-2 text-sm"
              >
                <RefreshCw className="h-3 w-3" /> Refresh preview
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default ResetApp;
