import { forwardRef, Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import * as ccxt from 'ccxt';

import { CircuitBreakerService } from '../../shared/circuit-breaker.service';
import { withExchangeRetryThrow } from '../../shared/retry.util';
import { User } from '../../users/users.entity';
import { BaseExchangeService } from '../base-exchange.service';
import { ExchangeKeyService } from '../exchange-key/exchange-key.service';
import { ExchangeService } from '../exchange.service';

@Injectable()
export class CoinbaseService extends BaseExchangeService {
  protected readonly exchangeSlug = 'coinbase'; // Regular Coinbase's slug
  protected readonly exchangeId: keyof typeof ccxt = 'coinbaseadvanced'; // Note: ccxt uses 'coinbaseadvanced' for Coinbase Advanced Trading
  protected readonly apiKeyConfigName = 'COINBASE_API_KEY';
  protected readonly apiSecretConfigName = 'COINBASE_API_SECRET';
  readonly quoteAsset = 'USD';

  /**
   * Coinbase Advanced supports futures/perpetual trading
   */
  override get supportsFutures(): boolean {
    return true;
  }

  protected override get balanceFilterByTotal(): boolean {
    return true;
  }

  protected override get balanceSilentOnError(): boolean {
    return true;
  }

  constructor(
    configService?: ConfigService,

    @Inject(forwardRef(() => ExchangeService)) exchangeService?: ExchangeService,
    @Inject(forwardRef(() => ExchangeKeyService)) exchangeKeyService?: ExchangeKeyService,
    @Optional() circuitBreaker?: CircuitBreakerService
  ) {
    super(configService, exchangeKeyService, exchangeService, circuitBreaker);
  }

  /**
   * Get a CCXT Coinbase client for a user or the default client
   * @param user Optional user for fetching their specific API keys
   * @returns A configured CCXT Coinbase client
   */
  async getCoinbaseClient(user?: User): Promise<ccxt.coinbaseadvanced> {
    return (await this.getClient(user)) as ccxt.coinbaseadvanced;
  }

  /**
   * Override formatSymbol for regular Coinbase specific formatting
   * @param symbol Raw symbol like "BTCUSD"
   * @returns Formatted symbol
   */
  formatSymbol(symbol: string): string {
    // Coinbase uses different symbol formatting than Coinbase Pro
    return symbol
      .replace('USDT', '/USD')
      .replace(/([A-Z]{3,4})([A-Z]{3,4})/, '$1-$2') // Use dash instead of slash
      .replace('/', '-'); // Convert any slashes to dashes
  }

  /**
   * Override getAdditionalClientConfig for regular Coinbase specific configuration
   */
  protected getAdditionalClientConfig(): object {
    return {
      sandbox: false // Regular Coinbase configuration
    };
  }

  /**
   * Create a futures order on Coinbase Advanced.
   * Coinbase Advanced does not support setMarginMode or setLeverage via API —
   * margin/leverage is managed by the exchange, not user-configurable.
   */
  async createFuturesOrder(
    user: User,
    symbol: string,
    side: 'buy' | 'sell',
    quantity: number,
    leverage: number,
    params?: Record<string, unknown>
  ): Promise<ccxt.Order> {
    if (leverage !== undefined && leverage !== 1) {
      this.logger.debug(
        `Coinbase Advanced: leverage=${leverage} ignored — margin/leverage is managed by the exchange, not user-configurable`
      );
    }

    const exchange = await this.getClient(user);

    return exchange.createMarketOrder(symbol, side, quantity, undefined, {
      ...params
    });
  }

  /**
   * Get open futures positions from Coinbase Advanced
   * @param user User context for client initialization
   * @param symbol Optional symbol filter; if omitted, returns all positions
   * @returns Array of CCXT position objects
   */
  async getFuturesPositions(user: User, symbol?: string): Promise<ccxt.Position[]> {
    const exchange = await this.getClient(user);
    const symbols = symbol ? [symbol] : undefined;
    return this.withCircuitBreaker(() =>
      withExchangeRetryThrow(() => exchange.fetchPositions(symbols), {
        logger: this.logger,
        operationName: 'getFuturesPositions'
      })
    );
  }
}
