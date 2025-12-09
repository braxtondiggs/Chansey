import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { UserStrategyPosition } from './entities/user-strategy-position.entity';

/**
 * Tracks trading positions per user per strategy for robo-advisor.
 * Manages position updates, P&L calculations, and portfolio aggregation.
 */
@Injectable()
export class PositionTrackingService {
  private readonly logger = new Logger(PositionTrackingService.name);

  constructor(
    @InjectRepository(UserStrategyPosition)
    private readonly positionRepo: Repository<UserStrategyPosition>
  ) {}

  async getPositions(userId: string, strategyConfigId?: string): Promise<UserStrategyPosition[]> {
    const where: any = { userId };
    if (strategyConfigId) {
      where.strategyConfigId = strategyConfigId;
    }

    return this.positionRepo.find({
      where,
      relations: ['strategyConfig', 'user'],
      order: { updatedAt: 'DESC' }
    });
  }

  async getPosition(userId: string, strategyConfigId: string, symbol: string): Promise<UserStrategyPosition | null> {
    return this.positionRepo.findOne({
      where: { userId, strategyConfigId, symbol },
      relations: ['strategyConfig', 'user']
    });
  }

  async updatePosition(
    userId: string,
    strategyConfigId: string,
    symbol: string,
    quantity: number,
    price: number,
    side: 'buy' | 'sell'
  ): Promise<UserStrategyPosition> {
    let position = await this.getPosition(userId, strategyConfigId, symbol);

    if (!position) {
      position = this.positionRepo.create({
        userId,
        strategyConfigId,
        symbol,
        quantity: 0,
        avgEntryPrice: 0,
        unrealizedPnL: 0,
        realizedPnL: 0
      });
    }

    const currentQuantity = Number(position.quantity);
    const currentAvgPrice = Number(position.avgEntryPrice);

    if (side === 'buy') {
      const totalCost = currentQuantity * currentAvgPrice + quantity * price;
      const newQuantity = currentQuantity + quantity;
      position.quantity = newQuantity;
      position.avgEntryPrice = newQuantity > 0 ? totalCost / newQuantity : 0;
    } else if (side === 'sell') {
      const soldValue = quantity * price;
      const costBasis = quantity * currentAvgPrice;
      const tradePnL = soldValue - costBasis;

      position.quantity = currentQuantity - quantity;
      position.realizedPnL = Number(position.realizedPnL) + tradePnL;

      if (position.quantity <= 0) {
        position.quantity = 0;
        position.avgEntryPrice = 0;
        position.unrealizedPnL = 0;
      }
    }

    return this.positionRepo.save(position);
  }

  async calculateUnrealizedPnL(
    userId: string,
    strategyConfigId: string,
    currentPrices: Map<string, number>
  ): Promise<number> {
    const positions = await this.getPositions(userId, strategyConfigId);
    let totalUnrealizedPnL = 0;

    for (const position of positions) {
      const currentPrice = currentPrices.get(position.symbol);
      if (!currentPrice || Number(position.quantity) === 0) {
        continue;
      }

      const currentValue = Number(position.quantity) * currentPrice;
      const costBasis = Number(position.quantity) * Number(position.avgEntryPrice);
      const unrealizedPnL = currentValue - costBasis;

      position.unrealizedPnL = unrealizedPnL;
      await this.positionRepo.save(position);

      totalUnrealizedPnL += unrealizedPnL;
    }

    return totalUnrealizedPnL;
  }

  async closePosition(userId: string, strategyConfigId: string, symbol: string, currentPrice: number): Promise<void> {
    const position = await this.getPosition(userId, strategyConfigId, symbol);
    if (!position || Number(position.quantity) === 0) {
      this.logger.warn(`No position to close for user ${userId}, strategy ${strategyConfigId}, symbol ${symbol}`);
      return;
    }

    const soldValue = Number(position.quantity) * currentPrice;
    const costBasis = Number(position.quantity) * Number(position.avgEntryPrice);
    const tradePnL = soldValue - costBasis;

    position.realizedPnL = Number(position.realizedPnL) + tradePnL;
    position.quantity = 0;
    position.avgEntryPrice = 0;
    position.unrealizedPnL = 0;

    await this.positionRepo.save(position);

    this.logger.log(
      `Closed position for user ${userId}, strategy ${strategyConfigId}, symbol ${symbol}, PnL: ${tradePnL.toFixed(2)}`
    );
  }

  async getUserTotalPnL(userId: string): Promise<{ realizedPnL: number; unrealizedPnL: number; totalPnL: number }> {
    const positions = await this.getPositions(userId);

    const realizedPnL = positions.reduce((sum, pos) => sum + Number(pos.realizedPnL), 0);
    const unrealizedPnL = positions.reduce((sum, pos) => sum + Number(pos.unrealizedPnL), 0);

    return {
      realizedPnL,
      unrealizedPnL,
      totalPnL: realizedPnL + unrealizedPnL
    };
  }

  async getStrategyPnL(
    userId: string,
    strategyConfigId: string
  ): Promise<{ realizedPnL: number; unrealizedPnL: number; totalPnL: number }> {
    const positions = await this.getPositions(userId, strategyConfigId);

    const realizedPnL = positions.reduce((sum, pos) => sum + Number(pos.realizedPnL), 0);
    const unrealizedPnL = positions.reduce((sum, pos) => sum + Number(pos.unrealizedPnL), 0);

    return {
      realizedPnL,
      unrealizedPnL,
      totalPnL: realizedPnL + unrealizedPnL
    };
  }

  async getAllUserPositionsBySymbol(
    userId: string
  ): Promise<Map<string, { quantity: number; avgPrice: number; pnl: number }>> {
    const positions = await this.getPositions(userId);
    const aggregated = new Map<string, { quantity: number; avgPrice: number; pnl: number }>();

    for (const position of positions) {
      const existing = aggregated.get(position.symbol);
      if (existing) {
        const totalQuantity = existing.quantity + Number(position.quantity);
        const totalCost =
          existing.quantity * existing.avgPrice + Number(position.quantity) * Number(position.avgEntryPrice);
        existing.quantity = totalQuantity;
        existing.avgPrice = totalQuantity > 0 ? totalCost / totalQuantity : 0;
        existing.pnl += Number(position.realizedPnL) + Number(position.unrealizedPnL);
      } else {
        aggregated.set(position.symbol, {
          quantity: Number(position.quantity),
          avgPrice: Number(position.avgEntryPrice),
          pnl: Number(position.realizedPnL) + Number(position.unrealizedPnL)
        });
      }
    }

    return aggregated;
  }
}
