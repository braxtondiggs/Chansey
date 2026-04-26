import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Job, Queue } from 'bullmq';

import { FailSafeWorkerHost } from '../../failed-jobs/fail-safe-worker-host';
import { FailedJobService } from '../../failed-jobs/failed-job.service';
import { LOCK_DEFAULTS, LOCK_KEYS } from '../../shared/distributed-lock.constants';
import { DistributedLockService } from '../../shared/distributed-lock.service';
import { toErrorInfo } from '../../shared/error.util';
import { ExchangeSymbolMap } from '../exchange-symbol-map.entity';
import { OHLCService } from '../ohlc.service';
import { ExchangeSymbolMapService } from '../services/exchange-symbol-map.service';
import { OHLCBackfillService } from '../services/ohlc-backfill.service';

@Processor('ohlc-gap-detection-queue')
@Injectable()
export class OHLCGapDetectionTask extends FailSafeWorkerHost implements OnModuleInit {
  private readonly logger = new Logger(OHLCGapDetectionTask.name);
  private jobScheduled = false;

  // 365 days × 24 hours = 8760 expected hourly candles per coin
  private static readonly LOOKBACK_DAYS = 365;
  private static readonly EXPECTED_HOURLY_COUNT = 365 * 24;
  private static readonly DEFICIENCY_THRESHOLD = 0.95; // 95% of expected
  private static readonly MAX_BACKFILLS_PER_RUN = 30;
  private static readonly RECENT_FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h
  // BullMQ default lock duration is 30s and a typical backfill run is minutes, not an hour.
  // If `updatedAt` hasn't advanced in 60 minutes, the worker is almost certainly dead.
  private static readonly IN_FLIGHT_STALE_MS = 60 * 60 * 1000; // 1h — assume worker died

  constructor(
    @InjectQueue('ohlc-gap-detection-queue') private readonly gapQueue: Queue,
    private readonly ohlcService: OHLCService,
    private readonly symbolMapService: ExchangeSymbolMapService,
    private readonly backfillService: OHLCBackfillService,
    private readonly configService: ConfigService,
    private readonly lockService: DistributedLockService,
    failedJobService: FailedJobService
  ) {
    super(failedJobService);
  }

  async onModuleInit() {
    if (
      process.env.NODE_ENV === 'development' ||
      process.env.DISABLE_BACKGROUND_TASKS === 'true' ||
      this.configService.get('OHLC_SYNC_ENABLED') === 'false'
    ) {
      this.logger.log('OHLC gap detection jobs disabled');
      return;
    }

    if (!this.jobScheduled) {
      await this.scheduleGapDetectionJob();
      this.jobScheduled = true;
    }
  }

  /**
   * Schedule the recurring gap-detection job to run daily at 5:00 AM UTC.
   * Sits after the existing 3AM/4AM maintenance burst.
   */
  private async scheduleGapDetectionJob() {
    const lock = await this.lockService.acquire({
      key: LOCK_KEYS.OHLC_GAP_DETECTION_SCHEDULE,
      ttlMs: LOCK_DEFAULTS.SCHEDULE_LOCK_TTL_MS,
      maxRetries: 2,
      retryDelayMs: 500
    });

    if (!lock.acquired) {
      this.logger.log('Another instance is scheduling OHLC gap detection job, skipping');
      return;
    }

    try {
      const repeatedJobs = await this.gapQueue.getRepeatableJobs();
      const existingJob = repeatedJobs.find((job) => job.name === 'ohlc-gap-detection');

      if (existingJob) {
        this.logger.log(`OHLC gap detection job already scheduled with pattern: ${existingJob.pattern}`);
        return;
      }

      const cronPattern = '0 5 * * *';

      await this.gapQueue.add(
        'ohlc-gap-detection',
        {
          timestamp: new Date().toISOString(),
          description: 'Scheduled OHLC gap detection job'
        },
        {
          repeat: { pattern: cronPattern },
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000
          },
          removeOnComplete: 30,
          removeOnFail: 20
        }
      );

      this.logger.log(`OHLC gap detection job scheduled to run daily at 5:00 AM UTC`);
    } finally {
      await this.lockService.release(LOCK_KEYS.OHLC_GAP_DETECTION_SCHEDULE, lock.token);
    }
  }

  // BullMQ: process incoming jobs
  async process(job: Job) {
    this.logger.log(`Processing job ${job.id} of type ${job.name}`);
    try {
      return await this.handleGapDetection(job);
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to process job ${job.id}: ${err.message}`, err.stack);
      throw error;
    }
  }

  async handleGapDetection(job: Job) {
    const lock = await this.lockService.acquire({
      key: LOCK_KEYS.OHLC_GAP_DETECTION,
      ttlMs: LOCK_DEFAULTS.OHLC_GAP_DETECTION_TTL_MS,
      maxRetries: 0
    });

    if (!lock.acquired) {
      this.logger.log('Another instance is running gap detection, skipping');
      return {
        skipped: true,
        reason: 'lock_not_acquired'
      };
    }

    try {
      await job.updateProgress(5);

      const symbolMaps = await this.symbolMapService.getActiveSymbolMaps();
      const uniqueCoinMappings = this.dedupeMappingsByCoin(symbolMaps);
      const coinIds = Array.from(uniqueCoinMappings.keys());

      this.logger.log(`Gap detection scan started: ${coinIds.length} active mappings`);
      await job.updateProgress(20);

      if (coinIds.length === 0) {
        this.logger.log('No active mappings, nothing to scan');
        return {
          activeMappings: 0,
          deficient: 0,
          queued: 0,
          skippedInFlight: 0,
          recentFailures: 0,
          recentCompletions: 0
        };
      }

      const now = new Date();
      const lookbackStart = new Date(now.getTime() - OHLCGapDetectionTask.LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
      const minRequired = Math.floor(
        OHLCGapDetectionTask.EXPECTED_HOURLY_COUNT * OHLCGapDetectionTask.DEFICIENCY_THRESHOLD
      );

      const counts = await this.ohlcService.getCandleCountsByCoinInRange(coinIds, lookbackStart, now);
      await job.updateProgress(40);

      // Determine deficient coins (coins with count < threshold OR missing from result entirely)
      const deficientMappings: ExchangeSymbolMap[] = [];
      for (const [coinId, mapping] of uniqueCoinMappings.entries()) {
        const count = counts.get(coinId) ?? 0;
        if (count < minRequired) {
          deficientMappings.push(mapping);
          this.logger.debug(
            `Deficient coin: ${mapping.symbol} (${count}/${OHLCGapDetectionTask.EXPECTED_HOURLY_COUNT} candles, lastSync ${
              mapping.lastSyncAt?.toISOString() ?? 'never'
            })`
          );
        }
      }

      // Sort by oldest lastSyncAt first (nulls first — never synced is most stale)
      deficientMappings.sort((a, b) => {
        const aTime = a.lastSyncAt ? a.lastSyncAt.getTime() : 0;
        const bTime = b.lastSyncAt ? b.lastSyncAt.getTime() : 0;
        return aTime - bTime;
      });

      await job.updateProgress(60);

      let queued = 0;
      let skippedInFlight = 0;
      let recentFailures = 0;
      let recentCompletions = 0;
      const queuedCoinIds: string[] = [];

      for (const mapping of deficientMappings) {
        if (queued >= OHLCGapDetectionTask.MAX_BACKFILLS_PER_RUN) break;

        const eligibility = await this.checkBackfillEligibility(mapping.coinId);
        if (eligibility === 'in_flight') {
          skippedInFlight++;
          continue;
        }
        if (eligibility === 'recent_failure') {
          recentFailures++;
          continue;
        }
        if (eligibility === 'recent_completion') {
          recentCompletions++;
          continue;
        }

        queuedCoinIds.push(mapping.coinId);
        queued++;
      }

      await job.updateProgress(80);

      // Concurrency (≤2 simultaneous backfills cluster-wide) is enforced inside
      // OHLCBackfillService via the ohlc-backfill-queue worker.
      for (const coinId of queuedCoinIds) {
        await this.backfillService.startBackfill(coinId);
      }

      await job.updateProgress(100);

      this.logger.log(
        `Queued backfills: ${queued}, skipped (in-flight): ${skippedInFlight}, recent-failure: ${recentFailures}, recent-completion: ${recentCompletions}, deficient total: ${deficientMappings.length}`
      );

      return {
        activeMappings: coinIds.length,
        deficient: deficientMappings.length,
        queued,
        skippedInFlight,
        recentFailures,
        recentCompletions
      };
    } finally {
      await this.lockService.release(LOCK_KEYS.OHLC_GAP_DETECTION, lock.token);
    }
  }

  /**
   * Determine whether a coin is eligible for a new backfill.
   * - 'in_flight': pending/in_progress with fresh updatedAt — skip
   * - 'recent_failure': failed within last 24h — skip to avoid hammering
   * - 'recent_completion': completed within last 24h — skip cooldown so a coin
   *   that legitimately can't reach the 95% threshold (e.g. listed <1yr) doesn't
   *   re-queue every day
   * - 'eligible': no progress, fresh failed/completed >24h ago, or stale in_flight
   */
  private async checkBackfillEligibility(
    coinId: string
  ): Promise<'in_flight' | 'recent_failure' | 'recent_completion' | 'eligible'> {
    const progress = await this.backfillService.getProgress(coinId);
    if (!progress) return 'eligible';

    const ageMs = Date.now() - progress.updatedAt.getTime();

    if (progress.status === 'pending' || progress.status === 'in_progress') {
      if (ageMs >= OHLCGapDetectionTask.IN_FLIGHT_STALE_MS) {
        // Stale — worker likely died. Allow re-queue.
        return 'eligible';
      }
      return 'in_flight';
    }

    if (progress.status === 'failed' && ageMs < OHLCGapDetectionTask.RECENT_FAILURE_WINDOW_MS) {
      return 'recent_failure';
    }

    if (progress.status === 'completed' && ageMs < OHLCGapDetectionTask.RECENT_FAILURE_WINDOW_MS) {
      return 'recent_completion';
    }

    return 'eligible';
  }

  /**
   * Reduce active mappings to one entry per coin (highest-priority mapping wins —
   * mappings come pre-sorted by priority ASC from the service).
   */
  private dedupeMappingsByCoin(mappings: ExchangeSymbolMap[]): Map<string, ExchangeSymbolMap> {
    const result = new Map<string, ExchangeSymbolMap>();
    for (const mapping of mappings) {
      if (!result.has(mapping.coinId)) {
        result.set(mapping.coinId, mapping);
      }
    }
    return result;
  }
}
