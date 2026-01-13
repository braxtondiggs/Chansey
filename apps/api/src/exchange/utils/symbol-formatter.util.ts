/**
 * Exchange Symbol Formatter Utility
 *
 * Handles exchange-specific symbol format conversions.
 * Different exchanges use different conventions for trading symbols.
 */

/**
 * Symbol conversion rules for specific exchanges
 */
const EXCHANGE_SYMBOL_RULES: Record<string, { base: Record<string, string>; quote: Record<string, string> }> = {
  kraken: {
    // Kraken uses XBT instead of BTC
    base: { BTC: 'XBT' },
    // Kraken uses ZUSD for USD
    quote: { USD: 'ZUSD' }
  }
};

/**
 * Format a trading symbol for a specific exchange.
 *
 * Some exchanges use different conventions:
 * - Kraken uses XBT instead of BTC
 * - Kraken uses ZUSD instead of USD
 *
 * @param exchangeSlug - The exchange identifier (e.g., 'kraken', 'binance_us')
 * @param symbol - The standard trading symbol (e.g., 'BTC/USD')
 * @returns The formatted symbol for the specific exchange
 *
 * @example
 * formatSymbolForExchange('kraken', 'BTC/USD') // Returns 'XBT/ZUSD'
 * formatSymbolForExchange('binance_us', 'BTC/USD') // Returns 'BTC/USD'
 */
export function formatSymbolForExchange(exchangeSlug: string, symbol: string): string {
  const rules = EXCHANGE_SYMBOL_RULES[exchangeSlug];

  if (!rules) {
    return symbol;
  }

  let formattedSymbol = symbol;

  // Apply base currency conversions
  for (const [from, to] of Object.entries(rules.base)) {
    formattedSymbol = formattedSymbol.replace(`${from}/`, `${to}/`);
  }

  // Apply quote currency conversions
  for (const [from, to] of Object.entries(rules.quote)) {
    formattedSymbol = formattedSymbol.replace(`/${from}`, `/${to}`);
  }

  return formattedSymbol;
}

/**
 * Convert an exchange-specific symbol back to standard format.
 *
 * @param exchangeSlug - The exchange identifier
 * @param symbol - The exchange-specific trading symbol
 * @returns The standard format symbol
 *
 * @example
 * normalizeSymbolFromExchange('kraken', 'XBT/ZUSD') // Returns 'BTC/USD'
 */
export function normalizeSymbolFromExchange(exchangeSlug: string, symbol: string): string {
  const rules = EXCHANGE_SYMBOL_RULES[exchangeSlug];

  if (!rules) {
    return symbol;
  }

  let normalizedSymbol = symbol;

  // Reverse base currency conversions
  for (const [from, to] of Object.entries(rules.base)) {
    normalizedSymbol = normalizedSymbol.replace(`${to}/`, `${from}/`);
  }

  // Reverse quote currency conversions
  for (const [from, to] of Object.entries(rules.quote)) {
    normalizedSymbol = normalizedSymbol.replace(`/${to}`, `/${from}`);
  }

  return normalizedSymbol;
}
