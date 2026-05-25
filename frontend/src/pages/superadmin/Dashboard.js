import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Navbar from '../../components/Navbar';
import { Building2, Store, Users, TrendingUp } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const SuperAdminDashboard = () => {
  const [companies, setCompanies] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [companiesRes, vendorsRes] = await Promise.all([
        axios.get(`${API}/companies`, { withCredentials: true }),
        axios.get(`${API}/vendors`, { withCredentials: true })
      ]);
      setCompanies(companiesRes.data);
      setVendors(vendorsRes.data);
    } catch (error) {
      console.error('Error fetching data:', error);
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
            Super Admin Dashboard
          </h1>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div data-testid="total-companies-card" className="bg-card border border-border-light rounded-2xl p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="bg-blue-100 rounded-xl p-3">
                  <Building2 className="h-6 w-6 text-blue-600" />
                </div>
                <TrendingUp className="h-5 w-5 text-green-500" />
              </div>
              <p className="text-3xl font-heading font-semibold text-text-primary mb-1">{companies.length}</p>
              <p className="text-text-secondary text-sm">Total Companies</p>
            </div>

            <div data-testid="total-vendors-card" className="bg-card border border-border-light rounded-2xl p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="bg-primary-light rounded-xl p-3">
                  <Store className="h-6 w-6 text-primary" />
                </div>
              </div>
              <p className="text-3xl font-heading font-semibold text-text-primary mb-1">{vendors.length}</p>
              <p className="text-text-secondary text-sm">Total Vendors</p>
            </div>

            <div data-testid="platform-status-card" className="bg-gradient-to-br from-primary-light to-accent-light border border-primary/20 rounded-2xl p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="bg-white rounded-xl p-3">
                  <Users className="h-6 w-6 text-primary" />
                </div>
              </div>
              <p className="text-3xl font-heading font-semibold text-text-primary mb-1">Active</p>
              <p className="text-text-secondary text-sm">Platform Status</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div>
              <h2 className="font-heading text-2xl font-medium text-text-primary mb-4">Companies</h2>
              <div className="space-y-4">
                {companies.map((company) => (
                  <div key={company.id} data-testid={`company-${company.id}`} className="bg-card border border-border-light rounded-xl p-6">
                    <h3 className="font-heading text-lg font-medium text-text-primary mb-2">{company.name}</h3>
                    <p className="text-text-secondary text-sm mb-1">{company.address}</p>
                    <p className="text-text-muted text-xs">{company.contact_email}</p>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h2 className="font-heading text-2xl font-medium text-text-primary mb-4">Vendors</h2>
              <div className="space-y-4">
                {vendors.map((vendor) => (
                  <div key={vendor.id} data-testid={`vendor-${vendor.id}`} className="bg-card border border-border-light rounded-xl p-6">
                    <div className="flex justify-between items-start mb-2">
                      <h3 className="font-heading text-lg font-medium text-text-primary">{vendor.name}</h3>
                      <div className="flex items-center space-x-1 bg-accent-light px-2 py-1 rounded-full">
                        <span className="text-accent-hover text-sm font-medium">{vendor.rating}</span>
                        <span className="text-accent-hover">★</span>
                      </div>
                    </div>
                    <p className="text-text-secondary text-sm">{vendor.cuisine_type}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default SuperAdminDashboard;