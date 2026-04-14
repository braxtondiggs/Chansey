import { forwardRef, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';

import * as ccxt from 'ccxt';
import { Repository } from 'typeorm';

import { MarketType, MAX_LEVERAGE_CAP } from '@chansey/api-interfaces';

import { OrderConversionService } from './order-conversion.service';
import { OrderValidationService } from './order-validation.service';
import { PositionManagementService } from './position-management.service';

import { AlgorithmActivation } from '../../algorithm/algorithm-activation.entity';
import {
  ExchangeKeyNotFoundException,
  InvalidSymbolException,
  SlippageExceededException,
  UserNotFoundException,
  ValidationException
} from '../../common/exceptions';
import { ExchangeKeyService } from '../../exchange/exchange-key/exchange-key.service';
import { ExchangeManagerService } from '../../exchange/exchange-manager.service';
import { NOTIFICATION_EVENTS } from '../../notification/interfaces/notification-events.interface';
import { toErrorInfo } from '../../shared/error.util';
import { withExchangeRetryThrow } from '../../shared/retry.util';
import { User } from '../../users/users.entity';
import { DEFAULT_SLIPPAGE_LIMITS, slippageLimitsConfig, SlippageLimitsConfig } from '../config/slippage-limits.config';
import type { TradeSignal, TradeSignalWithExit } from '../interfaces/trade-signal.interface';
import { Order } from '../order.entity';

export type { TradeSignal, TradeSignalWithExit } from '../interfaces/trade-signal.interface';

/**
 * TradeExecutionService
 *
 * Executes trades based on algorithm signals using CCXT.
 * Handles order creation, partial fills, and error logging.
 */
@Injectable()
export class TradeExecutionService {
  private readonly logger = new Logger(TradeExecutionService.name);
  private readonly slippageLimits: SlippageLimitsConfig;

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(AlgorithmActivation)
    private readonly algorithmActivationRepository: Repository<AlgorithmActivation>,
    private readonly exchangeKeyService: ExchangeKeyService,
    private readonly exchangeManagerService: ExchangeManagerService,
    private readonly orderConversionService: OrderConversionService,
    private readonly orderValidationService: OrderValidationService,
    private readonly eventEmitter: EventEmitter2,
    @Optional()
    @Inject(forwardRef(() => PositionManagementService))
    private readonly positionManagementService?: PositionManagementService,
    @Optional()
    @Inject(slippageLimitsConfig.KEY)
    slippageLimitsConfigValue?: ConfigType<typeof slippageLimitsConfig>
  ) {
    this.slippageLimits = slippageLimitsConfigValue ?? DEFAULT_SLIPPAGE_LIMITS;

    if (this.slippageLimits.maxSlippageBps <= this.slippageLimits.warnSlippageBps) {
      throw new Error(
        `Invalid slippage config: MAX_SLIPPAGE_BPS (${this.slippageLimits.maxSlippageBps}) must be greater than ` +
          `WARN_SLIPPAGE_BPS (${this.slippageLimits.warnSlippageBps})`
      );
    }
  }

  /**
   * Execute a trade signal from an algorithm
   * @param signal - Trade signal with algorithm activation, action, symbol, quantity, and optional exit config
   * @returns Created Order entity
   * @throws BadRequestException if validation fails
   */
  async executeTradeSignal(signal: TradeSignalWithExit): Promise<Order> {
    this.logger.log(
      `Executing trade signal: ${signal.action} ${signal.quantity} ${signal.symbol} for activation ${signal.algorithmActivationId}`
    );

    try {
      const { exchangeKey, user } = await this.validatePrerequisites(signal);
      const exchangeClient = await this.initializeExchangeClient(exchangeKey.exchange.slug, user, signal.symbol);
      const expectedPrice = await this.captureExpectedPrice(exchangeClient, signal.symbol, signal.action);
      const effectiveQuantity = this.resolveQuantity(signal, expectedPrice);

      // Validate order size against exchange minimums
      const market = exchangeClient.markets[signal.symbol];
      this.orderValidationService.validateAlgorithmicOrderSize(effectiveQuantity, expectedPrice, market);

      // Pre-execution slippage check
      await this.validateSlippage(exchangeClient, signal.symbol, effectiveQuantity, signal.action, expectedPrice);

      // Execute order via CCXT
      const ccxtOrder = await this.placeOrder(exchangeClient, exchangeKey.exchange, user, signal, effectiveQuantity);
      this.logger.log(`Order executed successfully: ${ccxtOrder.id}`);

      // Calculate and log actual slippage
      const actualPrice = ccxtOrder.average || ccxtOrder.price || 0;
      const actualSlippageBps = this.calculateSlippageBps(expectedPrice, actualPrice, signal.action);
      this.logSlippage(signal.symbol, actualSlippageBps, expectedPrice, actualPrice);

      // Convert CCXT order to our Order entity
      const order = await this.orderConversionService.convertCcxtOrderToEntity(
        ccxtOrder,
        user,
        exchangeKey.exchange,
        signal.algorithmActivationId,
        expectedPrice,
        actualSlippageBps,
        signal.marketType === 'futures' ? signal : undefined
      );

      // Log partial fill info
      if (ccxtOrder.filled && ccxtOrder.filled > 0) {
        this.logger.log(
          `Order ${ccxtOrder.id} executed: ${ccxtOrder.filled}/${ccxtOrder.amount} filled ` +
            `(${((ccxtOrder.filled / ccxtOrder.amount) * 100).toFixed(2)}%), slippage: ${actualSlippageBps.toFixed(2)} bps`
        );
      }

      // Attach exit orders if configured
      await this.tryAttachExitOrders(order, signal);

      // Emit trade executed notification
      this.eventEmitter.emit(NOTIFICATION_EVENTS.TRADE_EXECUTED, {
        userId: signal.userId,
        action: signal.action,
        symbol: signal.symbol,
        quantity: order.executedQuantity || effectiveQuantity,
        price: order.price || 0,
        exchangeName: exchangeKey.exchange.name,
        orderId: order.id
      });

      return order;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(
        `Failed to execute trade signal for activation ${signal.algorithmActivationId}: ${err.message}`,
        err.stack
      );

      this.eventEmitter.emit(NOTIFICATION_EVENTS.TRADE_ERROR, {
        userId: signal.userId,
        symbol: signal.symbol,
        action: signal.action,
        errorMessage: err.message
      });

      throw error;
    }
  }

  /**
   * Calculate trade size based on algorithm activation allocation percentage
   */
  calculateTradeSize(activation: AlgorithmActivation, portfolioValue: number): number {
    const allocationPercentage = activation.allocationPercentage || 5.0;
    const tradeSize = (portfolioValue * allocationPercentage) / 100;

    this.logger.debug(
      `Calculated trade size: ${allocationPercentage}% of $${portfolioValue.toFixed(2)} = $${tradeSize.toFixed(2)}`
    );

    return tradeSize;
  }

  /**
   * Check if the user has sufficient funds for a trade without throwing.
   * Returns the available balance and whether it's sufficient.
   */
  async checkFundsAvailable(
    exchangeClient: ccxt.Exchange,
    signal: TradeSignal
  ): Promise<{ sufficient: boolean; available: number; required: number }> {
    try {
      const balance = await exchangeClient.fetchBalance();
      const [baseCurrency, quoteCurrency] = signal.symbol.split('/');

      if (signal.action === 'BUY') {
        const ticker = await exchangeClient.fetchTicker(signal.symbol);
        const requiredAmount = signal.quantity * (ticker.last || 0);
        const available = balance[quoteCurrency]?.free || 0;
        return { sufficient: available >= requiredAmount, available, required: requiredAmount };
      } else {
        const available = balance[baseCurrency]?.free || 0;
        return { sufficient: available >= signal.quantity, available, required: signal.quantity };
      }
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.warn(`Failed to check funds: ${err.message}`);
      // On error, assume sufficient to not block execution
      return { sufficient: true, available: 0, required: 0 };
    }
  }

  /**
   * Fetch and validate exchange key + user, gate futures if not enabled.
   */
  private async validatePrerequisites(signal: TradeSignalWithExit) {
    const exchangeKey = await this.exchangeKeyService.findOne(signal.exchangeKeyId, signal.userId);
    if (!exchangeKey || !exchangeKey.exchange) {
      throw new ExchangeKeyNotFoundException(signal.exchangeKeyId);
    }

    const user = await this.userRepository.findOneBy({ id: signal.userId });
    if (!user) {
      throw new UserNotFoundException(signal.userId);
    }

    if (signal.marketType === MarketType.FUTURES && !user.futuresEnabled) {
      throw new ValidationException(
        'Futures trading is not enabled. Enable it in Settings > Trading to use futures/short-selling.'
      );
    }

    return { exchangeKey, user };
  }

  /**
   * Initialize CCXT exchange client, load markets, and verify the symbol exists.
   */
  private async initializeExchangeClient(slug: string, user: User, symbol: string) {
    const exchangeClient = await this.exchangeManagerService.getExchangeClient(slug, user);

    await withExchangeRetryThrow(() => exchangeClient.loadMarkets(), {
      logger: this.logger,
      operationName: 'loadMarkets'
    });

    if (!exchangeClient.markets[symbol]) {
      throw new InvalidSymbolException(symbol, slug);
    }

    return exchangeClient;
  }

  /**
   * Capture the expected execution price from the current ticker.
   */
  private async captureExpectedPrice(
    exchangeClient: ccxt.Exchange,
    symbol: string,
    action: 'BUY' | 'SELL'
  ): Promise<number> {
    const ticker = await withExchangeRetryThrow(() => exchangeClient.fetchTicker(symbol), {
      logger: this.logger,
      operationName: `fetchTicker(${symbol})`
    });
    const expectedPrice = action === 'BUY' ? ticker.ask || ticker.last || 0 : ticker.bid || ticker.last || 0;

    this.logger.debug(`Expected price for ${symbol}: ${expectedPrice} (${action === 'BUY' ? 'ask' : 'bid'})`);

    return expectedPrice;
  }

  /**
   * Resolve effective quantity: auto-size from portfolio allocation or use signal quantity.
   */
  private resolveQuantity(signal: TradeSignalWithExit, expectedPrice: number): number {
    let effectiveQuantity = signal.quantity;

    if (
      signal.autoSize &&
      signal.portfolioValue &&
      signal.portfolioValue > 0 &&
      signal.allocationPercentage &&
      signal.allocationPercentage > 0
    ) {
      if (expectedPrice <= 0) {
        throw new ValidationException('Cannot auto-size: expected price is zero or negative');
      }
      const tradeSizeUsd = (signal.portfolioValue * signal.allocationPercentage) / 100;
      effectiveQuantity = tradeSizeUsd / expectedPrice;
      this.logger.debug(
        `Auto-sized: ${signal.allocationPercentage}% of $${signal.portfolioValue.toFixed(2)} = ` +
          `$${tradeSizeUsd.toFixed(2)} → ${effectiveQuantity.toFixed(8)} ${signal.symbol}`
      );
    }

    if (effectiveQuantity <= 0) {
      throw new ValidationException(
        `Trade quantity is zero after ${signal.autoSize ? 'auto-sizing' : 'signal'} — ` +
          `cannot place order for ${signal.symbol}`
      );
    }

    return effectiveQuantity;
  }

  /**
   * Run pre-execution slippage validation against the order book.
   */
  private async validateSlippage(
    exchangeClient: ccxt.Exchange,
    symbol: string,
    quantity: number,
    action: 'BUY' | 'SELL',
    expectedPrice: number
  ): Promise<void> {
    if (!this.slippageLimits.enabled) return;

    const estimatedSlippageBps = await this.estimateSlippageFromOrderBook(
      exchangeClient,
      symbol,
      quantity,
      action,
      expectedPrice
    );

    if (estimatedSlippageBps > this.slippageLimits.maxSlippageBps) {
      throw new SlippageExceededException(
        Math.round(estimatedSlippageBps * 100) / 100,
        this.slippageLimits.maxSlippageBps
      );
    }

    if (estimatedSlippageBps > this.slippageLimits.warnSlippageBps) {
      this.logger.warn(
        `High estimated slippage for ${symbol}: ${estimatedSlippageBps.toFixed(2)} bps ` +
          `(warning threshold: ${this.slippageLimits.warnSlippageBps} bps)`
      );
    }
  }

  /**
   * Place a market order via CCXT, branching on spot vs futures.
   */
  private async placeOrder(
    exchangeClient: ccxt.Exchange,
    exchange: { slug: string; name: string },
    user: User,
    signal: TradeSignalWithExit,
    effectiveQuantity: number
  ): Promise<ccxt.Order> {
    const orderSide = signal.action.toLowerCase() as 'buy' | 'sell';

    if (signal.marketType === MarketType.FUTURES) {
      const leverage = Math.min(signal.leverage ?? 1, MAX_LEVERAGE_CAP);
      const futuresSide = signal.action.toLowerCase() as 'buy' | 'sell';

      const exchangeService = this.exchangeManagerService.getExchangeService(exchange.slug);
      if (!exchangeService.supportsFutures) {
        throw new ValidationException(`Exchange ${exchange.name} does not support futures trading`);
      }

      this.logger.log(
        `Placing futures order: ${futuresSide} ${effectiveQuantity} ${signal.symbol} ` +
          `leverage=${leverage}x positionSide=${signal.positionSide ?? 'long'}`
      );

      return exchangeService.createFuturesOrder(user, signal.symbol, futuresSide, effectiveQuantity, leverage, {
        positionSide: signal.positionSide ?? 'long'
      });
    }

    return exchangeClient.createMarketOrder(signal.symbol, orderSide, effectiveQuantity);
  }

  /**
   * Attach exit orders (SL/TP/trailing) to an entry order, swallowing errors.
   */
  private async tryAttachExitOrders(order: Order, signal: TradeSignalWithExit): Promise<void> {
    if (!signal.exitConfig || !this.positionManagementService) return;

    const hasExitEnabled =
      signal.exitConfig.enableStopLoss || signal.exitConfig.enableTakeProfit || signal.exitConfig.enableTrailingStop;

    if (!hasExitEnabled) return;

    try {
      const exitResult = await this.positionManagementService.attachExitOrders(
        order,
        signal.exitConfig,
        signal.priceData
      );

      this.logger.log(
        `Exit orders attached to entry ${order.id}: SL=${exitResult.stopLossOrderId || 'none'}, ` +
          `TP=${exitResult.takeProfitOrderId || 'none'}, OCO=${exitResult.ocoLinked}`
      );

      if (exitResult.warnings && exitResult.warnings.length > 0) {
        this.logger.warn(`Exit order warnings: ${exitResult.warnings.join(', ')}`);
      }
    } catch (exitError: unknown) {
      const err = toErrorInfo(exitError);
      this.logger.error(
        `Failed to attach exit orders to entry ${order.id}: ${err.message}. ` +
          `Entry order succeeded - manual exit order placement may be required.`,
        err.stack
      );
    }
  }

  /**
   * Log slippage warnings when actual slippage exceeds the warning threshold.
   */
  private logSlippage(symbol: string, slippageBps: number, expectedPrice: number, actualPrice: number): void {
    if (Math.abs(slippageBps) > this.slippageLimits.warnSlippageBps) {
      this.logger.warn(
        `High slippage detected on ${symbol}: ${slippageBps.toFixed(2)} bps ` +
          `(expected: ${expectedPrice.toFixed(8)}, actual: ${actualPrice.toFixed(8)})`
      );
    }
  }

  /**
   * Calculate slippage in basis points
   * Positive = unfavorable (paid more for buy, received less for sell)
   */
  private calculateSlippageBps(expectedPrice: number, actualPrice: number, action: 'BUY' | 'SELL'): number {
    if (expectedPrice <= 0 || actualPrice <= 0) return 0;

    const diff =
      action === 'BUY' ? (actualPrice - expectedPrice) / expectedPrice : (expectedPrice - actualPrice) / expectedPrice;

    return Math.round(diff * 10000 * 100) / 100;
  }

  /**
   * Estimate slippage from order book before execution.
   * Uses order book depth to estimate price impact.
   */
  private async estimateSlippageFromOrderBook(
    exchangeClient: ccxt.Exchange,
    symbol: string,
    quantity: number,
    action: 'BUY' | 'SELL',
    expectedPrice: number
  ): Promise<number> {
    try {
      const orderBook = await withExchangeRetryThrow(() => exchangeClient.fetchOrderBook(symbol, 20), {
        logger: this.logger,
        operationName: `fetchOrderBook(${symbol})`
      });

      const relevantSide = action === 'BUY' ? orderBook.asks : orderBook.bids;

      if (!relevantSide || relevantSide.length === 0) {
        return 0;
      }

      let remainingQuantity = quantity;
      let totalCost = 0;

      for (const [price, volume] of relevantSide) {
        if (remainingQuantity <= 0) break;

        const fillQuantity = Math.min(remainingQuantity, Number(volume ?? 0));
        totalCost += fillQuantity * Number(price ?? 0);
        remainingQuantity -= fillQuantity;
      }

      if (remainingQuantity > 0) {
        const lastPrice = Number(relevantSide[relevantSide.length - 1][0] ?? 0);
        const worstCasePrice = action === 'BUY' ? lastPrice * 1.01 : lastPrice * 0.99;
        totalCost += remainingQuantity * worstCasePrice;
      }

      const vwap = totalCost / quantity;
      const slippageBps = this.calculateSlippageBps(expectedPrice, vwap, action);

      return Math.abs(slippageBps);
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.warn(`Failed to estimate slippage from order book: ${err.message}`);
      return 0;
    }
  }
}
