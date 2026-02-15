import { Inject, Injectable, Logger } from '@nestjs/common';

import * as ccxt from 'ccxt';

import { BinanceUSService } from './binance/binance-us.service';
import { CoinbaseExchangeService } from './coinbase-exchange/coinbase-exchange.service';
// eslint-disable-next-line import/order
import { CoinbaseService } from './coinbase/coinbase.service';
import { EXCHANGE_SERVICE, IBaseExchangeService, IExchangeManagerService, IExchangeService } from './interfaces';
import { KrakenService } from './kraken/kraken.service';

import { toErrorInfo } from '../shared/error.util';
import type { User } from '../users/users.entity';

/**
 * Centralized exchange manager that provides access to all exchange services
 * Leverages the existing BaseExchangeService implementations without duplicating functionality
 */
@Injectable()
export class ExchangeManagerService implements IExchangeManagerService {
  private readonly logger = new Logger(ExchangeManagerService.name);

  constructor(
    private readonly binanceUSService: BinanceUSService,
    private readonly coinbaseService: CoinbaseService,
    private readonly coinbaseExchangeService: CoinbaseExchangeService,
    private readonly krakenService: KrakenService,
    @Inject(EXCHANGE_SERVICE)
    private readonly exchangeService: IExchangeService
  ) {}

  /**
   * Get the appropriate exchange service by slug
   * @param exchangeSlug The exchange identifier
   * @returns The exchange service instance
   */
  getExchangeService(exchangeSlug: string): IBaseExchangeService {
    switch (exchangeSlug) {
      case 'binance_us':
        return this.binanceUSService;
      case 'coinbase':
        return this.coinbaseService;
      case 'gdax':
        return this.coinbaseExchangeService;
      case 'kraken':
        return this.krakenService;
      default:
        throw new Error(`Exchange service not found for: ${exchangeSlug}`);
    }
  }

  /**
   * Get exchange client for a specific exchange using the base service's client management
   * @param exchangeSlug Exchange identifier
   * @param user User context for client initialization
   * @returns Exchange client instance
   */
  async getExchangeClient(exchangeSlug: string, user?: User): Promise<ccxt.Exchange> {
    const service = this.getExchangeService(exchangeSlug);
    return await service.getClient(user);
  }

  /**
   * Get a public-only exchange client (no API keys, public endpoints only)
   * @param exchangeSlug Exchange identifier (defaults to 'binance_us')
   * @returns Public exchange client instance
   */
  async getPublicClient(exchangeSlug = 'binance_us'): Promise<ccxt.Exchange> {
    const service = this.getExchangeService(exchangeSlug);
    return await service.getPublicClient();
  }

  /**
   * Get price from a specific exchange using the base service implementation
   * @param exchangeSlug Exchange identifier
   * @param symbol Trading pair symbol
   * @param user Optional user for API context
   * @returns Price data
   */
  async getPrice(exchangeSlug: string, symbol: string, user?: User) {
    const service = this.getExchangeService(exchangeSlug);
    return await service.getPrice(symbol, user);
  }

  /**
   * Get balance from a specific exchange using the base service implementation
   * @param exchangeSlug Exchange identifier
   * @param user User to get balance for
   * @returns Balance data
   */
  async getBalance(exchangeSlug: string, user: User) {
    const service = this.getExchangeService(exchangeSlug);
    return await service.getBalance(user);
  }

  /**
   * Format symbol for a specific exchange using the base service implementation
   * @param exchangeSlug Exchange identifier
   * @param symbol Raw symbol to format
   * @returns Formatted symbol
   */
  formatSymbol(exchangeSlug: string, symbol: string): string {
    const service = this.getExchangeService(exchangeSlug);
    return service.formatSymbol(symbol);
  }

  /**
   * Get balances from all configured exchanges for a user
   * @param user User to get balances for
   * @returns Array of balance results from all exchanges
   */
  async getBalancesFromAllExchanges(user: User) {
    const exchanges = await this.exchangeService.getExchanges({ supported: true });
    const results = [];

    for (const exchange of exchanges) {
      try {
        const exchangeService = this.getExchangeService(exchange.slug);
        const balances = await exchangeService.getBalance(user);
        results.push({
          exchange: exchange.slug,
          success: true,
          data: balances
        });
      } catch (error: unknown) {
        const err = toErrorInfo(error);
        this.logger.warn(`Failed to get balance from ${exchange.slug}: ${err.message}`);
        results.push({
          exchange: exchange.slug,
          success: false,
          error: err.message
        });
      }
    }

    return results;
  }
}
