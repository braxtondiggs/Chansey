import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { Order } from '../order/order.entity';

/** Rolling 24h loss threshold per risk level (as a fraction of trading capital) */
const RISK_LEVEL_THRESHOLDS: Record<number, number> = {
  1: 0.05,
  2: 0.075,
  3: 0.1,
  4: 0.125,
  5: 0.15
};

/**
 * Pre-trade daily loss limit gate.
 *
 * Blocks BUY / short_entry signals when the user's rolling 24-hour
 * realized losses from algorithmic trades exceed a risk-level-based
 * percentage of their trading capital.
 *
 * SELL / short_exit signals always pass so positions can unwind.
 * Fails closed: on any query error, BUY is blocked and a warning is logged.
 */
@Injectable()
export class DailyLossLimitGateService {
  private readonly logger = new Logger(DailyLossLimitGateService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>
  ) {}

  /**
   * Convenience method: can this user open new positions?
   * Returns { blocked: true, reason } when the daily loss limit is exceeded.
   */
  async isEntryBlocked(
    userId: string,
    tradingCapital: number,
    riskLevel: number
  ): Promise<{ blocked: boolean; reason?: string }> {
    const result = await this.checkDailyLossLimit(userId, tradingCapital, riskLevel, 'buy');
    return { blocked: !result.allowed, reason: result.reason };
  }

  async checkDailyLossLimit(
    userId: string,
    tradingCapital: number,
    riskLevel: number,
    action: 'buy' | 'sell' | 'short_entry' | 'short_exit'
  ): Promise<{ allowed: boolean; reason?: string }> {
    // SELLs and short exits always allowed — must be able to unwind positions
    if (action === 'sell' || action === 'short_exit') {
      return { allowed: true };
    }

    // Zero / negative capital guard — prevent division by zero
    if (tradingCapital <= 0) {
      return { allowed: false, reason: 'Trading capital is zero or negative' };
    }

    const threshold = RISK_LEVEL_THRESHOLDS[riskLevel] ?? RISK_LEVEL_THRESHOLDS[3];

    try {
      const result = await this.orderRepo
        .createQueryBuilder('order')
        .select('COALESCE(SUM(order.gainLoss), 0)', 'totalLoss')
        .where('order.userId = :userId', { userId })
        .andWhere('order.isAlgorithmicTrade = true')
        .andWhere('order.status = :status', { status: 'FILLED' })
        .andWhere('order.side = :side', { side: 'SELL' })
        .andWhere("order.createdAt > NOW() - INTERVAL '24 hours'")
        .andWhere('order.gainLoss < 0')
        .getRawOne<{ totalLoss: string }>();

      const totalLoss = Math.abs(parseFloat(result?.totalLoss ?? '0'));
      const lossPercent = (totalLoss / tradingCapital) * 100;
      const limitPercent = threshold * 100;

      if (lossPercent >= limitPercent) {
        const reason = `Daily loss limit exceeded: ${lossPercent.toFixed(1)}% losses >= ${limitPercent.toFixed(1)}% limit`;
        this.logger.warn(`${reason} (user ${userId})`);
        return { allowed: false, reason };
      }

      return { allowed: true };
    } catch (error) {
      // Fail closed: block BUY on any query error
      this.logger.warn(`Daily loss limit query failed for user ${userId}, blocking BUY as precaution`, error);
      return { allowed: false, reason: 'Daily loss limit check failed (fail-closed)' };
    }
  }
}
