import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Navbar from '../../components/Navbar';
import { TrendingUp, Users, DollarSign } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const CorporateAdminDashboard = () => {
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const fetchAnalytics = async () => {
    try {
      const { data } = await axios.get(`${API}/analytics/corporate`, { withCredentials: true });
      setAnalytics(data);
    } catch (error) {
      console.error('Error fetching analytics:', error);
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

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-background">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <h1 className="font-heading text-4xl sm:text-5xl tracking-tighter font-semibold text-text-primary mb-8">
            Corporate Dashboard
          </h1>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div data-testid="corporate-total-orders" className="bg-card border border-border-light rounded-2xl p-8">
              <div className="flex items-center justify-between mb-4">
                <div className="bg-primary-light rounded-xl p-3">
                  <Users className="h-8 w-8 text-primary" />
                </div>
                <TrendingUp className="h-6 w-6 text-green-500" />
              </div>
              <p className="text-4xl font-heading font-semibold text-text-primary mb-2">{analytics?.total_orders || 0}</p>
              <p className="text-text-secondary">Total Employee Orders</p>
            </div>

            <div data-testid="corporate-total-spend" className="bg-card border border-border-light rounded-2xl p-8">
              <div className="flex items-center justify-between mb-4">
                <div className="bg-green-100 rounded-xl p-3">
                  <DollarSign className="h-8 w-8 text-green-600" />
                </div>
              </div>
              <p className="text-4xl font-heading font-semibold text-text-primary mb-2">₹{analytics?.total_spend?.toFixed(2) || 0}</p>
              <p className="text-text-secondary">Total Spending</p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default CorporateAdminDashboard;