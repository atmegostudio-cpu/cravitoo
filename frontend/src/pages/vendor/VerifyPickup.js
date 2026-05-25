import React, { useState } from 'react';
import axios from 'axios';
import Navbar from '../../components/Navbar';
import { QrCode, CheckCircle, XCircle, Scan } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const VendorVerifyPickup = () => {
  const [qrCode, setQrCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState(null);

  const handleVerify = async (e) => {
    e.preventDefault();
    setVerifying(true);
    setResult(null);

    try {
      // Extract order_id from QR code format: CRAVITOO-PICKUP-{order_id}-{hash}
      const parts = qrCode.trim().split('-');
      if (parts.length < 4 || parts[0] !== 'CRAVITOO' || parts[1] !== 'PICKUP') {
        setResult({ success: false, message: 'Invalid QR code format' });
        setVerifying(false);
        return;
      }
      
      const orderId = parts[2];
      
      const { data } = await axios.post(
        `${API}/orders/${orderId}/verify-pickup?qr_code=${encodeURIComponent(qrCode.trim())}`,
        {},
        { withCredentials: true }
      );

      setResult({ success: true, message: data.message, orderId: data.order_id });
      setQrCode('');
    } catch (error) {
      setResult({
        success: false,
        message: error.response?.data?.detail || 'Verification failed'
      });
    } finally {
      setVerifying(false);
    }
  };

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-background">
        <div className="max-w-2xl mx-auto px-6 py-8">
          <h1 className="font-heading text-4xl sm:text-5xl tracking-tighter font-semibold text-text-primary mb-2">
            Verify Pickup
          </h1>
          <p className="text-text-secondary text-lg mb-8">
            Scan or enter the customer's pickup QR code
          </p>

          <div className="bg-card border border-border-light rounded-2xl p-8">
            <div className="flex items-center justify-center mb-6">
              <div className="bg-primary-light rounded-full p-6">
                <QrCode className="h-16 w-16 text-primary" />
              </div>
            </div>

            <form onSubmit={handleVerify} data-testid="verify-pickup-form">
              <div className="mb-6">
                <label className="block text-sm font-medium text-text-primary mb-2">
                  Enter QR Code
                </label>
                <input
                  type="text"
                  data-testid="qr-code-input"
                  value={qrCode}
                  onChange={(e) => setQrCode(e.target.value)}
                  placeholder="CRAVITOO-PICKUP-..."
                  className="w-full px-4 py-3 border border-border-light rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary bg-background font-mono text-sm"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={verifying || !qrCode.trim()}
                data-testid="verify-submit-btn"
                className="w-full bg-primary hover:bg-primary-hover text-white py-3 rounded-lg font-medium transition-all duration-200 flex items-center justify-center space-x-2 disabled:opacity-50"
              >
                {verifying ? (
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                ) : (
                  <>
                    <Scan className="h-5 w-5" />
                    <span>Verify Pickup</span>
                  </>
                )}
              </button>
            </form>

            {result && (
              <div
                data-testid="verify-result"
                className={`mt-6 p-4 rounded-lg flex items-start space-x-3 ${
                  result.success
                    ? 'bg-green-50 border border-green-200'
                    : 'bg-red-50 border border-red-200'
                }`}
              >
                {result.success ? (
                  <CheckCircle className="h-6 w-6 text-green-600 flex-shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="h-6 w-6 text-red-600 flex-shrink-0 mt-0.5" />
                )}
                <div>
                  <p className={`font-medium ${result.success ? 'text-green-800' : 'text-red-800'}`}>
                    {result.message}
                  </p>
                  {result.success && result.orderId && (
                    <p className="text-sm text-green-700 mt-1">Order #{result.orderId.slice(-8)} marked as completed</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default VendorVerifyPickup;
