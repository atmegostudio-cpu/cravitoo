import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { Html5Qrcode } from 'html5-qrcode';
import { ScanLine, CheckCircle2, XCircle, LogOut, Loader2, AlertCircle, Wallet, Camera, Keyboard, X, Wifi, WifiOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import logger from '../../lib/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const SCANNER_ID = 'kiosk-scanner-region';

/**
 * Full-screen Kiosk mode for the counter iPad.
 *
 * Design goals (busy lunch rush):
 *   - Chromeless: no navbar, no side nav — one big scanner.
 *   - Auto-loop: camera stays live between scans; success screen auto-closes in 3s.
 *   - No accidental navigation: exit button requires password confirmation.
 *   - Live tally: today's Cash / QR / Total pinned to the top so cash-drawer
 *     reconciliation is a glance-check at end of shift.
 */
export default function VendorKiosk() {
  const [phase, setPhase] = useState('scan');        // 'scan' | 'confirm' | 'success' | 'error'
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [manualMode, setManualMode] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const [tally, setTally] = useState({ qr_count: 0, qr_amount: 0, total_count: 0, total_amount: 0 });
  const [online, setOnline] = useState(navigator.onLine);
  const [exitPromptOpen, setExitPromptOpen] = useState(false);
  const [exitPwd, setExitPwd] = useState('');
  const [exitError, setExitError] = useState('');
  const scannerRef = useRef(null);
  const stoppedRef = useRef(false);
  const successTimerRef = useRef(null);
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const fetchTally = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/orders`, { withCredentials: true });
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const today = data.filter((o) => o.paid_at && new Date(o.paid_at) >= startOfDay);
      const t = { qr_count: 0, qr_amount: 0, total_count: 0, total_amount: 0 };
      for (const o of today) {
        if (o.payment_method === 'physical_qr') { t.qr_count++; t.qr_amount += o.total_amount || 0; }
        t.total_count++; t.total_amount += o.total_amount || 0;
      }
      setTally(t);
    } catch (err) {
      logger.warn('Kiosk tally refresh failed', err);
    }
  }, []);

  const stopScanner = useCallback(async () => {
    if (!scannerRef.current || stoppedRef.current) return;
    stoppedRef.current = true;
    try {
      const state = scannerRef.current.getState?.();
      if (state === 2 || state === 3) await scannerRef.current.stop();
      await scannerRef.current.clear();
    } catch (err) {
      logger.warn('Kiosk scanner stop failed', err);
    }
    scannerRef.current = null;
  }, []);

  const handleDecoded = useCallback(async (raw) => {
    const cleaned = (raw || '').trim().toUpperCase();
    if (!cleaned.startsWith('CRV-')) {
      setErrorMsg(`Not a Cravitoo code: "${cleaned.slice(0, 20)}"`);
      return;
    }
    await stopScanner();
    setCode(cleaned);
    setErrorMsg('');
    setPhase('confirm');
  }, [stopScanner]);

  // Start camera scanner
  useEffect(() => {
    if (phase !== 'scan' || manualMode) return;
    stoppedRef.current = false;
    let cancelled = false;
    (async () => {
      try {
        const html5 = new Html5Qrcode(SCANNER_ID, false);
        scannerRef.current = html5;
        await html5.start(
          { facingMode: 'environment' },
          { fps: 12, qrbox: { width: 300, height: 300 }, aspectRatio: 1.0 },
          (decoded) => { if (!cancelled) handleDecoded(decoded); },
          () => {},
        );
      } catch (err) {
        if (cancelled) return;
        logger.warn('Kiosk camera init failed', err);
        setErrorMsg('Camera blocked. Use manual entry.');
        setManualMode(true);
      }
    })();
    return () => { cancelled = true; stopScanner(); };
  }, [phase, manualMode, handleDecoded, stopScanner]);

  // Online / offline listener
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  // Initial tally + refresh every 60s
  useEffect(() => {
    fetchTally();
    const id = setInterval(fetchTally, 60000);
    return () => clearInterval(id);
  }, [fetchTally]);

  // Auto-loop back to scan 3s after success
  useEffect(() => {
    if (phase !== 'success') return;
    successTimerRef.current = setTimeout(() => {
      setPhase('scan');
      setCode('');
      setLastResult(null);
      setErrorMsg('');
      setManualMode(false);
      stoppedRef.current = false;
    }, 3000);
    return () => clearTimeout(successTimerRef.current);
  }, [phase]);

  const submit = async () => {
    if (!code || busy) return;
    setBusy(true);
    setErrorMsg('');
    try {
      const { data } = await axios.post(
        `${API}/orders/collect/${encodeURIComponent(code)}`,
        { method: 'physical_qr' },
        { withCredentials: true, timeout: 15000 },
      );
      setLastResult(data);
      setPhase('success');
      fetchTally();
    } catch (err) {
      setErrorMsg(err.response?.data?.detail || 'Could not collect');
      setPhase('error');
    } finally {
      setBusy(false);
    }
  };

  const backToScan = async () => {
    await stopScanner();
    clearTimeout(successTimerRef.current);
    setPhase('scan');
    setCode('');
    setErrorMsg('');
    setLastResult(null);
    setManualMode(false);
    stoppedRef.current = false;
  };

  const requestExit = () => { setExitPromptOpen(true); setExitPwd(''); setExitError(''); };

  const confirmExit = async () => {
    setExitError('');
    try {
      await axios.post(`${API}/auth/login`, { email: user?.email, password: exitPwd }, { withCredentials: true, timeout: 10000 });
      setExitPromptOpen(false);
      await stopScanner();
      navigate('/vendor/orders');
    } catch (err) {
      setExitError('Wrong password. Ask the manager.');
    }
  };

  const exitAndLogout = async () => {
    try { await logout(); } catch (e) { logger.warn(e); }
    navigate('/login');
  };

  const fmt = (n) => `₹${(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

  return (
    <div data-testid="kiosk-root" className="min-h-screen bg-slate-950 text-white flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 bg-slate-900/60 backdrop-blur">
        <div className="flex items-center gap-2">
          <div className="h-2.5 w-2.5 rounded-full bg-primary animate-pulse" />
          <span className="font-heading text-lg font-semibold tracking-tight">Cravitoo Kiosk</span>
          <span className="ml-2 text-xs text-white/50 hidden sm:inline">{user?.name || user?.email}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full ${online ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/20 text-red-300'}`} data-testid="kiosk-connection">
            {online ? <><Wifi className="h-3 w-3" /> Online</> : <><WifiOff className="h-3 w-3" /> Offline</>}
          </span>
          <button
            data-testid="kiosk-exit-btn"
            onClick={requestExit}
            className="flex items-center gap-1.5 text-xs bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-full text-white/80"
          >
            <LogOut className="h-3.5 w-3.5" /> Exit
          </button>
        </div>
      </div>

      {/* Live tally */}
      <div className="grid grid-cols-2 gap-3 px-5 py-4 border-b border-white/10 bg-slate-900/40">
        <div data-testid="kiosk-tally-total" className="rounded-2xl px-4 py-3 bg-gradient-to-br from-primary to-orange-600">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-white/80 font-semibold">
            <Wallet className="h-3 w-3" /> Today Total
          </div>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="font-heading text-3xl font-bold">{tally.total_count}</span>
            <span className="text-sm font-medium text-white/90">{fmt(tally.total_amount)}</span>
          </div>
        </div>
        <div data-testid="kiosk-tally-qr" className="rounded-2xl px-4 py-3 bg-white/5 border border-white/10">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-indigo-300 font-semibold">
            <ScanLine className="h-3 w-3" /> Physical QR
          </div>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="font-heading text-3xl font-bold">{tally.qr_count}</span>
            <span className="text-sm font-medium text-white/70">{fmt(tally.qr_amount)}</span>
          </div>
        </div>
      </div>

      {/* Main workspace */}
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-lg">

          {phase === 'scan' && !manualMode && (
            <div data-testid="kiosk-scan-phase">
              <p className="text-center text-white/60 text-sm mb-3 uppercase tracking-widest">Point at the employee&apos;s QR</p>
              <div id={SCANNER_ID} className="w-full aspect-square rounded-3xl overflow-hidden bg-black border-4 border-primary/60 shadow-[0_0_60px_-10px] shadow-primary/40" />
              {errorMsg && (
                <div className="mt-3 flex items-center gap-2 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg p-3 justify-center">
                  <AlertCircle className="h-4 w-4" /> {errorMsg}
                </div>
              )}
              <button
                data-testid="kiosk-manual-toggle"
                onClick={() => { stopScanner(); setManualMode(true); setErrorMsg(''); }}
                className="w-full mt-4 flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white px-4 py-3 rounded-2xl text-sm font-semibold"
              >
                <Keyboard className="h-4 w-4" /> Type Code Instead
              </button>
            </div>
          )}

          {phase === 'scan' && manualMode && (
            <div data-testid="kiosk-manual-phase" className="bg-white/5 border border-white/10 rounded-3xl p-6">
              <label className="block text-xs font-semibold text-white/60 uppercase tracking-widest mb-2">Collection Code</label>
              <input
                data-testid="kiosk-manual-input"
                type="text"
                autoFocus
                autoCapitalize="characters"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="CRV-A1B2C3"
                className="w-full px-4 py-4 rounded-2xl bg-slate-950 border-2 border-white/20 font-mono text-2xl tracking-widest text-center focus:outline-none focus:border-primary"
              />
              {errorMsg && (
                <div className="mt-3 flex items-center gap-2 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg p-3 justify-center">
                  <AlertCircle className="h-4 w-4" /> {errorMsg}
                </div>
              )}
              <div className="flex gap-2 mt-4">
                <button
                  data-testid="kiosk-back-to-camera"
                  onClick={() => { setManualMode(false); setCode(''); setErrorMsg(''); }}
                  className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white px-4 py-3 rounded-2xl text-sm font-semibold flex items-center justify-center gap-2"
                >
                  <Camera className="h-4 w-4" /> Camera
                </button>
                <button
                  data-testid="kiosk-manual-continue"
                  onClick={() => handleDecoded(code)}
                  disabled={!code}
                  className="flex-1 bg-primary hover:bg-primary-hover disabled:opacity-40 text-white px-4 py-3 rounded-2xl text-sm font-semibold"
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {phase === 'confirm' && (
            <div data-testid="kiosk-confirm-phase" className="bg-white/5 border border-white/10 rounded-3xl p-6">
              <div className="text-center mb-6">
                <p className="text-xs uppercase tracking-widest text-white/50 mb-1">Collection Code</p>
                <p data-testid="kiosk-detected-code" className="font-mono text-4xl font-bold text-primary tracking-widest">{code}</p>
              </div>

              <div className="flex items-center gap-3 mb-5 rounded-2xl border-2 border-indigo-400 bg-indigo-500/15 p-4" data-testid="kiosk-method-qr">
                <div className="rounded-xl bg-indigo-500/20 p-2.5">
                  <ScanLine className="h-6 w-6 text-indigo-300" />
                </div>
                <div>
                  <p className="text-base font-bold">Payment: Physical QR</p>
                  <p className="text-xs text-white/60">Confirm UPI payment on your counter QR before collecting.</p>
                </div>
              </div>

              {errorMsg && (
                <div className="mb-3 flex items-center gap-2 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                  <AlertCircle className="h-4 w-4" /> {errorMsg}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  data-testid="kiosk-rescan-btn"
                  onClick={backToScan}
                  disabled={busy}
                  className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white px-4 py-4 rounded-2xl text-sm font-semibold disabled:opacity-50"
                >
                  Rescan
                </button>
                <button
                  data-testid="kiosk-confirm-btn"
                  onClick={submit}
                  disabled={busy}
                  className="flex-[2] flex items-center justify-center gap-2 bg-primary hover:bg-primary-hover text-white px-4 py-4 rounded-2xl text-base font-bold disabled:opacity-50"
                >
                  {busy ? <><Loader2 className="h-5 w-5 animate-spin" /> Collecting</> : <><CheckCircle2 className="h-5 w-5" /> Confirm &amp; Collect</>}
                </button>
              </div>
            </div>
          )}

          {phase === 'success' && (
            <div data-testid="kiosk-success-phase" className="text-center animate-in fade-in zoom-in duration-300">
              <div className="w-28 h-28 mx-auto rounded-full bg-emerald-500/20 border-4 border-emerald-400 flex items-center justify-center mb-6">
                <CheckCircle2 className="h-16 w-16 text-emerald-400" />
              </div>
              <h1 className="font-heading text-5xl font-bold mb-2">Collected</h1>
              <p className="font-mono text-lg text-primary mb-1">{lastResult?.collection_code}</p>
              <p className="text-white/70 text-sm mb-8">
                Paid via <span className="font-semibold text-white">Physical QR</span>
              </p>
              <p className="text-xs text-white/40 uppercase tracking-widest">Next scan in 3s…</p>
              <button
                data-testid="kiosk-scan-now-btn"
                onClick={backToScan}
                className="mt-4 bg-primary hover:bg-primary-hover px-6 py-3 rounded-2xl font-semibold text-sm"
              >
                Scan Now
              </button>
            </div>
          )}

          {phase === 'error' && (
            <div data-testid="kiosk-error-phase" className="text-center">
              <div className="w-28 h-28 mx-auto rounded-full bg-red-500/20 border-4 border-red-400 flex items-center justify-center mb-6">
                <XCircle className="h-16 w-16 text-red-400" />
              </div>
              <h1 className="font-heading text-3xl font-bold mb-2">Could not collect</h1>
              <p className="font-mono text-sm text-white/50 mb-2">{code}</p>
              <p className="text-red-300 bg-red-500/10 border border-red-500/30 rounded-2xl px-4 py-3 mb-6 text-sm">{errorMsg}</p>
              <button
                data-testid="kiosk-error-retry-btn"
                onClick={backToScan}
                className="w-full bg-primary hover:bg-primary-hover px-6 py-4 rounded-2xl font-bold"
              >
                Try Again
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Exit password prompt */}
      {exitPromptOpen && (
        <div data-testid="kiosk-exit-modal" className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/10 rounded-3xl max-w-sm w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-heading text-lg font-semibold">Exit Kiosk</h2>
              <button
                data-testid="kiosk-exit-modal-close"
                onClick={() => setExitPromptOpen(false)}
                className="text-white/50 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-sm text-white/70 mb-4">
              Confirm the vendor password to leave kiosk mode. This stops accidental exits during busy hours.
            </p>
            <input
              data-testid="kiosk-exit-pwd"
              type="password"
              autoFocus
              value={exitPwd}
              onChange={(e) => setExitPwd(e.target.value)}
              placeholder="Vendor password"
              className="w-full px-4 py-3 rounded-2xl bg-slate-950 border border-white/20 text-white focus:outline-none focus:border-primary"
              onKeyDown={(e) => e.key === 'Enter' && confirmExit()}
            />
            {exitError && (
              <p data-testid="kiosk-exit-error" className="text-xs text-red-300 mt-2">{exitError}</p>
            )}
            <div className="flex gap-2 mt-5">
              <button
                data-testid="kiosk-exit-logout-btn"
                onClick={exitAndLogout}
                className="flex-1 bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-300 px-4 py-3 rounded-2xl text-sm font-semibold"
              >
                Log Out
              </button>
              <button
                data-testid="kiosk-exit-confirm-btn"
                onClick={confirmExit}
                disabled={!exitPwd}
                className="flex-1 bg-primary hover:bg-primary-hover disabled:opacity-40 text-white px-4 py-3 rounded-2xl text-sm font-bold"
              >
                Exit to Panel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
