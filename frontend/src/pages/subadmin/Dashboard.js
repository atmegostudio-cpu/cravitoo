import React from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../../components/Navbar';
import { useAuth } from '../../context/AuthContext';
import { ClipboardList, BarChart3, ShieldCheck, ArrowRight, Layers, MessageSquare, FileText } from 'lucide-react';

const PERM_CARDS = [
  {
    key: 'sales:view_all',
    title: 'Sales & Accounting',
    desc: 'Company-wide sales — day / site / vendor-wise totals, payment reconciliation and Excel exports.',
    to: '/reports/sales',
    icon: BarChart3,
    accent: 'from-teal-500/15 to-teal-500/5 text-teal-700',
  },
  {
    key: 'vendors:onboard',
    title: 'Vendor Onboarding',
    desc: 'Review, onboard and approve vendors for your assigned sites.',
    to: '/onboarding',
    icon: ClipboardList,
    accent: 'from-amber-500/15 to-amber-500/5 text-amber-700',
  },
  {
    key: 'sales:view',
    title: 'Sales Reports',
    desc: 'View sales totals split by client, city, site and vendor.',
    to: '/reports/sales',
    icon: BarChart3,
    accent: 'from-emerald-500/15 to-emerald-500/5 text-emerald-700',
  },
  {
    key: 'feedback:view',
    title: 'Feedback Inbox',
    desc: 'See employee feedback and issues for your assigned scope.',
    to: '/admin/feedback',
    icon: MessageSquare,
    accent: 'from-rose-500/15 to-rose-500/5 text-rose-700',
  },
  {
    key: 'menu_requests:view',
    title: 'Menu Requests',
    desc: 'Review vendor menu-change requests (Master gives final approval).',
    to: '/admin/menu-requests',
    icon: FileText,
    accent: 'from-sky-500/15 to-sky-500/5 text-sky-700',
  },
];

const scopeLine = (scope = {}, perms = []) => {
  if (perms.includes('sales:view_all')) return 'All sites · company-wide (finance)';
  const parts = [];
  if (scope.client_ids?.length) parts.push(`${scope.client_ids.length} client(s)`);
  if (scope.city_ids?.length) parts.push(`${scope.city_ids.length} city(ies)`);
  if (scope.site_ids?.length) parts.push(`${scope.site_ids.length} site(s)`);
  if (scope.vendor_ids?.length) parts.push(`${scope.vendor_ids.length} vendor(s)`);
  return parts.length ? parts.join(' · ') : 'No specific scope assigned';
};

const SubAdminDashboard = () => {
  const { user } = useAuth();
  const perms = user?.permissions || [];
  const granted = PERM_CARDS.filter((c) => perms.includes(c.key));

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-background" data-testid="sub-admin-dashboard">
        <div className="max-w-5xl mx-auto px-6 py-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="bg-emerald-50 rounded-xl p-2.5">
              <ShieldCheck className="h-6 w-6 text-emerald-700" />
            </div>
            <div>
              <h1 className="font-heading text-4xl sm:text-5xl tracking-tighter font-semibold text-text-primary">
                Hello, {user?.name || 'Sub-Admin'}
              </h1>
              <p className="text-text-muted text-sm">You have access only to what the Master Admin assigned below.</p>
            </div>
          </div>

          <div
            data-testid="sub-admin-scope"
            className="mt-6 flex items-center gap-2 bg-card border border-border-light rounded-xl px-4 py-3 text-sm text-text-secondary"
          >
            <Layers className="h-4 w-4 text-emerald-700 flex-shrink-0" />
            <span className="font-medium text-text-primary">Assigned scope:</span>
            <span>{scopeLine(user?.scope, perms)}</span>
          </div>

          <h2 className="mt-10 mb-4 text-base md:text-lg font-heading font-semibold text-text-primary">Your tools</h2>

          {granted.length === 0 ? (
            <div data-testid="sub-admin-no-access" className="bg-card border border-border-light rounded-2xl p-10 text-center">
              <ShieldCheck className="h-10 w-10 text-text-muted mx-auto mb-3" />
              <p className="text-text-secondary">No permissions have been assigned to you yet.</p>
              <p className="text-text-muted text-sm mt-1">Please contact your Cravitoo Master Admin.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {granted.map((c) => {
                const Icon = c.icon;
                return (
                  <Link
                    key={c.key}
                    to={c.to}
                    data-testid={`sub-admin-card-${c.key.replace(':', '-')}`}
                    className="group bg-card border border-border-light rounded-2xl p-6 hover:border-primary/40 hover:shadow-lg transition-all duration-200"
                  >
                    <div className={`inline-flex rounded-xl p-3 bg-gradient-to-br ${c.accent}`}>
                      <Icon className="h-6 w-6" />
                    </div>
                    <h3 className="mt-4 font-heading text-lg font-semibold text-text-primary">{c.title}</h3>
                    <p className="mt-1 text-sm text-text-secondary">{c.desc}</p>
                    <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary">
                      Open
                      <ArrowRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default SubAdminDashboard;
