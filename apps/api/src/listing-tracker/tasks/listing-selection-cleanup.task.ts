import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';

import { Job, Queue } from 'bullmq';
import { In, Repository } from 'typeorm';

import { CoinSelectionSource } from '../../coin-selection/coin-selection-source.enum';
import { CoinSelectionType } from '../../coin-selection/coin-selection-type.enum';
import { CoinSelection } from '../../coin-selection/coin-selection.entity';
import { CoinSelectionService } from '../../coin-selection/coin-selection.service';
import { FailSafeWorkerHost } from '../../failed-jobs/fail-safe-worker-host';
import { FailedJobService } from '../../failed-jobs/failed-job.service';
import { toErrorInfo } from '../../shared/error.util';
import { ListingPositionStatus, ListingTradePosition } from '../entities/listing-trade-position.entity';

export const LISTING_SELECTION_CLEANUP_QUEUE = 'listing-selection-cleanup';
const CLEANUP_JOB_NAME = 'listing-selection-cleanup-sweep';

// 4:30 AM UTC — offset from RedisMaintenanceTask at 4 AM to spread daily I/O load.
const CLEANUP_CRON = '30 4 * * *';

// Listing selections younger than this are kept even if no position exists, in case
// the trade is still being executed. Listing executor inserts the selection BEFORE
// queueing the order, so a fresh row may have no matching position for a few minutes.
const LISTING_ORPHAN_GRACE_HOURS = 48;

const TERMINAL_POSITION_STATUSES: readonly ListingPositionStatus[] = [
  ListingPositionStatus.CLOSED,
  ListingPositionStatus.EXITED_TIME_STOP,
  ListingPositionStatus.EXITED_SL,
  ListingPositionStatus.EXITED_TP
] as const;

@Processor(LISTING_SELECTION_CLEANUP_QUEUE)
@Injectable()
export class ListingSelectionCleanupTask extends FailSafeWorkerHost implements OnModuleInit {
  private readonly logger = new Logger(ListingSelectionCleanupTask.name);
  private jobScheduled = false;

  constructor(
    @InjectQueue(LISTING_SELECTION_CLEANUP_QUEUE) private readonly queue: Queue,
    @InjectRepository(CoinSelection) private readonly selectionRepo: Repository<CoinSelection>,
    @InjectRepository(ListingTradePosition) private readonly positionRepo: Repository<ListingTradePosition>,
    private readonly coinSelectionService: CoinSelectionService,
    private readonly config: ConfigService,
    failedJobService: FailedJobService
  ) {
    super(failedJobService);
  }

  async onModuleInit() {
    if (this.isDisabled()) {
      this.logger.log('Listing selection cleanup task disabled');
      return;
    }
    if (!this.jobScheduled) {
      await this.schedule();
      this.jobScheduled = true;
    }
  }

  private isDisabled(): boolean {
    if (process.env.DISABLE_BACKGROUND_TASKS === 'true') return true;
    if (process.env.NODE_ENV === 'development') return true;
    return this.config.get<string>('LISTING_TRACKER_ENABLED') !== 'true';
  }

  private async schedule(): Promise<void> {
    const existing = await this.queue.getRepeatableJobs();
    const already = existing.find((job) => job.name === CLEANUP_JOB_NAME);
    if (already) {
      this.logger.log(`Listing selection cleanup already scheduled (${already.pattern})`);
      return;
    }
    await this.queue.add(
      CLEANUP_JOB_NAME,
      { scheduledAt: new Date().toISOString() },
      {
        repeat: { pattern: CLEANUP_CRON },
        attempts: 2,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: 30,
        removeOnFail: 30
      }
    );
    this.logger.log(`Listing selection cleanup scheduled at '${CLEANUP_CRON}' UTC`);
  }

  async process(job: Job): Promise<{ usersProcessed: number; coinsRemoved: number } | undefined> {
    if (job.name !== CLEANUP_JOB_NAME) return;

    try {
      return await this.runSweep();
    } catch (error) {
      const err = toErrorInfo(error);
      this.logger.error(`Listing selection cleanup failed: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Sweep orphaned `source='listing'` coin_selection rows.
   *
   * For each user with at least one listing-sourced selection:
   *  - keep the selection if any non-terminal position exists for (userId, coinId)
   *  - keep the selection if no position exists yet AND the row is younger than
   *    `LISTING_ORPHAN_GRACE_HOURS` (covers the executor's insert-before-trade window)
   *  - otherwise delete it
   */
  async runSweep(): Promise<{ usersProcessed: number; coinsRemoved: number }> {
    const listingSelections = await this.selectionRepo.find({
      where: { type: CoinSelectionType.AUTOMATIC, source: CoinSelectionSource.LISTING },
      relations: ['coin', 'user'],
      withDeleted: false
    });

    if (listingSelections.length === 0) {
      return { usersProcessed: 0, coinsRemoved: 0 };
    }

    // Created date is `select: false` on the entity — fetch it explicitly per row.
    const ids = listingSelections.map((s) => s.id);
    const createdRows = await this.selectionRepo
      .createQueryBuilder('cs')
      .select(['cs.id AS id', 'cs."createdAt" AS "createdAt"'])
      .where('cs.id IN (:...ids)', { ids })
      .getRawMany<{ id: string; createdAt: Date }>();
    const createdAtById = new Map(createdRows.map((r) => [r.id, new Date(r.createdAt)]));

    // Group selections by user.
    const byUser = new Map<string, CoinSelection[]>();
    for (const sel of listingSelections) {
      const userId = sel.user.id;
      const list = byUser.get(userId) ?? [];
      list.push(sel);
      byUser.set(userId, list);
    }

    const graceCutoff = Date.now() - LISTING_ORPHAN_GRACE_HOURS * 60 * 60 * 1000;
    let totalRemoved = 0;

    for (const [userId, selections] of byUser) {
      const coinIds = selections.map((s) => s.coin.id);
      const positions = await this.positionRepo.find({
        where: { userId, coinId: In(coinIds) }
      });

      // Group positions by coinId.
      const positionsByCoin = new Map<string, ListingTradePosition[]>();
      for (const p of positions) {
        const list = positionsByCoin.get(p.coinId) ?? [];
        list.push(p);
        positionsByCoin.set(p.coinId, list);
      }

      const keepCoinIds = new Set<string>();
      for (const sel of selections) {
        const coinId = sel.coin.id;
        const positionsForCoin = positionsByCoin.get(coinId) ?? [];

        if (positionsForCoin.length === 0) {
          const createdAt = createdAtById.get(sel.id);
          if (!createdAt || createdAt.getTime() >= graceCutoff) {
            // No position yet but still inside the grace window — keep.
            keepCoinIds.add(coinId);
          }
          continue;
        }

        const hasNonTerminal = positionsForCoin.some((p) => !TERMINAL_POSITION_STATUSES.includes(p.status));
        if (hasNonTerminal) keepCoinIds.add(coinId);
      }

      const candidatesForRemoval = selections.length - keepCoinIds.size;
      if (candidatesForRemoval === 0) continue;

      const result = await this.coinSelectionService.bulkDeleteAutomaticSelections(
        userId,
        CoinSelectionSource.LISTING,
        keepCoinIds
      );
      const removed = (result?.affected as number | undefined) ?? candidatesForRemoval;
      totalRemoved += removed;
      this.logger.log(`Listing cleanup user ${userId}: removed ${removed} selection(s), kept ${keepCoinIds.size}`);
    }

    return { usersProcessed: byUser.size, coinsRemoved: totalRemoved };
  }
}
