import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DEFAULT_QUOTE_CURRENCY, EXCHANGE_QUOTE_CURRENCY, USD_QUOTE_CURRENCIES } from '../../exchange/constants';
import { ExchangeManagerService } from '../../exchange/exchange-manager.service';
import { formatSymbolForExchange } from '../../exchange/utils';
import { withExchangeRetryThrow } from '../../shared/retry.util';

export interface OHLCRawData {
  timestamp: number; // Unix ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type OHLCFetchErrorType = 'no_data' | 'request_failed' | 'no_exchanges_available';

export interface OHLCFetchResult {
  success: boolean;
  candles?: OHLCRawData[];
  exchangeSlug?: string;
  error?: string;
  errorType?: OHLCFetchErrorType;
}

@Injectable()
export class ExchangeOHLCService {
  private readonly logger = new Logger(ExchangeOHLCService.name);
  private readonly EXCHANGE_PRIORITY: string[];

  constructor(
    private readonly exchangeManager: ExchangeManagerService,
    private readonly configService: ConfigService
  ) {
    // Get exchange priority from config or use default
    const priorityConfig = this.configService.get<string>('OHLC_EXCHANGE_PRIORITY');
    this.EXCHANGE_PRIORITY = priorityConfig
      ? priorityConfig.split(',').map((s) => s.trim())
      : ['binance_us', 'gdax', 'kraken'];
  }

  /**
   * Get the exchange priority list for iteration by external callers
   */
  getExchangePriority(): string[] {
    return [...this.EXCHANGE_PRIORITY];
  }

  /**
   * Fetch OHLC data with automatic fallback to next exchange on failure
   * @param symbol Trading symbol (e.g., 'BTC/USD')
   * @param since Start timestamp in milliseconds
   * @param limit Maximum number of candles to fetch (default 500)
   */
  async fetchOHLCWithFallback(symbol: string, since: number, limit = 500): Promise<OHLCFetchResult> {
    const errors: string[] = [];
    let sawNoData = false;
    let attempted = 0;

    for (const exchangeSlug of this.EXCHANGE_PRIORITY) {
      attempted++;
      const result = await this.fetchOHLCWithRetry(exchangeSlug, symbol, since, limit);

      if (result.success) {
        return result;
      }

      errors.push(`${exchangeSlug}: ${result.error}`);
      if (result.errorType === 'no_data') sawNoData = true;

      // Add delay between exchange attempts to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // Distinguish "every exchange errored" from "no exchange has this data".
    // Callers use this to decide whether to halt (request_failed) or skip ahead (no_data).
    // If any exchange returned no_data, the pair/hour genuinely has no candle there; otherwise
    // every attempt was a request error and we should not silently skip forward.
    let errorType: OHLCFetchErrorType;
    if (attempted === 0) {
      errorType = 'no_exchanges_available';
    } else if (sawNoData) {
      errorType = 'no_data';
    } else {
      errorType = 'request_failed';
    }

    return {
      success: false,
      error: attempted === 0 ? 'No exchanges configured' : `All exchanges failed: ${errors.join('; ')}`,
      errorType
    };
  }

  /**
   * Fetch OHLC data from a specific exchange with retry logic.
   * Retry is handled inside fetchOHLC via withExchangeRetryThrow.
   */
  async fetchOHLCWithRetry(exchangeSlug: string, symbol: string, since: number, limit = 500): Promise<OHLCFetchResult> {
    return this.fetchOHLC(exchangeSlug, symbol, since, limit);
  }

  /**
   * Fetch OHLC data from a specific exchange (single attempt)
   */
  async fetchOHLC(exchangeSlug: string, symbol: string, since: number, limit = 500): Promise<OHLCFetchResult> {
    try {
      this.logger.debug(`Fetching OHLC from ${exchangeSlug} for ${symbol} since ${new Date(since).toISOString()}`);

      const client = await this.exchangeManager.getPublicClient(exchangeSlug);

      // Check if exchange supports fetchOHLCV
      if (!client.has.fetchOHLCV) {
        return {
          success: false,
          exchangeSlug,
          error: `${exchangeSlug} does not support fetchOHLCV`,
          errorType: 'no_data'
        };
      }

      // Load markets if not already loaded
      if (!client.markets) {
        await withExchangeRetryThrow(() => client.loadMarkets(), {
          logger: this.logger,
          operationName: `loadMarkets(${exchangeSlug})`
        });
      }

      // Check if the symbol exists on this exchange
      const formattedSymbol = formatSymbolForExchange(exchangeSlug, symbol);
      if (!client.markets[formattedSymbol]) {
        return {
          success: false,
          exchangeSlug,
          error: `Symbol ${formattedSymbol} not found on ${exchangeSlug}`,
          errorType: 'no_data'
        };
      }

      // Fetch OHLCV data (Open, High, Low, Close, Volume)
      // Format: [[timestamp, open, high, low, close, volume], ...]
      const ohlcv = await withExchangeRetryThrow(() => client.fetchOHLCV(formattedSymbol, '1h', since, limit), {
        logger: this.logger,
        operationName: `fetchOHLCV(${exchangeSlug}:${symbol})`
      });

      if (!ohlcv || ohlcv.length === 0) {
        return {
          success: false,
          exchangeSlug,
          error: 'No data returned',
          errorType: 'no_data'
        };
      }

      // Transform CCXT OHLCV array format to our interface
      const candles: OHLCRawData[] = ohlcv.map(([timestamp, open, high, low, close, volume]) => ({
        timestamp: timestamp as number,
        open: open as number,
        high: high as number,
        low: low as number,
        close: close as number,
        volume: volume as number
      }));

      this.logger.debug(`Fetched ${candles.length} candles from ${exchangeSlug} for ${symbol}`);

      return {
        success: true,
        exchangeSlug,
        candles
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`OHLC fetch failed for ${exchangeSlug}/${symbol}: ${message}`);

      return {
        success: false,
        exchangeSlug,
        error: message,
        errorType: 'request_failed'
      };
    }
  }

  /**
   * Check if an exchange supports OHLC data
   */
  async supportsOHLC(exchangeSlug: string): Promise<boolean> {
    try {
      const client = await this.exchangeManager.getPublicClient(exchangeSlug);
      return Boolean(client.has.fetchOHLCV);
    } catch {
      return false;
    }
  }

  /**
   * Returns the uppercase base-asset symbols for every market on this exchange
   * that trades against a USD-equivalent quote. Used to pre-filter candidate
   * coins before attempting per-symbol lookups.
   */
  async getAllBaseSymbols(exchangeSlug: string): Promise<Set<string>> {
    const client = await this.exchangeManager.getPublicClient(exchangeSlug);

    if (!client.markets) {
      await withExchangeRetryThrow(() => client.loadMarkets(), {
        logger: this.logger,
        operationName: `loadMarkets(${exchangeSlug})`
      });
    }

    const bases = new Set<string>();
    for (const symbol of Object.keys(client.markets)) {
      const market = client.markets[symbol];
      if (market.base && USD_QUOTE_CURRENCIES.has(market.quote)) {
        bases.add(market.base.toUpperCase());
      }
    }
    return bases;
  }

  /**
   * Get available USD trading pairs for a base asset on an exchange
   */
  async getAvailableSymbols(exchangeSlug: string, baseAsset: string): Promise<string[]> {
    try {
      const client = await this.exchangeManager.getPublicClient(exchangeSlug);

      if (!client.markets) {
        await withExchangeRetryThrow(() => client.loadMarkets(), {
          logger: this.logger,
          operationName: `loadMarkets(${exchangeSlug})`
        });
      }

      const symbols: string[] = [];
      const baseUpper = baseAsset.toUpperCase();

      for (const symbol of Object.keys(client.markets)) {
        const market = client.markets[symbol];
        if (market.base?.toUpperCase() === baseUpper && USD_QUOTE_CURRENCIES.has(market.quote)) {
          symbols.push(symbol);
        }
      }

      // Prefer the exchange's native quote currency first
      const preferred = EXCHANGE_QUOTE_CURRENCY[exchangeSlug] ?? DEFAULT_QUOTE_CURRENCY;
      symbols.sort((a, b) => {
        const quoteA = a.split('/')[1] || '';
        const quoteB = b.split('/')[1] || '';
        if (quoteA === preferred && quoteB !== preferred) return -1;
        if (quoteB === preferred && quoteA !== preferred) return 1;
        return a.localeCompare(b);
      });

      return symbols;
    } catch (error: unknown) {
      this.logger.warn(`Failed to get available symbols for ${baseAsset} on ${exchangeSlug}: ${error}`);
      return [];
    }
  }
}
