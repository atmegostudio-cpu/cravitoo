import React from 'react';

/**
 * FSSAI-standard veg / non-veg indicator.
 *
 * India's Food Safety and Standards Regulations mandate:
 *   - Green filled circle inside a green square  = pure vegetarian
 *   - Red   filled circle inside a red   square  = non-vegetarian
 *
 * Rendering both variants (never omitting the marker) is a compliance
 * requirement — an item with NO marker is ambiguous to allergen /
 * dietary-restricted users and can create legal liability for the
 * cafeteria operator.
 *
 * Props:
 *   isVeg  (boolean): true  → green marker, false → red marker
 *   size   ('sm'|'md'|'lg'): 12px | 16px | 20px outer square.
 *   showLabel (boolean): if true, appends "Veg" / "Non-veg" text.
 *
 * Every rendered marker also carries a data-testid + title for
 * accessibility (screen readers announce "vegetarian" / "non-vegetarian").
 */
const SIZE_MAP = {
  sm: { box: 12, dot: 5, border: 1 },
  md: { box: 16, dot: 7, border: 1.5 },
  lg: { box: 20, dot: 9, border: 2 },
};

export const VegIndicator = ({ isVeg, size = 'md', showLabel = false, className = '' }) => {
  const dim = SIZE_MAP[size] || SIZE_MAP.md;
  const color = isVeg ? '#16A34A' /* green-600 */ : '#DC2626' /* red-600 */;
  const label = isVeg ? 'Veg' : 'Non-veg';
  const testId = isVeg ? 'veg-indicator' : 'non-veg-indicator';

  return (
    <span
      className={`inline-flex items-center gap-1.5 ${className}`}
      data-testid={testId}
      title={label}
      aria-label={label}
    >
      <span
        style={{
          width: dim.box,
          height: dim.box,
          border: `${dim.border}px solid ${color}`,
          borderRadius: 2,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            width: dim.dot,
            height: dim.dot,
            borderRadius: '50%',
            backgroundColor: color,
          }}
        />
      </span>
      {showLabel && (
        <span
          className="text-xs font-medium"
          style={{ color }}
        >
          {label}
        </span>
      )}
    </span>
  );
};

export default VegIndicator;
