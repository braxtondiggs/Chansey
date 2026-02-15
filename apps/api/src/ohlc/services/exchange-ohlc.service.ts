import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ExchangeManagerService } from '../../exchange/exchange-manager.service';
import { formatSymbolForExchange } from '../../exchange/utils';

export interface OHLCRawData {
  timestamp: number; // Unix ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface OHLCFetchResult {
  success: boolean;
  candles?: OHLCRawData[];
  exchangeSlug?: string;
  error?: string;
}

@Injectable()
export class ExchangeOHLCService {
  private readonly logger = new Logger(ExchangeOHLCService.name);
  private readonly EXCHANGE_PRIORITY: string[];
  private readonly MAX_RETRIES = 3;
  private readonly INITIAL_BACKOFF_MS = 2000;

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

    for (const exchangeSlug of this.EXCHANGE_PRIORITY) {
      const result = await this.fetchOHLCWithRetry(exchangeSlug, symbol, since, limit);

      if (result.success) {
        return result;
      }

      errors.push(`${exchangeSlug}: ${result.error}`);

      // Add delay between exchange attempts to avoid rate limiting
      await this.sleep(500);
    }

    return {
      success: false,
      error: `All exchanges failed: ${errors.join('; ')}`
    };
  }

  /**
   * Fetch OHLC data from a specific exchange with retry logic
   */
  async fetchOHLCWithRetry(
    exchangeSlug: string,
    symbol: string,
    since: number,
    limit = 500,
    retries = this.MAX_RETRIES
  ): Promise<OHLCFetchResult> {
    let lastError = '';
    let backoffMs = this.INITIAL_BACKOFF_MS;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const result = await this.fetchOHLC(exchangeSlug, symbol, since, limit);

        if (result.success) {
          return result;
        }

        lastError = result.error || 'Unknown error';

        // Check if it's a rate limit error
        if (lastError.toLowerCase().includes('rate limit')) {
          this.logger.warn(
            `Rate limit hit on ${exchangeSlug}, waiting ${backoffMs}ms before retry ${attempt}/${retries}`
          );
          await this.sleep(backoffMs);
          backoffMs *= 2; // Exponential backoff
        } else if (attempt < retries) {
          // Other errors - shorter delay
          await this.sleep(backoffMs);
          backoffMs *= 2;
        }
      } catch (error: unknown) {
        lastError = error instanceof Error ? error.message : 'Unknown error';
        this.logger.warn(`OHLC fetch attempt ${attempt}/${retries} failed for ${exchangeSlug}: ${lastError}`);

        if (attempt < retries) {
          await this.sleep(backoffMs);
          backoffMs *= 2;
        }
      }
    }

    return {
      success: false,
      exchangeSlug,
      error: lastError
    };
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
          error: `${exchangeSlug} does not support fetchOHLCV`
        };
      }

      // Load markets if not already loaded
      if (!client.markets) {
        await client.loadMarkets();
      }

      // Check if the symbol exists on this exchange
      const formattedSymbol = formatSymbolForExchange(exchangeSlug, symbol);
      if (!client.markets[formattedSymbol]) {
        return {
          success: false,
          exchangeSlug,
          error: `Symbol ${formattedSymbol} not found on ${exchangeSlug}`
        };
      }

      // Fetch OHLCV data (Open, High, Low, Close, Volume)
      // Format: [[timestamp, open, high, low, close, volume], ...]
      const ohlcv = await client.fetchOHLCV(formattedSymbol, '1h', since, limit);

      if (!ohlcv || ohlcv.length === 0) {
        return {
          success: false,
          exchangeSlug,
          error: 'No data returned'
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
        error: message
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
   * Get available USD trading pairs for a base asset on an exchange
   */
  async getAvailableSymbols(exchangeSlug: string, baseAsset: string): Promise<string[]> {
    try {
      const client = await this.exchangeManager.getPublicClient(exchangeSlug);

      if (!client.markets) {
        await client.loadMarkets();
      }

      const symbols: string[] = [];
      const baseUpper = baseAsset.toUpperCase();

      for (const symbol of Object.keys(client.markets)) {
        const market = client.markets[symbol];
        if (
          market.base?.toUpperCase() === baseUpper &&
          (market.quote === 'USD' || market.quote === 'USDT' || market.quote === 'ZUSD')
        ) {
          symbols.push(symbol);
        }
      }

      // Sort to prefer /USD over /USDT over /ZUSD
      const quoteOrder: Record<string, number> = { USD: 0, USDT: 1, ZUSD: 2 };
      symbols.sort((a, b) => {
        const quoteA = a.split('/')[1] || '';
        const quoteB = b.split('/')[1] || '';
        return (quoteOrder[quoteA] ?? 99) - (quoteOrder[quoteB] ?? 99);
      });

      return symbols;
    } catch (error: unknown) {
      this.logger.warn(`Failed to get available symbols for ${baseAsset} on ${exchangeSlug}: ${error}`);
      return [];
    }
  }

  /**
   * Sleep helper for delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
