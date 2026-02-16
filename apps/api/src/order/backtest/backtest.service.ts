import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
  Optional
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Queue } from 'bullmq';
import { In, Repository } from 'typeorm';

import { createHash, randomUUID } from 'node:crypto';

import {
  BacktestRunCollection,
  BacktestRunDetail,
  BacktestRunSummary,
  BacktestSignalCollection,
  SimulatedOrderFillCollection
} from '@chansey/api-interfaces';

import { DEFAULT_CHECKPOINT_CONFIG } from './backtest-checkpoint.interface';
import { BacktestEngine } from './backtest-engine.service';
import { BacktestPauseService } from './backtest-pause.service';
import { BacktestResultService } from './backtest-result.service';
import { BacktestStreamService } from './backtest-stream.service';
import { backtestConfig } from './backtest.config';
import {
  Backtest,
  BacktestPerformanceSnapshot,
  BacktestSignal as BacktestSignalEntity,
  BacktestStatus,
  BacktestTrade,
  BacktestType,
  SimulatedOrderFill as SimulatedOrderFillEntity
} from './backtest.entity';
import { BacktestJobData } from './backtest.job-data';
import { ComparisonReport, ComparisonReportRun } from './comparison-report.entity';
import { DatasetValidatorService } from './dataset-validator.service';
import {
  BacktestComparisonDto,
  BacktestFiltersDto,
  BacktestPerformanceDto,
  BacktestProgressDto,
  BacktestSignalQueryDto,
  BacktestTradesQueryDto,
  CreateBacktestDto,
  CreateComparisonReportDto,
  UpdateBacktestDto
} from './dto/backtest.dto';
import { MarketDataSet, MarketDataSource, MarketDataTimeframe } from './market-data-set.entity';

import { AlgorithmService } from '../../algorithm/algorithm.service';
import { CoinService } from '../../coin/coin.service';
import { NotFoundException } from '../../common/exceptions';
import {
  AlgorithmNotFoundException,
  BacktestNotFoundException,
  ComparisonReportNotFoundException,
  MarketDataSetNotFoundException
} from '../../common/exceptions/resource';
import { MetricsService } from '../../metrics/metrics.service';
import { OHLCService } from '../../ohlc/ohlc.service';
import { User } from '../../users/users.entity';

const BACKTEST_QUEUE_NAMES = backtestConfig();

@Injectable()
export class BacktestService implements OnModuleInit {
  private readonly logger = new Logger(BacktestService.name);

  constructor(
    private readonly algorithmService: AlgorithmService,
    private readonly coinService: CoinService,
    private readonly ohlcService: OHLCService,
    private readonly backtestEngine: BacktestEngine,
    private readonly backtestStream: BacktestStreamService,
    private readonly backtestResultService: BacktestResultService,
    private readonly datasetValidator: DatasetValidatorService,
    @InjectRepository(Backtest) private readonly backtestRepository: Repository<Backtest>,
    @InjectRepository(BacktestTrade) private readonly backtestTradeRepository: Repository<BacktestTrade>,
    @InjectRepository(BacktestPerformanceSnapshot)
    private readonly backtestSnapshotRepository: Repository<BacktestPerformanceSnapshot>,
    @InjectRepository(MarketDataSet) private readonly marketDataSetRepository: Repository<MarketDataSet>,
    @InjectRepository(BacktestSignalEntity) private readonly backtestSignalRepository: Repository<BacktestSignalEntity>,
    @InjectRepository(SimulatedOrderFillEntity)
    private readonly simulatedFillRepository: Repository<SimulatedOrderFillEntity>,
    @InjectRepository(ComparisonReport) private readonly comparisonReportRepository: Repository<ComparisonReport>,
    @InjectRepository(ComparisonReportRun)
    private readonly comparisonReportRunRepository: Repository<ComparisonReportRun>,
    @InjectQueue(BACKTEST_QUEUE_NAMES.historicalQueue) private readonly historicalQueue: Queue,
    @InjectQueue(BACKTEST_QUEUE_NAMES.replayQueue) private readonly replayQueue: Queue,
    private readonly backtestPauseService: BacktestPauseService,
    @Optional() private readonly metricsService?: MetricsService
  ) {}

  async onModuleInit(): Promise<void> {
    // Create/update default dataset on startup (non-blocking)
    this.ensureDefaultDatasetExists().catch((err) => {
      this.logger.warn(`Failed to initialize default dataset on startup: ${err.message}`);
    });
  }

  /**
   * Create a new backtest
   */
  async createBacktest(user: User, createBacktestDto: CreateBacktestDto): Promise<BacktestRunDetail> {
    try {
      this.logger.log(`Creating backtest: ${createBacktestDto.name}`);

      // Validate algorithm exists
      const algorithm = await this.algorithmService.getAlgorithmById(createBacktestDto.algorithmId);
      if (!algorithm) {
        throw new AlgorithmNotFoundException(createBacktestDto.algorithmId);
      }

      const marketDataSet = await this.marketDataSetRepository.findOne({
        where: { id: createBacktestDto.marketDataSetId }
      });

      if (!marketDataSet) {
        throw new MarketDataSetNotFoundException(createBacktestDto.marketDataSetId);
      }

      const deterministicSeed = createBacktestDto.deterministicSeed ?? randomUUID();
      const warningFlags: string[] = [];

      if (marketDataSet.integrityScore < 80) {
        warningFlags.push('dataset_integrity_low');
      }

      if (createBacktestDto.type === BacktestType.LIVE_REPLAY && !marketDataSet.replayCapable) {
        throw new BadRequestException('Selected dataset is not replay capable');
      } else if (createBacktestDto.type !== BacktestType.HISTORICAL && !marketDataSet.replayCapable) {
        warningFlags.push('dataset_not_replay_capable');
      }

      // Validate dataset against backtest configuration
      const validationResult = await this.datasetValidator.validateDataset(marketDataSet, {
        startDate: new Date(createBacktestDto.startDate),
        endDate: new Date(createBacktestDto.endDate)
      });

      if (!validationResult.valid) {
        const errorMessages = validationResult.errors.map((e) => e.message).join('; ');
        throw new BadRequestException(`Dataset validation failed: ${errorMessages}`);
      }

      // Add validation warnings to backtest warnings
      if (validationResult.warnings.length > 0) {
        warningFlags.push(...validationResult.warnings);
      }

      const configSnapshot = {
        algorithm: {
          id: algorithm.id,
          name: algorithm.name
        },
        dataset: {
          id: marketDataSet.id,
          source: marketDataSet.source,
          timeframe: marketDataSet.timeframe,
          startAt: marketDataSet.startAt,
          endAt: marketDataSet.endAt
        },
        run: {
          type: createBacktestDto.type,
          initialCapital: createBacktestDto.initialCapital,
          tradingFee: createBacktestDto.tradingFee || 0.001,
          startDate: createBacktestDto.startDate,
          endDate: createBacktestDto.endDate,
          quoteCurrency: createBacktestDto.quoteCurrency || 'USDT',
          replaySpeed: createBacktestDto.replaySpeed
        },
        slippage: {
          model: createBacktestDto.slippageModel || 'fixed',
          fixedBps: createBacktestDto.slippageFixedBps ?? 5,
          baseBps: createBacktestDto.slippageBaseBps ?? 5,
          volumeImpactFactor: createBacktestDto.slippageVolumeImpactFactor ?? 100
        },
        parameters: createBacktestDto.strategyParams ?? {}
      };

      const backtest = new Backtest({
        name: createBacktestDto.name,
        description: createBacktestDto.description,
        type: createBacktestDto.type,
        status: BacktestStatus.PENDING,
        initialCapital: createBacktestDto.initialCapital,
        tradingFee: createBacktestDto.tradingFee || 0.001,
        startDate: new Date(createBacktestDto.startDate),
        endDate: new Date(createBacktestDto.endDate),
        strategyParams: createBacktestDto.strategyParams,
        user,
        algorithm,
        marketDataSet,
        configSnapshot,
        deterministicSeed,
        warningFlags
      });

      const savedBacktest = await this.backtestRepository.save(backtest);

      // Record backtest creation metric
      this.metricsService?.recordBacktestCreated(createBacktestDto.type, algorithm.name);

      // Stream publishing - non-critical, don't fail if stream is unavailable
      try {
        await this.backtestStream.publishStatus(savedBacktest.id, 'queued', undefined, {
          algorithmId: algorithm.id,
          marketDataSetId: marketDataSet.id
        });
        await this.backtestStream.publishLog(savedBacktest.id, 'info', 'Backtest queued for execution', {
          mode: createBacktestDto.type,
          deterministicSeed,
          warningFlags
        });
      } catch (streamError) {
        this.logger.warn(`Failed to publish backtest stream status: ${streamError.message}`);
      }

      const jobPayload = this.buildJobPayload(savedBacktest, {
        userId: user.id,
        algorithmId: algorithm.id,
        datasetId: marketDataSet.id,
        deterministicSeed
      });
      const targetQueue = this.getQueueForType(createBacktestDto.type);
      await targetQueue.add('execute-backtest', jobPayload, {
        jobId: savedBacktest.id,
        removeOnComplete: true,
        removeOnFail: 50
      });

      return this.mapRunDetail(savedBacktest);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(`Failed to create backtest: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Failed to create backtest due to an internal error');
    }
  }

  /**
   * Get backtests with filtering
   */
  async getBacktests(user: User, filters: BacktestFiltersDto): Promise<BacktestRunCollection> {
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);

    const query = this.backtestRepository
      .createQueryBuilder('backtest')
      .leftJoinAndSelect('backtest.algorithm', 'algorithm')
      .leftJoinAndSelect('backtest.marketDataSet', 'marketDataSet')
      .leftJoinAndSelect('backtest.user', 'owner')
      .where('owner.id = :userId', { userId: user.id })
      .orderBy('backtest.createdAt', 'DESC')
      .addOrderBy('backtest.id', 'DESC')
      .take(limit + 1);

    const typeFilter = filters.type ?? filters.mode;
    if (typeFilter) {
      query.andWhere('backtest.type = :type', { type: typeFilter });
    }

    if (filters.algorithmId) {
      query.andWhere('algorithm.id = :algorithmId', { algorithmId: filters.algorithmId });
    }

    if (filters.status) {
      query.andWhere('backtest.status = :status', { status: filters.status });
    }

    if (filters.createdAfter) {
      query.andWhere('backtest.createdAt >= :createdAfter', { createdAfter: new Date(filters.createdAfter) });
    }

    if (filters.createdBefore) {
      query.andWhere('backtest.createdAt <= :createdBefore', { createdBefore: new Date(filters.createdBefore) });
    }

    if (filters.cursor) {
      const cursor = this.decodeCursor(filters.cursor);
      if (cursor?.createdAt && cursor?.id) {
        query.andWhere(
          '(backtest.createdAt < :cursorDate OR (backtest.createdAt = :cursorDate AND backtest.id < :cursorId))',
          { cursorDate: new Date(cursor.createdAt), cursorId: cursor.id }
        );
      }
    }

    const rows = await query.getMany();
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    return {
      items: items.map((run) => this.mapRunSummary(run)),
      nextCursor: hasMore ? this.encodeCursor(items[items.length - 1].createdAt, items[items.length - 1].id) : undefined
    };
  }

  async getDatasets(): Promise<MarketDataSet[]> {
    // Ensure default dataset exists before returning
    await this.ensureDefaultDatasetExists();

    return this.marketDataSetRepository.find({ order: { createdAt: 'DESC' } });
  }

  /**
   * Cache for default dataset to reduce repeated DB queries
   * TTL: 5 minutes
   */
  private defaultDatasetCache: { dataset: MarketDataSet; checksum: string; expiresAt: number } | null = null;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  /**
   * Ensure the default dataset exists, creating or updating it if necessary.
   * Uses upsert pattern to prevent race conditions and caching to reduce DB load.
   *
   * This method is designed to be resilient and never throw - it returns null on failure
   * to allow the application to continue operating even if dataset creation fails.
   * This is intentional for startup safety (called from onModuleInit).
   *
   * @returns The default dataset if successfully created/updated, or null if:
   *   - No price data exists in the database
   *   - No valid coins found for the instrument universe
   *   - Database operation fails (logged as error)
   */
  async ensureDefaultDatasetExists(): Promise<MarketDataSet | null> {
    try {
      // Check if we have OHLC candle data
      const [coinIds, dateRange] = await Promise.all([
        this.ohlcService.getCoinsWithCandleData(),
        this.ohlcService.getCandleDataDateRange()
      ]);

      if (coinIds.length === 0 || !dateRange) {
        this.logger.debug('No OHLC data available - skipping default dataset creation');
        return null;
      }

      // Get coin symbols for the instrument universe
      const coins = await this.coinService.getCoinsByIds(coinIds);
      const instrumentUniverse = coins.map((c) => c.symbol).filter(Boolean);

      if (instrumentUniverse.length === 0) {
        this.logger.debug('No valid coins found - skipping default dataset creation');
        return null;
      }

      // Generate checksum based on data characteristics
      const checksumData = `${instrumentUniverse.sort().join(',')}-${dateRange.start.toISOString()}-${dateRange.end.toISOString()}`;
      const checksum = createHash('sha256').update(checksumData).digest('hex').substring(0, 16);

      // Check cache first - return cached dataset if checksum matches and not expired
      const now = Date.now();
      if (
        this.defaultDatasetCache &&
        this.defaultDatasetCache.checksum === checksum &&
        this.defaultDatasetCache.expiresAt > now
      ) {
        return this.defaultDatasetCache.dataset;
      }

      // Build dataset metadata
      const candleCount = await this.ohlcService.getCandleCount();
      const metadata = {
        autoGenerated: true,
        source: 'ohlc-candle-table',
        lastUpdated: new Date().toISOString(),
        coinCount: instrumentUniverse.length,
        dataPointCount: candleCount
      };

      // Common field values for both create and update paths
      const datasetFields = {
        label: 'Available Historical Data',
        source: MarketDataSource.INTERNAL_CAPTURE,
        instrumentUniverse,
        timeframe: MarketDataTimeframe.HOUR,
        startAt: dateRange.start,
        endAt: dateRange.end,
        integrityScore: 90,
        checksum,
        storageLocation: '',
        replayCapable: false,
        metadata: metadata as any
      };

      // Look for existing auto-generated dataset by metadata flag
      let dataset = await this.marketDataSetRepository
        .createQueryBuilder('dataset')
        .where("dataset.metadata->>'autoGenerated' = :flag", { flag: 'true' })
        .getOne();

      if (dataset) {
        // Update existing dataset
        await this.marketDataSetRepository.update(dataset.id, datasetFields);

        // Re-fetch to get updated entity
        dataset = await this.marketDataSetRepository.findOne({ where: { id: dataset.id } });
      } else {
        // Create new dataset (let PostgreSQL auto-generate UUID)
        // A partial unique index on (metadata->>'autoGenerated') WHERE = 'true'
        // prevents duplicates if concurrent callers both reach this branch.
        try {
          const newDataset = this.marketDataSetRepository.create(datasetFields);
          dataset = await this.marketDataSetRepository.save(newDataset);
        } catch (error) {
          // Unique constraint violation (23505) means another caller created it concurrently
          if (error?.code === '23505' || error?.driverError?.code === '23505') {
            this.logger.debug('Concurrent dataset creation detected, fetching existing dataset');
            dataset = await this.marketDataSetRepository
              .createQueryBuilder('dataset')
              .where("dataset.metadata->>'autoGenerated' = :flag", { flag: 'true' })
              .getOne();
          } else {
            throw error;
          }
        }
      }

      if (dataset) {
        // Update cache
        this.defaultDatasetCache = {
          dataset,
          checksum,
          expiresAt: now + this.CACHE_TTL_MS
        };

        this.logger.log(
          `Upserted default dataset: ${instrumentUniverse.length} coins, ${dateRange.start.toISOString()} to ${dateRange.end.toISOString()}`
        );
      }

      return dataset;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Failed to ensure default dataset exists: ${message}`, stack);
      return null;
    }
  }

  /**
   * Get the ID of the auto-generated default dataset, or null if none exists.
   * Checks cache first, then falls back to a metadata-based DB query.
   */
  async getDefaultDatasetId(): Promise<string | null> {
    // Check cache first
    const now = Date.now();
    if (this.defaultDatasetCache && this.defaultDatasetCache.expiresAt > now) {
      return this.defaultDatasetCache.dataset.id;
    }

    // Query by metadata flag
    const dataset = await this.marketDataSetRepository
      .createQueryBuilder('dataset')
      .where("dataset.metadata->>'autoGenerated' = :flag", { flag: 'true' })
      .getOne();

    // Populate cache to avoid repeated DB queries
    if (dataset) {
      this.defaultDatasetCache = {
        dataset,
        checksum: dataset.checksum,
        expiresAt: now + this.CACHE_TTL_MS
      };
    }

    return dataset?.id ?? null;
  }

  /**
   * Get a specific backtest
   */
  async getBacktest(user: User, backtestId: string): Promise<BacktestRunDetail> {
    const backtest = await this.fetchBacktestEntity(user, backtestId, ['algorithm', 'user', 'marketDataSet']);

    const [signalsCount, tradesCount] = await Promise.all([
      this.backtestSignalRepository.count({ where: { backtest: { id: backtestId } } }),
      this.backtestTradeRepository.count({ where: { backtest: { id: backtestId } } })
    ]);

    return this.mapRunDetail(backtest, { signalsCount, tradesCount });
  }

  async getBacktestSignals(
    user: User,
    backtestId: string,
    options: BacktestSignalQueryDto = {}
  ): Promise<BacktestSignalCollection> {
    await this.ensureRunOwnership(user, backtestId);

    const pageSize = this.clampPageSize(options.pageSize ?? 100);

    const query = this.backtestSignalRepository
      .createQueryBuilder('signal')
      .where('signal.backtestId = :backtestId', { backtestId })
      .orderBy('signal.timestamp', 'ASC')
      .addOrderBy('signal.id', 'ASC')
      .take(pageSize + 1);

    if (options.cursor) {
      const cursor = this.decodeCursor(options.cursor);
      if (cursor?.timestamp && cursor?.id) {
        query.andWhere('(signal.timestamp > :cursorTs OR (signal.timestamp = :cursorTs AND signal.id > :cursorId))', {
          cursorTs: new Date(cursor.timestamp),
          cursorId: cursor.id
        });
      }
    }

    if (options.instrument) {
      query.andWhere('signal.instrument = :instrument', { instrument: options.instrument });
    }

    if (options.signalType) {
      query.andWhere('signal.signalType = :signalType', { signalType: options.signalType });
    }

    if (options.direction) {
      query.andWhere('signal.direction = :direction', { direction: options.direction });
    }

    const entities = await query.getMany();
    const hasMore = entities.length > pageSize;
    const items = hasMore ? entities.slice(0, pageSize) : entities;

    return {
      items: items.map((signal) => this.mapSignal(signal, backtestId)),
      nextCursor: hasMore
        ? this.encodeCursor(items[items.length - 1].timestamp, items[items.length - 1].id, 'timestamp')
        : undefined
    };
  }

  async getBacktestTrades(
    user: User,
    backtestId: string,
    options: BacktestTradesQueryDto = {}
  ): Promise<SimulatedOrderFillCollection> {
    await this.ensureRunOwnership(user, backtestId);

    const pageSize = this.clampPageSize(options.pageSize ?? 100);
    const query = this.simulatedFillRepository
      .createQueryBuilder('fill')
      .where('fill.backtestId = :backtestId', { backtestId })
      .orderBy('fill.executionTimestamp', 'ASC')
      .addOrderBy('fill.id', 'ASC')
      .take(pageSize + 1);

    if (options.cursor) {
      const cursor = this.decodeCursor(options.cursor);
      if (cursor?.timestamp && cursor?.id) {
        query.andWhere(
          '(fill.executionTimestamp > :cursorTs OR (fill.executionTimestamp = :cursorTs AND fill.id > :cursorId))',
          {
            cursorTs: new Date(cursor.timestamp),
            cursorId: cursor.id
          }
        );
      }
    }

    if (options.instrument) {
      query.andWhere('fill.instrument = :instrument', { instrument: options.instrument });
    }

    if (options.orderType) {
      query.andWhere('fill.orderType = :orderType', { orderType: options.orderType });
    }

    if (options.status) {
      query.andWhere('fill.status = :status', { status: options.status });
    }

    const entities = await query.getMany();
    const hasMore = entities.length > pageSize;
    const items = hasMore ? entities.slice(0, pageSize) : entities;

    return {
      items: items.map((fill) => this.mapSimulatedFill(fill, backtestId)),
      nextCursor: hasMore
        ? this.encodeCursor(items[items.length - 1].executionTimestamp, items[items.length - 1].id, 'timestamp')
        : undefined
    };
  }

  private buildJobPayload(backtest: Backtest, overrides: Partial<BacktestJobData> = {}): BacktestJobData {
    const datasetId =
      overrides.datasetId ?? backtest.marketDataSet?.id ?? (backtest.configSnapshot?.dataset?.id as string);
    if (!datasetId) {
      throw new Error('Backtest dataset reference is missing');
    }

    const userId = overrides.userId ?? backtest.user?.id;
    if (!userId) {
      throw new Error('Backtest user reference is missing');
    }

    const algorithmId =
      overrides.algorithmId ?? backtest.algorithm?.id ?? (backtest.configSnapshot?.algorithm?.id as string);
    if (!algorithmId) {
      throw new Error('Backtest algorithm reference is missing');
    }

    return {
      backtestId: backtest.id,
      userId,
      datasetId,
      algorithmId,
      deterministicSeed: overrides.deterministicSeed ?? backtest.deterministicSeed ?? randomUUID(),
      mode: backtest.type
    };
  }

  private async ensureRunOwnership(user: User, backtestId: string): Promise<void> {
    const exists = await this.backtestRepository.exist({
      where: { id: backtestId, user: { id: user.id } }
    });
    if (!exists) {
      throw new BacktestNotFoundException(backtestId);
    }
  }

  private async fetchBacktestEntity(user: User, backtestId: string, relations: string[] = []): Promise<Backtest> {
    const backtest = await this.backtestRepository.findOne({
      where: { id: backtestId, user: { id: user.id } },
      relations
    });

    if (!backtest) {
      throw new BacktestNotFoundException(backtestId);
    }

    return backtest;
  }

  private getQueueForType(type: BacktestType): Queue {
    switch (type) {
      case BacktestType.HISTORICAL:
        return this.historicalQueue;
      case BacktestType.LIVE_REPLAY:
        return this.replayQueue;
      case BacktestType.PAPER_TRADING:
      case BacktestType.STRATEGY_OPTIMIZATION:
        throw new Error(
          `BacktestType.${type} should not be created via backtestService.createBacktest(). ` +
            `Use the appropriate service: paperTradingService or optimizationService.`
        );
      default: {
        const _exhaustive: never = type;
        throw new Error(`Unknown backtest type: ${type}`);
      }
    }
  }

  private async loadBacktestsForUser(userId: string, ids: string[]): Promise<Backtest[]> {
    const backtests = await this.backtestRepository.find({
      where: { id: In(ids), user: { id: userId } },
      relations: ['algorithm', 'marketDataSet', 'user']
    });

    if (backtests.length !== ids.length) {
      const foundIds = backtests.map((b) => b.id);
      const missingIds = ids.filter((id) => !foundIds.includes(id));
      throw new BacktestNotFoundException(missingIds[0]);
    }

    return backtests;
  }

  private async buildComparisonResponse(backtests: Backtest[], report?: ComparisonReport, fallbackUser?: User) {
    const runs = await Promise.all(
      backtests.map(async (backtest) => {
        const snapshots = await this.backtestSnapshotRepository.find({
          where: { backtest: { id: backtest.id } },
          order: { timestamp: 'ASC' }
        });

        return {
          run: {
            id: backtest.id,
            name: backtest.name,
            description: backtest.description,
            mode: backtest.type === BacktestType.LIVE_REPLAY ? 'live_replay' : 'historical',
            status: backtest.status,
            algorithm: {
              id: backtest.algorithm?.id,
              name: backtest.algorithm?.name
              // version: (backtest.algorithm as Record<string, unknown>)?.version ?? null
            },
            marketDataSet: backtest.marketDataSet
              ? {
                  id: backtest.marketDataSet.id,
                  label: backtest.marketDataSet.label,
                  timeframe: backtest.marketDataSet.timeframe
                }
              : undefined,
            initiatedAt: backtest.createdAt,
            completedAt: backtest.completedAt
          },
          metrics: {
            totalReturn: backtest.totalReturn ?? 0,
            sharpeRatio: backtest.sharpeRatio ?? 0,
            maxDrawdown: backtest.maxDrawdown ?? 0,
            winRate: backtest.winRate ?? 0,
            totalTrades: backtest.totalTrades ?? 0,
            profitFactor: (backtest.performanceMetrics as Record<string, unknown>)?.profitFactor ?? null
          },
          snapshots: snapshots.map((snapshot) => ({
            timestamp: snapshot.timestamp,
            portfolioValue: snapshot.portfolioValue,
            cumulativeReturn: snapshot.cumulativeReturn
          })),
          benchmark: null
        };
      })
    );

    const summary = runs.length
      ? {
          bestReturn: runs.reduce(
            (max, current) => Math.max(max, current.metrics.totalReturn ?? 0),
            Number.NEGATIVE_INFINITY
          ),
          bestSharpe: runs.reduce(
            (max, current) => Math.max(max, current.metrics.sharpeRatio ?? 0),
            Number.NEGATIVE_INFINITY
          ),
          lowestDrawdown: runs.reduce(
            (min, current) => Math.min(min, current.metrics.maxDrawdown ?? 0),
            Number.POSITIVE_INFINITY
          )
        }
      : { bestReturn: 0, bestSharpe: 0, lowestDrawdown: 0 };

    return {
      id: report?.id ?? null,
      name: report?.name ?? 'Ad-hoc Comparison',
      createdAt: report?.createdAt ?? new Date(),
      createdBy: this.createUserRef(report?.createdBy ?? fallbackUser),
      filters: report?.filters ?? null,
      runs,
      notes: [],
      summary
    };
  }

  private createUserRef(user?: User) {
    if (!user) {
      return { id: 'system', displayName: 'System' };
    }

    const displayName = [user.given_name, user.family_name].filter(Boolean).join(' ').trim() || user.email || user.id;
    return { id: user.id, displayName };
  }

  /**
   * Update a backtest
   */
  async updateBacktest(user: User, backtestId: string, updateDto: UpdateBacktestDto): Promise<Backtest> {
    try {
      const backtest = await this.fetchBacktestEntity(user, backtestId);

      if (backtest.status === BacktestStatus.RUNNING) {
        throw new BadRequestException('Cannot update a running backtest');
      }

      Object.assign(backtest, updateDto);
      return this.backtestRepository.save(backtest);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(`Failed to update backtest ${backtestId}: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Failed to update backtest due to an internal error');
    }
  }

  /**
   * Delete a backtest
   */
  async deleteBacktest(user: User, backtestId: string): Promise<void> {
    try {
      const backtest = await this.fetchBacktestEntity(user, backtestId);

      if (backtest.status === BacktestStatus.RUNNING) {
        throw new BadRequestException('Cannot delete a running backtest');
      }

      await this.backtestRepository.remove(backtest);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(`Failed to delete backtest ${backtestId}: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Failed to delete backtest due to an internal error');
    }
  }

  /**
   * Get backtest performance metrics
   */
  async getBacktestPerformance(user: User, backtestId: string): Promise<BacktestPerformanceDto> {
    try {
      const backtest = await this.fetchBacktestEntity(user, backtestId, ['algorithm', 'user', 'marketDataSet']);

      if (backtest.status !== BacktestStatus.COMPLETED) {
        throw new BadRequestException('Backtest must be completed to view performance');
      }

      // Get recent trades (last 50)
      const recentTrades = await this.backtestTradeRepository.find({
        where: { backtest: { id: backtestId } },
        relations: ['baseCoin', 'quoteCoin'],
        order: { executedAt: 'DESC' },
        take: 50
      });

      // Get performance history
      const snapshots = await this.backtestSnapshotRepository.find({
        where: { backtest: { id: backtestId } },
        order: { timestamp: 'ASC' }
      });

      return {
        backtestId: backtest.id,
        name: backtest.name,
        initialCapital: backtest.initialCapital,
        finalValue: backtest.finalValue || 0,
        totalReturn: backtest.totalReturn || 0,
        annualizedReturn: backtest.annualizedReturn || 0,
        sharpeRatio: backtest.sharpeRatio || 0,
        maxDrawdown: backtest.maxDrawdown || 0,
        totalTrades: backtest.totalTrades || 0,
        winningTrades: backtest.winningTrades || 0,
        winRate: backtest.winRate || 0,
        performanceHistory: snapshots.map((snapshot) => ({
          timestamp: snapshot.timestamp,
          portfolioValue: snapshot.portfolioValue,
          cumulativeReturn: snapshot.cumulativeReturn,
          drawdown: snapshot.drawdown
        })),
        recentTrades: recentTrades.map((trade) => ({
          id: trade.id,
          type: trade.type,
          quantity: trade.quantity,
          price: trade.price,
          totalValue: trade.totalValue,
          executedAt: trade.executedAt,
          baseCoin: { symbol: trade.baseCoin?.symbol, name: trade.baseCoin?.name },
          quoteCoin: { symbol: trade.quoteCoin?.symbol, name: trade.quoteCoin?.name }
        }))
      };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(`Failed to get backtest performance ${backtestId}: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Failed to get backtest performance due to an internal error');
    }
  }

  /**
   * Compare multiple backtests
   */
  async compareBacktests(user: User, comparisonDto: BacktestComparisonDto) {
    const backtests = await this.loadBacktestsForUser(user.id, comparisonDto.backtestIds);
    return this.buildComparisonResponse(backtests, undefined, user);
  }

  async createComparisonReport(user: User, dto: CreateComparisonReportDto) {
    if (dto.runIds.length < 2) {
      throw new Error('Please select at least two runs to compare');
    }

    const backtests = await this.loadBacktestsForUser(user.id, dto.runIds);
    const report = this.comparisonReportRepository.create({
      name: dto.name,
      filters: dto.filters as any,
      createdBy: user
    });

    const savedReport = await this.comparisonReportRepository.save(report);
    const runEntities = dto.runIds.map((id) =>
      this.comparisonReportRunRepository.create({
        comparisonReportId: savedReport.id,
        backtestId: id
      })
    );

    await this.comparisonReportRunRepository.save(runEntities);
    return this.buildComparisonResponse(backtests, savedReport, user);
  }

  async getComparisonReport(user: User, reportId: string) {
    const report = await this.comparisonReportRepository.findOne({
      where: { id: reportId },
      relations: ['createdBy', 'runs']
    });

    if (!report) {
      throw new ComparisonReportNotFoundException(reportId);
    }

    const runIds = report.runs?.map((run) => run.backtestId) ?? [];
    const backtests = await this.loadBacktestsForUser(user.id, runIds);

    return this.buildComparisonResponse(backtests, report, user);
  }

  /**
   * Get backtest progress (for running backtests)
   */
  async getBacktestProgress(user: User, backtestId: string): Promise<BacktestProgressDto> {
    const backtest = await this.fetchBacktestEntity(user, backtestId, ['user', 'algorithm', 'marketDataSet']);

    // Calculate actual progress from checkpoint data if available
    const hasProgress = backtest.processedTimestampCount > 0 && backtest.totalTimestampCount > 0;
    const actualProgress = hasProgress
      ? Math.round((backtest.processedTimestampCount / backtest.totalTimestampCount) * 100)
      : 0;

    // Get current date from checkpoint if available
    const currentDate = backtest.checkpointState?.lastProcessedTimestamp
      ? new Date(backtest.checkpointState.lastProcessedTimestamp)
      : undefined;

    // Get trade count from checkpoint if available
    const tradesExecuted = backtest.checkpointState?.persistedCounts?.trades;

    switch (backtest.status) {
      case BacktestStatus.PENDING:
        return {
          progress: hasProgress ? actualProgress : 0,
          message: hasProgress
            ? `Backtest queued for processing (resuming from ${actualProgress}%)`
            : 'Backtest queued for processing'
        };
      case BacktestStatus.RUNNING:
        return {
          progress: hasProgress ? actualProgress : 50,
          message: hasProgress
            ? `Processing... ${backtest.processedTimestampCount.toLocaleString()} of ${backtest.totalTimestampCount.toLocaleString()} timestamps`
            : 'Backtest in progress...',
          currentDate,
          tradesExecuted
        };
      case BacktestStatus.PAUSED:
        return {
          progress: hasProgress ? actualProgress : 50,
          message: hasProgress
            ? `Paused at ${actualProgress}%. Resume when ready.`
            : 'Backtest paused. Resume when ready.',
          currentDate,
          tradesExecuted
        };
      case BacktestStatus.COMPLETED:
        return {
          progress: 100,
          message: 'Backtest completed successfully',
          tradesExecuted: backtest.totalTrades
        };
      case BacktestStatus.FAILED:
        return {
          progress: hasProgress ? actualProgress : 0,
          message: `Backtest failed: ${backtest.errorMessage || 'Unknown error'}`,
          currentDate,
          tradesExecuted
        };
      case BacktestStatus.CANCELLED:
        return {
          progress: hasProgress ? actualProgress : 0,
          message: hasProgress ? `Cancelled at ${actualProgress}%` : 'Backtest was cancelled',
          currentDate,
          tradesExecuted
        };
      default:
        return { progress: 0, message: 'Unknown status' };
    }
  }

  /**
   * Cancel a running backtest
   */
  async cancelBacktest(user: User, backtestId: string): Promise<void> {
    try {
      const backtest = await this.fetchBacktestEntity(user, backtestId, ['algorithm', 'marketDataSet', 'user']);

      if (backtest.status !== BacktestStatus.RUNNING && backtest.status !== BacktestStatus.PENDING) {
        throw new BadRequestException('Can only cancel running or pending backtests');
      }

      const queue = this.getQueueForType(backtest.type);
      const job = await queue.getJob(backtest.id);
      if (job) {
        await job.remove();
      }

      await this.backtestResultService.markCancelled(backtest, 'User requested cancellation');

      // Record cancellation metric
      this.metricsService?.recordBacktestCancelled(backtest.algorithm?.name ?? 'unknown');
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(`Failed to cancel backtest ${backtestId}: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Failed to cancel backtest due to an internal error');
    }
  }

  /**
   * Request a running live replay backtest to pause.
   * The backtest will pause at the next checkpoint and save its state.
   *
   * @param user - User requesting the pause
   * @param backtestId - ID of the backtest to pause
   */
  async pauseBacktest(user: User, backtestId: string): Promise<void> {
    try {
      const backtest = await this.fetchBacktestEntity(user, backtestId, ['algorithm', 'marketDataSet', 'user']);

      // Only allow pausing running live replay backtests
      if (backtest.status !== BacktestStatus.RUNNING) {
        throw new BadRequestException(`Can only pause running backtests. Current status: ${backtest.status}`);
      }

      if (backtest.type !== BacktestType.LIVE_REPLAY) {
        throw new BadRequestException(
          `Only live replay backtests support pause. This backtest type is: ${backtest.type}`
        );
      }

      // Set pause flag - the processor will check this and pause at the next checkpoint
      await this.backtestPauseService.setPauseFlag(backtestId);

      // Publish status update to stream
      try {
        await this.backtestStream.publishStatus(backtest.id, 'pause_requested', undefined, {
          requestedAt: new Date().toISOString()
        });
        await this.backtestStream.publishLog(
          backtest.id,
          'info',
          'Pause requested. Backtest will pause at the next checkpoint.'
        );
      } catch (streamError) {
        this.logger.warn(`Failed to publish pause request status for backtest ${backtestId}: ${streamError.message}`);
      }

      this.logger.log(`Pause requested for backtest ${backtestId}`);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(`Failed to pause backtest ${backtestId}: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Failed to pause backtest due to an internal error');
    }
  }

  async resumeBacktest(user: User, backtestId: string): Promise<Backtest> {
    try {
      const backtest = await this.fetchBacktestEntity(user, backtestId, ['algorithm', 'marketDataSet', 'user']);

      // Allow resume from PAUSED, CANCELLED, or FAILED status
      const resumableStatuses = [BacktestStatus.PAUSED, BacktestStatus.CANCELLED, BacktestStatus.FAILED];
      if (!resumableStatuses.includes(backtest.status)) {
        throw new BadRequestException(
          `Only paused, cancelled, or failed backtests can be resumed. Current status: ${backtest.status}`
        );
      }

      // Check for existing checkpoint
      let hasValidCheckpoint = false;
      if (backtest.checkpointState && backtest.lastCheckpointAt) {
        const checkpointAge = Date.now() - new Date(backtest.lastCheckpointAt).getTime();

        if (checkpointAge > DEFAULT_CHECKPOINT_CONFIG.maxCheckpointAge) {
          // Checkpoint is too old - clear it and start fresh
          this.logger.warn(
            `Clearing stale checkpoint for backtest ${backtestId} (age: ${Math.round(checkpointAge / 1000 / 60 / 60)}h)`
          );
          backtest.checkpointState = null;
          backtest.lastCheckpointAt = null;
          backtest.processedTimestampCount = 0;
        } else {
          hasValidCheckpoint = true;
          const progress = backtest.totalTimestampCount
            ? Math.round((backtest.processedTimestampCount / backtest.totalTimestampCount) * 100)
            : 0;
          this.logger.log(
            `Resuming backtest ${backtestId} from checkpoint at index ${backtest.checkpointState.lastProcessedIndex} (${progress}% complete)`
          );
        }
      }

      backtest.status = BacktestStatus.PENDING;
      await this.backtestRepository.save(backtest);

      const payload = this.buildJobPayload(backtest, {
        userId: backtest.user.id,
        algorithmId: backtest.algorithm.id,
        datasetId: backtest.marketDataSet?.id || backtest.configSnapshot?.dataset?.id,
        deterministicSeed: backtest.deterministicSeed
      });
      const queue = this.getQueueForType(backtest.type);
      await queue.add('execute-backtest', payload, {
        jobId: backtest.id,
        removeOnComplete: true,
        removeOnFail: 50
      });

      try {
        await this.backtestStream.publishStatus(backtest.id, 'queued', undefined, {
          resumed: true,
          hasCheckpoint: hasValidCheckpoint,
          checkpointIndex: hasValidCheckpoint ? backtest.checkpointState?.lastProcessedIndex : undefined
        });
      } catch (streamError) {
        this.logger.warn(`Failed to publish resume status for backtest ${backtestId}: ${streamError.message}`);
      }

      return backtest;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(`Failed to resume backtest ${backtestId}: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Failed to resume backtest due to an internal error');
    }
  }

  private mapRunSummary(backtest: Backtest): BacktestRunSummary {
    const completedAt = backtest.completedAt;

    return {
      id: backtest.id,
      name: backtest.name,
      description: backtest.description,
      algorithm: {
        id: backtest.algorithm?.id,
        name: backtest.algorithm?.name
        // version: (backtest.algorithm as Record<string, unknown>)?.version as string | undefined
      },
      marketDataSet: backtest.marketDataSet
        ? {
            id: backtest.marketDataSet.id,
            label: backtest.marketDataSet.label,
            source: backtest.marketDataSet.source,
            instrumentUniverse: backtest.marketDataSet.instrumentUniverse,
            timeframe: backtest.marketDataSet.timeframe,
            startAt: backtest.marketDataSet.startAt,
            endAt: backtest.marketDataSet.endAt,
            integrityScore: backtest.marketDataSet.integrityScore,
            checksum: backtest.marketDataSet.checksum,
            storageLocation: backtest.marketDataSet.storageLocation,
            replayCapable: backtest.marketDataSet.replayCapable,
            metadata: backtest.marketDataSet.metadata,
            createdAt: backtest.marketDataSet.createdAt,
            updatedAt: backtest.marketDataSet.updatedAt
          }
        : undefined,
      mode: this.mapRunMode(backtest.type),
      type: backtest.type,
      status: backtest.status,
      initiatedBy: this.createUserRef(backtest.user),
      initiatedAt: backtest.createdAt,
      completedAt,
      durationMs: completedAt ? completedAt.getTime() - backtest.createdAt.getTime() : undefined,
      warningFlags: backtest.warningFlags ?? [],
      keyMetrics: this.mapKeyMetrics(backtest),
      createdAt: backtest.createdAt,
      updatedAt: backtest.updatedAt
    };
  }

  private mapRunDetail(
    backtest: Backtest,
    counts?: { signalsCount?: number; tradesCount?: number }
  ): BacktestRunDetail {
    const summary = this.mapRunSummary(backtest);
    return {
      ...summary,
      type: backtest.type,
      initialCapital: backtest.initialCapital,
      tradingFee: backtest.tradingFee,
      startDate: backtest.startDate,
      endDate: backtest.endDate,
      finalValue: backtest.finalValue,
      totalReturn: backtest.totalReturn,
      annualizedReturn: backtest.annualizedReturn,
      sharpeRatio: backtest.sharpeRatio,
      maxDrawdown: backtest.maxDrawdown,
      totalTrades: backtest.totalTrades,
      winningTrades: backtest.winningTrades,
      winRate: backtest.winRate,
      configSnapshot: backtest.configSnapshot,
      deterministicSeed: backtest.deterministicSeed,
      signalsCount: counts?.signalsCount ?? backtest.signals?.length ?? 0,
      tradesCount: counts?.tradesCount ?? backtest.trades?.length ?? 0,
      auditTrail: []
    };
  }

  private mapKeyMetrics(backtest: Backtest) {
    return {
      totalReturn: backtest.totalReturn ?? (backtest.performanceMetrics as Record<string, number>)?.totalReturn,
      annualizedReturn:
        backtest.annualizedReturn ?? (backtest.performanceMetrics as Record<string, number>)?.annualizedReturn,
      sharpeRatio: backtest.sharpeRatio ?? (backtest.performanceMetrics as Record<string, number>)?.sharpeRatio,
      maxDrawdown: backtest.maxDrawdown ?? (backtest.performanceMetrics as Record<string, number>)?.maxDrawdown,
      winRate: backtest.winRate,
      totalTrades: backtest.totalTrades,
      winningTrades: backtest.winningTrades,
      profitFactor: (backtest.performanceMetrics as Record<string, number>)?.profitFactor,
      maxAdverseExcursion: (backtest.performanceMetrics as Record<string, number>)?.maxAdverseExcursion,
      volatility: (backtest.performanceMetrics as Record<string, number>)?.volatility,
      benchmarkSymbol: (backtest.performanceMetrics as Record<string, string>)?.benchmarkSymbol,
      benchmarkReturn: (backtest.performanceMetrics as Record<string, number>)?.benchmarkReturn
    };
  }

  private mapSignal(signal: BacktestSignalEntity, backtestId?: string) {
    return {
      id: signal.id,
      backtestId: backtestId ?? (signal.backtest as Backtest)?.id,
      timestamp: signal.timestamp,
      signalType: signal.signalType,
      instrument: signal.instrument,
      direction: signal.direction,
      quantity: signal.quantity,
      price: signal.price,
      reason: signal.reason,
      confidence: signal.confidence,
      payload: signal.payload
    };
  }

  private mapSimulatedFill(fill: SimulatedOrderFillEntity, backtestId?: string) {
    return {
      id: fill.id,
      backtestId: backtestId ?? (fill.backtest as Backtest)?.id,
      orderType: fill.orderType,
      status: fill.status,
      filledQuantity: fill.filledQuantity,
      averagePrice: fill.averagePrice,
      fees: fill.fees,
      slippageBps: fill.slippageBps,
      executionTimestamp: fill.executionTimestamp,
      instrument: fill.instrument,
      metadata: fill.metadata,
      signalId: (fill.signal as BacktestSignalEntity)?.id
    };
  }

  private mapRunMode(type: BacktestType) {
    return type === BacktestType.LIVE_REPLAY ? 'live_replay' : 'historical';
  }

  private encodeCursor(date: Date, id: string, field: 'createdAt' | 'timestamp' = 'createdAt'): string {
    const payload = { id, [field]: date.toISOString() };
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  }

  private decodeCursor(cursor: string): Record<string, string> | null {
    try {
      return JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
    } catch {
      return null;
    }
  }

  private clampPageSize(size: number): number {
    return Math.min(Math.max(size, 10), 500);
  }
}
