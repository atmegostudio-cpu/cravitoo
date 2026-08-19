/**
 * Dev-only logger. Compiles to a no-op in production builds so debug traces
 * and error stack details never leak to end-users' devtools, while keeping
 * developer ergonomics intact during local work and preview testing.
 */
const isProd = process.env.NODE_ENV === 'production';

export const log = isProd ? () => {} : (...args) => console.log(...args);
export const warn = isProd ? () => {} : (...args) => console.warn(...args);
export const error = isProd ? () => {} : (...args) => console.error(...args);

export default { log, warn, error };
