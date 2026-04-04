import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import * as ccxt from 'ccxt';
import { Repository } from 'typeorm';

import { MarketType } from '@chansey/api-interfaces';

import { OrderCalculationService } from './order-calculation.service';
import { OrderStateMachineService } from './order-state-machine.service';

import { Coin } from '../../coin/coin.entity';
import { CoinService } from '../../coin/coin.service';
import { Exchange } from '../../exchange/exchange.entity';
import { User } from '../../users/users.entity';
import { OrderTransitionReason } from '../entities/order-status-history.entity';
import { TradeSignal } from '../interfaces/trade-signal.interface';
import { Order, OrderSide, OrderStatus } from '../order.entity';

/**
 * OrderConversionService
 *
 * Converts CCXT order responses into persisted Order entities.
 */
@Injectable()
export class OrderConversionService {
  private readonly logger = new Logger(OrderConversionService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    private readonly coinService: CoinService,
    private readonly orderCalculationService: OrderCalculationService,
    private readonly stateMachineService: OrderStateMachineService
  ) {}

  /**
   * Convert CCXT order response to our Order entity, persist it, and record the initial status transition.
   */
  async convertCcxtOrderToEntity(
    ccxtOrder: ccxt.Order,
    user: User,
    exchange: Exchange,
    algorithmActivationId: string,
    expectedPrice?: number,
    actualSlippageBps?: number,
    futuresSignal?: Pick<TradeSignal, 'marketType' | 'positionSide' | 'leverage'>
  ): Promise<Order> {
    const [baseSymbol, quoteSymbol] = ccxtOrder.symbol.split('/');

    const [baseCoin, quoteCoin] = await Promise.all([this.resolveCoin(baseSymbol), this.resolveCoin(quoteSymbol)]);

    const status = this.resolveOrderStatus(ccxtOrder);

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
      type: this.orderCalculationService.mapCcxtOrderTypeToOrderType(String(ccxtOrder.type ?? '')),
      user,
      baseCoin: baseCoin && !CoinService.isVirtualCoin(baseCoin) ? baseCoin : undefined,
      quoteCoin: quoteCoin && !CoinService.isVirtualCoin(quoteCoin) ? quoteCoin : undefined,
      exchange,
      algorithmActivationId,
      timeInForce: ccxtOrder.timeInForce,
      remaining: ccxtOrder.remaining,
      trades: (ccxtOrder.trades ?? []).map((t) => ({
        id: String(t.id ?? ''),
        timestamp: Number(t.timestamp ?? 0),
        price: t.price,
        amount: Number(t.amount ?? 0),
        cost: Number(t.cost ?? 0),
        fee: t.fee ? { cost: Number(t.fee.cost ?? 0), currency: String(t.fee.currency ?? '') } : undefined,
        side: String(t.side ?? ''),
        takerOrMaker: t.takerOrMaker?.toString()
      })),
      info: ccxtOrder.info,
      // Futures-specific fields
      marketType:
        futuresSignal?.marketType === MarketType.FUTURES ? 'futures' : ccxtOrder.info?.marginMode ? 'futures' : 'spot',
      positionSide: futuresSignal?.positionSide ?? (ccxtOrder.info?.positionSide as string) ?? undefined,
      leverage: futuresSignal?.leverage ?? (ccxtOrder.info?.leverage ? Number(ccxtOrder.info.leverage) : undefined),
      marginMode:
        futuresSignal?.marketType === MarketType.FUTURES
          ? 'isolated'
          : ((ccxtOrder.info?.marginMode as string) ?? undefined),
      liquidationPrice: ccxtOrder.info?.liquidationPrice ? Number(ccxtOrder.info.liquidationPrice) : undefined,
      marginAmount: ccxtOrder.info?.initialMargin ? Number(ccxtOrder.info.initialMargin) : undefined
    });

    const savedOrder = await this.orderRepository.save(order);

    await this.stateMachineService.transitionStatus(
      savedOrder.id,
      null,
      savedOrder.status,
      OrderTransitionReason.TRADE_EXECUTION,
      {
        algorithmActivationId,
        expectedPrice,
        actualSlippageBps,
        exchangeOrderId: ccxtOrder.id,
        symbol: ccxtOrder.symbol,
        side: ccxtOrder.side,
        type: ccxtOrder.type,
        filled: ccxtOrder.filled,
        amount: ccxtOrder.amount
      }
    );

    return savedOrder;
  }

  private async resolveCoin(symbol: string): Promise<Coin | null> {
    try {
      return await this.coinService.getCoinBySymbol(symbol, [], false);
    } catch {
      this.logger.warn(`Coin ${symbol} not found in database`);
      return null;
    }
  }

  private resolveOrderStatus(ccxtOrder: ccxt.Order): OrderStatus {
    if (ccxtOrder.status === 'closed' || ccxtOrder.filled === ccxtOrder.amount) {
      return OrderStatus.FILLED;
    }
    if (ccxtOrder.filled && ccxtOrder.filled > 0) {
      return OrderStatus.PARTIALLY_FILLED;
    }
    if (ccxtOrder.status === 'canceled') {
      return OrderStatus.CANCELED;
    }
    if (ccxtOrder.status === 'rejected') {
      return OrderStatus.REJECTED;
    }
    return OrderStatus.NEW;
  }
}
