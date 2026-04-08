import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Decimal } from 'decimal.js';
import { Repository } from 'typeorm';

import {
  AlgorithmComparisonDto,
  ComparisonDto,
  DeviationMetricsDto,
  PerformanceMetricsDto
} from './dto/comparison.dto';
import {
  calculateDeviationPercent,
  DEFAULT_THRESHOLDS,
  latestPerformanceCondition,
  toInt,
  toNumber
} from './live-trade-monitoring.utils';

import { AlgorithmActivation } from '../../algorithm/algorithm-activation.entity';
import { Algorithm } from '../../algorithm/algorithm.entity';
import { Backtest, BacktestStatus } from '../../order/backtest/backtest.entity';
import { SimulatedOrderFill } from '../../order/backtest/simulated-order-fill.entity';
import { Order } from '../../order/order.entity';

@Injectable()
export class LiveTradeComparisonService {
  constructor(
    @InjectRepository(AlgorithmActivation)
    private readonly activationRepo: Repository<AlgorithmActivation>,
    @InjectRepository(Backtest)
    private readonly backtestRepo: Repository<Backtest>,
    @InjectRepository(SimulatedOrderFill)
    private readonly fillRepo: Repository<SimulatedOrderFill>,
    @InjectRepository(Algorithm)
    private readonly algorithmRepo: Repository<Algorithm>
  ) {}

  async getComparison(algorithmId: string): Promise<ComparisonDto> {
    const algorithm = await this.algorithmRepo.findOne({ where: { id: algorithmId } });
    if (!algorithm) {
      throw new NotFoundException(`Algorithm with ID '${algorithmId}' not found`);
    }

    const periodStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const liveMetrics = await this.getLiveMetrics(algorithmId, periodStart);

    const backtest = await this.backtestRepo.findOne({
      where: { algorithm: { id: algorithmId }, status: BacktestStatus.COMPLETED },
      order: { completedAt: 'DESC' }
    });

    let backtestMetrics: PerformanceMetricsDto | undefined;
    if (backtest) {
      backtestMetrics = {
        totalReturn: backtest.totalReturn,
        sharpeRatio: backtest.sharpeRatio,
        winRate: backtest.winRate,
        maxDrawdown: backtest.maxDrawdown,
        totalTrades: backtest.totalTrades,
        avgSlippageBps: await this.getBacktestAvgSlippage(backtest.id)
      };
    }

    const deviations = this.calculateDeviations(liveMetrics, backtestMetrics);
    const alerts = this.generateComparisonAlerts(liveMetrics, backtestMetrics);

    const comparison: AlgorithmComparisonDto = {
      algorithmId,
      algorithmName: algorithm.name,
      activeActivations: await this.activationRepo.count({ where: { algorithmId, isActive: true } }),
      totalLiveOrders: liveMetrics.totalTrades ?? 0,
      backtestId: backtest?.id,
      backtestName: backtest?.name,
      liveMetrics,
      backtestMetrics,
      deviations,
      hasSignificantDeviation: alerts.length > 0,
      alerts
    };

    return {
      comparison,
      periodStart: periodStart.toISOString(),
      periodEnd: new Date().toISOString(),
      calculatedAt: new Date().toISOString()
    };
  }

  private async getLiveMetrics(algorithmId: string, periodStart?: Date): Promise<PerformanceMetricsDto> {
    const orderCondition = periodStart
      ? 'o.algorithmActivationId = aa.id AND o.isAlgorithmicTrade = true AND o.createdAt >= :periodStart'
      : 'o.algorithmActivationId = aa.id AND o.isAlgorithmicTrade = true';

    const qb = this.activationRepo
      .createQueryBuilder('aa')
      .leftJoin(
        'algorithm_performances',
        'ap',
        `ap.algorithmActivationId = aa.id AND ${latestPerformanceCondition('ap')}`
      )
      .leftJoin(Order, 'o', orderCondition);

    if (periodStart) {
      qb.setParameter('periodStart', periodStart);
    }

    const result = await qb
      .select('COALESCE(AVG(ap.roi), 0)', 'totalReturn')
      .addSelect('COALESCE(AVG(ap.sharpeRatio), 0)', 'sharpeRatio')
      .addSelect('COALESCE(AVG(ap.winRate), 0)', 'winRate')
      .addSelect('COALESCE(AVG(ap.maxDrawdown), 0)', 'maxDrawdown')
      .addSelect('COUNT(o.id)', 'totalTrades')
      .addSelect('COALESCE(AVG(o.actualSlippageBps), 0)', 'avgSlippageBps')
      .addSelect('COALESCE(SUM(o.cost), 0)', 'totalVolume')
      .addSelect('COALESCE(AVG(ap.volatility), 0)', 'volatility')
      .where('aa.algorithmId = :algorithmId', { algorithmId })
      .andWhere('aa.isActive = true')
      .getRawOne();

    return {
      totalReturn: toNumber(result?.totalReturn),
      sharpeRatio: toNumber(result?.sharpeRatio),
      winRate: toNumber(result?.winRate),
      maxDrawdown: toNumber(result?.maxDrawdown),
      totalTrades: toInt(result?.totalTrades),
      avgSlippageBps: toNumber(result?.avgSlippageBps),
      totalVolume: toNumber(result?.totalVolume),
      volatility: toNumber(result?.volatility)
    };
  }

  private async getBacktestAvgSlippage(backtestId: string): Promise<number> {
    const result = await this.fillRepo
      .createQueryBuilder('f')
      .select('COALESCE(AVG(f.slippageBps), 0)', 'avgSlippageBps')
      .where('f.backtest.id = :backtestId', { backtestId })
      .getRawOne();

    return toNumber(result?.avgSlippageBps);
  }

  private calculateDeviations(
    live: PerformanceMetricsDto,
    backtest?: PerformanceMetricsDto
  ): DeviationMetricsDto | undefined {
    if (!backtest) return undefined;

    const safeDeviation = (liveVal?: number, backtestVal?: number): number | undefined => {
      if (liveVal === undefined || backtestVal === undefined) return undefined;
      return calculateDeviationPercent(liveVal, backtestVal);
    };

    return {
      totalReturn: safeDeviation(live.totalReturn, backtest.totalReturn),
      sharpeRatio: safeDeviation(live.sharpeRatio, backtest.sharpeRatio),
      winRate: safeDeviation(live.winRate, backtest.winRate),
      maxDrawdown: safeDeviation(live.maxDrawdown, backtest.maxDrawdown),
      avgSlippageBps:
        live.avgSlippageBps !== undefined && backtest.avgSlippageBps !== undefined
          ? new Decimal(live.avgSlippageBps).minus(backtest.avgSlippageBps).toNumber()
          : undefined
    };
  }

  private generateComparisonAlerts(live: PerformanceMetricsDto, backtest?: PerformanceMetricsDto): string[] {
    const alerts: string[] = [];
    if (!backtest) {
      alerts.push('No completed backtest available for comparison');
      return alerts;
    }

    const deviations = this.calculateDeviations(live, backtest);
    if (!deviations) return alerts;

    if (deviations.totalReturn !== undefined && deviations.totalReturn < -DEFAULT_THRESHOLDS.totalReturnWarning) {
      alerts.push(`Total return ${deviations.totalReturn.toFixed(1)}% lower than backtest`);
    }
    if (deviations.sharpeRatio !== undefined && deviations.sharpeRatio < -DEFAULT_THRESHOLDS.sharpeRatioWarning) {
      alerts.push(`Sharpe ratio ${Math.abs(deviations.sharpeRatio).toFixed(1)}% lower than backtest`);
    }
    if (deviations.winRate !== undefined && deviations.winRate < -DEFAULT_THRESHOLDS.winRateWarning) {
      alerts.push(`Win rate ${Math.abs(deviations.winRate).toFixed(1)}% lower than backtest`);
    }
    if (deviations.maxDrawdown !== undefined && deviations.maxDrawdown > DEFAULT_THRESHOLDS.maxDrawdownWarning) {
      alerts.push(`Max drawdown ${deviations.maxDrawdown.toFixed(1)}% higher than backtest`);
    }
    if (deviations.avgSlippageBps !== undefined && deviations.avgSlippageBps > DEFAULT_THRESHOLDS.slippageWarningBps) {
      alerts.push(`Slippage ${deviations.avgSlippageBps.toFixed(1)} bps higher than backtest`);
    }

    return alerts;
  }
}
