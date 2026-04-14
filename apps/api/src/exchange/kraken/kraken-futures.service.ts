import { forwardRef, Inject, Injectable, InternalServerErrorException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import * as ccxt from 'ccxt';

import { CircuitBreakerService } from '../../shared/circuit-breaker.service';
import { toErrorInfo } from '../../shared/error.util';
import { User } from '../../users/users.entity';
import { BaseExchangeService } from '../base-exchange.service';
import { ExchangeKeyService } from '../exchange-key/exchange-key.service';
import { ExchangeService } from '../exchange.service';

/** Slippage fraction applied to limit prices when simulating market orders (0.1% = 10 bps) */
const SLIPPAGE_FRACTION = 0.001;

@Injectable()
export class KrakenFuturesService extends BaseExchangeService {
  protected readonly exchangeSlug = 'kraken_futures';
  protected readonly exchangeId: keyof typeof ccxt = 'krakenfutures';
  protected readonly apiKeyConfigName = 'KRAKEN_FUTURES_API_KEY';
  protected readonly apiSecretConfigName = 'KRAKEN_FUTURES_API_SECRET';
  readonly quoteAsset = 'USD';

  override get supportsFutures(): boolean {
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
   * Set leverage for a symbol on Kraken Futures.
   * Kraken Futures supports this via PUT /leveragepreferences.
   */
  override async setLeverage(leverage: number, symbol: string, user: User): Promise<void> {
    try {
      const exchange = await this.getClient(user);
      await exchange.setLeverage(leverage, symbol);
      this.logger.log(`Set leverage to ${leverage}x for ${symbol} on Kraken Futures`);
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to set leverage on Kraken Futures: ${err.message}`, err.stack);
      throw new InternalServerErrorException(`Failed to set leverage on Kraken Futures: ${err.message}`);
    }
  }

  /**
   * Create a futures order on Kraken Futures.
   * Kraken Futures does NOT support market orders — uses limit orders instead.
   * If no price is provided in params, fetches the current ticker price and applies
   * a small slippage buffer to simulate a market order.
   */
  override async createFuturesOrder(
    user: User,
    symbol: string,
    side: 'buy' | 'sell',
    quantity: number,
    leverage: number,
    params?: Record<string, unknown>
  ): Promise<ccxt.Order> {
    try {
      const exchange = await this.getClient(user);

      // Set leverage before placing the order (inline to avoid double getClient call)
      if (leverage && leverage > 1) {
        await exchange.setLeverage(leverage, symbol);
        this.logger.log(`Set leverage to ${leverage}x for ${symbol} on Kraken Futures`);
      }

      // Determine limit price: use explicit price or fetch from ticker
      let price = params?.price as number | undefined;
      if (!price) {
        const ticker = await exchange.fetchTicker(symbol);
        const lastPrice = ticker.last;
        if (!lastPrice) {
          throw new InternalServerErrorException(`Cannot determine price for ${symbol} on Kraken Futures`);
        }
        // Apply slippage buffer: add for buys, subtract for sells
        price = side === 'buy' ? lastPrice * (1 + SLIPPAGE_FRACTION) : lastPrice * (1 - SLIPPAGE_FRACTION);
      }

      const { price: _price, ...restParams } = params ?? {};

      return await exchange.createOrder(symbol, 'limit', side, quantity, price, restParams);
    } catch (error: unknown) {
      if (error instanceof InternalServerErrorException) throw error;
      const err = toErrorInfo(error);
      this.logger.error(`Failed to create futures order on Kraken Futures: ${err.message}`, err.stack);
      throw new InternalServerErrorException(`Failed to create futures order on Kraken Futures: ${err.message}`);
    }
  }

  /**
   * Get open futures positions from Kraken Futures
   */
  override async getFuturesPositions(user: User, symbol?: string): Promise<ccxt.Position[]> {
    const exchange = await this.getClient(user);
    const symbols = symbol ? [symbol] : undefined;
    return exchange.fetchPositions(symbols);
  }

  /**
   * Format symbol for Kraken Futures.
   * Kraken Futures uses `BTC/USD:USD` format (with settlement currency).
   * Converts: BTCUSD → BTC/USD:USD, BTC/USD → BTC/USD:USD
   */
  override formatSymbol(symbol: string): string {
    symbol = symbol.toUpperCase();

    // Already in futures format (e.g., BTC/USD:USD)
    if (symbol.includes(':')) {
      return symbol;
    }

    // Has slash but no settlement (e.g., BTC/USD → BTC/USD:USD)
    if (symbol.includes('/')) {
      const quote = symbol.split('/')[1];
      return `${symbol}:${quote}`;
    }

    // Raw format (e.g., BTCUSD → BTC/USD:USD)
    if (symbol.endsWith('USDT')) {
      const base = symbol.slice(0, -4);
      if (base.length >= 2) return `${base}/USDT:USDT`;
    } else if (symbol.endsWith('USD')) {
      const base = symbol.slice(0, -3);
      if (base.length >= 2) return `${base}/USD:USD`;
    }

    // Fallback
    this.logger.warn(`Could not parse symbol into futures format: ${symbol}`);
    return symbol;
  }

  protected override getAdditionalClientConfig(): object {
    return {
      sandbox: false
    };
  }
}
