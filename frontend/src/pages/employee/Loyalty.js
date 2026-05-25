import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Navbar from '../../components/Navbar';
import { Award, Star, TrendingUp, Gift } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const TIER_COLORS = {
  Starter: { bg: 'from-gray-100 to-gray-200', icon: 'text-gray-600', badge: 'bg-gray-600' },
  Bronze: { bg: 'from-orange-100 to-amber-100', icon: 'text-orange-700', badge: 'bg-orange-700' },
  Silver: { bg: 'from-slate-100 to-slate-200', icon: 'text-slate-600', badge: 'bg-slate-600' },
  Gold: { bg: 'from-yellow-100 to-amber-200', icon: 'text-yellow-700', badge: 'bg-yellow-700' }
};

const EmployeeLoyalty = () => {
  const [loyalty, setLoyalty] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLoyalty();
  }, []);

  const fetchLoyalty = async () => {
    try {
      const { data } = await axios.get(`${API}/loyalty`, { withCredentials: true });
      setLoyalty(data);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
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

  const tier = loyalty?.tier || 'Starter';
  const colors = TIER_COLORS[tier];

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-background">
        <div className="max-w-5xl mx-auto px-6 py-8">
          <h1 className="font-heading text-4xl sm:text-5xl tracking-tighter font-semibold text-text-primary mb-2">
            Loyalty Rewards
          </h1>
          <p className="text-text-secondary text-lg mb-8">
            Earn points with every order and unlock exclusive rewards
          </p>

          <div data-testid="loyalty-tier-card" className={`bg-gradient-to-br ${colors.bg} border-2 border-primary/10 rounded-3xl p-8 mb-8`}>
            <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
              <div className="flex items-center space-x-4">
                <div className="bg-white rounded-full p-4 shadow-md">
                  <Award className={`h-12 w-12 ${colors.icon}`} />
                </div>
                <div>
                  <p className="text-text-secondary text-sm">Your Tier</p>
                  <h2 className="font-heading text-4xl font-semibold text-text-primary">{tier}</h2>
                </div>
              </div>
              <div className="text-right">
                <p className="text-text-secondary text-sm">Available Points</p>
                <p data-testid="available-points" className="font-heading text-5xl font-semibold text-primary">{loyalty?.available_points || 0}</p>
                <p className="text-xs text-text-muted">= ₹{loyalty?.available_points || 0} discount</p>
              </div>
            </div>

            {loyalty?.next_tier_at && (
              <div className="bg-white/70 backdrop-blur-sm rounded-xl p-4">
                <p className="text-text-secondary text-sm mb-2">Spend ₹{loyalty.next_tier_at.toFixed(2)} more to reach the next tier</p>
                <div className="bg-gray-200 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-primary h-full rounded-full transition-all duration-500"
                    style={{ width: `${Math.min((loyalty.total_spent / (loyalty.total_spent + loyalty.next_tier_at)) * 100, 100)}%` }}
                  ></div>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div data-testid="total-spent-card" className="bg-card border border-border-light rounded-2xl p-6">
              <div className="bg-primary-light rounded-xl p-3 w-fit mb-3">
                <TrendingUp className="h-6 w-6 text-primary" />
              </div>
              <p className="text-3xl font-heading font-semibold text-text-primary">₹{loyalty?.total_spent?.toFixed(2) || 0}</p>
              <p className="text-text-secondary text-sm">Total Spent</p>
            </div>
            <div data-testid="points-earned-card" className="bg-card border border-border-light rounded-2xl p-6">
              <div className="bg-accent-light rounded-xl p-3 w-fit mb-3">
                <Star className="h-6 w-6 text-accent-hover" />
              </div>
              <p className="text-3xl font-heading font-semibold text-text-primary">{loyalty?.points_earned || 0}</p>
              <p className="text-text-secondary text-sm">Total Points Earned</p>
            </div>
            <div data-testid="orders-card" className="bg-card border border-border-light rounded-2xl p-6">
              <div className="bg-blue-100 rounded-xl p-3 w-fit mb-3">
                <Gift className="h-6 w-6 text-blue-600" />
              </div>
              <p className="text-3xl font-heading font-semibold text-text-primary">{loyalty?.order_count || 0}</p>
              <p className="text-text-secondary text-sm">Orders Placed</p>
            </div>
          </div>

          <div className="bg-card border border-border-light rounded-2xl p-6">
            <h2 className="font-heading text-2xl font-medium text-text-primary mb-4">How it works</h2>
            <div className="space-y-4">
              <div className="flex items-start space-x-4">
                <div className="bg-primary-light rounded-full w-10 h-10 flex items-center justify-center flex-shrink-0">
                  <span className="text-primary font-semibold">1</span>
                </div>
                <div>
                  <h4 className="font-medium text-text-primary">Earn Points</h4>
                  <p className="text-text-secondary text-sm">Get 1 point for every ₹100 spent on paid orders</p>
                </div>
              </div>
              <div className="flex items-start space-x-4">
                <div className="bg-primary-light rounded-full w-10 h-10 flex items-center justify-center flex-shrink-0">
                  <span className="text-primary font-semibold">2</span>
                </div>
                <div>
                  <h4 className="font-medium text-text-primary">Unlock Tiers</h4>
                  <p className="text-text-secondary text-sm">Starter (₹0) → Bronze (₹1000) → Silver (₹5000) → Gold (₹10000)</p>
                </div>
              </div>
              <div className="flex items-start space-x-4">
                <div className="bg-primary-light rounded-full w-10 h-10 flex items-center justify-center flex-shrink-0">
                  <span className="text-primary font-semibold">3</span>
                </div>
                <div>
                  <h4 className="font-medium text-text-primary">Redeem Points</h4>
                  <p className="text-text-secondary text-sm">Apply points as discount on future orders (1 point = ₹1, minimum 100 points)</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default EmployeeLoyalty;
