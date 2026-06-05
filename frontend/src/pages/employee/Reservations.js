import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Navbar from '../../components/Navbar';
import { Sunrise, Sun, Coffee, Moon, Clock, CheckCircle2, X, Calendar, Store } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const MEAL_META = {
  breakfast: { icon: Sunrise, label: 'Breakfast', emoji: '🌅', color: 'amber' },
  lunch:     { icon: Sun, label: 'Lunch', emoji: '🍽️', color: 'orange' },
  snacks:    { icon: Coffee, label: 'Evening Snacks', emoji: '☕', color: 'rose' },
  dinner:    { icon: Moon, label: 'Dinner', emoji: '🌙', color: 'indigo' },
};

const Countdown = ({ to }) => {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    const tick = () => setRemaining(Math.max(0, new Date(to).getTime() - Date.now()));
    tick();
    const i = setInterval(tick, 30000);
    return () => clearInterval(i);
  }, [to]);
  if (remaining <= 0) return null;
  const hours = Math.floor(remaining / 3600000);
  const mins = Math.floor((remaining % 3600000) / 60000);
  return <span className="text-text-muted">Cutoff in {hours}h {mins}m</span>;
};

const ReservationCard = ({ meal, onReserve, onCancel, reserving }) => {
  const meta = MEAL_META[meal.meal_period];
  const Icon = meta.icon;
  const isReserved = !!meal.already_reserved;
  const isDisabled = !meal.enabled;
  const cutoffPassed = meal.cutoff_passed;
  const [selectedVendorId, setSelectedVendorId] = useState(meal.eligible_vendors?.[0]?.id || '');

  const canReserve = !isReserved && !isDisabled && !cutoffPassed && meal.eligible_vendors?.length > 0;

  return (
    <div
      data-testid={`reservation-card-${meal.meal_period}`}
      className={`bg-card border rounded-2xl p-5 transition-all ${
        isReserved ? 'border-green-300 bg-green-50/30' :
        isDisabled || cutoffPassed ? 'border-border-light opacity-60' :
        'border-border-light hover:shadow-md'
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className={`bg-primary-light rounded-xl p-2.5`}>
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="font-heading text-lg font-semibold text-text-primary">
              {meta.emoji} {meta.label}
            </h3>
            <p className="text-xs text-text-muted">Tomorrow • {meal.delivery_date}</p>
          </div>
        </div>
        {isReserved && (
          <span data-testid={`status-reserved-${meal.meal_period}`} className="bg-green-100 text-green-700 text-xs font-medium px-2.5 py-1 rounded-full flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" /> Reserved
          </span>
        )}
        {isDisabled && (
          <span data-testid={`status-disabled-${meal.meal_period}`} className="bg-gray-100 text-gray-600 text-xs font-medium px-2.5 py-1 rounded-full">Disabled by admin</span>
        )}
        {!isDisabled && !isReserved && cutoffPassed && (
          <span data-testid={`status-cutoff-${meal.meal_period}`} className="bg-red-50 text-red-700 text-xs font-medium px-2.5 py-1 rounded-full flex items-center gap-1">
            <Clock className="h-3 w-3" /> Cutoff passed
          </span>
        )}
      </div>

      {isReserved ? (
        <>
          <div className="bg-white border border-green-200 rounded-lg p-3 text-sm">
            <p className="text-xs text-text-muted">Reserved with</p>
            <p className="font-medium text-text-primary flex items-center gap-1.5 mt-1">
              <Store className="h-4 w-4" /> {meal.already_reserved.vendor_name || 'Vendor'}
            </p>
          </div>
          <button
            onClick={() => onCancel(meal.already_reserved.id)}
            data-testid={`cancel-reservation-${meal.meal_period}`}
            className="mt-3 w-full text-sm text-red-600 hover:bg-red-50 py-2 rounded-lg border border-red-200 transition-colors"
          >
            Cancel reservation
          </button>
        </>
      ) : (
        <>
          {meal.eligible_vendors?.length > 0 ? (
            <>
              <label className="block text-xs text-text-muted mb-1.5">Vendor</label>
              <select
                value={selectedVendorId}
                onChange={(e) => setSelectedVendorId(e.target.value)}
                disabled={!canReserve}
                data-testid={`vendor-select-${meal.meal_period}`}
                className="w-full px-3 py-2 border border-border-light rounded-lg bg-background text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary"
              >
                {meal.eligible_vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
              <button
                onClick={() => onReserve(meal.meal_period, selectedVendorId)}
                disabled={!canReserve || reserving}
                data-testid={`reserve-btn-${meal.meal_period}`}
                className="mt-3 w-full bg-primary hover:bg-primary-hover text-white font-medium py-2.5 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {reserving ? 'Reserving...' : 'Reserve'}
              </button>
            </>
          ) : (
            <p className="text-sm text-text-muted py-2">No vendors available for this meal yet.</p>
          )}
          {!cutoffPassed && !isDisabled && (
            <p className="text-xs text-text-muted mt-2 text-center">
              <Clock className="h-3 w-3 inline mr-1" /><Countdown to={meal.cutoff_at} />
            </p>
          )}
        </>
      )}
    </div>
  );
};

const EmployeeReservations = () => {
  const [availability, setAvailability] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reserving, setReserving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const fetchAvailability = async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API}/reservations/availability`, { withCredentials: true });
      setAvailability(data);
    } catch (e) {
      setError(e.response?.data?.detail || 'Could not load reservations');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAvailability(); }, []);

  const handleReserve = async (mealPeriod, vendorId) => {
    setReserving(true);
    setError(''); setMessage('');
    try {
      await axios.post(`${API}/reservations`, { vendor_id: vendorId, meal_period: mealPeriod }, { withCredentials: true });
      setMessage(`✅ ${MEAL_META[mealPeriod].label} reserved for tomorrow`);
      setTimeout(() => setMessage(''), 4000);
      fetchAvailability();
    } catch (e) {
      setError(e.response?.data?.detail || 'Reservation failed');
    } finally {
      setReserving(false);
    }
  };

  const handleCancel = async (reservationId) => {
    if (!window.confirm('Cancel this reservation?')) return;
    setError('');
    try {
      await axios.delete(`${API}/reservations/${reservationId}`, { withCredentials: true });
      setMessage('Reservation cancelled');
      setTimeout(() => setMessage(''), 3000);
      fetchAvailability();
    } catch (e) {
      setError(e.response?.data?.detail || 'Cancel failed');
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
        <div className="max-w-5xl mx-auto px-6 py-8">
          <div className="mb-8">
            <h1 className="font-heading text-4xl sm:text-5xl tracking-tighter font-semibold text-text-primary">
              Reserve Tomorrow's Meals
            </h1>
            <div className="flex items-center gap-2 mt-2 text-text-secondary">
              <Calendar className="h-4 w-4" />
              <span data-testid="reservation-date">Reservations for {availability?.date}</span>
            </div>
          </div>

          <div className="bg-primary-light border border-primary/20 rounded-2xl p-4 mb-6 flex items-start gap-3">
            <Clock className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
            <div className="text-sm text-text-secondary">
              <strong className="text-text-primary">How it works:</strong> Pick one meal per slot for tomorrow.
              Reservations close at <strong>8 PM today</strong> (your site admin can change this).
              No payment — this is a head-count for your cafeteria to plan prep.
            </div>
          </div>

          {message && (
            <div data-testid="reservation-success" className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">{message}</div>
          )}
          {error && (
            <div data-testid="reservation-error" className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {availability?.meals?.map((m) => (
              <ReservationCard
                key={m.meal_period}
                meal={m}
                onReserve={handleReserve}
                onCancel={handleCancel}
                reserving={reserving}
              />
            ))}
          </div>
        </div>
      </div>
    </>
  );
};

export default EmployeeReservations;
