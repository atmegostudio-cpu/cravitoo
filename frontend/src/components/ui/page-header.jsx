import React from 'react';

/**
 * Consistent page title block used across every dashboard/panel.
 * Pure presentational — no data or logic.
 */
export const PageHeader = ({ title, subtitle, icon: Icon, actions, testid, className = '' }) => (
  <div className={`flex flex-wrap items-start justify-between gap-4 mb-6 sm:mb-8 ${className}`} data-testid={testid}>
    <div className="flex items-start gap-3 min-w-0">
      {Icon && (
        <div className="bg-primary-light rounded-2xl p-3 flex-shrink-0 hidden sm:flex">
          <Icon className="h-7 w-7 text-primary" />
        </div>
      )}
      <div className="min-w-0">
        <h1 className="font-heading text-3xl sm:text-4xl tracking-tighter font-semibold text-text-primary leading-none">
          {title}
        </h1>
        {subtitle && <p className="text-text-secondary mt-2 text-sm sm:text-base">{subtitle}</p>}
      </div>
    </div>
    {actions && <div className="flex items-center gap-3 flex-wrap">{actions}</div>}
  </div>
);

export default PageHeader;
