import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { randomUUID } from 'node:crypto';

import { BacktestRunCollection, BacktestRunDetail } from '@chansey/api-interfaces';

import { BacktestCoreRepository } from './backtest-core-repository.service';
import { wrapInternal } from './backtest-error.util';
import { BacktestMapper } from './backtest-mapper.service';
import { BacktestSignal as BacktestSignalEntity } from './backtest-signal.entity';
import { BacktestStreamService } from './backtest-stream.service';
import { BacktestTrade } from './backtest-trade.entity';
import { Backtest, BacktestStatus, BacktestType } from './backtest.entity';
import { DatasetValidatorService } from './dataset-validator.service';
import { BacktestFiltersDto, CreateBacktestDto, UpdateBacktestDto } from './dto/backtest.dto';
import { MarketDataSet } from './market-data-set.entity';

import { AlgorithmService } from '../../algorithm/algorithm.service';
import { AlgorithmNotFoundException, MarketDataSetNotFoundException } from '../../common/exceptions/resource';
import { MetricsService } from '../../metrics/metrics.service';
import { toErrorInfo } from '../../shared/error.util';
import { User } from '../../users/users.entity';

@Injectable()
export class BacktestService {
  private readonly logger = new Logger(BacktestService.name);

  constructor(
    private readonly coreRepository: BacktestCoreRepository,
    private readonly mapper: BacktestMapper,
    private readonly algorithmService: AlgorithmService,
    private readonly datasetValidator: DatasetValidatorService,
    private readonly backtestStream: BacktestStreamService,
    @InjectRepository(MarketDataSet) private readonly marketDataSetRepository: Repository<MarketDataSet>,
    @InjectRepository(BacktestSignalEntity) private readonly backtestSignalRepository: Repository<BacktestSignalEntity>,
    @InjectRepository(BacktestTrade) private readonly backtestTradeRepository: Repository<BacktestTrade>,
    @Optional() private readonly metricsService?: MetricsService
  ) {}

  /**
   * Create a new backtest
   */
  async createBacktest(user: User, createBacktestDto: CreateBacktestDto): Promise<BacktestRunDetail> {
    return wrapInternal(this.logger, 'Failed to create backtest', async () => {
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
          baseSlippageBps: createBacktestDto.slippageBaseBps ?? 5,
          participationRateLimit: createBacktestDto.slippageParticipationRate,
          rejectParticipationRate: createBacktestDto.slippageRejectThreshold,
          volatilityFactor: createBacktestDto.slippageVolatilityFactor,
          spreadCalibrationFactor: createBacktestDto.slippageSpreadCalibrationFactor ?? 1.0,
          minSpreadBps: createBacktestDto.slippageMinSpreadBps ?? 2
        },
        regime: {
          enableRegimeGate: createBacktestDto.enableRegimeGate,
          enableRegimeScaledSizing: createBacktestDto.enableRegimeScaledSizing,
          riskLevel: createBacktestDto.riskLevel
        },
        parameters: createBacktestDto.strategyParams ?? {},
        ...(createBacktestDto.coinSymbolFilter?.length && { coinSymbolFilter: createBacktestDto.coinSymbolFilter }),
        ...(createBacktestDto.exitConfig && { exitConfig: createBacktestDto.exitConfig })
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

      const savedBacktest = await this.coreRepository.save(backtest);

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
      } catch (streamError: unknown) {
        const err = toErrorInfo(streamError);
        this.logger.warn(`Failed to publish backtest stream status: ${err.message}`);
      }

      const jobPayload = this.coreRepository.buildJobPayload(savedBacktest, {
        userId: user.id,
        algorithmId: algorithm.id,
        datasetId: marketDataSet.id,
        deterministicSeed
      });
      const targetQueue = this.coreRepository.getQueueForType(createBacktestDto.type);
      await targetQueue.add('execute-backtest', jobPayload, {
        jobId: savedBacktest.id,
        removeOnComplete: true,
        removeOnFail: 50
      });

      return this.mapper.mapRunDetail(savedBacktest);
    });
  }

  /**
   * Get backtests with filtering
   */
  async getBacktests(user: User, filters: BacktestFiltersDto): Promise<BacktestRunCollection> {
    return this.coreRepository.listForUser(user, filters, this.mapper);
  }

  /**
   * Get a specific backtest
   */
  async getBacktest(user: User, backtestId: string): Promise<BacktestRunDetail> {
    const backtest = await this.coreRepository.fetchBacktestEntity(user, backtestId, [
      'algorithm',
      'user',
      'marketDataSet'
    ]);

    const [signalsCount, tradesCount] = await Promise.all([
      this.backtestSignalRepository.count({ where: { backtest: { id: backtestId } } }),
      this.backtestTradeRepository.count({ where: { backtest: { id: backtestId } } })
    ]);

    return this.mapper.mapRunDetail(backtest, { signalsCount, tradesCount });
  }

  /**
   * Update a backtest
   */
  async updateBacktest(user: User, backtestId: string, updateDto: UpdateBacktestDto): Promise<Backtest> {
    return wrapInternal(this.logger, `Failed to update backtest ${backtestId}`, async () => {
      const backtest = await this.coreRepository.fetchBacktestEntity(user, backtestId);

      if (backtest.status === BacktestStatus.RUNNING) {
        throw new BadRequestException('Cannot update a running backtest');
      }

      Object.assign(backtest, updateDto);
      return this.coreRepository.save(backtest);
    });
  }

  /**
   * Update futures-specific configuration on a backtest entity.
   * Used by pipeline orchestration to propagate marketType and leverage from StrategyConfig.
   */
  async updateBacktestFuturesConfig(backtestId: string, marketType: string, leverage: number): Promise<void> {
    await this.coreRepository.updateById(backtestId, { marketType, leverage });
  }

  /**
   * Delete a backtest
   */
  async deleteBacktest(user: User, backtestId: string): Promise<void> {
    return wrapInternal(this.logger, `Failed to delete backtest ${backtestId}`, async () => {
      const backtest = await this.coreRepository.fetchBacktestEntity(user, backtestId);

      if (backtest.status === BacktestStatus.RUNNING) {
        throw new BadRequestException('Cannot delete a running backtest');
      }

      await this.coreRepository.remove(backtest);
    });
  }
}
