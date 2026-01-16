import { Injectable, Logger, Optional } from '@nestjs/common';

import { Coin } from '../../coin/coin.entity';
import { CoinService } from '../../coin/coin.service';
import { QuoteCurrencyNotFoundException } from '../../common/exceptions/backtest';
import { MetricsService } from '../../metrics';

export const DEFAULT_QUOTE_CURRENCY_FALLBACK = ['USDT', 'USDC', 'BUSD', 'DAI'];

@Injectable()
export class QuoteCurrencyResolverService {
  private readonly logger = new Logger(QuoteCurrencyResolverService.name);

  constructor(
    private readonly coinService: CoinService,
    @Optional() private readonly metricsService?: MetricsService
  ) {}

  /**
   * Resolves a quote currency coin from the database.
   * Tries the preferred currency first, then falls back through common stablecoins.
   * Rejects virtual coins that cannot be persisted to the database.
   *
   * @param preferredCurrency - The preferred quote currency symbol (default: 'USDT')
   * @param fallbackChain - Array of fallback currency symbols to try if preferred is not available
   * @returns A valid Coin entity that can be used as a quote currency
   * @throws Error if no valid quote currency can be resolved
   */
  async resolveQuoteCurrency(
    preferredCurrency = 'USDT',
    fallbackChain: string[] = DEFAULT_QUOTE_CURRENCY_FALLBACK
  ): Promise<Coin> {
    // Build candidate list: preferred currency first, then fallbacks (excluding duplicates)
    const candidates = [
      preferredCurrency.toUpperCase(),
      ...fallbackChain.filter((c) => c.toUpperCase() !== preferredCurrency.toUpperCase())
    ];

    for (const symbol of candidates) {
      // Pass fail=false to avoid throwing when coin not found
      const coin = await this.coinService.getCoinBySymbol(symbol, undefined, false);

      if (coin && !this.isVirtualCoin(coin)) {
        if (symbol !== preferredCurrency.toUpperCase()) {
          this.logger.warn(`Preferred quote currency '${preferredCurrency}' not found, using fallback '${symbol}'`);
          this.metricsService?.recordQuoteCurrencyFallback(preferredCurrency.toUpperCase(), symbol);
        }
        return coin;
      }
    }

    throw new QuoteCurrencyNotFoundException(candidates);
  }

  /**
   * Checks if a coin is a virtual/synthetic coin that cannot be persisted.
   * Virtual coins have IDs containing 'virtual' or starting with 'USD-'.
   */
  private isVirtualCoin(coin: Coin): boolean {
    return coin.id?.includes('virtual') || coin.id?.startsWith('USD-');
  }
}
