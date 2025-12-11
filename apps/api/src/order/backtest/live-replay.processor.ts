import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Job } from 'bullmq';
import { Repository } from 'typeorm';

import { BacktestEngine } from './backtest-engine.service';
import { BacktestResultService } from './backtest-result.service';
import { BacktestStreamService } from './backtest-stream.service';
import { backtestConfig } from './backtest.config';
import { Backtest, BacktestStatus, BacktestType } from './backtest.entity';
import { BacktestJobData } from './backtest.job-data';
import { MarketDataSet } from './market-data-set.entity';

import { Coin } from '../../coin/coin.entity';
import { CoinService } from '../../coin/coin.service';
import { MetricsService } from '../../metrics/metrics.service';

const BACKTEST_QUEUE_NAMES = backtestConfig();

@Injectable()
@Processor(BACKTEST_QUEUE_NAMES.replayQueue)
export class LiveReplayProcessor extends WorkerHost {
  private readonly logger = new Logger(LiveReplayProcessor.name);

  constructor(
    private readonly backtestEngine: BacktestEngine,
    private readonly coinService: CoinService,
    private readonly backtestStream: BacktestStreamService,
    private readonly backtestResultService: BacktestResultService,
    private readonly metricsService: MetricsService,
    @InjectRepository(Backtest) private readonly backtestRepository: Repository<Backtest>,
    @InjectRepository(MarketDataSet) private readonly marketDataSetRepository: Repository<MarketDataSet>
  ) {
    super();
  }

  async process(job: Job<BacktestJobData>): Promise<void> {
    const { backtestId, userId, datasetId, deterministicSeed, algorithmId, mode } = job.data;
    this.logger.log(`Processing live replay backtest ${backtestId} for user ${userId}`);

    const strategyName = algorithmId ?? 'unknown';
    const endTimer = this.metricsService.startBacktestTimer(strategyName);

    try {
      const backtest = await this.backtestRepository.findOne({
        where: { id: backtestId },
        relations: ['algorithm', 'marketDataSet', 'user']
      });

      if (!backtest) {
        throw new Error(`Backtest ${backtestId} not found`);
      }

      if (backtest.type !== BacktestType.LIVE_REPLAY) {
        this.logger.warn(`Backtest ${backtestId} is not configured for live replay. Type: ${backtest.type}`);
        return;
      }

      if (backtest.status !== BacktestStatus.PENDING) {
        this.logger.warn(`Backtest ${backtestId} is not pending. Current status: ${backtest.status}`);
        return;
      }

      const dataset =
        backtest.marketDataSet ?? (await this.marketDataSetRepository.findOne({ where: { id: datasetId } }));
      if (!dataset) {
        throw new Error(`Market dataset ${datasetId} not found`);
      }

      if (!dataset.replayCapable) {
        throw new Error('Dataset is not flagged as replay capable');
      }

      backtest.status = BacktestStatus.RUNNING;
      await this.backtestRepository.save(backtest);
      await this.backtestStream.publishStatus(backtest.id, 'running', undefined, { mode });

      const coins = await this.resolveCoins(dataset);
      if (!coins.length) {
        throw new Error('No coins resolved for dataset instrument universe');
      }

      const results = await this.backtestEngine.executeHistoricalBacktest(backtest, coins, {
        dataset,
        deterministicSeed,
        telemetryEnabled: true
      });

      await this.backtestResultService.persistSuccess(backtest, results);
      this.metricsService.recordBacktestCompleted(strategyName, 'success');
    } catch (error) {
      this.logger.error(`Live replay backtest ${backtestId} failed: ${error.message}`, error.stack);
      await this.backtestResultService.markFailed(backtestId, error.message);
      this.metricsService.recordBacktestCompleted(strategyName, 'failed');
    } finally {
      endTimer();
    }
  }

  private async resolveCoins(dataset: MarketDataSet): Promise<Coin[]> {
    const instruments = dataset.instrumentUniverse ?? [];
    const resolved: Coin[] = [];

    for (const instrument of instruments) {
      const symbol = instrument.toUpperCase();
      try {
        const direct = await this.coinService.getCoinBySymbol(symbol);
        if (direct) {
          resolved.push(direct);
          continue;
        }
      } catch (error) {
        this.logger.debug(`Failed to resolve symbol ${symbol}: ${error.message}`);
      }

      const baseCandidate = symbol.replace(/(USDT|USD|BTC|ETH)$/i, '');
      if (baseCandidate && baseCandidate !== symbol) {
        try {
          const baseCoin = await this.coinService.getCoinBySymbol(baseCandidate);
          if (baseCoin) {
            resolved.push(baseCoin);
            continue;
          }
        } catch (error) {
          this.logger.debug(`Failed to resolve base symbol ${baseCandidate}: ${error.message}`);
        }
      }
    }

    if (!resolved.length) {
      this.logger.warn('Falling back to popular coins for live replay due to unresolved instrument universe');
      return (await this.coinService.getPopularCoins()).slice(0, 5);
    }

    return resolved.slice(0, 5);
  }
}
