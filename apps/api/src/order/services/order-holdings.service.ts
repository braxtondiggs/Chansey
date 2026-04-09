import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { UserHoldingsDto } from '@chansey/api-interfaces';

import { Coin } from '../../coin/coin.entity';
import { User } from '../../users/users.entity';
import { Order, OrderSide, OrderStatus } from '../order.entity';

/**
 * Computes user holdings for a coin from filled order history.
 * Calculates total amount, weighted average buy price, current value, and P&L.
 */
@Injectable()
export class OrderHoldingsService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>
  ) {}

  /**
   * Get user holdings for a specific coin, aggregated across exchanges.
   */
  async getHoldingsByCoin(user: User, coin: Coin): Promise<UserHoldingsDto> {
    const orders = await this.orderRepository.find({
      where: {
        user: { id: user.id },
        baseCoin: { id: coin.id },
        status: OrderStatus.FILLED
      },
      relations: ['exchange', 'baseCoin'],
      order: { transactTime: 'ASC' }
    });

    if (orders.length === 0) {
      return {
        coinSymbol: coin.symbol,
        totalAmount: 0,
        averageBuyPrice: 0,
        currentValue: 0,
        profitLoss: 0,
        profitLossPercent: 0,
        exchanges: []
      };
    }

    let totalBought = 0;
    let totalSold = 0;
    let totalCostBasis = 0;

    const exchangeHoldings = new Map<string, { exchangeName: string; amount: number; lastSynced: Date }>();

    for (const order of orders) {
      const amount = order.executedQuantity || 0;
      const exchangeId = order.exchange?.id || 'unknown';
      const exchangeName = order.exchange?.name || 'Unknown';

      if (order.side === OrderSide.BUY) {
        totalBought += amount;
        totalCostBasis += order.cost || amount * (order.price || 0);

        const existing = exchangeHoldings.get(exchangeId) || {
          exchangeName,
          amount: 0,
          lastSynced: order.transactTime
        };
        existing.amount += amount;
        existing.lastSynced = order.transactTime;
        exchangeHoldings.set(exchangeId, existing);
      } else if (order.side === OrderSide.SELL) {
        totalSold += amount;

        const existing = exchangeHoldings.get(exchangeId) || {
          exchangeName,
          amount: 0,
          lastSynced: order.transactTime
        };
        existing.amount -= amount;
        existing.lastSynced = order.transactTime;
        exchangeHoldings.set(exchangeId, existing);
      }
    }

    const totalAmount = totalBought - totalSold;
    const averageBuyPrice = totalBought > 0 ? totalCostBasis / totalBought : 0;
    const currentPrice = coin.currentPrice || 0;
    const currentValue = totalAmount * currentPrice;
    const invested = totalAmount * averageBuyPrice;
    const profitLoss = currentValue - invested;
    const profitLossPercent = invested > 0 ? (profitLoss / invested) * 100 : 0;

    const exchangesList = Array.from(exchangeHoldings.values()).filter((h) => h.amount > 0);

    return {
      coinSymbol: coin.symbol,
      totalAmount,
      averageBuyPrice,
      currentValue,
      profitLoss,
      profitLossPercent,
      exchanges: exchangesList
    };
  }
}
