import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Navbar from '../../components/Navbar';
import { Heart, AlertTriangle, Utensils, Save } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const DIETARY_OPTIONS = ['Vegetarian', 'Vegan', 'Non-vegetarian', 'Gluten-free', 'Dairy-free', 'Low-carb', 'Keto'];
const ALLERGY_OPTIONS = ['Peanuts', 'Tree nuts', 'Dairy', 'Eggs', 'Soy', 'Wheat', 'Shellfish', 'Fish'];
const CUISINE_OPTIONS = ['North Indian', 'South Indian', 'Chinese', 'Italian', 'Continental', 'Mexican', 'Thai', 'Japanese'];

const EmployeePreferences = () => {
  const [preferences, setPreferences] = useState({
    dietary_preferences: [],
    allergies: [],
    favorite_cuisines: []
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetchPreferences();
  }, []);

  const fetchPreferences = async () => {
    try {
      const { data } = await axios.get(`${API}/preferences`, { withCredentials: true });
      setPreferences(data);
    } catch (error) {
      console.error('Error fetching preferences:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleItem = (category, item) => {
    setPreferences(prev => ({
      ...prev,
      [category]: prev[category].includes(item)
        ? prev[category].filter(i => i !== item)
        : [...prev[category], item]
    }));
  };

  const savePreferences = async () => {
    setSaving(true);
    setMessage('');
    try {
      await axios.post(`${API}/preferences`, preferences, { withCredentials: true });
      setMessage('Preferences saved successfully!');
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      setMessage('Failed to save preferences');
    } finally {
      setSaving(false);
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
        <div className="max-w-4xl mx-auto px-6 py-8">
          <h1 className="font-heading text-4xl sm:text-5xl tracking-tighter font-semibold text-text-primary mb-2">
            My Preferences
          </h1>
          <p className="text-text-secondary text-lg mb-8">
            Tell us your preferences to get personalized meal recommendations
          </p>

          {message && (
            <div data-testid="preferences-message" className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700">
              {message}
            </div>
          )}

          <div className="space-y-6">
            <div data-testid="dietary-section" className="bg-card border border-border-light rounded-2xl p-6">
              <div className="flex items-center space-x-3 mb-4">
                <div className="bg-primary-light rounded-xl p-2">
                  <Utensils className="h-5 w-5 text-primary" />
                </div>
                <h3 className="font-heading text-xl font-medium text-text-primary">Dietary Preferences</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {DIETARY_OPTIONS.map((option) => (
                  <button
                    key={option}
                    data-testid={`dietary-${option.toLowerCase()}`}
                    onClick={() => toggleItem('dietary_preferences', option)}
                    className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 ${
                      preferences.dietary_preferences.includes(option)
                        ? 'bg-primary text-white'
                        : 'bg-background border border-border-light text-text-secondary hover:border-primary'
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>

            <div data-testid="allergies-section" className="bg-card border border-border-light rounded-2xl p-6">
              <div className="flex items-center space-x-3 mb-4">
                <div className="bg-red-50 rounded-xl p-2">
                  <AlertTriangle className="h-5 w-5 text-red-600" />
                </div>
                <h3 className="font-heading text-xl font-medium text-text-primary">Allergies</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {ALLERGY_OPTIONS.map((option) => (
                  <button
                    key={option}
                    data-testid={`allergy-${option.toLowerCase().replace(' ', '-')}`}
                    onClick={() => toggleItem('allergies', option)}
                    className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 ${
                      preferences.allergies.includes(option)
                        ? 'bg-red-600 text-white'
                        : 'bg-background border border-border-light text-text-secondary hover:border-red-500'
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>

            <div data-testid="cuisines-section" className="bg-card border border-border-light rounded-2xl p-6">
              <div className="flex items-center space-x-3 mb-4">
                <div className="bg-accent-light rounded-xl p-2">
                  <Heart className="h-5 w-5 text-accent-hover" />
                </div>
                <h3 className="font-heading text-xl font-medium text-text-primary">Favorite Cuisines</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {CUISINE_OPTIONS.map((option) => (
                  <button
                    key={option}
                    data-testid={`cuisine-${option.toLowerCase().replace(' ', '-')}`}
                    onClick={() => toggleItem('favorite_cuisines', option)}
                    className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 ${
                      preferences.favorite_cuisines.includes(option)
                        ? 'bg-accent-hover text-white'
                        : 'bg-background border border-border-light text-text-secondary hover:border-accent-hover'
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={savePreferences}
              disabled={saving}
              data-testid="save-preferences-btn"
              className="w-full bg-primary hover:bg-primary-hover text-white py-3 rounded-lg font-medium transition-all duration-200 flex items-center justify-center space-x-2 disabled:opacity-50"
            >
              {saving ? (
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
              ) : (
                <>
                  <Save className="h-5 w-5" />
                  <span>Save Preferences</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default EmployeePreferences;
