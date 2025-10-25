import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { BacktestStreamService } from './backtest-stream.service';
import {
  Backtest,
  BacktestPerformanceSnapshot,
  BacktestSignal,
  BacktestStatus,
  BacktestTrade,
  SimulatedOrderFill
} from './backtest.entity';

@Injectable()
export class BacktestResultService {
  constructor(
    @InjectRepository(Backtest) private readonly backtestRepository: Repository<Backtest>,
    @InjectRepository(BacktestTrade) private readonly backtestTradeRepository: Repository<BacktestTrade>,
    @InjectRepository(BacktestSignal) private readonly backtestSignalRepository: Repository<BacktestSignal>,
    @InjectRepository(SimulatedOrderFill) private readonly simulatedFillRepository: Repository<SimulatedOrderFill>,
    @InjectRepository(BacktestPerformanceSnapshot)
    private readonly backtestSnapshotRepository: Repository<BacktestPerformanceSnapshot>,
    private readonly backtestStream: BacktestStreamService
  ) {}

  async persistSuccess(
    backtest: Backtest,
    results: {
      trades: Partial<BacktestTrade>[];
      signals: Partial<BacktestSignal>[];
      simulatedFills: Partial<SimulatedOrderFill>[];
      snapshots: Partial<BacktestPerformanceSnapshot>[];
      finalMetrics: Record<string, unknown>;
    }
  ): Promise<void> {
    if (results.signals?.length) {
      await this.backtestSignalRepository.save(results.signals);
    }

    if (results.simulatedFills?.length) {
      await this.simulatedFillRepository.save(results.simulatedFills);
    }

    if (results.trades?.length) {
      await this.backtestTradeRepository.save(results.trades);
    }

    if (results.snapshots?.length) {
      await this.backtestSnapshotRepository.save(results.snapshots);
    }

    Object.assign(backtest, {
      finalValue: results.finalMetrics.finalValue,
      totalReturn: results.finalMetrics.totalReturn,
      annualizedReturn: results.finalMetrics.annualizedReturn,
      sharpeRatio: results.finalMetrics.sharpeRatio,
      maxDrawdown: results.finalMetrics.maxDrawdown,
      totalTrades: results.finalMetrics.totalTrades,
      winningTrades: results.finalMetrics.winningTrades,
      winRate: results.finalMetrics.winRate,
      status: BacktestStatus.COMPLETED,
      completedAt: new Date()
    });

    await this.backtestRepository.save(backtest);
    await this.backtestStream.publishStatus(backtest.id, 'completed');
  }

  async markFailed(backtestId: string, errorMessage: string): Promise<void> {
    await this.backtestRepository.update(backtestId, {
      status: BacktestStatus.FAILED,
      errorMessage
    });

    await this.backtestStream.publishStatus(backtestId, 'failed', errorMessage);
  }

  async markCancelled(backtest: Backtest, reason?: string): Promise<void> {
    backtest.status = BacktestStatus.CANCELLED;
    await this.backtestRepository.save(backtest);
    await this.backtestStream.publishStatus(backtest.id, 'cancelled', reason);
  }
}
