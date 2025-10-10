import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import * as ccxt from 'ccxt';
import { Repository } from 'typeorm';

import { AlgorithmActivation } from '../../algorithm/algorithm-activation.entity';
import { Coin } from '../../coin/coin.entity';
import { CoinService } from '../../coin/coin.service';
import { ExchangeKeyService } from '../../exchange/exchange-key/exchange-key.service';
import { ExchangeManagerService } from '../../exchange/exchange-manager.service';
import { User } from '../../users/users.entity';
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
 * TradeExecutionService
 *
 * Executes trades based on algorithm signals using CCXT.
 * Handles order creation, partial fills, and error logging.
 */
@Injectable()
export class TradeExecutionService {
  private readonly logger = new Logger(TradeExecutionService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly exchangeKeyService: ExchangeKeyService,
    private readonly exchangeManagerService: ExchangeManagerService,
    private readonly coinService: CoinService
  ) {}

  /**
   * Execute a trade signal from an algorithm
   * @param signal - Trade signal with algorithm activation, action, symbol, quantity
   * @returns Created Order entity
   * @throws BadRequestException if validation fails
   */
  async executeTradeSignal(signal: TradeSignal): Promise<Order> {
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

      // Execute market order via CCXT
      const orderSide = signal.action.toLowerCase() as 'buy' | 'sell';
      const ccxtOrder = await exchangeClient.createMarketOrder(signal.symbol, orderSide, signal.quantity);

      this.logger.log(`Order executed successfully: ${ccxtOrder.id}`);

      // Convert CCXT order to our Order entity
      const order = await this.convertCcxtOrderToEntity(
        ccxtOrder,
        user,
        exchangeKey.exchange,
        signal.algorithmActivationId
      );

      // Accept partial fills as successful (per clarifications)
      if (ccxtOrder.filled && ccxtOrder.filled > 0) {
        this.logger.log(
          `Order ${ccxtOrder.id} executed: ${ccxtOrder.filled}/${ccxtOrder.amount} filled (${((ccxtOrder.filled / ccxtOrder.amount) * 100).toFixed(2)}%)`
        );
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
   * Convert CCXT order response to our Order entity
   * @param ccxtOrder - CCXT order object
   * @param user - User entity
   * @param exchange - Exchange entity
   * @param algorithmActivationId - Algorithm activation ID
   * @returns Order entity
   */
  private async convertCcxtOrderToEntity(
    ccxtOrder: ccxt.Order,
    user: User,
    exchange: any,
    algorithmActivationId: string
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
}
