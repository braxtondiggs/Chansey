import { Injectable, Logger } from '@nestjs/common';

import * as ccxt from 'ccxt';

import { BaseExchangeService } from './base-exchange.service';
import { BinanceUSService } from './binance/binance-us.service';
import { CoinbaseExchangeService } from './coinbase-exchange/coinbase-exchange.service';
// eslint-disable-next-line import/order
import { CoinbaseService } from './coinbase/coinbase.service';
import { ExchangeService } from './exchange.service';

import { User } from '../users/users.entity';

/**
 * Centralized exchange manager that provides access to all exchange services
 * Leverages the existing BaseExchangeService implementations without duplicating functionality
 */
@Injectable()
export class ExchangeManagerService {
  private readonly logger = new Logger(ExchangeManagerService.name);

  constructor(
    private readonly binanceUSService: BinanceUSService,
    private readonly coinbaseService: CoinbaseService,
    private readonly coinbaseExchangeService: CoinbaseExchangeService,
    private readonly exchangeService: ExchangeService
  ) {}

  /**
   * Get the appropriate exchange service by slug
   * @param exchangeSlug The exchange identifier
   * @returns The exchange service instance
   */
  getExchangeService(exchangeSlug: string): BaseExchangeService {
    switch (exchangeSlug) {
      case 'binance_us':
        return this.binanceUSService;
      case 'coinbase':
        return this.coinbaseService;
      case 'gdax':
        return this.coinbaseExchangeService;
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
    console.log(`Getting client for exchange: ${service}`);
    return await service.getClient(user);
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
      } catch (error) {
        this.logger.warn(`Failed to get balance from ${exchange.slug}: ${error.message}`);
        results.push({
          exchange: exchange.slug,
          success: false,
          error: error.message
        });
      }
    }

    return results;
  }
}
