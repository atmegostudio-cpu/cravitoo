import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Navbar from '../../components/Navbar';
import { Calendar, CheckCircle, Plus } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const PLANS = [
  { id: 'basic', name: 'Basic Plan', meals: '1 meal/day', duration: 30, price: 3000, color: 'border-border-light' },
  { id: 'standard', name: 'Standard Plan', meals: '2 meals/day', duration: 30, price: 5500, color: 'border-primary' },
  { id: 'premium', name: 'Premium Plan', meals: '3 meals/day', duration: 30, price: 7500, color: 'border-accent-hover' }
];

const EmployeeSubscriptions = () => {
  const [subscriptions, setSubscriptions] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [selectedVendor, setSelectedVendor] = useState('');
  const [mealType, setMealType] = useState('lunch');
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [subsRes, vendorsRes] = await Promise.all([
        axios.get(`${API}/subscriptions`, { withCredentials: true }),
        axios.get(`${API}/vendors`, { withCredentials: true })
      ]);
      setSubscriptions(subsRes.data);
      setVendors(vendorsRes.data);
      if (vendorsRes.data.length > 0) {
        setSelectedVendor(vendorsRes.data[0].id);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const subscribe = async () => {
    if (!selectedPlan || !selectedVendor) return;
    try {
      await axios.post(
        `${API}/subscriptions`,
        {
          vendor_id: selectedVendor,
          plan_type: selectedPlan.id,
          meal_type: mealType,
          duration_days: selectedPlan.duration
        },
        { withCredentials: true }
      );
      setMessage('Subscription created successfully!');
      setSelectedPlan(null);
      fetchData();
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      setMessage('Failed to create subscription');
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
        <div className="max-w-7xl mx-auto px-6 py-8">
          <h1 className="font-heading text-4xl sm:text-5xl tracking-tighter font-semibold text-text-primary mb-2">
            Meal Subscriptions
          </h1>
          <p className="text-text-secondary text-lg mb-8">
            Save more with monthly meal plans
          </p>

          {message && (
            <div data-testid="subscription-message" className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700">
              {message}
            </div>
          )}

          {subscriptions.length > 0 && (
            <div className="mb-8">
              <h2 className="font-heading text-2xl font-medium text-text-primary mb-4">Active Subscriptions</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {subscriptions.filter(s => s.status === 'active').map((sub) => (
                  <div key={sub.id} data-testid={`active-sub-${sub.id}`} className="bg-gradient-to-br from-primary-light to-accent-light border border-primary/20 rounded-2xl p-6">
                    <div className="flex items-center justify-between mb-4">
                      <CheckCircle className="h-8 w-8 text-primary" />
                      <span className="text-xs bg-white px-3 py-1 rounded-full text-primary font-medium">Active</span>
                    </div>
                    <h3 className="font-heading text-lg font-medium text-text-primary mb-2 capitalize">{sub.plan_type} Plan</h3>
                    <p className="text-text-secondary text-sm mb-3 capitalize">{sub.meal_type}</p>
                    <p className="text-xs text-text-muted">
                      Ends: {new Date(sub.end_date).toLocaleDateString()}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <h2 className="font-heading text-2xl font-medium text-text-primary mb-4">Choose Your Plan</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            {PLANS.map((plan) => (
              <div
                key={plan.id}
                data-testid={`plan-${plan.id}`}
                onClick={() => setSelectedPlan(plan)}
                className={`bg-card border-2 rounded-2xl p-6 cursor-pointer transition-all duration-200 hover:shadow-lg ${
                  selectedPlan?.id === plan.id ? 'border-primary ring-4 ring-primary/20' : plan.color
                }`}
              >
                <div className="flex items-center justify-between mb-4">
                  <Calendar className="h-8 w-8 text-primary" />
                  {plan.id === 'standard' && (
                    <span className="text-xs bg-primary text-white px-3 py-1 rounded-full font-medium">Popular</span>
                  )}
                </div>
                <h3 className="font-heading text-2xl font-medium text-text-primary mb-2">{plan.name}</h3>
                <p className="text-text-secondary mb-4">{plan.meals}</p>
                <p className="font-heading text-4xl font-semibold text-primary mb-2">₹{plan.price}</p>
                <p className="text-text-muted text-sm">for {plan.duration} days</p>
              </div>
            ))}
          </div>

          {selectedPlan && (
            <div data-testid="subscribe-section" className="bg-card border border-border-light rounded-2xl p-6">
              <h3 className="font-heading text-xl font-medium text-text-primary mb-4">Configure Your Subscription</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">Vendor</label>
                  <select
                    data-testid="sub-vendor-select"
                    value={selectedVendor}
                    onChange={(e) => setSelectedVendor(e.target.value)}
                    className="w-full px-4 py-3 border border-border-light rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary bg-background"
                  >
                    {vendors.map((vendor) => (
                      <option key={vendor.id} value={vendor.id}>{vendor.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">Meal Type</label>
                  <select
                    data-testid="sub-meal-type"
                    value={mealType}
                    onChange={(e) => setMealType(e.target.value)}
                    className="w-full px-4 py-3 border border-border-light rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary bg-background"
                  >
                    <option value="breakfast">Breakfast</option>
                    <option value="lunch">Lunch</option>
                    <option value="dinner">Dinner</option>
                  </select>
                </div>
              </div>

              <button
                onClick={subscribe}
                data-testid="subscribe-btn"
                className="w-full bg-primary hover:bg-primary-hover text-white py-3 rounded-lg font-medium transition-all duration-200 flex items-center justify-center space-x-2"
              >
                <Plus className="h-5 w-5" />
                <span>Subscribe to {selectedPlan.name} - ₹{selectedPlan.price}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default EmployeeSubscriptions;
