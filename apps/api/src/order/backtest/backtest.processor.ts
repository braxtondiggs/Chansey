import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Job } from 'bullmq';
import { Repository } from 'typeorm';

import { BacktestEngine, MarketData, TradingSignal } from './backtest-engine.service';
import { Backtest, BacktestTrade, BacktestPerformanceSnapshot, BacktestStatus } from './backtest.entity';

import { AlgorithmService } from '../../algorithm/algorithm.service';
import { CoinService } from '../../coin/coin.service';

interface BacktestJobData {
  backtestId: string;
  userId: string;
}

@Processor('backtest-queue')
@Injectable()
export class BacktestProcessor extends WorkerHost {
  private readonly logger = new Logger(BacktestProcessor.name);

  constructor(
    private readonly backtestEngine: BacktestEngine,
    private readonly algorithmService: AlgorithmService,
    private readonly coinService: CoinService,
    @InjectRepository(Backtest) private readonly backtestRepository: Repository<Backtest>,
    @InjectRepository(BacktestTrade) private readonly backtestTradeRepository: Repository<BacktestTrade>,
    @InjectRepository(BacktestPerformanceSnapshot)
    private readonly backtestSnapshotRepository: Repository<BacktestPerformanceSnapshot>
  ) {
    super();
  }

  async process(job: Job<BacktestJobData>): Promise<void> {
    const { backtestId, userId } = job.data;
    
    this.logger.log(`Processing backtest job: ${backtestId} for user: ${userId}`);

    try {
      // Get the backtest
      const backtest = await this.backtestRepository.findOne({
        where: { id: backtestId },
        relations: ['algorithm', 'user']
      });

      if (!backtest) {
        throw new Error(`Backtest ${backtestId} not found`);
      }

      if (backtest.status !== BacktestStatus.PENDING) {
        this.logger.warn(`Backtest ${backtestId} is not in PENDING status, skipping`);
        return;
      }

      // Mark as running
      backtest.status = BacktestStatus.RUNNING;
      await this.backtestRepository.save(backtest);

      // Get coins for this algorithm (for now, get some popular coins)
      // TODO: This should be configurable or based on algorithm preferences
      const coins = await this.coinService.getPopularCoins();
      
      if (!coins || coins.length === 0) {
        throw new Error('No coins available for backtesting');
      }

      // Execute the backtest using a simple strategy
      // TODO: Load the actual strategy function from the algorithm
      const strategyFunction = this.createSimpleMovingAverageStrategy();

      const results = await this.backtestEngine.executeHistoricalBacktest(
        backtest,
        coins.slice(0, 5), // Limit to first 5 coins for now
        strategyFunction
      );

      // Save trades
      const trades = results.trades.map(trade => ({
        ...trade,
        backtest
      }));
      
      if (trades.length > 0) {
        await this.backtestTradeRepository.save(trades);
      }

      // Save performance snapshots
      const snapshots = results.snapshots.map(snapshot => ({
        ...snapshot,
        backtest
      }));
      
      if (snapshots.length > 0) {
        await this.backtestSnapshotRepository.save(snapshots);
      }

      // Update backtest with final results
      Object.assign(backtest, results.finalMetrics);
      backtest.status = BacktestStatus.COMPLETED;
      await this.backtestRepository.save(backtest);

      this.logger.log(`Backtest ${backtestId} completed successfully`);

    } catch (error) {
      this.logger.error(`Backtest ${backtestId} failed: ${error.message}`, error.stack);

      // Mark as failed
      await this.backtestRepository.update(backtestId, {
        status: BacktestStatus.FAILED,
        errorMessage: error.message
      });
    }
  }

  /**
   * Simple moving average crossover strategy for demonstration
   */
  private createSimpleMovingAverageStrategy() {
    return async (marketData: MarketData) => {
      const signals: TradingSignal[] = [];
      
      for (const [coinId] of marketData.prices) {
        // Simple buy signal when price is above moving average
        // This is just a placeholder - real strategies would be much more sophisticated
        if (Math.random() > 0.8) { // Random 20% chance to trade
          signals.push({
            action: Math.random() > 0.5 ? 'BUY' : 'SELL',
            coinId,
            percentage: 0.1, // 10% of portfolio
            reason: `Simple MA strategy: ${Math.random() > 0.5 ? 'bullish' : 'bearish'} signal`,
            confidence: Math.random()
          });
        }
      }
      
      return signals;
    };
  }
}
