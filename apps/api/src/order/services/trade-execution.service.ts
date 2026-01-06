import { BadRequestException, forwardRef, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';

import * as ccxt from 'ccxt';
import { Repository } from 'typeorm';

import { PositionManagementService } from './position-management.service';

import { AlgorithmActivation } from '../../algorithm/algorithm-activation.entity';
import { Coin } from '../../coin/coin.entity';
import { CoinService } from '../../coin/coin.service';
import { ExchangeKeyService } from '../../exchange/exchange-key/exchange-key.service';
import { ExchangeManagerService } from '../../exchange/exchange-manager.service';
import { Exchange } from '../../exchange/exchange.entity';
import { PriceSummary } from '../../price/price.entity';
import { User } from '../../users/users.entity';
import { DEFAULT_SLIPPAGE_LIMITS, slippageLimitsConfig, SlippageLimitsConfig } from '../config/slippage-limits.config';
import { ExitConfig } from '../interfaces/exit-config.interface';
import { Order, OrderSide, OrderStatus, OrderType } from '../order.entity';

/**
 * Trade signal interface for algorithm-generated signals
 */
export interface TradeSignal {
  algorithmActivationId: string;
  userId: string;
  exchangeKeyId: string;
  action: 'BUY' | 'SELL';
  symbol: string;
  quantity: number;
}

/**
 * Extended trade signal with exit configuration
 */
export interface TradeSignalWithExit extends TradeSignal {
  /** Exit configuration for automatic SL/TP/trailing stop placement */
  exitConfig?: Partial<ExitConfig>;
  /** Historical price data for ATR-based exit calculations */
  priceData?: PriceSummary[];
}

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
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly exchangeKeyService: ExchangeKeyService,
    private readonly exchangeManagerService: ExchangeManagerService,
    private readonly coinService: CoinService,
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
      // Fetch exchange key and validate
      const exchangeKey = await this.exchangeKeyService.findOne(signal.exchangeKeyId, signal.userId);
      if (!exchangeKey || !exchangeKey.exchange) {
        throw new BadRequestException('Exchange key not found or invalid');
      }

      // Fetch user
      const user = await this.userRepository.findOneBy({ id: signal.userId });
      if (!user) {
        throw new BadRequestException('User not found');
      }

      // Initialize CCXT exchange client
      const exchangeClient = await this.exchangeManagerService.getExchangeClient(exchangeKey.exchange.slug, user);

      // Load markets
      await exchangeClient.loadMarkets();

      // Verify symbol exists
      if (!exchangeClient.markets[signal.symbol]) {
        throw new BadRequestException(`Symbol ${signal.symbol} not available on ${exchangeKey.exchange.name}`);
      }

      // Verify funds (optional - can be skipped for faster execution)
      // await this.verifyFunds(exchangeClient, signal);

      // CAPTURE EXPECTED PRICE BEFORE EXECUTION (for slippage calculation)
      const ticker = await exchangeClient.fetchTicker(signal.symbol);
      const expectedPrice = signal.action === 'BUY' ? ticker.ask || ticker.last || 0 : ticker.bid || ticker.last || 0;

      this.logger.debug(
        `Expected price for ${signal.symbol}: ${expectedPrice} (${signal.action === 'BUY' ? 'ask' : 'bid'})`
      );

      // PRE-EXECUTION SLIPPAGE CHECK
      if (this.slippageLimits.enabled) {
        const estimatedSlippageBps = await this.estimateSlippageFromOrderBook(
          exchangeClient,
          signal.symbol,
          signal.quantity,
          signal.action,
          expectedPrice
        );

        if (estimatedSlippageBps > this.slippageLimits.maxSlippageBps) {
          throw new BadRequestException(
            `Estimated slippage ${estimatedSlippageBps.toFixed(2)} bps exceeds maximum allowed ` +
              `(${this.slippageLimits.maxSlippageBps} bps) for ${signal.symbol}`
          );
        }

        if (estimatedSlippageBps > this.slippageLimits.warnSlippageBps) {
          this.logger.warn(
            `High estimated slippage for ${signal.symbol}: ${estimatedSlippageBps.toFixed(2)} bps ` +
              `(warning threshold: ${this.slippageLimits.warnSlippageBps} bps)`
          );
        }
      }

      // Execute market order via CCXT
      const orderSide = signal.action.toLowerCase() as 'buy' | 'sell';
      const ccxtOrder = await exchangeClient.createMarketOrder(signal.symbol, orderSide, signal.quantity);

      this.logger.log(`Order executed successfully: ${ccxtOrder.id}`);

      // CALCULATE ACTUAL SLIPPAGE
      const actualPrice = ccxtOrder.average || ccxtOrder.price || 0;
      const actualSlippageBps = this.calculateSlippageBps(expectedPrice, actualPrice, signal.action);

      // LOG SIGNIFICANT SLIPPAGE
      if (Math.abs(actualSlippageBps) > this.slippageLimits.warnSlippageBps) {
        this.logger.warn(
          `High slippage detected on ${signal.symbol}: ${actualSlippageBps.toFixed(2)} bps ` +
            `(expected: ${expectedPrice.toFixed(8)}, actual: ${actualPrice.toFixed(8)})`
        );
      }

      // Convert CCXT order to our Order entity with slippage data
      const order = await this.convertCcxtOrderToEntity(
        ccxtOrder,
        user,
        exchangeKey.exchange,
        signal.algorithmActivationId,
        expectedPrice,
        actualSlippageBps
      );

      // Accept partial fills as successful (per clarifications)
      if (ccxtOrder.filled && ccxtOrder.filled > 0) {
        this.logger.log(
          `Order ${ccxtOrder.id} executed: ${ccxtOrder.filled}/${ccxtOrder.amount} filled ` +
            `(${((ccxtOrder.filled / ccxtOrder.amount) * 100).toFixed(2)}%), slippage: ${actualSlippageBps.toFixed(2)} bps`
        );
      }

      // ATTACH EXIT ORDERS if exit config is provided
      if (signal.exitConfig && this.positionManagementService) {
        const hasExitEnabled =
          signal.exitConfig.enableStopLoss ||
          signal.exitConfig.enableTakeProfit ||
          signal.exitConfig.enableTrailingStop;

        if (hasExitEnabled) {
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
          } catch (exitError) {
            // Entry succeeded - log exit failure but don't fail the trade
            this.logger.error(
              `Failed to attach exit orders to entry ${order.id}: ${exitError.message}. ` +
                `Entry order succeeded - manual exit order placement may be required.`,
              exitError.stack
            );
          }
        }
      }

      return order;
    } catch (error) {
      // Log failures but do not retry (per clarifications)
      this.logger.error(
        `Failed to execute trade signal for activation ${signal.algorithmActivationId}: ${error.message}`,
        error.stack
      );
      throw error;
    }
  }

  /**
   * Calculate trade size based on algorithm activation allocation percentage
   * @param activation - AlgorithmActivation with allocation percentage
   * @param portfolioValue - Total portfolio value in USD
   * @returns Trade size in USD
   */
  calculateTradeSize(activation: AlgorithmActivation, portfolioValue: number): number {
    const allocationPercentage = activation.allocationPercentage || 1.0;
    const tradeSize = (portfolioValue * allocationPercentage) / 100;

    this.logger.log(
      `Calculated trade size: ${allocationPercentage}% of $${portfolioValue.toFixed(2)} = $${tradeSize.toFixed(2)}`
    );

    return tradeSize;
  }

  /**
   * Verify user has sufficient funds for the trade
   * @param exchangeClient - CCXT exchange client
   * @param signal - Trade signal
   * @throws BadRequestException if insufficient funds
   */
  private async verifyFunds(exchangeClient: ccxt.Exchange, signal: TradeSignal): Promise<void> {
    try {
      const balance = await exchangeClient.fetchBalance();
      const [baseCurrency, quoteCurrency] = signal.symbol.split('/');

      if (signal.action === 'BUY') {
        // Check quote currency balance (e.g., USDT for BTC/USDT buy)
        const ticker = await exchangeClient.fetchTicker(signal.symbol);
        const requiredAmount = signal.quantity * (ticker.last || 0);
        const available = balance[quoteCurrency]?.free || 0;

        if (available < requiredAmount) {
          throw new BadRequestException(`Insufficient ${quoteCurrency} balance: ${available} < ${requiredAmount}`);
        }
      } else {
        // Check base currency balance (e.g., BTC for BTC/USDT sell)
        const available = balance[baseCurrency]?.free || 0;

        if (available < signal.quantity) {
          throw new BadRequestException(`Insufficient ${baseCurrency} balance: ${available} < ${signal.quantity}`);
        }
      }
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.warn(`Failed to verify funds: ${error.message}`);
      // Continue with order execution even if balance check fails
    }
  }

  /**
   * Calculate slippage in basis points
   * @param expectedPrice - Price captured before execution
   * @param actualPrice - Price achieved after execution
   * @param action - Trade direction (BUY or SELL)
   * @returns Slippage in basis points (positive = unfavorable)
   */
  private calculateSlippageBps(expectedPrice: number, actualPrice: number, action: 'BUY' | 'SELL'): number {
    if (expectedPrice <= 0 || actualPrice <= 0) return 0;

    // Positive slippage = unfavorable (paid more for buy, received less for sell)
    const diff =
      action === 'BUY' ? (actualPrice - expectedPrice) / expectedPrice : (expectedPrice - actualPrice) / expectedPrice;

    return Math.round(diff * 10000 * 100) / 100; // Round to 2 decimal places
  }

  /**
   * Convert CCXT order response to our Order entity
   * @param ccxtOrder - CCXT order object
   * @param user - User entity
   * @param exchange - Exchange entity
   * @param algorithmActivationId - Algorithm activation ID
   * @param expectedPrice - Expected execution price (for slippage calculation)
   * @param actualSlippageBps - Calculated slippage in basis points
   * @returns Order entity
   */
  private async convertCcxtOrderToEntity(
    ccxtOrder: ccxt.Order,
    user: User,
    exchange: Exchange,
    algorithmActivationId: string,
    expectedPrice?: number,
    actualSlippageBps?: number
  ): Promise<Order> {
    // Parse symbol to get base and quote coins
    const [baseSymbol, quoteSymbol] = ccxtOrder.symbol.split('/');

    let baseCoin: Coin | null = null;
    let quoteCoin: Coin | null = null;

    try {
      baseCoin = await this.coinService.getCoinBySymbol(baseSymbol, [], false);
    } catch (error) {
      this.logger.warn(`Base coin ${baseSymbol} not found in database`);
    }

    try {
      quoteCoin = await this.coinService.getCoinBySymbol(quoteSymbol, [], false);
    } catch (error) {
      this.logger.warn(`Quote coin ${quoteSymbol} not found in database`);
    }

    // Determine order status
    let status: OrderStatus;
    if (ccxtOrder.status === 'closed' || ccxtOrder.filled === ccxtOrder.amount) {
      status = OrderStatus.FILLED;
    } else if (ccxtOrder.filled && ccxtOrder.filled > 0) {
      status = OrderStatus.PARTIALLY_FILLED;
    } else if (ccxtOrder.status === 'canceled') {
      status = OrderStatus.CANCELED;
    } else if (ccxtOrder.status === 'rejected') {
      status = OrderStatus.REJECTED;
    } else {
      status = OrderStatus.NEW;
    }

    // Create order entity
    const order = new Order({
      symbol: ccxtOrder.symbol,
      orderId: ccxtOrder.id || '',
      clientOrderId: ccxtOrder.clientOrderId || '',
      transactTime: new Date(ccxtOrder.timestamp || Date.now()),
      quantity: ccxtOrder.amount || 0,
      price: ccxtOrder.price || ccxtOrder.average || 0,
      executedQuantity: ccxtOrder.filled || 0,
      cost: ccxtOrder.cost || (ccxtOrder.filled || 0) * (ccxtOrder.average || ccxtOrder.price || 0),
      fee: ccxtOrder.fee?.cost || 0,
      commission: ccxtOrder.fee?.cost || 0,
      feeCurrency: ccxtOrder.fee?.currency,
      averagePrice: ccxtOrder.average,
      expectedPrice,
      actualSlippageBps,
      status,
      side: ccxtOrder.side === 'buy' ? OrderSide.BUY : OrderSide.SELL,
      type: this.mapCcxtOrderType(ccxtOrder.type),
      user,
      baseCoin: baseCoin || undefined,
      quoteCoin: quoteCoin || undefined,
      exchange,
      algorithmActivationId,
      timeInForce: ccxtOrder.timeInForce,
      remaining: ccxtOrder.remaining,
      trades: ccxtOrder.trades,
      info: ccxtOrder.info
    });

    return await this.orderRepository.save(order);
  }

  /**
   * Map CCXT order type to our OrderType enum
   * @param ccxtType - CCXT order type string
   * @returns OrderType enum value
   */
  private mapCcxtOrderType(ccxtType: string): OrderType {
    const typeMap: { [key: string]: OrderType } = {
      market: OrderType.MARKET,
      limit: OrderType.LIMIT,
      stop: OrderType.STOP_LOSS,
      stop_loss: OrderType.STOP_LOSS,
      stop_limit: OrderType.STOP_LIMIT,
      stop_loss_limit: OrderType.STOP_LIMIT,
      take_profit: OrderType.TAKE_PROFIT,
      take_profit_limit: OrderType.TAKE_PROFIT,
      trailing_stop: OrderType.TRAILING_STOP,
      trailing_stop_market: OrderType.TRAILING_STOP,
      oco: OrderType.OCO
    };

    return typeMap[ccxtType.toLowerCase()] || OrderType.MARKET;
  }

  /**
   * Estimate slippage from order book before execution
   * Uses order book depth to estimate price impact
   *
   * @param exchangeClient - CCXT exchange client
   * @param symbol - Trading pair symbol
   * @param quantity - Order quantity
   * @param action - Trade direction (BUY or SELL)
   * @param expectedPrice - Expected execution price (best bid/ask)
   * @returns Estimated slippage in basis points
   */
  private async estimateSlippageFromOrderBook(
    exchangeClient: ccxt.Exchange,
    symbol: string,
    quantity: number,
    action: 'BUY' | 'SELL',
    expectedPrice: number
  ): Promise<number> {
    try {
      // Fetch order book with limited depth for efficiency
      const orderBook = await exchangeClient.fetchOrderBook(symbol, 20);

      // Use asks for BUY orders, bids for SELL orders
      const relevantSide = action === 'BUY' ? orderBook.asks : orderBook.bids;

      if (!relevantSide || relevantSide.length === 0) {
        // If no order book data, assume minimal slippage
        return 0;
      }

      // Calculate volume-weighted average price for the order size
      let remainingQuantity = quantity;
      let totalCost = 0;

      for (const [price, volume] of relevantSide) {
        if (remainingQuantity <= 0) break;

        const fillQuantity = Math.min(remainingQuantity, volume);
        totalCost += fillQuantity * price;
        remainingQuantity -= fillQuantity;
      }

      // If order book doesn't have enough liquidity, estimate conservatively
      if (remainingQuantity > 0) {
        // Assume worst-case 1% additional slippage for unfilled portion
        const lastPrice = relevantSide[relevantSide.length - 1][0];
        const worstCasePrice = action === 'BUY' ? lastPrice * 1.01 : lastPrice * 0.99;
        totalCost += remainingQuantity * worstCasePrice;
      }

      const vwap = totalCost / quantity;
      const slippageBps = this.calculateSlippageBps(expectedPrice, vwap, action);

      return Math.abs(slippageBps);
    } catch (error) {
      this.logger.warn(`Failed to estimate slippage from order book: ${error.message}`);
      // On error, don't block the trade - return 0 to allow execution
      return 0;
    }
  }
}
