import React, { useState, useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { X, Camera, Keyboard, CheckCircle2, AlertCircle, IndianRupee, Loader2 } from 'lucide-react';
import axios from 'axios';
import logger from '../lib/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/**
 * Vendor-side one-tap collect modal.
 *
 * Flow:
 *   1. Vendor taps "Scan & Collect" — modal opens with rear camera
 *   2. Employee holds their CRV-XXXXXX QR up
 *   3. On decode → confirm the code + pick Cash / Physical QR
 *   4. POST /api/orders/collect/{code} → marks paid + collected in one call
 *
 * Falls back to a manual text-entry field for cases where the browser
 * blocks camera access or the QR is smudged.
 */
const SCANNER_ID = 'crv-scanner-region';

export default function CollectionScanner({ open, onClose, onSuccess }) {
  const [phase, setPhase] = useState('scan');   // 'scan' | 'confirm' | 'success' | 'error'
  const [code, setCode] = useState('');
  const [method, setMethod] = useState('cash');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [manualMode, setManualMode] = useState(false);
  const [result, setResult] = useState(null);
  const scannerRef = useRef(null);
  const stoppedRef = useRef(false);

  const stopScanner = async () => {
    if (!scannerRef.current || stoppedRef.current) return;
    stoppedRef.current = true;
    try {
      const state = scannerRef.current.getState?.();
      // 2 = SCANNING, 3 = PAUSED
      if (state === 2 || state === 3) {
        await scannerRef.current.stop();
      }
      await scannerRef.current.clear();
    } catch (err) {
      logger.warn('Scanner stop failed', err);
    }
    scannerRef.current = null;
  };

  useEffect(() => {
    if (!open || manualMode || phase !== 'scan') return;
    stoppedRef.current = false;
    let cancelled = false;

    (async () => {
      try {
        const html5 = new Html5Qrcode(SCANNER_ID, /* verbose= */ false);
        scannerRef.current = html5;
        await html5.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 240, height: 240 }, aspectRatio: 1.0 },
          (decoded) => {
            if (cancelled) return;
            handleDecoded(decoded);
          },
          () => { /* per-frame decode errors — swallow */ },
        );
      } catch (err) {
        if (cancelled) return;
        logger.warn('Scanner init failed', err);
        setErrorMsg('Camera unavailable. Enter the code manually.');
        setManualMode(true);
      }
    })();

    return () => {
      cancelled = true;
      stopScanner();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, manualMode, phase]);

  const handleDecoded = async (raw) => {
    const cleaned = (raw || '').trim().toUpperCase();
    if (!cleaned.startsWith('CRV-')) {
      setErrorMsg(`"${cleaned.slice(0, 20)}" is not a Cravitoo collection code. Ask the employee to open Orders → Collection QR.`);
      return;
    }
    await stopScanner();
    setCode(cleaned);
    setErrorMsg('');
    setPhase('confirm');
  };

  const submit = async () => {
    if (!code || busy) return;
    setBusy(true);
    setErrorMsg('');
    try {
      const { data } = await axios.post(
        `${API}/orders/collect/${encodeURIComponent(code)}`,
        { method },
        { withCredentials: true, timeout: 15000 },
      );
      setResult(data);
      setPhase('success');
      onSuccess?.(data);
    } catch (err) {
      const detail = err.response?.data?.detail || 'Could not complete collect';
      setErrorMsg(detail);
      setPhase('error');
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    await stopScanner();
    setPhase('scan');
    setCode('');
    setMethod('cash');
    setErrorMsg('');
    setResult(null);
    setManualMode(false);
    stoppedRef.current = false;
  };

  const close = async () => {
    await stopScanner();
    setPhase('scan');
    setCode('');
    setMethod('cash');
    setErrorMsg('');
    setResult(null);
    setManualMode(false);
    onClose?.();
  };

  if (!open) return null;

  return (
    <div
      data-testid="collection-scanner-modal"
      className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div className="bg-card w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl border border-border-light shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-light">
          <div className="flex items-center gap-2">
            <Camera className="h-5 w-5 text-primary" />
            <h2 className="font-heading text-lg font-semibold text-text-primary">
              {phase === 'success' ? 'Collected' : phase === 'confirm' ? 'Confirm Collection' : 'Scan Collection QR'}
            </h2>
          </div>
          <button
            data-testid="scanner-close-btn"
            onClick={close}
            className="p-1.5 rounded-full hover:bg-background text-text-secondary"
            aria-label="Close scanner"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5">
          {phase === 'scan' && !manualMode && (
            <>
              <div id={SCANNER_ID} className="w-full aspect-square rounded-2xl overflow-hidden bg-black relative" data-testid="scanner-camera-region" />
              <p className="text-xs text-text-muted mt-3 text-center">
                Point the camera at the employee's <span className="font-mono font-medium text-text-primary">CRV-XXXXXX</span> QR code.
              </p>
              {errorMsg && (
                <div className="mt-3 flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2" data-testid="scanner-error">
                  <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}
              <button
                onClick={() => { stopScanner(); setManualMode(true); setErrorMsg(''); }}
                data-testid="scanner-manual-toggle"
                className="w-full mt-4 flex items-center justify-center gap-2 bg-background hover:bg-background/80 border border-border-light text-text-primary px-4 py-2.5 rounded-xl text-sm font-medium"
              >
                <Keyboard className="h-4 w-4" /> Type code instead
              </button>
            </>
          )}

          {phase === 'scan' && manualMode && (
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Collection Code</label>
              <input
                data-testid="scanner-manual-input"
                type="text"
                autoFocus
                autoCapitalize="characters"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="CRV-A1B2C3"
                className="w-full px-4 py-3 rounded-xl border border-border-light bg-background font-mono text-lg tracking-widest text-center text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              <p className="text-xs text-text-muted mt-2">Ask the employee to read out their 6-character code.</p>
              {errorMsg && (
                <div className="mt-3 flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">
                  <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}
              <div className="flex gap-2 mt-4">
                <button
                  data-testid="scanner-back-to-camera"
                  onClick={() => { setManualMode(false); setErrorMsg(''); setCode(''); }}
                  className="flex-1 bg-background hover:bg-background/80 border border-border-light text-text-primary px-4 py-2.5 rounded-xl text-sm font-medium"
                >
                  Use camera
                </button>
                <button
                  data-testid="scanner-manual-continue"
                  onClick={() => handleDecoded(code)}
                  disabled={!code}
                  className="flex-1 bg-primary hover:bg-primary-hover disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-sm font-medium"
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {phase === 'confirm' && (
            <div data-testid="scanner-confirm-panel">
              <div className="text-center bg-gradient-to-br from-primary-light to-accent-light rounded-2xl p-5 mb-5">
                <p className="text-xs uppercase tracking-wider text-text-muted mb-1">Collection code</p>
                <p className="font-mono text-2xl font-bold text-primary tracking-widest" data-testid="scanner-detected-code">{code}</p>
              </div>

              <p className="text-sm font-medium text-text-primary mb-2">How did the employee pay?</p>
              <div className="grid grid-cols-2 gap-2 mb-5">
                <button
                  data-testid="scanner-method-cash"
                  onClick={() => setMethod('cash')}
                  className={`p-4 rounded-xl border-2 text-left transition-all ${method === 'cash' ? 'border-primary bg-primary-light' : 'border-border-light bg-background hover:border-primary/40'}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <IndianRupee className="h-4 w-4 text-primary" />
                    <span className="text-sm font-semibold text-text-primary">Cash</span>
                  </div>
                  <p className="text-[11px] text-text-muted">Received notes at the counter</p>
                </button>
                <button
                  data-testid="scanner-method-qr"
                  onClick={() => setMethod('physical_qr')}
                  className={`p-4 rounded-xl border-2 text-left transition-all ${method === 'physical_qr' ? 'border-primary bg-primary-light' : 'border-border-light bg-background hover:border-primary/40'}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Camera className="h-4 w-4 text-primary" />
                    <span className="text-sm font-semibold text-text-primary">Physical QR</span>
                  </div>
                  <p className="text-[11px] text-text-muted">UPI to your counter QR</p>
                </button>
              </div>

              {errorMsg && (
                <div className="mb-3 flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">
                  <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <div className="flex gap-2">
                <button
                  data-testid="scanner-cancel-btn"
                  onClick={reset}
                  disabled={busy}
                  className="flex-1 bg-background hover:bg-background/80 border border-border-light text-text-primary px-4 py-3 rounded-xl text-sm font-medium disabled:opacity-50"
                >
                  Rescan
                </button>
                <button
                  data-testid="scanner-confirm-btn"
                  onClick={submit}
                  disabled={busy}
                  className="flex-1 flex items-center justify-center gap-2 bg-primary hover:bg-primary-hover text-white px-4 py-3 rounded-xl text-sm font-semibold disabled:opacity-50"
                >
                  {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Working...</> : <>Confirm & Collect</>}
                </button>
              </div>
            </div>
          )}

          {phase === 'success' && (
            <div data-testid="scanner-success-panel" className="text-center py-4">
              <div className="w-16 h-16 rounded-full bg-green-100 mx-auto mb-4 flex items-center justify-center">
                <CheckCircle2 className="h-9 w-9 text-green-600" />
              </div>
              <h3 className="font-heading text-xl font-semibold text-text-primary mb-1">Order Collected</h3>
              <p className="font-mono text-sm text-primary mb-4">{result?.collection_code}</p>
              <p className="text-sm text-text-secondary mb-6">
                Marked as <strong>Paid ({result?.payment_method === 'cash' ? 'Cash' : 'Physical QR'})</strong> and <strong>Collected</strong>.
              </p>
              <div className="flex gap-2">
                <button
                  data-testid="scanner-scan-another-btn"
                  onClick={reset}
                  className="flex-1 bg-primary hover:bg-primary-hover text-white px-4 py-3 rounded-xl text-sm font-semibold"
                >
                  Scan Another
                </button>
                <button
                  data-testid="scanner-done-btn"
                  onClick={close}
                  className="flex-1 bg-background hover:bg-background/80 border border-border-light text-text-primary px-4 py-3 rounded-xl text-sm font-medium"
                >
                  Done
                </button>
              </div>
            </div>
          )}

          {phase === 'error' && (
            <div data-testid="scanner-error-panel" className="text-center py-4">
              <div className="w-16 h-16 rounded-full bg-red-100 mx-auto mb-4 flex items-center justify-center">
                <AlertCircle className="h-9 w-9 text-red-600" />
              </div>
              <h3 className="font-heading text-xl font-semibold text-text-primary mb-1">Could not collect</h3>
              <p className="font-mono text-xs text-text-muted mb-2">{code}</p>
              <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3 mb-6">{errorMsg}</p>
              <div className="flex gap-2">
                <button
                  data-testid="scanner-error-retry-btn"
                  onClick={reset}
                  className="flex-1 bg-primary hover:bg-primary-hover text-white px-4 py-3 rounded-xl text-sm font-semibold"
                >
                  Try Again
                </button>
                <button
                  data-testid="scanner-error-close-btn"
                  onClick={close}
                  className="flex-1 bg-background hover:bg-background/80 border border-border-light text-text-primary px-4 py-3 rounded-xl text-sm font-medium"
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
