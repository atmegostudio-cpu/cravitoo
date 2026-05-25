import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../../context/AuthContext';
import Navbar from '../../components/Navbar';
import { Sparkles, TrendingUp, ShoppingBag, Clock } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const EmployeeDashboard = () => {
  const { user } = useAuth();
  const [vendors, setVendors] = useState([]);
  const [recentOrders, setRecentOrders] = useState([]);
  const [recommendations, setRecommendations] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [vendorsRes, ordersRes] = await Promise.all([
        axios.get(`${API}/vendors`, { withCredentials: true }),
        axios.get(`${API}/orders`, { withCredentials: true })
      ]);
      setVendors(vendorsRes.data);
      setRecentOrders(ordersRes.data.slice(0, 3));
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getAIRecommendations = async () => {
    try {
      let prefsBody = { user_preferences: 'I like healthy options', dietary_restrictions: 'None' };
      try {
        const { data: prefs } = await axios.get(`${API}/preferences`, { withCredentials: true });
        if (prefs.favorite_cuisines?.length || prefs.dietary_preferences?.length) {
          prefsBody = {
            user_preferences: `Favorite cuisines: ${prefs.favorite_cuisines?.join(', ') || 'any'}. Dietary: ${prefs.dietary_preferences?.join(', ') || 'no preference'}`,
            dietary_restrictions: prefs.allergies?.length ? `Allergic to: ${prefs.allergies.join(', ')}` : 'None'
          };
        }
      } catch (e) {
        // Ignore preferences fetch error and use defaults
      }
      const { data } = await axios.post(
        `${API}/ai/recommendations`,
        prefsBody,
        { withCredentials: true }
      );
      setRecommendations(data.recommendations);
    } catch (error) {
      console.error('Error getting recommendations:', error);
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
          <div className="mb-8">
            <h1 className="font-heading text-4xl sm:text-5xl tracking-tighter font-semibold text-text-primary mb-2">
              Welcome back, {user?.name}!
            </h1>
            <p className="text-text-secondary text-lg">What would you like to eat today?</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
            <div data-testid="stat-card-orders" className="bg-card border border-border-light rounded-2xl p-6 hover:shadow-md transition-all duration-200">
              <div className="flex items-center justify-between mb-4">
                <div className="bg-primary-light rounded-xl p-3">
                  <ShoppingBag className="h-6 w-6 text-primary" />
                </div>
                <TrendingUp className="h-5 w-5 text-green-500" />
              </div>
              <p className="text-3xl font-heading font-semibold text-text-primary mb-1">{recentOrders.length}</p>
              <p className="text-text-secondary text-sm">Recent Orders</p>
            </div>

            <div data-testid="stat-card-vendors" className="bg-card border border-border-light rounded-2xl p-6 hover:shadow-md transition-all duration-200">
              <div className="flex items-center justify-between mb-4">
                <div className="bg-accent-light rounded-xl p-3">
                  <Sparkles className="h-6 w-6 text-accent-hover" />
                </div>
              </div>
              <p className="text-3xl font-heading font-semibold text-text-primary mb-1">{vendors.length}</p>
              <p className="text-text-secondary text-sm">Available Vendors</p>
            </div>

            <div data-testid="stat-card-recommendations" className="bg-gradient-to-br from-primary-light to-accent-light border border-primary/20 rounded-2xl p-6 hover:shadow-md transition-all duration-200">
              <div className="flex items-center justify-between mb-4">
                <div className="bg-white rounded-xl p-3">
                  <Sparkles className="h-6 w-6 text-primary" />
                </div>
              </div>
              <p className="text-text-primary font-medium mb-2">AI Recommendations</p>
              <button
                onClick={getAIRecommendations}
                data-testid="get-ai-recommendations-btn"
                className="text-sm bg-primary hover:bg-primary-hover text-white px-4 py-2 rounded-lg transition-all duration-200 font-medium"
              >
                Get Suggestions
              </button>
            </div>
          </div>

          {recommendations && (
            <div data-testid="ai-recommendations-result" className="bg-card border border-border-light rounded-2xl p-6 mb-8">
              <h3 className="font-heading text-xl font-medium text-text-primary mb-4 flex items-center space-x-2">
                <Sparkles className="h-5 w-5 text-primary" />
                <span>AI Recommendations for You</span>
              </h3>
              <div className="text-text-secondary whitespace-pre-wrap leading-relaxed">
                {recommendations}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div>
              <h2 className="font-heading text-2xl font-medium text-text-primary mb-4">Available Vendors</h2>
              <div className="space-y-4">
                {vendors.map((vendor) => (
                  <div key={vendor.id} data-testid={`vendor-card-${vendor.id}`} className="bg-card border border-border-light rounded-xl p-6 hover:shadow-md transition-all duration-200">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h3 className="font-heading text-lg font-medium text-text-primary mb-1">{vendor.name}</h3>
                        <p className="text-text-secondary text-sm">{vendor.cuisine_type}</p>
                      </div>
                      <div className="flex items-center space-x-1 bg-accent-light px-3 py-1 rounded-full">
                        <span className="text-accent-hover font-medium">{vendor.rating}</span>
                        <span className="text-accent-hover">★</span>
                      </div>
                    </div>
                    <p className="text-text-secondary text-sm mb-4">{vendor.description}</p>
                    <a
                      href={`/employee/menu?vendor=${vendor.id}`}
                      data-testid={`view-menu-btn-${vendor.id}`}
                      className="inline-block bg-primary hover:bg-primary-hover text-white px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200"
                    >
                      View Menu
                    </a>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h2 className="font-heading text-2xl font-medium text-text-primary mb-4">Recent Orders</h2>
              {recentOrders.length === 0 ? (
                <div data-testid="no-orders-message" className="bg-card border border-border-light rounded-xl p-8 text-center">
                  <Clock className="h-12 w-12 text-text-muted mx-auto mb-4" />
                  <p className="text-text-secondary">No orders yet. Start exploring our menu!</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {recentOrders.map((order) => (
                    <div key={order.id} data-testid={`order-card-${order.id}`} className="bg-card border border-border-light rounded-xl p-6">
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <p className="font-medium text-text-primary mb-1">Order #{order.id.slice(-6)}</p>
                          <p className="text-text-secondary text-sm">{new Date(order.created_at).toLocaleDateString()}</p>
                        </div>
                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                          order.status === 'confirmed' ? 'bg-green-100 text-green-700' :
                          order.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                          'bg-blue-100 text-blue-700'
                        }`}>
                          {order.status}
                        </span>
                      </div>
                      <p className="text-text-primary font-medium">₹{order.total_amount.toFixed(2)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default EmployeeDashboard;