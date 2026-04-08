import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, NotFoundException, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Queue } from 'bullmq';
import { Repository } from 'typeorm';

import { PipelineProgressionService } from './pipeline-progression.service';

import { AlgorithmRegistry } from '../../algorithm/registry/algorithm-registry.service';
import { CoinSelectionService } from '../../coin-selection/coin-selection.service';
import { ExchangeSelectionService } from '../../exchange/exchange-selection/exchange-selection.service';
import { OptimizationOrchestratorService } from '../../optimization/services/optimization-orchestrator.service';
import { buildParameterSpace } from '../../optimization/utils/parameter-space-builder';
import { BacktestDatasetService } from '../../order/backtest/backtest-dataset.service';
import { BacktestLifecycleService } from '../../order/backtest/backtest-lifecycle.service';
import { BacktestStatus, BacktestType } from '../../order/backtest/backtest.entity';
import { BacktestService } from '../../order/backtest/backtest.service';
import { PaperTradingService } from '../../order/paper-trading/paper-trading.service';
import { CUSTOM_RISK_LEVEL } from '../../risk/risk.constants';
import { forceRemoveJob } from '../../shared';
import { User } from '../../users/users.entity';
import { Pipeline } from '../entities/pipeline.entity';
import {
  HistoricalStageConfig,
  LiveReplayStageConfig,
  PipelineJobData,
  PipelineStage,
  PipelineStatus
} from '../interfaces';

@Injectable()
export class PipelineStageExecutionService {
  private readonly logger = new Logger(PipelineStageExecutionService.name);

  constructor(
    @InjectRepository(Pipeline)
    private readonly pipelineRepository: Repository<Pipeline>,
    @InjectQueue('pipeline')
    private readonly pipelineQueue: Queue,
    @Inject(forwardRef(() => OptimizationOrchestratorService))
    private readonly optimizationService: OptimizationOrchestratorService,
    @Inject(forwardRef(() => BacktestService))
    private readonly backtestService: BacktestService,
    @Inject(forwardRef(() => BacktestDatasetService))
    private readonly backtestDatasetService: BacktestDatasetService,
    @Inject(forwardRef(() => BacktestLifecycleService))
    private readonly backtestLifecycleService: BacktestLifecycleService,
    @Inject(forwardRef(() => PaperTradingService))
    private readonly paperTradingService: PaperTradingService,
    @Inject(forwardRef(() => AlgorithmRegistry))
    private readonly algorithmRegistry: AlgorithmRegistry,
    private readonly exchangeSelectionService: ExchangeSelectionService,
    @Inject(forwardRef(() => CoinSelectionService))
    private readonly coinSelectionService: CoinSelectionService,
    @Inject(forwardRef(() => PipelineProgressionService))
    private readonly progressionService: PipelineProgressionService
  ) {}

  static stageJobId(pipelineId: string, stage: PipelineStage): string {
    return `pipeline-${pipelineId}-${stage}`;
  }

  async enqueueStageJob(pipeline: Pipeline, stage: PipelineStage, userId: string): Promise<void> {
    const jobId = PipelineStageExecutionService.stageJobId(pipeline.id, stage);
    await forceRemoveJob(this.pipelineQueue, jobId, this.logger);
    await this.pipelineQueue.add(
      'execute-stage',
      { pipelineId: pipeline.id, userId, stage } satisfies PipelineJobData,
      { jobId }
    );
  }

  async removeStageJob(pipelineId: string, stage: PipelineStage): Promise<void> {
    await forceRemoveJob(this.pipelineQueue, PipelineStageExecutionService.stageJobId(pipelineId, stage), this.logger);
  }

  async executeStage(pipelineId: string, stage: PipelineStage): Promise<void> {
    const pipeline = await this.pipelineRepository.findOne({
      where: { id: pipelineId },
      relations: ['strategyConfig', 'strategyConfig.algorithm', 'user', 'user.coinRisk']
    });

    if (!pipeline) {
      throw new NotFoundException(`Pipeline ${pipelineId} not found`);
    }

    if (pipeline.status !== PipelineStatus.RUNNING) {
      this.logger.warn(`Pipeline ${pipelineId} is not running (status: ${pipeline.status})`);
      return;
    }

    this.logger.log(`Executing stage ${stage} for pipeline ${pipelineId}`);

    switch (stage) {
      case PipelineStage.OPTIMIZE:
        await this.executeOptimizationStage(pipeline);
        break;
      case PipelineStage.HISTORICAL:
        await this.executeBacktestStage(
          pipeline,
          pipeline.stageConfig.historical,
          BacktestType.HISTORICAL,
          'Historical'
        );
        break;
      case PipelineStage.LIVE_REPLAY:
        await this.executeBacktestStage(
          pipeline,
          pipeline.stageConfig.liveReplay,
          BacktestType.LIVE_REPLAY,
          'Live Replay'
        );
        break;
      case PipelineStage.PAPER_TRADE:
        await this.executePaperTradingStage(pipeline);
        break;
      default:
        throw new Error(`Pipeline ${pipelineId}: unknown or non-executable stage ${stage}`);
    }
  }

  private async executeOptimizationStage(pipeline: Pipeline): Promise<void> {
    const config = pipeline.stageConfig.optimization;
    if (!config) {
      throw new Error(`Pipeline ${pipeline.id}: optimization stage config is missing`);
    }

    const strategy = await this.algorithmRegistry.getStrategyForAlgorithm(pipeline.strategyConfig.algorithmId);
    if (!strategy?.getConfigSchema) {
      throw new Error(
        `Pipeline ${pipeline.id}: strategy not found or has no config schema for algorithm ${pipeline.strategyConfig.algorithmId}`
      );
    }

    const schema = strategy.getConfigSchema();
    const constraints = strategy.getParameterConstraints?.() ?? [];
    const parameterSpace = buildParameterSpace(strategy.id, schema, constraints, pipeline.strategyConfig.version);

    if (parameterSpace.parameters.length === 0) {
      throw new Error(`Pipeline ${pipeline.id}: strategy has no optimizable parameters`);
    }

    const run = await this.optimizationService.startOptimization(pipeline.strategyConfigId, parameterSpace, {
      method: 'random_search',
      maxIterations: config.maxCombinations,
      maxCombinations: config.maxCombinations,
      objective: {
        metric: config.objectiveMetric,
        minimize: false
      },
      walkForward: {
        trainDays: config.trainDays,
        testDays: config.testDays,
        stepDays: config.stepDays,
        method: 'rolling',
        minWindowsRequired: 3
      },
      earlyStop: config.earlyStop
        ? {
            enabled: true,
            patience: config.patience ?? 20,
            minImprovement: pipeline.progressionRules?.optimization?.minImprovement ?? 5
          }
        : undefined,
      parallelism: {
        maxConcurrentBacktests: 2,
        maxConcurrentWindows: 2
      },
      maxCoins: config.maxCoins,
      riskLevel: this.getUserRiskLevel(pipeline)
    });

    pipeline.optimizationRunId = run.id;
    await this.pipelineRepository.save(pipeline);

    this.logger.log(`Started optimization run ${run.id} for pipeline ${pipeline.id}`);
  }

  private getUserRiskLevel(pipeline: Pipeline): number {
    const user = pipeline.user as User;
    return user.effectiveCalculationRiskLevel;
  }

  private async resolveCoinSymbolFilter(pipeline: Pipeline): Promise<string[] | undefined> {
    const user = pipeline.user as User;
    if (user.coinRisk?.level === CUSTOM_RISK_LEVEL) {
      return this.coinSelectionService.getManualCoinSelectionSymbols(user);
    }
    return undefined;
  }

  private async executeBacktestStage(
    pipeline: Pipeline,
    config: HistoricalStageConfig | LiveReplayStageConfig,
    backtestType: BacktestType,
    label: string
  ): Promise<void> {
    const marketDataSetId = config.marketDataSetId ?? (await this.backtestDatasetService.getDefaultDatasetId());
    if (!marketDataSetId) {
      throw new Error('No market data set configured and no auto-generated dataset available');
    }

    const marketType = pipeline.strategyConfig.marketType ?? 'spot';
    const leverage = pipeline.strategyConfig.defaultLeverage ?? 1;

    const coinSymbolFilter = await this.resolveCoinSymbolFilter(pipeline);

    const backtest = await this.backtestService.createBacktest(pipeline.user as User, {
      name: `Pipeline ${pipeline.name} - ${label}`,
      type: backtestType,
      algorithmId: pipeline.strategyConfig.algorithmId,
      marketDataSetId,
      startDate: config.startDate,
      endDate: config.endDate,
      initialCapital: config.initialCapital,
      tradingFee: config.tradingFee ?? 0.001,
      strategyParams: pipeline.optimizedParameters as Record<string, any>,
      riskLevel: this.getUserRiskLevel(pipeline),
      ...(coinSymbolFilter?.length && { coinSymbolFilter })
    });

    if (marketType === 'futures') {
      await this.backtestService.updateBacktestFuturesConfig(backtest.id, marketType, leverage);
      this.logger.log(`Set futures config for backtest ${backtest.id}: marketType=${marketType}, leverage=${leverage}`);
    }

    if (backtestType === BacktestType.HISTORICAL) {
      pipeline.historicalBacktestId = backtest.id;
    } else {
      pipeline.liveReplayBacktestId = backtest.id;
    }
    await this.pipelineRepository.save(pipeline);

    this.logger.log(`Started ${label.toLowerCase()} backtest ${backtest.id} for pipeline ${pipeline.id}`);
  }

  private async executePaperTradingStage(pipeline: Pipeline): Promise<void> {
    const config = pipeline.stageConfig.paperTrading;

    if (!pipeline.user?.id) {
      throw new Error(`Pipeline ${pipeline.id} missing user relation for paper trading stage`);
    }

    const exchangeKey = await this.exchangeSelectionService.selectDefault(pipeline.user.id);

    const session = await this.paperTradingService.startFromPipeline({
      pipelineId: pipeline.id,
      algorithmId: pipeline.strategyConfig.algorithmId,
      exchangeKeyId: exchangeKey.id,
      initialCapital: config.initialCapital,
      optimizedParameters: pipeline.optimizedParameters as Record<string, number>,
      duration: config.duration,
      stopConditions: config.stopConditions,
      userId: pipeline.user.id,
      name: `Pipeline ${pipeline.name} - Paper Trading`,
      riskLevel: this.getUserRiskLevel(pipeline),
      minTrades: config.minTrades
    });

    pipeline.paperTradingSessionId = session.id;
    await this.pipelineRepository.save(pipeline);

    this.logger.log(`Started paper trading session ${session.id} for pipeline ${pipeline.id}`);
  }

  private getStageBacktestId(pipeline: Pipeline): string | undefined {
    return pipeline.currentStage === PipelineStage.HISTORICAL
      ? pipeline.historicalBacktestId
      : pipeline.liveReplayBacktestId;
  }

  async pauseCurrentStage(pipeline: Pipeline): Promise<void> {
    switch (pipeline.currentStage) {
      case PipelineStage.OPTIMIZE:
        this.logger.log(
          `Pipeline ${pipeline.id} paused during OPTIMIZE stage (optimization will complete but not advance)`
        );
        break;
      case PipelineStage.HISTORICAL:
        this.logger.log(`Pipeline ${pipeline.id}: HISTORICAL stage does not support pause — will complete normally`);
        break;
      case PipelineStage.LIVE_REPLAY: {
        const backtestId = this.getStageBacktestId(pipeline);
        if (backtestId) {
          await this.backtestLifecycleService.pauseBacktest(pipeline.user as User, backtestId);
        }
        break;
      }
      case PipelineStage.PAPER_TRADE:
        if (pipeline.paperTradingSessionId) {
          await this.paperTradingService.pause(pipeline.paperTradingSessionId, pipeline.user as User);
        }
        break;
    }
  }

  async resumeCurrentStage(pipeline: Pipeline, user: User): Promise<void> {
    switch (pipeline.currentStage) {
      case PipelineStage.OPTIMIZE: {
        if (!pipeline.optimizationRunId) {
          await this.enqueueStageJob(pipeline, pipeline.currentStage, user.id);
          break;
        }
        if (pipeline.stageResults?.optimization?.status === 'COMPLETED') {
          this.logger.log(`Pipeline ${pipeline.id}: OPTIMIZE already completed during pause — advancing on resume`);
          await this.progressionService.advanceToNextStage(pipeline);
          break;
        }
        this.logger.log(
          `Pipeline ${pipeline.id} resumed - optimization run ${pipeline.optimizationRunId} still in progress`
        );
        break;
      }
      case PipelineStage.HISTORICAL:
      case PipelineStage.LIVE_REPLAY: {
        const backtestId = this.getStageBacktestId(pipeline);
        if (!backtestId) {
          await this.enqueueStageJob(pipeline, pipeline.currentStage, user.id);
          break;
        }
        const backtest = await this.backtestService.getBacktest(user, backtestId);
        const terminalStatuses: BacktestStatus[] = [
          BacktestStatus.COMPLETED,
          BacktestStatus.FAILED,
          BacktestStatus.CANCELLED
        ];
        if (terminalStatuses.includes(backtest.status)) {
          this.logger.log(
            `Pipeline ${pipeline.id}: ${pipeline.currentStage} backtest already terminal (${backtest.status}) on resume — skipping resumeBacktest`
          );
          await this.progressionService.advanceToNextStage(pipeline);
          break;
        }
        await this.backtestLifecycleService.resumeBacktest(user, backtestId);
        break;
      }
      case PipelineStage.PAPER_TRADE:
        if (!pipeline.paperTradingSessionId) {
          await this.enqueueStageJob(pipeline, pipeline.currentStage, user.id);
          break;
        }
        await this.paperTradingService.resume(pipeline.paperTradingSessionId, user);
        break;
      default:
        await this.enqueueStageJob(pipeline, pipeline.currentStage, user.id);
    }
  }

  async cancelCurrentStage(pipeline: Pipeline): Promise<void> {
    switch (pipeline.currentStage) {
      case PipelineStage.OPTIMIZE:
        if (pipeline.optimizationRunId) {
          await this.optimizationService.cancelOptimization(pipeline.optimizationRunId);
        }
        break;
      case PipelineStage.HISTORICAL:
      case PipelineStage.LIVE_REPLAY: {
        const backtestId = this.getStageBacktestId(pipeline);
        if (backtestId) {
          await this.backtestLifecycleService.cancelBacktest(pipeline.user as User, backtestId);
        }
        break;
      }
      case PipelineStage.PAPER_TRADE:
        if (pipeline.paperTradingSessionId) {
          await this.paperTradingService.stop(
            pipeline.paperTradingSessionId,
            pipeline.user as User,
            'pipeline_cancelled'
          );
        }
        break;
    }
  }
}
