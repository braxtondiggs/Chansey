import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { DataSource, Repository } from 'typeorm';

import { BacktestStreamService } from './backtest-stream.service';
import {
  Backtest,
  BacktestPerformanceSnapshot,
  BacktestSignal,
  BacktestStatus,
  BacktestTrade,
  SimulatedOrderFill
} from './backtest.entity';

export interface BacktestFinalMetrics {
  finalValue: number;
  totalReturn: number;
  annualizedReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  totalTrades: number;
  winningTrades: number;
  winRate: number;
}

@Injectable()
export class BacktestResultService {
  private readonly logger = new Logger(BacktestResultService.name);

  constructor(
    @InjectRepository(Backtest) private readonly backtestRepository: Repository<Backtest>,
    private readonly dataSource: DataSource,
    private readonly backtestStream: BacktestStreamService
  ) {}

  async persistSuccess(
    backtest: Backtest,
    results: {
      trades: Partial<BacktestTrade>[];
      signals: Partial<BacktestSignal>[];
      simulatedFills: Partial<SimulatedOrderFill>[];
      snapshots: Partial<BacktestPerformanceSnapshot>[];
      finalMetrics: BacktestFinalMetrics;
    }
  ): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      if (results.signals?.length) {
        await queryRunner.manager.save(BacktestSignal, results.signals);
      }

      if (results.simulatedFills?.length) {
        await queryRunner.manager.save(SimulatedOrderFill, results.simulatedFills);
      }

      if (results.trades?.length) {
        await queryRunner.manager.save(BacktestTrade, results.trades);
      }

      if (results.snapshots?.length) {
        await queryRunner.manager.save(BacktestPerformanceSnapshot, results.snapshots);
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

      await queryRunner.manager.save(Backtest, backtest);

      await queryRunner.commitTransaction();
      this.logger.log(`Backtest ${backtest.id} results persisted successfully`);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`Failed to persist backtest ${backtest.id} results: ${error.message}`, error.stack);
      throw error;
    } finally {
      await queryRunner.release();
    }

    // Publish status AFTER transaction commits to ensure consistency
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
