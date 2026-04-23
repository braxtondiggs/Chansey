/**
 * Shared symbol-normalization helpers for announcement clients.
 *
 * Kraken/Coinbase/etc. return base symbols in slightly different shapes — some
 * legacy-coded (`XBT` → `BTC`), some concatenated-with-quote (`APXUSD` → `APX`).
 * These helpers centralize the normalization so every client yields a clean,
 * upper-cased base symbol suitable for coin lookup.
 */

import { KRAKEN_BASE_ALIASES } from '../../exchange/constants';

/**
 * Known quote suffixes we strip from concatenated altnames when `wsname` is
 * unavailable. Ordered longest-first so `USDT` is matched before `USD`.
 */
const KNOWN_QUOTE_SUFFIXES: readonly string[] = ['USDT', 'USDC', 'EUR', 'GBP', 'JPY', 'USD'];

/**
 * Strip a known quote-asset suffix from a concatenated pair code.
 * Returns the original string when no suffix matches.
 *
 * Example: `stripPairSuffix('APXUSD')` → `'APX'`.
 */
export function stripPairSuffix(symbol: string): string {
  const upper = symbol.toUpperCase();
  for (const suffix of KNOWN_QUOTE_SUFFIXES) {
    if (upper.length > suffix.length && upper.endsWith(suffix)) {
      return upper.slice(0, -suffix.length);
    }
  }
  return upper;
}

/**
 * Normalize a raw base symbol to its canonical uppercase form.
 *
 * - Upper-cases the input.
 * - Applies Kraken aliases (XBT → BTC, XDG → DOGE).
 * - Strips a known quote suffix if one is appended (e.g. APXUSD → APX).
 */
export function normalizeBaseSymbol(raw: string): string {
  const upper = raw.toUpperCase();
  const stripped = stripPairSuffix(upper);
  return KRAKEN_BASE_ALIASES[stripped] ?? stripped;
}
