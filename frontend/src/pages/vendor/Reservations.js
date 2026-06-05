import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Navbar from '../../components/Navbar';
import { Calendar, Users, Coffee, Sunrise, Sun, Moon, Loader2, CheckCircle2 } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const MEAL_META = {
  breakfast: { icon: Sunrise, label: 'Breakfast', emoji: '🌅' },
  lunch:     { icon: Sun, label: 'Lunch', emoji: '🍽️' },
  snacks:    { icon: Coffee, label: 'Snacks', emoji: '☕' },
  dinner:    { icon: Moon, label: 'Dinner', emoji: '🌙' },
};

const VendorReservations = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      try {
        const { data } = await axios.get(`${API}/reservations/vendor/counts`, { withCredentials: true });
        setData(data);
      } catch (e) {
        console.error(e);
      } finally { setLoading(false); }
    };
    fetch();
  }, []);

  const handleExport = () => {
    if (!data?.reservations?.length) return;
    const csv = [
      ['Meal', 'Employee Name', 'Email', 'Pickup QR', 'Reserved At'].join(','),
      ...data.reservations.map(r => [r.meal_period, r.employee_name, r.employee_email, r.pickup_qr, r.created_at].join(',')),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cravitoo-reservations-${data.date}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <>
        <Navbar />
        <div className="min-h-screen bg-background flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </>
    );
  }

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-background">
        <div className="max-w-6xl mx-auto px-6 py-8">
          <div className="mb-8 flex flex-wrap justify-between items-start gap-3">
            <div>
              <h1 className="font-heading text-4xl sm:text-5xl tracking-tighter font-semibold text-text-primary">
                Tomorrow's Reservations
              </h1>
              <p className="text-text-secondary mt-2 flex items-center gap-2">
                <Calendar className="h-4 w-4" /> {data?.date}
              </p>
            </div>
            <button
              onClick={handleExport}
              disabled={!data?.reservations?.length}
              data-testid="export-csv-btn"
              className="bg-primary hover:bg-primary-hover disabled:opacity-40 text-white px-5 py-2.5 rounded-lg font-medium transition-colors"
            >
              Export Kitchen List (CSV)
            </button>
          </div>

          {/* Head-count cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
            {Object.entries(MEAL_META).map(([meal, meta]) => {
              const c = data?.counts?.[meal] || { reserved: 0, consumed: 0 };
              const Icon = meta.icon;
              return (
                <div key={meal} data-testid={`count-${meal}`} className="bg-card border border-border-light rounded-2xl p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="bg-primary-light rounded-lg p-2">
                      <Icon className="h-4 w-4 text-primary" />
                    </div>
                    <p className="text-sm font-medium text-text-secondary">{meta.emoji} {meta.label}</p>
                  </div>
                  <p className="font-heading text-3xl font-semibold text-text-primary">{c.reserved}</p>
                  <p className="text-xs text-text-muted mt-1">{c.consumed} consumed</p>
                </div>
              );
            })}
          </div>

          {/* Grand total */}
          <div className="bg-gradient-to-r from-primary to-orange-600 text-white rounded-2xl p-5 mb-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Users className="h-8 w-8" />
              <div>
                <p className="text-sm opacity-90">Total reservations</p>
                <p className="font-heading text-3xl font-semibold">{data?.total || 0}</p>
              </div>
            </div>
            <p className="text-sm opacity-90">Plan prep accordingly</p>
          </div>

          {/* Detailed list */}
          <div className="bg-card border border-border-light rounded-2xl overflow-hidden">
            <div className="p-5 border-b border-border-light">
              <h2 className="font-heading text-xl font-semibold text-text-primary">Customer List</h2>
              <p className="text-sm text-text-secondary">Showing all active reservations for tomorrow</p>
            </div>
            {data?.reservations?.length === 0 ? (
              <p data-testid="empty-reservations" className="p-8 text-center text-text-muted">No reservations yet for tomorrow.</p>
            ) : (
              <table className="w-full">
                <thead className="bg-background text-xs text-text-muted uppercase tracking-wider">
                  <tr>
                    <th className="text-left px-5 py-3">Meal</th>
                    <th className="text-left px-5 py-3">Employee</th>
                    <th className="text-left px-5 py-3 hidden sm:table-cell">Email</th>
                    <th className="text-left px-5 py-3 hidden md:table-cell">Reserved at</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.reservations?.map((r) => (
                    <tr key={r.id} data-testid={`vendor-reservation-${r.id}`} className="border-t border-border-light hover:bg-background/50">
                      <td className="px-5 py-3 text-sm">
                        <span className="capitalize">{MEAL_META[r.meal_period]?.emoji} {r.meal_period}</span>
                      </td>
                      <td className="px-5 py-3 text-sm text-text-primary font-medium">{r.employee_name}</td>
                      <td className="px-5 py-3 text-sm text-text-secondary hidden sm:table-cell">{r.employee_email}</td>
                      <td className="px-5 py-3 text-sm text-text-muted hidden md:table-cell">{new Date(r.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default VendorReservations;
