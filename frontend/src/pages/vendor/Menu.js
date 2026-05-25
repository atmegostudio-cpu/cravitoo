import React from 'react';
import Navbar from '../../components/Navbar';
import { UtensilsCrossed } from 'lucide-react';

const VendorMenu = () => {
  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-background">
        <div className="max-w-5xl mx-auto px-6 py-8">
          <h1 className="font-heading text-4xl sm:text-5xl tracking-tighter font-semibold text-text-primary mb-8">
            Menu Management
          </h1>
          <div data-testid="vendor-menu-placeholder" className="bg-card border border-border-light rounded-xl p-12 text-center">
            <UtensilsCrossed className="h-16 w-16 text-text-muted mx-auto mb-4" />
            <p className="text-text-secondary">Menu management features coming soon</p>
          </div>
        </div>
      </div>
    </>
  );
};

export default VendorMenu;