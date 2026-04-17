import { InjectQueue } from '@nestjs/bullmq';
import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Queue } from 'bullmq';
import { In, Repository } from 'typeorm';

import { ListingTradeExecutorService } from './listing-trade-executor.service';

import { Coin } from '../../coin/coin.entity';
import { ExchangeKey } from '../../exchange/exchange-key/exchange-key.entity';
import { toErrorInfo } from '../../shared/error.util';
import { User } from '../../users/users.entity';
import { getListingRiskConfig } from '../constants/risk-config';
import { ListingAnnouncement } from '../entities/listing-announcement.entity';
import { ListingCandidate } from '../entities/listing-candidate.entity';
import { ListingStrategyType } from '../entities/listing-trade-position.entity';

export const LISTING_TRADE_EXECUTION_QUEUE = 'listing-trade-execution';
export const LISTING_TRADE_EXECUTION_JOB = 'listing-trade-execute';

export interface ListingTradeExecutionJobData {
  userId: string;
  coinId: string;
  strategyType: ListingStrategyType;
  announcementId?: string | null;
  candidateId?: string | null;
}

@Injectable()
export class ListingTrackerService {
  private readonly logger = new Logger(ListingTrackerService.name);

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(ExchangeKey) private readonly exchangeKeyRepo: Repository<ExchangeKey>,
    @InjectRepository(ListingAnnouncement)
    private readonly announcementRepo: Repository<ListingAnnouncement>,
    @InjectRepository(ListingCandidate)
    private readonly candidateRepo: Repository<ListingCandidate>,
    @Inject(forwardRef(() => ListingTradeExecutorService))
    private readonly executor: ListingTradeExecutorService,
    @InjectQueue(LISTING_TRADE_EXECUTION_QUEUE) private readonly executionQueue: Queue
  ) {}

  /**
   * Fan out a freshly-detected announcement to every eligible user.
   */
  async handleNewAnnouncement(announcement: ListingAnnouncement, coin: Coin): Promise<void> {
    if (!coin) return;

    const eligibleUsers = await this.getEligibleUsers([5]);
    if (eligibleUsers.length === 0) {
      this.logger.log(`No eligible risk-5 users for announcement ${announcement.id} (${coin.symbol})`);
      return;
    }

    for (const user of eligibleUsers) {
      await this.enqueueTrade(user, coin.id, ListingStrategyType.POST_ANNOUNCEMENT, announcement.id, null);
    }
  }

  /**
   * Fan out a qualified candidate to eligible users (risk 4 & 5).
   */
  async handleQualifiedCandidate(candidate: ListingCandidate): Promise<void> {
    if (!candidate.qualified) return;

    const coin = await this.candidateRepo.manager.findOne(Coin, { where: { id: candidate.coinId } });
    if (!coin) return;

    const eligibleUsers = await this.getEligibleUsers([4, 5]);
    for (const user of eligibleUsers) {
      await this.enqueueTrade(user, coin.id, ListingStrategyType.PRE_LISTING, null, candidate.id);
    }
  }

  /**
   * Enqueue a trade-execution job after running cheap eligibility checks.
   * Expensive checks (portfolio value, exchange support) happen inside the worker.
   */
  private async enqueueTrade(
    user: User,
    coinId: string,
    strategyType: ListingStrategyType,
    announcementId: string | null,
    candidateId: string | null
  ): Promise<void> {
    const riskConfig = getListingRiskConfig(user.effectiveCalculationRiskLevel);
    const config =
      strategyType === ListingStrategyType.POST_ANNOUNCEMENT ? riskConfig?.postAnnouncement : riskConfig?.preListing;
    if (!config) return;

    try {
      if (await this.executor.hasOpenPositionForCoin(user.id, coinId)) {
        this.logger.debug(`User ${user.id} already holds coin ${coinId}, skipping`);
        return;
      }

      const active = await this.executor.countActivePositions(user.id, strategyType);
      if (active >= config.maxConcurrent) {
        this.logger.debug(`User ${user.id} at max concurrency for ${strategyType}`);
        return;
      }

      await this.executionQueue.add(
        LISTING_TRADE_EXECUTION_JOB,
        { userId: user.id, coinId, strategyType, announcementId, candidateId } satisfies ListingTradeExecutionJobData,
        {
          attempts: 2,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: 200,
          removeOnFail: 100
        }
      );
    } catch (error) {
      const err = toErrorInfo(error);
      this.logger.warn(`Failed to enqueue listing trade for user ${user.id}: ${err.message}`);
    }
  }

  /**
   * Users eligible for automated listing trades:
   * - `algoTradingEnabled = true`
   * - `effectiveCalculationRiskLevel` in `allowedRiskLevels`
   * - at least one active exchange key
   */
  async getEligibleUsers(allowedRiskLevels: number[]): Promise<User[]> {
    const users = await this.userRepo.find({
      where: { algoTradingEnabled: true },
      relations: ['coinRisk']
    });

    const filtered = users.filter((u) => allowedRiskLevels.includes(u.effectiveCalculationRiskLevel));
    if (filtered.length === 0) return [];

    const filteredUserIds = filtered.map((u) => u.id);
    const keys = await this.exchangeKeyRepo.find({
      where: { userId: In(filteredUserIds), isActive: true },
      select: ['userId']
    });
    const userIdsWithActiveKey = new Set(keys.map((k) => k.userId));

    return filtered.filter((u) => userIdsWithActiveKey.has(u.id));
  }
}
