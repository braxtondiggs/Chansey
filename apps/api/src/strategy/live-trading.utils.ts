import { Decimal } from 'decimal.js';

import { ExchangeBalanceDto } from '../balance/dto';

/**
 * Calculate total free (available) USD value across all exchanges.
 * Free balance = balance.free (not locked in orders).
 */
export function calculateFreeUsdValue(exchanges: ExchangeBalanceDto[]): number {
  let totalFree = new Decimal(0);

  for (const exchange of exchanges) {
    for (const balance of exchange.balances || []) {
      const freeAmount = new Decimal(balance.free || '0');
      const usdValue = new Decimal(balance.usdValue || 0);

      // Calculate free portion of USD value
      const totalAmount = freeAmount.plus(new Decimal(balance.locked || '0'));
      if (totalAmount.gt(0)) {
        const freePercentage = freeAmount.dividedBy(totalAmount);
        totalFree = totalFree.plus(usdValue.times(freePercentage));
      }
    }
  }

  return totalFree.toNumber();
}

/**
 * Estimate total portfolio capital from exchange balances (positions + cash).
 * Used as a fallback when free cash is zero but opportunity selling is enabled.
 */
export function estimatePortfolioCapital(exchanges: ExchangeBalanceDto[]): number {
  let total = new Decimal(0);
  for (const exchange of exchanges) {
    for (const balance of exchange.balances || []) {
      total = total.plus(new Decimal(balance.usdValue || 0));
    }
  }
  return total.gt(0) ? total.toNumber() : 1; // Minimum $1 to avoid zero-division in Kelly allocation
}

/**
 * Extract the base coin ID (e.g., "BTC") from a trading pair symbol (e.g., "BTC/USDT").
 * Returns the symbol as-is if no "/" separator is found.
 */
export function extractCoinIdFromSymbol(symbol: string): string {
  if (!symbol.includes('/')) {
    return symbol;
  }
  return symbol.split('/')[0];
}
