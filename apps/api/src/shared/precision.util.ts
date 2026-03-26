/**
 * CCXT precision mode constants.
 * @see https://docs.ccxt.com/#/README?id=precision-mode
 */
export const CCXT_DECIMAL_PLACES = 2;
export const CCXT_SIGNIFICANT_DIGITS = 3;
export const CCXT_TICK_SIZE = 4;

export interface MarketLimitsResult {
  minQuantity: number;
  maxQuantity: number;
  minCost: number;
  quantityStep: number;
  priceStep: number;
}

/**
 * Convert a CCXT precision value to a step size, respecting the exchange's precision mode.
 *
 * - TICK_SIZE (e.g. Binance): the value *is* the step (e.g. 0.001)
 * - DECIMAL_PLACES / SIGNIFICANT_DIGITS: the value is a count → step = 10^(-n)
 * - null / undefined: returns 0 (unknown)
 */
export function precisionToStepSize(
  precisionValue: number | undefined | null,
  precisionMode: number | undefined | null
): number {
  if (precisionValue == null) return 0;
  if (precisionMode === CCXT_TICK_SIZE) return precisionValue;
  if (precisionMode === CCXT_DECIMAL_PLACES || precisionMode === CCXT_SIGNIFICANT_DIGITS)
    return Math.pow(10, -precisionValue);
  // Unknown or missing mode — fall back to DECIMAL_PLACES behaviour
  return Math.pow(10, -precisionValue);
}

/**
 * Extract normalised market limits from a CCXT market object.
 *
 * @param market  - a CCXT market (may be undefined/null)
 * @param precisionMode - `exchange.precisionMode` (TICK_SIZE | DECIMAL_PLACES | …)
 */
export function extractMarketLimits(
  market:
    | { limits?: Record<string, Record<string, number | undefined>>; precision?: Record<string, number | undefined> }
    | undefined
    | null,
  precisionMode: number | undefined | null
): MarketLimitsResult {
  return {
    minQuantity: market?.limits?.amount?.min ?? 0,
    maxQuantity: market?.limits?.amount?.max ?? 0,
    minCost: market?.limits?.cost?.min ?? 0,
    quantityStep: precisionToStepSize(market?.precision?.amount, precisionMode),
    priceStep: precisionToStepSize(market?.precision?.price, precisionMode)
  };
}
