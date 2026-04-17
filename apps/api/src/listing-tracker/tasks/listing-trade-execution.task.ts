import { Processor } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Job } from 'bullmq';
import { Repository } from 'typeorm';

import { SignalSource, SignalStatus, LiveTradingSignalAction } from '@chansey/api-interfaces';

import { Coin } from '../../coin/coin.entity';
import { FailSafeWorkerHost } from '../../failed-jobs/fail-safe-worker-host';
import { FailedJobService } from '../../failed-jobs/failed-job.service';
import { Order } from '../../order/order.entity';
import { DistributedLockService } from '../../shared/distributed-lock.service';
import { toErrorInfo } from '../../shared/error.util';
import { LiveSignalService } from '../../strategy/live-signal.service';
import { User } from '../../users/users.entity';
import { getListingRiskConfig, LISTING_STRATEGY_NAMES } from '../constants/risk-config';
import { ListingStrategyType } from '../entities/listing-trade-position.entity';
import { ListingHedgeService } from '../services/listing-hedge.service';
import {
  LISTING_TRADE_EXECUTION_JOB,
  LISTING_TRADE_EXECUTION_QUEUE,
  ListingTradeExecutionJobData
} from '../services/listing-tracker.service';
import { ListingTradeExecutorService } from '../services/listing-trade-executor.service';

@Processor(LISTING_TRADE_EXECUTION_QUEUE, { concurrency: 3 })
@Injectable()
export class ListingTradeExecutionTask extends FailSafeWorkerHost {
  private readonly logger = new Logger(ListingTradeExecutionTask.name);

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Coin) private readonly coinRepo: Repository<Coin>,
    @InjectRepository(Order) private readonly orderRepo: Repository<Order>,
    private readonly executor: ListingTradeExecutorService,
    private readonly hedgeService: ListingHedgeService,
    private readonly liveSignalService: LiveSignalService,
    private readonly lockService: DistributedLockService,
    failedJobService: FailedJobService
  ) {
    super(failedJobService);
  }

  async process(job: Job<ListingTradeExecutionJobData>) {
    if (job.name !== LISTING_TRADE_EXECUTION_JOB) return;

    const { userId, coinId, strategyType, announcementId, candidateId } = job.data;
    const strategyName =
      strategyType === ListingStrategyType.PRE_LISTING
        ? LISTING_STRATEGY_NAMES.PRE_LISTING
        : LISTING_STRATEGY_NAMES.POST_ANNOUNCEMENT;

    let coinSymbol: string | undefined;

    try {
      const [user, coin] = await Promise.all([
        this.userRepo.findOne({ where: { id: userId }, relations: ['coinRisk'] }),
        this.coinRepo.findOne({ where: { id: coinId } })
      ]);
      if (!user || !coin) {
        this.logger.warn(`[${strategyName}] user=${userId} coin=${coinId} skipped (not found)`);
        return { skipped: 'missing-user-or-coin' };
      }
      coinSymbol = coin.symbol;

      const riskConfig = getListingRiskConfig(user.effectiveCalculationRiskLevel);
      const config =
        strategyType === ListingStrategyType.POST_ANNOUNCEMENT ? riskConfig?.postAnnouncement : riskConfig?.preListing;
      if (!config) {
        return { skipped: 'no-risk-config' };
      }

      // Per-user lock: `concurrency: 3` + parallel enqueues could otherwise let two
      // workers pass the check-then-execute window and both create a position.
      const lockKey = `listing-trade:user:${user.id}`;
      const lock = await this.lockService.acquire({ key: lockKey, ttlMs: 60_000, maxRetries: 0 });
      if (!lock.acquired) {
        this.logger.debug(`[${strategyName}] user=${userId} coin=${coinId} lock contention, skipping`);
        return { skipped: 'lock_not_acquired' };
      }

      try {
        if (await this.executor.hasOpenPositionForCoin(user.id, coin.id)) {
          return { skipped: 'already-holding' };
        }

        const active = await this.executor.countActivePositions(user.id, strategyType);
        if (active >= config.maxConcurrent) {
          return { skipped: 'max-concurrent' };
        }

        const position = await this.executor.executeBuy({
          user,
          coin,
          strategyType,
          config,
          announcementId: announcementId ?? null,
          candidateId: candidateId ?? null
        });
        if (!position) {
          await this.recordFailure(user.id, coin.symbol, 'executeBuy returned null');
          return { skipped: 'execution-failed' };
        }

        await this.recordSuccess(user.id, coin.symbol, position.orderId);

        // Optional hedge leg — risk-5 + kraken_futures key
        if (strategyType === ListingStrategyType.POST_ANNOUNCEMENT && riskConfig?.hedge?.enabled) {
          const spotOrder = await this.orderRepo.findOne({ where: { id: position.orderId } });
          if (spotOrder) {
            await this.hedgeService.openShort(user, spotOrder, riskConfig.hedge, position.id);
          }
        }

        return { positionId: position.id };
      } finally {
        await this.lockService.release(lockKey, lock.token);
      }
    } catch (error) {
      const err = toErrorInfo(error);
      this.logger.error(`[${strategyName}] user=${userId} coin=${coinId} failed: ${err.message}`, err.stack);
      await this.recordFailure(userId, coinSymbol, err.message);
      throw error;
    }
  }

  private async recordSuccess(userId: string, symbol: string, orderId: string | undefined): Promise<void> {
    try {
      await this.liveSignalService.recordOutcome({
        userId,
        action: LiveTradingSignalAction.BUY,
        symbol,
        quantity: 0,
        status: SignalStatus.PLACED,
        source: SignalSource.LISTING_TRACKER,
        orderId
      });
    } catch (error) {
      const err = toErrorInfo(error);
      this.logger.warn(`Failed to record listing signal outcome: ${err.message}`);
    }
  }

  private async recordFailure(userId: string, symbol: string | undefined, reason: string): Promise<void> {
    try {
      await this.liveSignalService.recordOutcome({
        userId,
        action: LiveTradingSignalAction.BUY,
        symbol: symbol ?? 'unknown',
        quantity: 0,
        status: SignalStatus.FAILED,
        source: SignalSource.LISTING_TRACKER,
        reason
      });
    } catch (error) {
      const err = toErrorInfo(error);
      this.logger.warn(`Failed to record listing signal failure: ${err.message}`);
    }
  }
}
