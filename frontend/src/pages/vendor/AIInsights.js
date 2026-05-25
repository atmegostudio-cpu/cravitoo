import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Navbar from '../../components/Navbar';
import { Sparkles, TrendingUp, AlertTriangle, BarChart3 } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const VendorAIInsights = () => {
  const [forecast, setForecast] = useState(null);
  const [wastage, setWastage] = useState(null);
  const [loadingForecast, setLoadingForecast] = useState(false);
  const [loadingWastage, setLoadingWastage] = useState(false);

  const getForecast = async () => {
    setLoadingForecast(true);
    try {
      const { data } = await axios.post(`${API}/ai/demand-forecast`, {}, { withCredentials: true });
      setForecast(data);
    } catch (error) {
      console.error('Forecast error:', error);
    } finally {
      setLoadingForecast(false);
    }
  };

  const getWastageAnalysis = async () => {
    setLoadingWastage(true);
    try {
      const { data } = await axios.post(`${API}/ai/wastage-analysis`, {}, { withCredentials: true });
      setWastage(data);
    } catch (error) {
      console.error('Wastage error:', error);
    } finally {
      setLoadingWastage(false);
    }
  };

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-background">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex items-center space-x-3 mb-2">
            <Sparkles className="h-8 w-8 text-primary" />
            <h1 className="font-heading text-4xl sm:text-5xl tracking-tighter font-semibold text-text-primary">
              AI Insights
            </h1>
          </div>
          <p className="text-text-secondary text-lg mb-8">
            Powered by GPT-5.2 — Make data-driven decisions
          </p>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div data-testid="forecast-card" className="bg-card border border-border-light rounded-2xl p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center space-x-3">
                  <div className="bg-primary-light rounded-xl p-3">
                    <TrendingUp className="h-6 w-6 text-primary" />
                  </div>
                  <h2 className="font-heading text-2xl font-medium text-text-primary">Demand Forecast</h2>
                </div>
              </div>
              <p className="text-text-secondary mb-4">
                Get AI-powered predictions for next week's demand based on order history.
              </p>
              <button
                onClick={getForecast}
                disabled={loadingForecast}
                data-testid="get-forecast-btn"
                className="bg-primary hover:bg-primary-hover text-white px-6 py-3 rounded-lg font-medium transition-all duration-200 disabled:opacity-50 mb-4"
              >
                {loadingForecast ? 'Analyzing...' : 'Generate Forecast'}
              </button>

              {forecast && (
                <div data-testid="forecast-result" className="mt-4">
                  <div className="bg-gradient-to-br from-primary-light to-accent-light p-4 rounded-lg mb-4">
                    <p className="text-text-primary whitespace-pre-wrap leading-relaxed text-sm">{forecast.forecast}</p>
                  </div>
                  {forecast.top_items?.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="font-medium text-text-primary mb-2">Top Selling Items</h4>
                      {forecast.top_items.slice(0, 5).map((item, i) => (
                        <div key={i} className="flex justify-between items-center bg-background p-3 rounded-lg">
                          <span className="text-text-primary text-sm">{item.name}</span>
                          <span className="text-primary font-medium text-sm">{item.quantity} sold</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div data-testid="wastage-card" className="bg-card border border-border-light rounded-2xl p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center space-x-3">
                  <div className="bg-red-100 rounded-xl p-3">
                    <AlertTriangle className="h-6 w-6 text-red-600" />
                  </div>
                  <h2 className="font-heading text-2xl font-medium text-text-primary">Wastage Analysis</h2>
                </div>
              </div>
              <p className="text-text-secondary mb-4">
                Identify food wastage patterns and get strategies to reduce them.
              </p>
              <button
                onClick={getWastageAnalysis}
                disabled={loadingWastage}
                data-testid="get-wastage-btn"
                className="bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-lg font-medium transition-all duration-200 disabled:opacity-50 mb-4"
              >
                {loadingWastage ? 'Analyzing...' : 'Analyze Wastage'}
              </button>

              {wastage && (
                <div data-testid="wastage-result" className="mt-4">
                  <div className="grid grid-cols-2 gap-2 mb-4">
                    <div className="bg-background p-3 rounded-lg">
                      <p className="text-xs text-text-muted">Total Orders</p>
                      <p className="font-heading text-xl font-semibold text-text-primary">{wastage.metrics.total_orders}</p>
                    </div>
                    <div className="bg-background p-3 rounded-lg">
                      <p className="text-xs text-text-muted">Cancellation Rate</p>
                      <p className="font-heading text-xl font-semibold text-red-600">{wastage.metrics.cancellation_rate}%</p>
                    </div>
                  </div>
                  <div className="bg-gradient-to-br from-red-50 to-orange-50 p-4 rounded-lg">
                    <p className="text-text-primary whitespace-pre-wrap leading-relaxed text-sm">{wastage.analysis}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default VendorAIInsights;
