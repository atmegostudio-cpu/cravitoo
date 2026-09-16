import React from 'react';

const TONES = {
  primary: 'bg-primary-light text-primary',
  green: 'bg-emerald-50 text-emerald-600',
  blue: 'bg-blue-50 text-blue-600',
  amber: 'bg-amber-50 text-amber-600',
  purple: 'bg-purple-50 text-purple-600',
  indigo: 'bg-indigo-50 text-indigo-600',
  teal: 'bg-teal-50 text-teal-600',
  red: 'bg-red-50 text-red-600',
  slate: 'bg-slate-100 text-slate-600',
  accent: 'bg-accent-light text-accent-hover',
};

/**
 * Uniform metric tile shared across all dashboards.
 * Presentational only — no data fetching or logic.
 */
export const StatCard = ({ label, value, icon: Icon, tone = 'primary', hint, trend, testid }) => (
  <div
    data-testid={testid}
    className="bg-card border border-border-light rounded-2xl p-5 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
  >
    <div className="flex items-center justify-between mb-3">
      {Icon && (
        <div className={`rounded-xl p-2.5 ${TONES[tone] || TONES.primary}`}>
          <Icon className="h-5 w-5" />
        </div>
      )}
      {trend}
    </div>
    <p className="text-2xl sm:text-3xl font-heading font-semibold text-text-primary leading-none">{value}</p>
    <p className="text-text-secondary text-xs sm:text-sm mt-1.5">{label}</p>
    {hint && <p className="text-text-muted text-xs mt-1">{hint}</p>}
  </div>
);

export default StatCard;
