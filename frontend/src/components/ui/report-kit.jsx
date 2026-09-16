import React from 'react';
import { Filter } from 'lucide-react';

/**
 * Consistent filter container used across all report pages.
 * A card with a "Filters" overline; children are the actual controls.
 */
export const FilterBar = ({ children, testid, actions, className = '' }) => (
  <div className={`bg-card border border-border-light rounded-2xl p-5 mb-6 ${className}`} data-testid={testid}>
    <div className="flex items-center gap-2 mb-4">
      <Filter className="h-4 w-4 text-text-muted" />
      <span className="text-xs uppercase tracking-wider font-semibold text-text-muted">Filters</span>
      {actions ? <div className="ml-auto">{actions}</div> : null}
    </div>
    {children}
  </div>
);

/**
 * Pill-chip date-mode selector, identical look on every report.
 * modes = [{ k, label }]
 */
export const DateModeChips = ({ mode, onChange, modes, testidPrefix }) => (
  <div className="flex items-center gap-2 flex-wrap">
    {modes.map((m) => (
      <button
        key={m.k}
        type="button"
        data-testid={`${testidPrefix}-${m.k}`}
        onClick={() => onChange(m.k)}
        className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
          mode === m.k ? 'bg-primary text-white' : 'bg-background text-text-secondary hover:text-text-primary'
        }`}
      >
        {m.label}
      </button>
    ))}
  </div>
);

/** Labelled field wrapper for consistent inputs inside a FilterBar. */
export const FilterField = ({ label, children, className = '' }) => (
  <div className={className}>
    <label className="text-xs text-text-muted mb-1 block">{label}</label>
    {children}
  </div>
);

const inputCls =
  'w-full px-3 py-2 border border-border-light rounded-lg bg-background text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20';

export const filterInputClass = inputCls;

/**
 * Shared summary/breakdown table with a uniform header + row rhythm.
 * cols = [{ key, label, align?, strong?, render? }]
 */
export const DataTable = ({
  title,
  icon: Icon,
  rows = [],
  cols,
  emptyText = 'No data in this period.',
  testid,
  headerExtra,
  minWidthClass = '',
  rowKey,
  rowTestId,
}) => (
  <div className="bg-card border border-border-light rounded-2xl overflow-hidden" data-testid={testid}>
    {title && (
      <div className="px-5 py-4 border-b border-border-light flex items-center gap-2">
        {Icon && <Icon className="h-5 w-5 text-primary" />}
        <h2 className="font-heading text-lg font-semibold text-text-primary">{title}</h2>
        {headerExtra ? <div className="ml-auto">{headerExtra}</div> : null}
      </div>
    )}
    {rows.length === 0 ? (
      <div className="p-8 text-center text-text-muted text-sm">{emptyText}</div>
    ) : (
      <div className="overflow-x-auto">
        <table className={`w-full text-sm ${minWidthClass}`}>
          <thead className="bg-background text-xs text-text-muted uppercase tracking-wider">
            <tr>
              {cols.map((c) => (
                <th key={c.key} className={`px-5 py-3 ${c.align === 'right' ? 'text-right' : 'text-left'}`}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border-light">
            {rows.map((row, i) => (
              <tr
                key={rowKey ? rowKey(row, i) : i}
                data-testid={rowTestId ? rowTestId(row, i) : `${testid}-row-${i}`}
                className="hover:bg-background/50 transition-colors"
              >
                {cols.map((c) => (
                  <td
                    key={c.key}
                    className={`px-5 py-3 ${c.align === 'right' ? 'text-right font-mono font-semibold' : ''} ${
                      c.strong ? 'font-medium text-text-primary' : 'text-text-secondary'
                    }`}
                  >
                    {c.render ? c.render(row) : row[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
);

export default DataTable;
