import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import * as ccxt from 'ccxt';
import { QueryRunner, Repository } from 'typeorm';

import { randomUUID } from 'crypto';

import { Coin } from '../../coin/coin.entity';
import { CoinService } from '../../coin/coin.service';
import { ExchangeKey } from '../../exchange/exchange-key/exchange-key.entity';
import { ExchangeKeyService } from '../../exchange/exchange-key/exchange-key.service';
import { ExchangeManagerService } from '../../exchange/exchange-manager.service';
import { CircuitBreakerService, CircuitOpenError } from '../../shared/circuit-breaker.service';
import { toErrorInfo } from '../../shared/error.util';
import { precisionToStepSize } from '../../shared/precision.util';
import { extractRetryAfterMs, isRateLimitError, isTransientError, withRetry } from '../../shared/retry.util';
import { User } from '../../users/users.entity';
import { ExchangeMarketLimits, PlaceExitOrderParams } from '../interfaces/exit-config.interface';
import { Order, OrderSide, OrderStatus, OrderType } from '../order.entity';

/**
 * Exchange OCO support configuration
 */
export interface ExchangeOcoSupport {
  /** Exchange supports native OCO orders */
  native: boolean;
  /** Exchange supports simulated OCO (via position monitoring) */
  simulated: boolean;
}

/**
 * ExitOrderPlacementService
 *
 * Handles exchange interaction for exit orders — placing, cancelling, OCO linking,
 * resilience wrapper, market limits, and coin lookup.
 */
@Injectable()
export class ExitOrderPlacementService {
  private readonly logger = new Logger(ExitOrderPlacementService.name);

  /**
   * Known OCO support per exchange
   */
  private readonly exchangeOcoSupport: Record<string, ExchangeOcoSupport> = {
    binance_us: { native: false, simulated: true },
    binance: { native: false, simulated: true },
    coinbase: { native: false, simulated: true },
    gdax: { native: false, simulated: true },
    kraken: { native: false, simulated: true }
  };

  constructor(
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    private readonly exchangeKeyService: ExchangeKeyService,
    private readonly exchangeManagerService: ExchangeManagerService,
    private readonly coinService: CoinService,
    private readonly circuitBreaker: CircuitBreakerService
  ) {}

  /**
   * Execute an exchange operation with circuit breaker and retry protection
   */
  async executeWithResilience<T>(exchangeSlug: string, operation: () => Promise<T>, operationName: string): Promise<T> {
    const circuitKey = `exchange:${exchangeSlug}`;

    // Check circuit breaker first (fail-fast)
    try {
      this.circuitBreaker.checkCircuit(circuitKey);
    } catch (error: unknown) {
      if (error instanceof CircuitOpenError) {
        this.logger.warn(`${operationName} blocked by circuit breaker for ${exchangeSlug}: ${error.message}`);
      }
      throw error;
    }

    // Execute with retry (rate-limit-aware delays)
    const result = await withRetry(operation, {
      maxRetries: 3,
      initialDelayMs: 1000,
      maxDelayMs: 10000,
      backoffMultiplier: 2,
      isRetryable: isTransientError,
      onRetry: (error, _attempt, defaultDelay) => {
        if (isRateLimitError(error)) {
          return extractRetryAfterMs(error) ?? Math.max(defaultDelay, 5000);
        }
      },
      logger: this.logger,
      operationName: `${operationName} (${exchangeSlug})`
    });

    if (result.success) {
      this.circuitBreaker.recordSuccess(circuitKey);
      return result.result as T;
    }

    // Record failure and throw
    this.circuitBreaker.recordFailure(circuitKey);
    throw result.error;
  }

  /**
   * Get an exchange client for the given slug and user (with resilience)
   */
  async getExchangeClient(exchangeSlug: string, user: User): Promise<ccxt.Exchange> {
    return this.executeWithResilience(
      exchangeSlug,
      () => this.exchangeManagerService.getExchangeClient(exchangeSlug, user),
      'getExchangeClient'
    );
  }

  /**
   * Get market limits from exchange client
   * Extracts minimum order size, step size, and notional requirements
   */
  getMarketLimits(exchangeClient: ccxt.Exchange, symbol: string): ExchangeMarketLimits | null {
    try {
      const market = exchangeClient.markets?.[symbol];
      if (!market) {
        this.logger.warn(`Market ${symbol} not found in exchange markets`);
        return null;
      }

      const precisionMode = exchangeClient.precisionMode;
      const rawAmountPrecision = market.precision?.amount;
      const rawPricePrecision = market.precision?.price;

      // Normalize step size using the exchange's precision mode
      const amountStep = precisionToStepSize(rawAmountPrecision, precisionMode);
      const priceStep = precisionToStepSize(rawPricePrecision, precisionMode);

      // Derive integer decimal-place counts from step sizes (safe for Decimal.toDecimalPlaces)
      const amountPrecision = amountStep > 0 ? Math.max(0, Math.round(-Math.log10(amountStep))) : 8;
      const pricePrecision = priceStep > 0 ? Math.max(0, Math.round(-Math.log10(priceStep))) : 8;

      return {
        minAmount: market.limits?.amount?.min ?? 0,
        maxAmount: market.limits?.amount?.max ?? Number.MAX_SAFE_INTEGER,
        amountStep,
        minCost: market.limits?.cost?.min ?? 0,
        pricePrecision,
        amountPrecision
      };
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.warn(`Failed to get market limits for ${symbol}: ${err.message}`);
      return null;
    }
  }

  /**
   * Check exchange OCO support
   */
  checkExchangeOcoSupport(exchangeSlug: string): ExchangeOcoSupport {
    return this.exchangeOcoSupport[exchangeSlug] || { native: false, simulated: true };
  }

  /**
   * Place stop loss order on exchange (with resilience)
   */
  async placeStopLossOrder(
    params: PlaceExitOrderParams,
    exchangeClient: ccxt.Exchange | null,
    user: User,
    exchangeKey: ExchangeKey | null,
    queryRunner: QueryRunner,
    exchangeSlug?: string
  ): Promise<Order> {
    let ccxtOrder: ccxt.Order | null = null;

    if (exchangeClient && exchangeSlug) {
      try {
        ccxtOrder = await this.executeWithResilience(
          exchangeSlug,
          () =>
            exchangeClient.createOrder(
              params.symbol,
              'stop_loss',
              params.side.toLowerCase(),
              params.quantity,
              undefined, // No limit price for market stop
              { stopPrice: params.stopPrice }
            ),
          'createStopLossOrder'
        );
      } catch (exchangeError: unknown) {
        const err = toErrorInfo(exchangeError);
        this.logger.warn(`Exchange stop loss creation failed: ${err.message}`);
        // Will create a tracking order for monitoring
      }
    }

    // Lookup coins for the symbol
    const { baseCoin, quoteCoin } = await this.lookupCoinsForSymbol(params.symbol);

    // Create order entity
    const order = queryRunner.manager.create(Order, {
      orderId: ccxtOrder?.id?.toString() || `sl_pending_${randomUUID()}`,
      clientOrderId: ccxtOrder?.clientOrderId || `sl_pending_${randomUUID()}`,
      symbol: params.symbol,
      side: params.side as OrderSide,
      type: OrderType.STOP_LOSS,
      quantity: params.quantity,
      price: 0, // Market order
      executedQuantity: 0,
      status: OrderStatus.NEW,
      transactTime: new Date(),
      isManual: false,
      exchangeKeyId: params.exchangeKeyId || undefined,
      stopPrice: params.stopPrice,
      stopLossPrice: params.stopPrice,
      user,
      baseCoin: baseCoin || undefined,
      quoteCoin: quoteCoin || undefined,
      exchange: exchangeKey?.exchange,
      info: ccxtOrder?.info
    });

    return queryRunner.manager.save(order);
  }

  /**
   * Place take profit order on exchange (with resilience)
   */
  async placeTakeProfitOrder(
    params: PlaceExitOrderParams,
    exchangeClient: ccxt.Exchange | null,
    user: User,
    exchangeKey: ExchangeKey | null,
    queryRunner: QueryRunner,
    exchangeSlug?: string
  ): Promise<Order> {
    let ccxtOrder: ccxt.Order | null = null;

    if (exchangeClient && exchangeSlug) {
      try {
        // Take profit is typically a limit order
        ccxtOrder = await this.executeWithResilience(
          exchangeSlug,
          () =>
            exchangeClient.createOrder(
              params.symbol,
              'limit',
              params.side.toLowerCase(),
              params.quantity,
              params.price
            ),
          'createTakeProfitOrder'
        );
      } catch (exchangeError: unknown) {
        const err = toErrorInfo(exchangeError);
        this.logger.warn(`Exchange take profit creation failed: ${err.message}`);
      }
    }

    // Lookup coins for the symbol
    const { baseCoin, quoteCoin } = await this.lookupCoinsForSymbol(params.symbol);

    // Create order entity
    const order = queryRunner.manager.create(Order, {
      orderId: ccxtOrder?.id?.toString() || `tp_pending_${randomUUID()}`,
      clientOrderId: ccxtOrder?.clientOrderId || `tp_pending_${randomUUID()}`,
      symbol: params.symbol,
      side: params.side as OrderSide,
      type: OrderType.TAKE_PROFIT,
      quantity: params.quantity,
      price: params.price,
      executedQuantity: 0,
      status: OrderStatus.NEW,
      transactTime: new Date(),
      isManual: false,
      exchangeKeyId: params.exchangeKeyId || undefined,
      takeProfitPrice: params.price,
      user,
      baseCoin: baseCoin || undefined,
      quoteCoin: quoteCoin || undefined,
      exchange: exchangeKey?.exchange,
      info: ccxtOrder?.info
    });

    return queryRunner.manager.save(order);
  }

  /**
   * Link OCO orders natively on exchange (for exchanges that support it)
   */
  linkOcoOrdersNative(_stopLossOrder: Order, _takeProfitOrder: Order, _exchangeClient: ccxt.Exchange): void {
    // Most exchanges don't support modifying orders to link them after creation
    // This would typically require creating a native OCO order type
    // For now, we rely on simulated OCO via the position monitor
    this.logger.log('Native OCO linking not implemented, using simulated OCO');
  }

  /**
   * Cancel an order by ID (with resilience)
   */
  async cancelOrderById(orderId: string, user: User): Promise<void> {
    try {
      const order = await this.orderRepo.findOne({
        where: { id: orderId },
        relations: ['exchange']
      });

      if (!order) {
        this.logger.warn(`Order ${orderId} not found for cancellation`);
        return;
      }

      // Try to cancel on exchange if we have exchange key (with resilience)
      if (order.exchangeKeyId && order.exchange) {
        const exchangeSlug = order.exchange.slug;
        try {
          const exchangeKey = await this.exchangeKeyService.findOne(order.exchangeKeyId, user.id);
          if (exchangeKey) {
            const exchangeClient = await this.executeWithResilience(
              exchangeSlug,
              () => this.exchangeManagerService.getExchangeClient(exchangeSlug, user),
              'getExchangeClient'
            );
            await this.executeWithResilience(
              exchangeSlug,
              () => exchangeClient.cancelOrder(order.orderId, order.symbol),
              'cancelOrder'
            );
          }
        } catch (cancelError: unknown) {
          const err = toErrorInfo(cancelError);
          this.logger.warn(`Exchange order cancellation failed: ${err.message}`);
        }
      }

      // Update order status in DB
      order.status = OrderStatus.CANCELED;
      await this.orderRepo.save(order);

      this.logger.log(`Order ${orderId} cancelled`);
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to cancel order ${orderId}: ${err.message}`);
    }
  }

  /**
   * Lookup base and quote coins for a trading symbol
   */
  private async lookupCoinsForSymbol(symbol: string): Promise<{ baseCoin: Coin | null; quoteCoin: Coin | null }> {
    const [baseSymbol, quoteSymbol] = symbol.split('/');
    let baseCoin: Coin | null = null;
    let quoteCoin: Coin | null = null;

    try {
      const coins = await this.coinService.getMultipleCoinsBySymbol([baseSymbol, quoteSymbol]);
      baseCoin = coins.find((c) => c.symbol.toLowerCase() === baseSymbol.toLowerCase()) || null;
      quoteCoin = coins.find((c) => c.symbol.toLowerCase() === quoteSymbol.toLowerCase()) || null;

      if (!baseCoin) {
        this.logger.debug(`Base coin ${baseSymbol} not found in database`);
      }
      if (!quoteCoin) {
        this.logger.debug(`Quote coin ${quoteSymbol} not found in database`);
      }
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.warn(`Could not lookup coins for symbol ${symbol}: ${err.message}`);
    }

    return {
      baseCoin: baseCoin && !CoinService.isVirtualCoin(baseCoin) ? baseCoin : null,
      quoteCoin: quoteCoin && !CoinService.isVirtualCoin(quoteCoin) ? quoteCoin : null
    };
  }
}
