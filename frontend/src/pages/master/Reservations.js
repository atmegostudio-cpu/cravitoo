import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Navbar from '../../components/Navbar';
import { Calendar, Users, Sunrise, Sun, Coffee, Moon, Settings, Loader2, ToggleLeft, ToggleRight } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const MEAL_META = {
  breakfast: { icon: Sunrise, label: 'Breakfast', emoji: '🌅' },
  lunch:     { icon: Sun, label: 'Lunch', emoji: '🍽️' },
  snacks:    { icon: Coffee, label: 'Snacks', emoji: '☕' },
  dinner:    { icon: Moon, label: 'Dinner', emoji: '🌙' },
};

const AdminReservations = () => {
  const [summary, setSummary] = useState(null);
  const [sites, setSites] = useState([]);
  const [selectedSiteId, setSelectedSiteId] = useState('');
  const [siteSettings, setSiteSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [message, setMessage] = useState('');

  const fetchSummary = async () => {
    try {
      const { data } = await axios.get(`${API}/reservations/admin/summary`, { withCredentials: true });
      setSummary(data);
    } catch (e) { console.error(e); }
  };

  const fetchSites = async () => {
    try {
      const { data } = await axios.get(`${API}/sites`, { withCredentials: true });
      setSites(data);
      if (data.length > 0 && !selectedSiteId) setSelectedSiteId(data[0].id);
    } catch (e) { console.error(e); }
  };

  const fetchSiteSettings = async (siteId) => {
    if (!siteId) return;
    setSettingsLoading(true);
    try {
      const { data } = await axios.get(`${API}/sites/${siteId}/reservation-settings`, { withCredentials: true });
      setSiteSettings(data);
    } catch (e) {
      console.error(e);
    } finally {
      setSettingsLoading(false);
    }
  };

  useEffect(() => {
    Promise.all([fetchSummary(), fetchSites()]).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (selectedSiteId) fetchSiteSettings(selectedSiteId);
  }, [selectedSiteId]);

  const handleToggle = async (meal) => {
    const currentEnabled = siteSettings?.settings?.[meal]?.enabled;
    try {
      const { data } = await axios.patch(
        `${API}/sites/${selectedSiteId}/reservation-settings`,
        { [`${meal}_enabled`]: !currentEnabled },
        { withCredentials: true },
      );
      setSiteSettings({ ...siteSettings, settings: data.settings });
      setMessage(`${MEAL_META[meal].label} reservations ${!currentEnabled ? 'enabled' : 'disabled'} for ${siteSettings.site_name}`);
      setTimeout(() => setMessage(''), 4000);
    } catch (e) {
      alert(e.response?.data?.detail || 'Update failed');
    }
  };

  const handleCutoffChange = async (hour) => {
    try {
      const { data } = await axios.patch(
        `${API}/sites/${selectedSiteId}/reservation-settings`,
        { cutoff_hour: parseInt(hour, 10) },
        { withCredentials: true },
      );
      setSiteSettings({ ...siteSettings, settings: data.settings });
      setMessage(`Cutoff changed to ${hour}:00 IST (previous day)`);
      setTimeout(() => setMessage(''), 4000);
    } catch (e) {
      alert(e.response?.data?.detail || 'Update failed');
    }
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

  const cutoffHour = siteSettings?.settings?.lunch?.cutoff_hour ?? 20;

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-background">
        <div className="max-w-6xl mx-auto px-6 py-8">
          <div className="mb-8">
            <h1 className="font-heading text-4xl sm:text-5xl tracking-tighter font-semibold text-text-primary">
              Meal Reservations
            </h1>
            <p className="text-text-secondary mt-2 flex items-center gap-2">
              <Calendar className="h-4 w-4" /> Tomorrow • {summary?.date}
            </p>
          </div>

          {/* Aggregate counts */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            {Object.entries(MEAL_META).map(([meal, meta]) => {
              const Icon = meta.icon;
              return (
                <div key={meal} data-testid={`summary-${meal}`} className="bg-card border border-border-light rounded-2xl p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="bg-primary-light rounded-lg p-2"><Icon className="h-4 w-4 text-primary" /></div>
                    <p className="text-sm font-medium text-text-secondary">{meta.emoji} {meta.label}</p>
                  </div>
                  <p className="font-heading text-3xl font-semibold text-text-primary">{summary?.by_meal?.[meal] || 0}</p>
                </div>
              );
            })}
          </div>

          <div className="bg-gradient-to-r from-primary to-orange-600 text-white rounded-2xl p-5 mb-8 flex items-center gap-3">
            <Users className="h-8 w-8" />
            <div>
              <p className="text-sm opacity-90">Total reservations for tomorrow</p>
              <p className="font-heading text-3xl font-semibold">{summary?.total_reservations || 0}</p>
            </div>
          </div>

          {/* Per-site settings */}
          <div className="bg-card border border-border-light rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <Settings className="h-5 w-5 text-primary" />
              <h2 className="font-heading text-xl font-semibold text-text-primary">Reservation Settings</h2>
            </div>

            {message && (
              <div data-testid="settings-message" className="mb-4 p-3 bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg">{message}</div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">Site</label>
                <select
                  value={selectedSiteId}
                  onChange={(e) => setSelectedSiteId(e.target.value)}
                  data-testid="site-select"
                  className="w-full px-3 py-2.5 border border-border-light rounded-lg bg-background"
                >
                  {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">Cutoff hour (previous day, IST)</label>
                <select
                  value={cutoffHour}
                  onChange={(e) => handleCutoffChange(e.target.value)}
                  data-testid="cutoff-select"
                  disabled={settingsLoading || !siteSettings}
                  className="w-full px-3 py-2.5 border border-border-light rounded-lg bg-background"
                >
                  {[15, 16, 17, 18, 19, 20, 21, 22, 23].map(h => (
                    <option key={h} value={h}>{h}:00 ({h - 12 || h}{h >= 12 ? ' PM' : ' AM'})</option>
                  ))}
                </select>
              </div>
            </div>

            {settingsLoading ? (
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            ) : siteSettings && (
              <>
                <p className="text-sm text-text-secondary mb-3">Toggle each meal type on/off for this site:</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {Object.entries(MEAL_META).map(([meal, meta]) => {
                    const enabled = siteSettings.settings[meal]?.enabled;
                    return (
                      <button
                        key={meal}
                        onClick={() => handleToggle(meal)}
                        data-testid={`toggle-${meal}`}
                        className={`flex items-center justify-between p-4 rounded-xl border transition-all ${
                          enabled ? 'bg-primary-light border-primary/30' : 'bg-background border-border-light'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <meta.icon className="h-5 w-5 text-text-primary" />
                          <span className="font-medium text-text-primary">{meta.emoji} {meta.label}</span>
                        </div>
                        {enabled
                          ? <ToggleRight data-testid={`toggle-on-${meal}`} className="h-7 w-7 text-primary" />
                          : <ToggleLeft data-testid={`toggle-off-${meal}`} className="h-7 w-7 text-text-muted" />
                        }
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default AdminReservations;
