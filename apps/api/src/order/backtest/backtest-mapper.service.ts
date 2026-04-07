import { Injectable } from '@nestjs/common';

import { BacktestRunDetail, BacktestRunSummary } from '@chansey/api-interfaces';

import { BacktestPerformanceSnapshot } from './backtest-performance-snapshot.entity';
import { BacktestSignal as BacktestSignalEntity } from './backtest-signal.entity';
import { Backtest, BacktestType } from './backtest.entity';
import { SimulatedOrderFill as SimulatedOrderFillEntity } from './simulated-order-fill.entity';

import { User } from '../../users/users.entity';

@Injectable()
export class BacktestMapper {
  mapRunSummary(backtest: Backtest): BacktestRunSummary {
    const completedAt = backtest.completedAt;

    return {
      id: backtest.id,
      name: backtest.name,
      description: backtest.description,
      algorithm: {
        id: backtest.algorithm?.id,
        name: backtest.algorithm?.name
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

  mapRunDetail(backtest: Backtest, counts?: { signalsCount?: number; tradesCount?: number }): BacktestRunDetail {
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

  mapKeyMetrics(backtest: Backtest) {
    const pm = (backtest.performanceMetrics ?? {}) as Record<string, number | string | undefined>;
    return {
      totalReturn: backtest.totalReturn ?? (pm.totalReturn as number | undefined),
      annualizedReturn: backtest.annualizedReturn ?? (pm.annualizedReturn as number | undefined),
      sharpeRatio: backtest.sharpeRatio ?? (pm.sharpeRatio as number | undefined),
      maxDrawdown: backtest.maxDrawdown ?? (pm.maxDrawdown as number | undefined),
      winRate: backtest.winRate,
      totalTrades: backtest.totalTrades,
      winningTrades: backtest.winningTrades,
      profitFactor: pm.profitFactor as number | undefined,
      maxAdverseExcursion: pm.maxAdverseExcursion as number | undefined,
      volatility: pm.volatility as number | undefined,
      benchmarkSymbol: pm.benchmarkSymbol as string | undefined,
      benchmarkReturn: pm.benchmarkReturn as number | undefined
    };
  }

  mapSignal(signal: BacktestSignalEntity, backtestId?: string) {
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

  mapSimulatedFill(fill: SimulatedOrderFillEntity, backtestId?: string) {
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

  mapPerformanceSnapshot(snapshot: BacktestPerformanceSnapshot) {
    return {
      timestamp: snapshot.timestamp,
      portfolioValue: snapshot.portfolioValue,
      cumulativeReturn: snapshot.cumulativeReturn,
      drawdown: snapshot.drawdown
    };
  }

  mapRunMode(type: BacktestType) {
    return type === BacktestType.LIVE_REPLAY ? 'live_replay' : 'historical';
  }

  createUserRef(user?: User) {
    if (!user) {
      return { id: 'system', displayName: 'System' };
    }

    const displayName = [user.given_name, user.family_name].filter(Boolean).join(' ').trim() || user.email || user.id;
    return { id: user.id, displayName };
  }

  encodeCursor(date: Date, id: string, field: 'createdAt' | 'timestamp' = 'createdAt'): string {
    const payload = { id, [field]: date.toISOString() };
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  }

  decodeCursor(cursor: string): Record<string, string> | null {
    try {
      return JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
    } catch {
      return null;
    }
  }

  clampPageSize(size: number): number {
    return Math.min(Math.max(size, 10), 500);
  }
}
